import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadNotionSchema, resolveProfileConfig, validateNotionProfileSchema } from "../src/notion/profiles.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = path.join(root, "public-files.json");

function fail(message) {
  throw new Error(`Public candidate validation failed: ${message}`);
}

function normalizedRelative(filename) {
  const relative = path.relative(root, path.resolve(root, filename)).replaceAll("\\", "/");
  if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
    fail("allowlist entry escapes repository root");
  }
  return relative;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const publicFiles = manifest?.classifications?.PUBLIC;
if (!Array.isArray(publicFiles) || publicFiles.length === 0) fail("PUBLIC allowlist is empty");
if (new Set(publicFiles).size !== publicFiles.length) fail("PUBLIC allowlist contains duplicates");
if ([...publicFiles].sort().some((entry, index) => entry !== publicFiles[index])) {
  fail("PUBLIC allowlist must be sorted");
}

const contentRules = [
  { label: "owner-profile absolute path", pattern: /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+[\\/]/i },
  { label: "attachment or workspace UUID", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "credential literal", pattern: /(?:token|secret|password|api[_-]?key)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];
const dependencyRules = [
  { label: "personal Codex skill dependency", pattern: /\.codex[\\/]skills/i },
  { label: "non-public AINOTE write route", pattern: /\/apiv2\/(?:add_page|save_page|update_page)/i },
  { label: "non-public tree dependency", pattern: /(?:\.\.\/)*(?:artifacts|tools|video-showcase)[\\/]/i },
];
const dependencyExtensions = new Set([".js", ".mjs", ".cjs", ".json", ".ps1", ".py"]);

for (const declared of publicFiles) {
  const relative = normalizedRelative(declared);
  if (relative !== declared) fail("allowlist entries must use normalized repository-relative paths");
  const absolute = path.join(root, relative);
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) fail(`missing PUBLIC file: ${relative}`);
  const text = await readFile(absolute, "utf8");
  for (const rule of contentRules) {
    if (rule.pattern.test(text)) fail(`${rule.label} found in ${relative}`);
  }
  if (relative !== "public-files.json" && dependencyExtensions.has(path.extname(relative))) {
    for (const rule of dependencyRules) {
      if (rule.pattern.test(text)) fail(`${rule.label} found in ${relative}`);
    }
  }
}

if (publicFiles.some((entry) => path.basename(entry).toLowerCase() === "ainote_api.py")) {
  fail("external AINOTE helper must not be bundled in the PUBLIC allowlist");
}

for (const profile of ["user", "development"]) {
  for (const file of [`config/notion-${profile}.example.json`, `schemas/notion-${profile}.json`, "src/notion/profiles.mjs", "docs/notion-profiles.md"]) {
    if (!publicFiles.includes(file)) fail(`profile dependency missing from allowlist: ${file}`);
  }
  const config = JSON.parse(await readFile(path.join(root, `config/notion-${profile}.example.json`), "utf8"));
  const resolved = resolveProfileConfig(config, profile);
  if (resolved.defaultMode !== "clean") fail("profile example default must be Clean");
  for (const destination of Object.values(config.notion.destinations)) {
    if (destination.dataSourceId !== `REPLACE_WITH_${profile.toUpperCase()}_DATA_SOURCE_ID`) fail("profile destination must be a placeholder");
  }
  const schema = await loadNotionSchema(profile);
  if (schema.properties.length !== (profile === "user" ? 6 : 9)) fail("profile field count changed");
  if (schema.properties.some(p => !p.required || !p.meaning)) fail("profile schema must document required fields");
  const syntheticProperties = Object.fromEntries(schema.properties.map(p => [p.name, {
    id: `synthetic-${p.key}`, type: p.type, ...(p.options ? { select: { options: p.options.map(name => ({ name })) } } : {}),
  }]));
  if (profile === "development") {
    syntheticProperties["ノート名"] = syntheticProperties.Title;
    delete syntheticProperties.Title;
    if (schema.properties.find(p => p.key === "title")?.resolution !== "unique-property-by-type") fail("development Title resolution must be unique-property-by-type");
  }
  await validateNotionProfileSchema(profile, { properties: syntheticProperties });
}

