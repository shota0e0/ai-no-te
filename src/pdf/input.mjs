import { execFileSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const LIMITS = Object.freeze({ bytes: 512 * 1024 * 1024, pages: 500, pagePixels: 100_000_000, totalPixels: 500_000_000 });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(executable, args, label) {
  try {
    return execFileSync(executable, args, {
      encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
  } catch (error) {
    if (/password|encrypted/i.test(String(error.stderr))) throw new Error("Encrypted PDFs are not supported. Export an unencrypted PDF locally.");
    throw new Error(`${label} failed or timed out. Check the PDF and your Poppler installation; no fallback or download is performed.`);
  }
}

export function discoverPoppler(env = process.env) {
  const tools = {};
  for (const [name, key] of [["pdftoppm", "AINOTE_PDF_PDFTOPPM"], ["pdfinfo", "AINOTE_PDF_PDFINFO"]]) {
    const basename = process.platform === "win32" ? `${name}.exe` : name;
    const executable = env[key] || (env.PATH ?? env.Path ?? "").split(path.delimiter)
      .filter(Boolean).map(dir => path.resolve(dir, basename)).find(candidate => existsSync(candidate)) || name;
    if (env[key] && !path.isAbsolute(executable)) throw new Error(`${key} must be an absolute executable path.`);
    try {
      // Poppler prints version information to stderr even on success.
      execFileSync(executable, ["-v"], { timeout: 10_000, windowsHide: true, stdio: "pipe" });
    } catch {
      throw new Error(`${name} is unavailable. Install Poppler separately and check PATH or ${key}; automatic installation and renderer fallback are disabled.`);
    }
    tools[name] = executable;
  }
  return tools;
}

async function sourceInfo(input) {
  if (typeof input !== "string" || !input) throw new Error("--input requires a PDF file.");
  const source = path.resolve(input);
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new Error("Input PDF does not exist or is not a regular file.");
  if (info.size > LIMITS.bytes) throw new Error("PDF exceeds the 512 MiB input limit.");
  const bytes = await readFile(source);
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Input is not a PDF.");
  return { source, basename: path.basename(source), sha256: digest(bytes) };
}

export async function inspectPdf(input, { env = process.env } = {}) {
  const tools = discoverPoppler(env);
  const source = await sourceInfo(input);
  const header = run(tools.pdfinfo, [source.source], "PDF inspection");
  if (/Encrypted:\s+yes/i.test(header)) throw new Error("Encrypted PDFs are not supported. Export an unencrypted PDF locally.");
  if (!/Encrypted:\s+no/i.test(header)) throw new Error("Cannot establish PDF encryption status; inspection stopped.");
  const pageCount = Number(header.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > LIMITS.pages) throw new Error("Invalid PDF page count or more than 500 pages.");
  const details = run(tools.pdfinfo, ["-f", "1", "-l", String(pageCount), "-box", source.source], "PDF page inspection");
  const pages = [];
  for (let number = 1; number <= pageCount; number++) {
    const size = details.match(new RegExp(`^Page\\s+${number} size:\\s+([\\d.]+) x ([\\d.]+) pts`, "m"));
    const rotation = details.match(new RegExp(`^Page\\s+${number} rot:\\s+(-?\\d+)`, "m"));
    const box = details.match(new RegExp(`^Page\\s+${number} MediaBox:\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)`, "m"));
    if (!size || !rotation || !box) throw new Error("Unsupported pdfinfo page output; check your Poppler version.");
    const coords = box.slice(1).map(Number);
    const widthPt = coords[2] - coords[0], heightPt = coords[3] - coords[1];
    if (!(widthPt > 0 && heightPt > 0)) throw new Error("Invalid PDF page dimensions.");
    pages.push({ pageNumber: number, widthPt, heightPt, rotation: Number(rotation[1]) });
  }
  if ((await sourceInfo(source.source)).sha256 !== source.sha256) throw new Error("Source PDF changed during inspection; retry with a stable file.");
  return { schemaVersion: 1, basename: source.basename, exists: true, sha256: source.sha256, encrypted: false, pageCount, pages };
}

export function parsePages(value, count) {
  if (value === "all") return Array.from({ length: count }, (_, i) => i + 1);
  if (typeof value !== "string" || !value) throw new Error("--pages is required: all, 2, 2,3 or 2-5.");
  const selected = new Set();
  for (const part of value.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) throw new Error("Invalid page selection. Use all, a page list, or an ascending range.");
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last > count || first > last) throw new Error(`Page selection must be between 1 and ${count}.`);
    for (let page = first; page <= last; page++) selected.add(page);
  }
  return [...selected].sort((a, b) => a - b);
}

export function pngInfo(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Renderer did not produce a valid PNG header.");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > LIMITS.pagePixels) throw new Error("Invalid PNG dimensions or page pixel limit exceeded.");
  return { width, height, sha256: digest(bytes) };
}

export async function renderPdf(input, selection, { output, env = process.env } = {}) {
  const tools = discoverPoppler(env);
  const inspected = await inspectPdf(input, { env });
  const selectedPages = parsePages(selection, inspected.pageCount);
  let pixels = 0;
  for (const number of selectedPages) {
    const page = inspected.pages[number - 1];
    const size = Math.ceil(page.widthPt * 300 / 72) * Math.ceil(page.heightPt * 300 / 72);
    if (size > LIMITS.pagePixels || (pixels += size) > LIMITS.totalPixels) throw new Error("Rendering exceeds the 100 MP/page or 500 MP/job limit. Select fewer pages.");
  }
  let directory;
  if (output !== undefined) {
    if (!output.trim()) throw new Error("Invalid output directory.");
    const requested = path.resolve(output);
    if (await lstat(requested).catch(() => null)) throw new Error("Output already exists; choose a new job directory. Nothing was overwritten.");
    const parent = await realpath(path.dirname(requested)).catch(() => null);
    if (!parent || !(await stat(parent)).isDirectory()) throw new Error("Output parent must be an existing directory.");
    directory = path.join(parent, path.basename(requested));
    await mkdir(directory, { mode: 0o700 });
  } else directory = await mkdtemp(path.join(os.tmpdir(), "ai-no-te-pdf-"));
  const generatedFiles = [];
  try {
    const original = path.join(directory, "original.pdf");
    await copyFile(path.resolve(input), original, constants.COPYFILE_EXCL);
    if ((await sourceInfo(original)).sha256 !== inspected.sha256) throw new Error("Source changed before copying; output is incomplete.");
    for (const pageNumber of selectedPages) {
      const filename = `page-${String(pageNumber).padStart(3, "0")}.png`;
      const prefix = path.join(directory, filename.slice(0, -4));
      run(tools.pdftoppm, ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-r", "300", "-png", original, prefix], "PNG rendering");
      const png = pngInfo(await readFile(`${prefix}.png`));
      const page = inspected.pages[pageNumber - 1];
      const sideways = Math.abs(page.rotation) % 180 === 90;
      const expectedWidth = Math.ceil((sideways ? page.heightPt : page.widthPt) * 300 / 72);
      const expectedHeight = Math.ceil((sideways ? page.widthPt : page.heightPt) * 300 / 72);
      // pdfinfo rounds points; allow one pixel of rounding, never a resize.
      if (Math.abs(png.width - expectedWidth) > 1 || Math.abs(png.height - expectedHeight) > 1) throw new Error("PNG dimensions do not match full-page 300 DPI rendering.");
      generatedFiles.push({ pageNumber, filename, ...png });
    }
    if ((await sourceInfo(input)).sha256 !== inspected.sha256 || (await sourceInfo(original)).sha256 !== inspected.sha256) throw new Error("Source PDF hash changed; output must not be used.");
    // pdfinfo reports the producer, not the renderer version. Capture -v separately.
    const { spawnSync } = await import("node:child_process");
    const version = spawnSync(tools.pdftoppm, ["-v"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    const rendererVersion = `${version.stdout ?? ""}\n${version.stderr ?? ""}`.match(/pdftoppm version ([\w.\-]+)/)?.[1] ?? "not available";
    const metadata = { schemaVersion: 1, status: "complete", source: { ...inspected, filename: "original.pdf" }, selectedPages, renderer: { name: "Poppler pdftoppm", version: rendererVersion }, dpi: 300, generatedAt: new Date().toISOString(), generatedFiles };
    await writeFile(path.join(directory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
    return { ...metadata, outputDirectory: directory, externalWrites: 0 };
  } catch (error) {
    await writeFile(path.join(directory, "failure.json"), JSON.stringify({ status: "incomplete", generatedFiles, message: error.message }), { flag: "wx" }).catch(() => {});
    throw new Error(`PDF job incomplete at ${directory}. Do not use its output; inspect failure.json and retry in a new directory. ${error.message}`);
  }
}

export async function pdfCommand(args) {
  const action = args[0];
  if (!["inspect", "render"].includes(action)) throw new Error("Use pdf inspect or pdf render.");
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const name = args[i];
    if (name === "--json" && !options.json) { options.json = true; continue; }
    if (!["--input", ...(action === "render" ? ["--pages", "--output"] : [])].includes(name) || options[name] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown, repeated or incomplete PDF option.");
    options[name] = args[++i];
  }
  const result = action === "inspect" ? await inspectPdf(options["--input"]) : await renderPdf(options["--input"], options["--pages"], { output: options["--output"] });
  if (options.json) return result;
  if (action === "render") return `LOCAL PDF RENDER — NO EXTERNAL WRITE\nOutput: ${result.outputDirectory}\nSelected pages: ${result.selectedPages.join(", ")}\nRenderer: ${result.renderer.name} ${result.renderer.version}; 300 DPI\nOriginal preserved; metadata.json records PDF/PNG hashes.\n`;
  return `PDF INSPECT — READ ONLY\nInput: ${JSON.stringify(result.basename)}\nExists: yes\nSHA-256: ${result.sha256}\nEncrypted: no\nPages: ${result.pageCount}\n${result.pages.map(p => `Page ${p.pageNumber}: ${p.widthPt} x ${p.heightPt} pt; rotation ${p.rotation}`).join("\n")}\n`;
}
