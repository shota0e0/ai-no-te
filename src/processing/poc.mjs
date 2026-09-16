import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pngInfo } from "../pdf/input.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const MODES = ["clean", "interpreted"];
const UNKNOWN = "not exposed by runtime";
export const PROVIDER = Object.freeze({ provider: "OpenAI", tool: "image_gen", access: "Codex built-in, operator-mediated", model: UNKNOWN, modelVersion: UNKNOWN, seed: UNKNOWN, cost: "unknown" });
function modeCheck(mode) {
  if (!MODES.includes(mode)) throw new Error("Mode must be clean or interpreted.");
  return mode;
}
async function bytesAt(file, limit = 128 * 1024 * 1024) {
  if (typeof file !== "string" || !file) throw new Error("Input file is required.");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error("Input file is missing or not a regular file.");
  if (info.size > limit) throw new Error("Input exceeds the processing file-size limit.");
  return readFile(file);
}
export async function loadPrompt(mode, version = mode === "interpreted" ? 2 : 1) {
  modeCheck(mode);
  if (!Number.isInteger(version) || ![1, ...(mode === "interpreted" ? [2] : [])].includes(version)) throw new Error("Unsupported prompt version.");
  const filename = `${mode}-v${version}.txt`;
  const raw = await readFile(new URL(`../../prompts/${filename}`, import.meta.url), "utf8");
  const bytes = Buffer.from(raw.replaceAll("\r\n", "\n").trim(), "utf8");
  return { filename, version, sha256: sha256(bytes), text: bytes.toString("utf8") };
}
async function exclusiveJson(filename, value) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
async function absent(file) {
  if (await lstat(file).catch(() => null)) throw new Error("Output already exists; no file will be overwritten. Use a new job.");
}

export async function inspectOriginal(input) {
  if (typeof input !== "string" || !input) throw new Error("--input is required.");
  const originalPage = path.resolve(input);
  const pageBytes = await bytesAt(originalPage);
  const pageInfo = pngInfo(pageBytes);
  const directory = path.dirname(originalPage);
  const lineage = JSON.parse((await bytesAt(path.join(directory, "metadata.json"), 4 * 1024 * 1024)).toString());
  const page = lineage.generatedFiles?.find(item => item.filename === path.basename(originalPage));
  if (lineage.schemaVersion !== 1 || lineage.status !== "complete" || !page || !Number.isInteger(page.pageNumber)
    || page.pageNumber < 1 || page.pageNumber > lineage.source?.pageCount || !lineage.selectedPages?.includes(page.pageNumber)
    || page.filename !== `page-${String(page.pageNumber).padStart(3, "0")}.png`
    || page.sha256 !== pageInfo.sha256 || page.width !== pageInfo.width || page.height !== pageInfo.height
    || lineage.source.filename !== "original.pdf") throw new Error("Input must match a complete PDF Input job and its page hash/dimensions.");
  const originalPdf = path.join(directory, "original.pdf");
  const pdfBytes = await bytesAt(originalPdf, 512 * 1024 * 1024);
  if (!pdfBytes.subarray(0, 1024).includes(Buffer.from("%PDF-")) || sha256(pdfBytes) !== lineage.source.sha256) throw new Error("Original PDF hash does not match PDF Input metadata.");
  return { originalPage, originalPdf, pageBytes, pdfBytes, pageInfo, page, lineage };
}

export async function prepareProcessing({ input, mode, output }) {
  modeCheck(mode);
  const { originalPage, originalPdf, pageBytes, pdfBytes, pageInfo, page, lineage } = await inspectOriginal(input);
  const prompt = await loadPrompt(mode);
  let job;
  if (output !== undefined) {
    if (typeof output !== "string" || !output.trim()) throw new Error("Invalid output directory.");
    job = path.resolve(output);
    await absent(job);
    await mkdir(job, { mode: 0o700 });
  } else job = await mkdtemp(path.join(os.tmpdir(), "ai-no-te-process-"));
  try {
    await writeFile(path.join(job, "original.pdf"), pdfBytes, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(job, page.filename), pageBytes, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(job, "prompt.txt"), prompt.text, { flag: "wx", mode: 0o600 });
    if (sha256(await bytesAt(originalPage)) !== pageInfo.sha256 || sha256(await bytesAt(originalPdf, 512 * 1024 * 1024)) !== lineage.source.sha256) throw new Error("Original changed during preparation.");
    const request = { schemaVersion: 1, status: "awaiting_provider", mode, createdAt: new Date().toISOString(),
      original: { pdfFilename: "original.pdf", pdfSha256: lineage.source.sha256, pageFilename: page.filename, pageNumber: page.pageNumber, ...pageInfo },
      sourcePaths: { originalPage, originalPdf },
      prompt: { filename: "prompt.txt", contract: prompt.filename, version: prompt.version, sha256: prompt.sha256 },
      provider: PROVIDER, outputFilename: `${mode}.png`, humanReview: "not_requested", approved: false };
    await exclusiveJson(path.join(job, "processing-request.json"), request);
    return { job, request };
  } catch (error) {
    await exclusiveJson(path.join(job, "preparation-failure.json"), { status: "failed", message: error.message }).catch(() => {});
    throw error;
  }
}