const experimentalSource = await readFile(
  path.join(root, "experimental/ainote-return/ainote-clean-return-poc.mjs"),
  "utf8",
);
const experimentalReadmePath = "experimental/ainote-return/README.md";
if (!publicFiles.includes(experimentalReadmePath)) fail("Experimental Return boundary README is missing from PUBLIC");
const experimentalReadme = await readFile(path.join(root, experimentalReadmePath), "utf8");
const desktopReturnPath = "src/ainote/desktop-return.mjs";
const desktopReturnTestPath = "tests/desktop-return.test.mjs";
for (const file of [desktopReturnPath, desktopReturnTestPath]) {
  if (!publicFiles.includes(file)) fail(`Experimental Desktop Return public runtime missing: ${file}`);
}
const desktopReturnSource = await readFile(path.join(root, desktopReturnPath), "utf8");
const experimentalGuide = await readFile(path.join(root, "docs/experimental-ainote-return.md"), "utf8");
const desktopInputPath = "src/ainote/desktop-input.mjs";
const desktopInputTestPath = "tests/desktop-input.test.mjs";
const desktopInputGuidePath = "docs/experimental-desktop-input.md";
for (const file of [desktopInputPath, desktopInputTestPath, desktopInputGuidePath]) {
  if (!publicFiles.includes(file)) fail(`Experimental Desktop Input public file missing: ${file}`);
}
const desktopInputSource = await readFile(path.join(root, desktopInputPath), "utf8");
const desktopInputGuide = await readFile(path.join(root, desktopInputGuidePath), "utf8");
for (const required of ["desktop-list", "desktop-preview", "desktop-import", "db.json", "dir.json", "/note/getDetail", "sourceMutation:0", "ainoteWrites:0", "composeHandwritingLayers"]) {
  if (!desktopInputSource.includes(required) && !desktopInputGuide.includes(required)) fail(`Experimental Desktop Input contract missing: ${required}`);
}
for (const required of ["REQUIRED", "OPTIONAL", "NOT_USED", "PDF Input remains", "version-specific", "never bundled"]) {
  if (!desktopInputGuide.includes(required)) fail(`Experimental Desktop Input boundary missing: ${required}`);
}
for (const removedMode of ["--interpreted-flow", "--v21-flow", "--reuse-check"]) {
  if (experimentalSource.includes(removedMode)) {
    fail(`approval-provisioning mode remains reachable: ${removedMode}`);
  }
}
if (!experimentalSource.includes("AINOTE_API_HELPER is required")) {
  fail("experimental caller lacks a clear missing-helper failure");
}
for (const route of ["/note/createMixtureNote", "/note/addMixtureImgFile", "/note/saveRichMixtureNote", "/note/getDetail", "/sync/pushOneNote"]) {
  if (!experimentalSource.includes(route) || !experimentalReadme.includes(`| \`${route}\``)) {
    fail(`Experimental Return endpoint disclosure missing: ${route}`);
  }
  if (!desktopReturnSource.includes(route) || !experimentalGuide.includes(`| \`${route}\``)) {
    fail(`public Experimental Desktop Return route missing or undisclosed: ${route}`);
  }
}
for (const dependency of ["db.json", "dir.json", "note_relations.json", "page.bin", "change.json", "note.log", "T5/page data model"]) {
  if (!experimentalReadme.includes(dependency)) fail(`Experimental Return internal dependency disclosure missing: ${dependency}`);
}
for (const boundary of ["intentionally incompatible", "fails closed", "LOCAL_ONLY", "does not copy, vendor, download, or bundle", "Original is not overwritten", "There is no rollback"]) {
  if (!experimentalReadme.includes(boundary)) fail(`Experimental Return boundary missing: ${boundary}`);
}
for (const required of ["Review state", "Return target", "Original", "Clean", "Interpreted", "desktop-preview", "desktop-execute", "EXPLICIT_EXECUTE_REQUIRED", "installed AINOTE Skill", "automaticRetry: false"]) {
  if (!desktopReturnSource.includes(required) && !experimentalGuide.includes(required)) {
    fail(`Experimental Desktop Return current contract missing: ${required}`);
  }
}
for (const prohibited of ["Return state", "Result SHA-256", "AINOTE return ID", "Returned at"]) {
  if (desktopReturnSource.includes(prohibited)) fail(`legacy Return field leaked into public Desktop runtime: ${prohibited}`);
}

