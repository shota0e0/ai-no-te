import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const experimentalSource = await readFile(
  path.join(root, "experimental/ainote-return/ainote-clean-return-poc.mjs"),
  "utf8",
);
for (const removedMode of ["--interpreted-flow", "--v21-flow", "--reuse-check"]) {
  if (experimentalSource.includes(removedMode)) {
    fail(`approval-provisioning mode remains reachable: ${removedMode}`);
  }
}
if (!experimentalSource.includes("AINOTE_API_HELPER is required")) {
  fail("experimental caller lacks a clear missing-helper failure");
}

const readme = await readFile(path.join(root, "README.md"), "utf8");
const readmeJa = await readFile(path.join(root, "README.ja.md"), "utf8");
const projectTitle = "# アイノテ - AI-no-Te -";
if (readme.split(/\r?\n/, 1)[0] !== projectTitle || readmeJa.split(/\r?\n/, 1)[0] !== projectTitle) {
  fail("public project title is inconsistent");
}
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lockMetadata = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
if (packageMetadata.name !== "ai-no-te-public-alpha" || lockMetadata.name !== packageMetadata.name) {
  fail("repository-facing package name is inconsistent");
}
for (const requiredWarning of ["unofficial", "experimental", "version-specific", "unsupported"]) {
  if (!readme.toLowerCase().includes(requiredWarning)) fail(`README warning missing: ${requiredWarning}`);
}
for (const requiredWarning of ["非公式", "実験段階", "特定のバージョンに依存", "公式のサポート対象外"]) {
  if (!readmeJa.includes(requiredWarning)) fail(`README.ja warning missing: ${requiredWarning}`);
}
if (!/\[日本語版\]\(README\.ja\.md\)/.test(readme)) {
  fail("README canonical language link is missing");
}
if (!/\[English\]\(README\.md\)/.test(readmeJa)) {
  fail("README.ja canonical language link is missing");
}
for (const [label, enText, jaText] of [
  ["not an official API", "not an official AINOTE API", "公式のAINOTE APIではなく"],
  ["no compatibility guarantee", "There is no compatibility guarantee", "互換性は保証されません"],
  ["explicit execution", "Execution must be requested explicitly", "実際に書き込むには、`--execute`を付ける必要があります"],
  ["Original preservation", "Original is not overwritten", "Originalは上書きしません"],
  ["independent project", "independent experimental project", "独立した実験プロジェクト"],
  ["non-public behavior", "based on non-public AINOTE behavior", "公開されていないAINOTEの動作に依存している"],
  ["update breakage", "may break after AINOTE updates", "AINOTEの更新後に動かなくなる可能性があります"],
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
  /\bSTEP\s*[0-9A-Z]/i,
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