async function verifyRequest(job) {
  const request = JSON.parse((await bytesAt(path.join(job, "processing-request.json"), 4 * 1024 * 1024)).toString());
  modeCheck(request.mode);
  if (request.schemaVersion !== 1 || request.status !== "awaiting_provider" || request.outputFilename !== `${request.mode}.png`
    || request.original?.pdfFilename !== "original.pdf" || !Number.isInteger(request.original.pageNumber)
    || request.original.pageNumber < 1 || request.original.pageNumber > 500
    || request.original.pageFilename !== `page-${String(request.original.pageNumber).padStart(3, "0")}.png`
    || request.prompt?.filename !== "prompt.txt"
    || request.prompt.contract !== `${request.mode}-v${request.prompt.version}.txt`) throw new Error("Invalid processing request.");
  const prompt = await loadPrompt(request.mode, request.prompt.version);
  if (sha256(await bytesAt(path.join(job, "prompt.txt"))) !== request.prompt.sha256 || prompt.sha256 !== request.prompt.sha256) throw new Error("Effective prompt or prompt contract changed; prepare a new job.");
  return request;
}
async function verifyOriginals(job, request) {
  for (const [file, hash, limit] of [
    [path.join(job, request.original.pdfFilename), request.original.pdfSha256, 512 * 1024 * 1024],
    [path.join(job, request.original.pageFilename), request.original.sha256, 128 * 1024 * 1024],
    [request.sourcePaths?.originalPdf, request.original.pdfSha256, 512 * 1024 * 1024],
    [request.sourcePaths?.originalPage, request.original.sha256, 128 * 1024 * 1024],
  ]) if (sha256(await bytesAt(file, limit)) !== hash) throw new Error("Original hash changed; output is failed and must not be used.");
}

export async function recordProcessing({ job: jobInput, result, assessment, note, evidence, failure }) {
  if (typeof jobInput !== "string" || !jobInput) throw new Error("--job is required.");
  const job = path.resolve(jobInput);
  const request = await verifyRequest(job);
  if (failure) {
    if (result) throw new Error("Use either a provider failure or a returned image, not both.");
  } else if (!["pass", "failed"].includes(assessment) || !result || !note?.trim() || !evidence?.trim()) {
    throw new Error("A returned image requires assessment pass|failed, a visual review note and tool evidence. pass is not Owner approval.");
  }
  const metadataFile = path.join(job, "processing-metadata.json");
  await absent(metadataFile);
  await absent(path.join(job, request.outputFilename));
  // Permanent claim: concurrent or interrupted recording must never be silently retried.
  await writeFile(path.join(job, "recording-claim.json"), JSON.stringify({ startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  let output = null;
  let status = failure || assessment === "failed" ? "failed" : "awaiting_owner_visual_review";
  let failureMessage = failure ?? null;
  try {
    if (result) {
      const bytes = await bytesAt(result);
      await writeFile(path.join(job, request.outputFilename), bytes, { flag: "wx", mode: 0o600 });
      output = { filename: request.outputFilename, sha256: sha256(bytes), width: null, height: null };
      Object.assign(output, pngInfo(bytes));
      if (output.sha256 === request.original.sha256) throw new Error("Output is identical to Original; no AI transformation was established.");
    }
    await verifyOriginals(job, request);
  } catch (error) {
    status = "failed";
    failureMessage = error.message;
  }
  const metadata = { schemaVersion: 1, status, mode: request.mode, original: request.original, prompt: request.prompt,
    provider: PROVIDER, provenanceVerification: "operator-attested; file hashes do not prove provider execution",
    providerEvidence: evidence ?? "not available", output, generatedAt: new Date().toISOString(),
    preliminaryVisualCheck: { assessment: failureMessage ? "failed" : assessment, note: note ?? failureMessage },
    failure: failureMessage, humanReview: "not_requested", ownerVisualReview: "pending", approved: false };
  await exclusiveJson(metadataFile, metadata);
  return { job, metadata };
}

// Test seam: no production network provider is loaded by this module.
export async function runWithProvider(options, provider) {
  const prepared = await prepareProcessing(options);
  try {
    const response = await provider(prepared);
    return recordProcessing({ job: prepared.job, ...response });
  } catch {
    return recordProcessing({ job: prepared.job, failure: "Provider failed; retry only in a new job." });
  }
}

export async function processCommand(args) {
  const options = {};
  const recording = args[0] === "record";
  const allowed = recording ? ["--job", "--result", "--assessment", "--note", "--evidence", "--failure"] : ["--input", "--mode", "--output"];
  for (let i = recording ? 1 : 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--json" && !options.json) { options.json = true; continue; }
    if (!allowed.includes(name) || options[name] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown, repeated or incomplete processing option.");
    options[name] = args[++i];
  }
  const result = recording
    ? await recordProcessing({ job: options["--job"], result: options["--result"], assessment: options["--assessment"], note: options["--note"], evidence: options["--evidence"], failure: options["--failure"] })
    : await prepareProcessing({ input: options["--input"], mode: options["--mode"], output: options["--output"] });
  if (options.json) return result;
  return recording ? `Processing status: ${result.metadata.status}\nJob: ${result.job}\nOwner Visual Review pending; not approved; no Notion/Return call.\n`
    : `LOCAL REQUEST PREPARED — AI NOT YET RUN\nJob: ${result.job}\nUse the saved prompt.txt and Original page with Codex image_gen, then process record.\nImage editing sends the page to OpenAI; no automatic upload occurs in this CLI.\n`;
}