const readme = await readFile(path.join(root, "README.md"), "utf8");
const readmeJa = await readFile(path.join(root, "README.ja.md"), "utf8");
const startHere = await readFile(path.join(root, "START_HERE.txt"), "utf8");
const releaseNotes = await readFile(path.join(root, "docs/release-notes-public-alpha.md"), "utf8");
for (const file of ["START_HERE.txt", "docs/release-notes-public-alpha.md"]) {
  if (!publicFiles.includes(file)) fail(`beginner release document missing from PUBLIC: ${file}`);
}
const projectTitle = "# アイノテ - AI-no-Te -";
if (readme.split(/\r?\n/, 1)[0] !== projectTitle || readmeJa.split(/\r?\n/, 1)[0] !== projectTitle) {
  fail("public project title is inconsistent");
}
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lockMetadata = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
if (packageMetadata.name !== "ai-no-te-public-alpha" || lockMetadata.name !== packageMetadata.name) {
  fail("repository-facing package name is inconsistent");
}
for (const requiredWarning of ["experimental", "version-specific", "unsupported", "outside the published official openmodel api"]) {
  if (!readme.toLowerCase().includes(requiredWarning)) fail(`README warning missing: ${requiredWarning}`);
}
for (const requiredWarning of ["Experimental Desktop Return", "特定のバージョンに依存", "公式のサポート対象外", "公開された公式OpenModel APIではありません"]) {
  if (!readmeJa.includes(requiredWarning)) fail(`README.ja warning missing: ${requiredWarning}`);
}
if (!/\[日本語版\]\(README\.ja\.md\)/.test(readme)) {
  fail("README canonical language link is missing");
}
if (!/\[English\]\(README\.md\)/.test(readmeJa)) {
  fail("README.ja canonical language link is missing");
}
if (!/\[Getting Started guide\]\(docs\/getting-started\.md\)/.test(readme)) {
  fail("README Getting Started link is missing");
}
if (!/\[Getting Startedガイド\]\(docs\/getting-started\.ja\.md\)/.test(readmeJa)) {
  fail("README.ja Getting Started link is missing");
}
for (const [label, document] of [["README", readme], ["release notes", releaseNotes]]) {
  for (const required of ["independent community project", "Node.js 20", "Experimental Desktop", "not an official"]) {
    if (!document.includes(required)) fail(`${label} beginner-release guidance missing: ${required}`);
  }
}
for (const required of ["公式製品・公式ツールではありません", "Node.js 20", "AINOTE Desktop", "AINOTE Skill", "Original", "ランチャー", "docs/getting-started.ja.md"]) {
  if (!startHere.includes(required)) fail(`START_HERE guidance missing: ${required}`);
}
const gettingStarted = await readFile(path.join(root, "docs/getting-started.md"), "utf8");
const gettingStartedJa = await readFile(path.join(root, "docs/getting-started.ja.md"), "utf8");
for (const requiredFile of ["src/processing/poc.mjs", "src/processing/typed.mjs", "tests/processing.test.mjs", "tests/typed-processing.test.mjs", "docs/ai-processing.md", "prompts/clean-v1.txt", "prompts/interpreted-v1.txt", "prompts/interpreted-v2.txt", "prompts/ocr-v1.txt", "prompts/typed-clean-v1.txt", "prompts/typed-clean-v2.txt", "prompts/typed-interpreted-v1.txt", "prompts/typed-interpreted-v2.txt", "prompts/typed-interpreted-v3.txt"]) {
  if (!publicFiles.includes(requiredFile)) fail(`AI processing file missing from PUBLIC: ${requiredFile}`);
}
const processingGuide = await readFile(path.join(root, "docs/ai-processing.md"), "utf8");
const officialReturnSource = await readFile(path.join(root, "src/ainote/official-return.mjs"), "utf8");
const officialReturnGuide = await readFile(path.join(root, "docs/official-skill-return.md"), "utf8");
for (const file of ["src/ainote/official-return.mjs", "tests/official-return.test.mjs", "docs/official-skill-return.md"]) {
  if (!publicFiles.includes(file)) fail(`Official Skill Return file missing: ${file}`);
}
for (const route of ["/open-model-note/file/create", "/open-model-note/file/content", "/open-model/sync"]) {
  if (!officialReturnSource.includes(route)) fail(`Official Skill Return route missing: ${route}`);
}
for (const blocked of ["/note/createMixtureNote", "/note/addMixtureImgFile", "/note/saveRichMixtureNote", "/sync/pushOneNote", "db.json", "page.bin", "note.log"]) {
  if (officialReturnSource.includes(blocked)) fail(`Official Skill Return contains internal dependency: ${blocked}`);
}
for (const term of ["NO_OFFICIAL_PATH_FOUND", "NOT_DOCUMENTED", "text-only Return is not an AI-no-Te full loop", "preview-only"]) {
  if (!officialReturnGuide.includes(term)) fail(`Official Skill Return boundary missing: ${term}`);
}
for (const file of ["src/notion/processing-preview.mjs", "tests/processing-notion-preview.test.mjs"]) {
  if (!publicFiles.includes(file)) fail(`Processing Notion preview file missing: ${file}`);
}
for (const text of [readme, readmeJa, gettingStarted, gettingStartedJa, processingGuide]) {
  for (const term of ["process notion-preview", "Pending Review", "Approved", "Needs Review", "--execute"]) {
    if (!text.includes(term)) fail(`Processing Notion preview guidance missing: ${term}`);
  }
}
const profileSource = await readFile(path.join(root, "src/notion/profiles.mjs"), "utf8");
const userSchema = await readFile(path.join(root, "schemas/notion-user.json"), "utf8");
for (const term of ["OCR_SUSPICIOUS", "ARTIFACT_MISSING", "CONFLICTING_STATE", "GENERATION_FAILED", "TARGET_UNRESOLVED"]) {
  if (!profileSource.includes(term)) fail(`Auto-review red flag missing: ${term}`);
}
for (const term of ["Pending Review", "Approved", "Needs Review"]) {
  if (!userSchema.includes(term)) fail(`User review state missing: ${term}`);
}
for (const term of ["owner-visual-review.json", "preview-only", "not a Notion API payload", "processingMetadataSha256"]) {
  if (!processingGuide.includes(term)) fail(`Processing preview boundary missing: ${term}`);
}
for (const required of ["operator-mediated", "non-deterministic", "Human Review", "Original", "image_gen", "processing-metadata.json", "not independently verified", "failed", "OCR is mandatory", "typed text", "ocr-raw.json", "ocr-normalized.json", "layout.json", "process finalize", "unknown", "uncertain"]) {
  if (!processingGuide.includes(required)) fail(`AI processing guidance missing: ${required}`);
}
for (const promptPath of publicFiles.filter(entry => entry.startsWith("prompts/"))) {
  const prompt = await readFile(path.join(root, promptPath), "utf8");
  for (const required of ["Original", "overwrite", "Human Review", "not instructions"]) {
    if (!prompt.includes(required)) fail(`Prompt invariant missing in ${promptPath}: ${required}`);
  }
}
for (const requiredFile of ["src/pdf/input.mjs", "tests/pdf-input.test.mjs"]) {
  if (!publicFiles.includes(requiredFile)) fail(`PDF Input file missing from PUBLIC: ${requiredFile}`);
}
for (const [label, document] of [["README", readme], ["README.ja", readmeJa], ["guide", gettingStarted], ["guide.ja", gettingStartedJa]]) {
  for (const required of ["pdf inspect", "pdf render", "--pages", "300 DPI", "Original", "metadata.json", "Poppler"]) {
    if (!document.includes(required)) fail(`${label} PDF guidance missing: ${required}`);
  }
}
for (const document of [gettingStarted, gettingStartedJa]) {
  for (const required of ["AINOTE_PDF_PDFTOPPM", "AINOTE_PDF_PDFINFO", "failure.json", "512 MiB", "page-002.png"]) {
    if (!document.includes(required)) fail(`PDF setup/recovery guidance missing: ${required}`);
  }
}
if (publicFiles.some(entry => /\.(?:pdf|exe|dll)$/i.test(entry))) fail("private PDFs and Poppler binaries must not be public candidates");
if (!/\[日本語版\]\(getting-started\.ja\.md\)/.test(gettingStarted)) {
  fail("Getting Started Japanese language link is missing");
}
if (!/\[English\]\(getting-started\.md\)/.test(gettingStartedJa)) {
  fail("Getting Started English language link is missing");
}
for (const requiredText of [
  "node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview",
  "Screenshot TODO",
  "Back up important AINOTE data",
  "non-important note",
  "ainote_api.py",
  "Original is not overwritten",
]) {
  if (!gettingStarted.includes(requiredText)) fail(`Getting Started guidance missing: ${requiredText}`);
}
for (const requiredText of [
  "node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview",
  "Screenshot TODO",
  "大切なデータをバックアップ",
  "重要でないノート",
  "ainote_api.py",
  "Originalは上書きしません",
]) {
  if (!gettingStartedJa.includes(requiredText)) fail(`Getting Started Japanese guidance missing: ${requiredText}`);
}
for (const [label, enText, jaText] of [
  ["outside the published OpenModel API", "outside the published official OpenModel API", "公開された公式OpenModel APIではありません"],
  ["no compatibility guarantee", "There is no compatibility guarantee", "互換性は保証されません"],
  ["explicit execution", "Execution must be requested explicitly", "実際に書き込むには、`--execute`を付ける必要があります"],
  ["Original preservation", "Original is not overwritten", "Originalは上書きしません"],
  ["independent project", "independent experimental project", "独立した実験プロジェクト"],
  ["non-public behavior", "uses undocumented AINOTE Desktop endpoints", "公開されていないAINOTE Desktopの通信先"],
  ["update breakage", "may break after AINOTE updates", "AINOTEの更新後に動かなくなる可能性"],
]) {
  if (!readme.includes(enText) || !readmeJa.includes(jaText)) fail(`EN/JA parity missing: ${label}`);
}
for (const safetyText of [
  "### Experimental AINOTE Returnを使う前に",
  "必要なデータをバックアップ",
  "重要でないノート",
  "各自の判断で利用",
]) {
  if (!readmeJa.includes(safetyText)) fail(`README.ja practical safety notice missing: ${safetyText}`);
}
for (const safetyText of [
  "### Before using Experimental AINOTE Return",
  "non-public, unsupported AINOTE behavior",
  "back up any important data",
  "non-important note",
  "does not guarantee how AINOTE or the device will behave",
  "Use this feature only after reviewing and accepting these limitations",
]) {
  if (!readme.includes(safetyText)) fail(`README practical safety notice missing: ${safetyText}`);
}
for (const [label, enText, jaText] of [
  ["backup guidance", "back up any important data", "必要なデータをバックアップ"],
  ["non-important note", "non-important note", "重要でないノート"],
  ["tested device", "Tested with AINOTE Air 2", "AINOTE Air 2で確認"],
  ["unverified device models", "other AINOTE models have not been verified", "他の機種では未確認"],
  [
    "device, data, and compatibility disclaimer",
    "does not guarantee how AINOTE or the device will behave, the integrity of stored data, or future compatibility",
    "AINOTE本体や端末での動作、保存データの完全性、将来の互換性を保証しません",
  ],
]) {
  if (!readme.includes(enText) || !readmeJa.includes(jaText)) fail(`EN/JA safety parity missing: ${label}`);
}

const internalProcessRules = [
  /\bSTEP\s*[0-9]+[A-Z]?\b/i,
  /\bOwner(?:'s)?\s+(?:decision|preference|review|approval|has)\b/i,
  /vendor confirmation/i,
  /final documentation (?:step|pass|edit)/i,
  /separately approved UX step/i,
];
for (const relative of publicFiles.filter((entry) => entry.endsWith(".md"))) {
  const markdown = await readFile(path.join(root, relative), "utf8");
  for (const pattern of internalProcessRules) {
    if (pattern.test(markdown)) fail(`internal project-management wording found in ${relative}`);
  }
}

const formerName = "AINOTE" + "-LAB";
for (const relative of publicFiles) {
  const text = await readFile(path.join(root, relative), "utf8");
  if (text.includes(formerName)) fail(`former public project name remains in ${relative}`);
}

for (const relative of publicFiles.filter((entry) => entry.endsWith(".md"))) {
  const markdown = await readFile(path.join(root, relative), "utf8");
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const decoded = decodeURIComponent(target.split("#", 1)[0]);
    const linked = path.resolve(path.dirname(path.join(root, relative)), decoded);
    const linkedRelative = path.relative(root, linked);
    if (linkedRelative.startsWith("..") || path.isAbsolute(linkedRelative)) {
      fail(`Markdown link escapes repository: ${relative} -> ${target}`);
    }
    const linkedInfo = await stat(linked).catch(() => null);
    if (!linkedInfo) fail(`broken Markdown link: ${relative} -> ${target}`);
  }
}

process.stdout.write("PUBLIC candidate tree (allowlist):\n");
for (const filename of publicFiles) process.stdout.write(`- ${filename}\n`);
process.stdout.write(`Validation passed: ${publicFiles.length} PUBLIC files; no blocked path, identifier, secret literal, or private dependency pattern found.\n`);
