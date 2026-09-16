import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.mjs";
import { loadNotionSchema, validateProfile, resolveProfileConfig, resolveReturnTarget, evaluateUserReview, evaluateAutoReview } from "./profiles.mjs";
import { createPendingReview } from "../core/review.mjs";
import { inspectFinalizedJob } from "../processing/typed.mjs";

const hash = b => createHash("sha256").update(b).digest("hex");
const textChunks = value => {
  const text = String(value ?? "").trim() || "(none)";
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += 1900) chunks.push({ type: "text", text: { content: text.slice(offset, offset + 1900) } });
  return chunks;
};
const block = (type, value, extra = {}) => ({ object: "block", type, [type]: { rich_text: textChunks(value), ...extra } });
const heading = (level, value) => block(`heading_${level}`, value);
const bullet = value => block("bulleted_list_item", value);
const code = value => block("code", value, { language: "json" });
const printable = value => value === "unknown" ? "unknown" : JSON.stringify(value);

export function serializeDevelopmentPageBody({ metadata: m, metadataSha256, raw, normalized, layout, visual }) {
  if (!m || !raw || !normalized || !layout || visual?.result !== "PASS" || m.approved !== false) throw new Error("Verified Development processing details are required.");
  const blocks = [
    heading(2, "Processing Summary"),
    bullet(`Status: ${m.status}`), bullet(`Source page: ${m.original.pageNumber}`),
    bullet("Modes: Clean, Interpreted"),
    bullet(`Provider / model: ${m.provider.provider} / ${m.provider.model}`),
    heading(2, "OCR"), heading(3, "Normalized Text"),
  ];
  for (const item of normalized.blocks) {
    blocks.push(bullet(`Block ${item.id}; needs review: ${item.needsReview ? "yes" : "no"}; confidence: ${printable(item.confidence)}`));
    for (const rich of textChunks(item.text)) blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: [rich] } });
  }
  blocks.push(heading(3, "Raw OCR"));
  for (const item of raw.blocks) blocks.push(code(JSON.stringify(item, null, 2)));
  blocks.push(heading(2, "Layout"));
  for (const item of layout.blocks) blocks.push(bullet(`${item.id}: ${item.type}; position: ${item.position}; bbox: ${printable(item.bbox)}; ${item.description}`));
  blocks.push(heading(2, "Provenance"),
    bullet(`Processing metadata SHA-256: ${metadataSha256}`),
    bullet(`Original PDF SHA-256: ${m.original.pdfSha256}`), bullet(`Original page SHA-256: ${m.original.sha256}`),
    bullet(`OCR raw SHA-256: ${m.ocr.rawSha256}`), bullet(`OCR normalized SHA-256: ${m.ocr.normalizedSha256}`),
    bullet(`Layout SHA-256: ${m.ocr.layoutSha256}`));
  for (const mode of ["clean", "interpreted"]) {
    blocks.push(bullet(`${mode} prompt: ${m.prompts[mode].contract}; version: ${m.prompts[mode].version}; SHA-256: ${m.prompts[mode].sha256}`),
      bullet(`${mode} output SHA-256: ${m.outputs[mode].sha256}; selected attempt: ${m.outputs[mode].attempt}`));
  }
  blocks.push(heading(2, "Processing Attempts"));
  for (const attempt of m.attempts) blocks.push(bullet(`${attempt.attempt}: ${attempt.status}${attempt.reason ? `; reason: ${attempt.reason}` : ""}`));
  blocks.push(bullet(`Successful attempts: ${m.attempts.filter(item => !["failed", "incomplete"].includes(item.status)).length}`),
    bullet(`Failed attempts: ${m.failedAttempts.length}`),
    bullet("Owner Visual Review: PASS for this PoC sample; Human Approval: NOT GRANTED"));
  return { schemaVersion: 1, profile: "development", format: "notion-blocks", children: blocks };
}

const reviewReasonText = Object.freeze({
  OCR_SUSPICIOUS: "OCR結果を確認してください",
  ARTIFACT_MISSING: "必要な画像またはOriginalがありません",
  CONFLICTING_STATE: "状態の組み合わせを確認してください",
  GENERATION_FAILED: "CleanまたはInterpretedの生成結果を確認してください",
  TARGET_UNRESOLVED: "返す内容を決められません",
});

export function serializeUserReviewSection({ reviewState, returnTarget, defaultReturnMode = "clean", availableArtifacts, reasons = [] } = {}) {
  const review = evaluateUserReview({ reviewState, returnTarget, defaultReturnMode,
    availableArtifacts });
  if (review.reason === "RETURN_NOT_READY") throw new Error(`Invalid User review properties: ${review.detail}.`);
  if (reviewState === "Needs Review" && (!Array.isArray(reasons) || !reasons.length
    || reasons.some(reason => !Object.hasOwn(reviewReasonText, reason)))) throw new Error("Needs Review requires known red-flag reasons.");
  const children = [
    heading(2, "Review"),
    heading(3, "返す内容"),
    bullet(`現在値: ${returnTarget}`),
    heading(3, "確認状態"),
    bullet(`現在値: ${reviewState}`),
  ];
  if (reviewState === "Needs Review") children.push(bullet("確認が必要です:"), ...reasons.map(reason => bullet(reviewReasonText[reason])));
  return { schemaVersion: 1, profile: "user", evaluation: review, reasons: [...reasons], children };
}

export function serializeUserPageBody({ uploads, reviewState = "Approved", returnTarget = "Use Default", defaultReturnMode = "clean", reasons = [] } = {}) {
  const required = ["original.pdf", "page-002.png", "clean.png", "interpreted.png"];
  if (!uploads || required.some(name => !/^[a-f0-9-]{32,36}$/i.test(uploads[name] ?? ""))) {
    throw new Error("Four completed User file uploads are required.");
  }
  const reviewSection = serializeUserReviewSection({ reviewState, returnTarget, defaultReturnMode,
    availableArtifacts: { clean: true, interpreted: true }, reasons });
  const uploaded = name => ({ type: "file_upload", file_upload: { id: uploads[name] } });
  return { schemaVersion: 1, profile: "user", format: "notion-blocks", children: [
    heading(2, "Original"),
    { object: "block", type: "image", image: uploaded("page-002.png") },
    { object: "block", type: "file", file: uploaded("original.pdf") },
    heading(2, "Clean"),
    { object: "block", type: "image", image: uploaded("clean.png") },
    heading(2, "Interpreted"),
    { object: "block", type: "image", image: uploaded("interpreted.png") },
    ...reviewSection.children,
  ] };
}

async function developmentDetails(job, m, metadataSha256, normalized, visual) {
  const readVerified = async (filename, expected) => {
    const file = path.join(job, filename);
    const stat = await lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error("Missing or unsafe Development detail file.");
    const bytes = await readFile(file);
    if (hash(bytes) !== expected) throw new Error("Development detail hash changed.");
    return JSON.parse(bytes);
  };
  const raw = await readVerified("ocr-raw.json", m.ocr.rawSha256);
  const layout = await readVerified("layout.json", m.ocr.layoutSha256);
  return serializeDevelopmentPageBody({ metadata: m, metadataSha256, raw, normalized, layout, visual });
}
// Owner Visual Review is a separate, sample-bound attestation, never Human Approval.
async function visualReview(job, metadataSha256) {
  const file = path.join(job, "owner-visual-review.json");
  const s = await lstat(file).catch(() => null);
  if (!s?.isFile() || s.isSymbolicLink() || s.size > 65536) throw new Error("A sample-bound Owner Visual Review PASS record is required.");
  const b = await readFile(file);
  const r = JSON.parse(b);
  if (r.schemaVersion !== 1 || r.owner_visual_review !== "PASS" || r.processingMetadataSha256 !== metadataSha256
    || r.scope !== "poc_next_step_only" || r.approved !== false || r.humanDecision !== null
    || r.publicationApproved !== false || typeof r.owner_visual_review_note !== "string" || !r.owner_visual_review_note.trim()
    || typeof r.owner_visual_review_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(r.owner_visual_review_at)
    || Number.isNaN(Date.parse(r.owner_visual_review_at))) throw new Error("Visual review does not match this job or crosses the approval boundary.");
  return { result: "PASS", scope: r.scope, recordedAt: r.owner_visual_review_at, sha256: hash(b) };
}

export async function prepareProcessingNotionPreview({ job, config, profile: requestedProfile, returnTarget = "default", destinationOverride = "default", execute = false } = {}) {
  if (execute !== false) throw new Error("Processing-job Notion bridge is preview-only; execute is unavailable.");
  const { profile, destination, defaultMode } = resolveProfileConfig(config, requestedProfile, destinationOverride);
  const manifest = await loadNotionSchema(profile);
  const names = Object.fromEntries(manifest.properties.map(p => [p.key, p.name]));
  const resolutions = Object.fromEntries(manifest.properties.map(p => [p.key, p.resolution ?? "name-and-type"]));
  const returnChoice = resolveReturnTarget(returnTarget, defaultMode);
  const { metadata: m, metadataSha256, normalized } = await inspectFinalizedJob(job);
  const visual = profile === "development" ? await visualReview(path.resolve(job), metadataSha256) : null;
  const autoReview = profile === "user" ? evaluateAutoReview({
    ocr: { blocks: normalized.blocks, expectsText: normalized.blocks.length > 0, parseFailed: false },
    artifacts: { original: true, clean: true, interpreted: true },
    conflictingState: false,
    generation: { cleanValid: Boolean(m.outputs?.clean?.filename && m.outputs?.clean?.sha256),
      interpretedValid: Boolean(m.outputs?.interpreted?.filename && m.outputs?.interpreted?.sha256),
      historicalFailedAttempts: m.failedAttempts?.length ?? 0 },
    returnTarget: returnChoice.value, defaultReturnMode: defaultMode,
  }) : null;
  const review = profile === "user" ? Object.freeze({ state: autoReview.reviewState, humanDecision: null,
    decisionSource: "auto-review", reasons: autoReview.reasons }) : createPendingReview({ metadata: { fixtureId: `processed-${metadataSha256}` } });
  const reviewState = autoReview?.reviewState ?? "Pending Review";
  const asset = (filename, sha256, mimeType, extra = {}) => ({ filename, sha256, mimeType, ...extra });
  const properties = [
    { field: names.title, logicalField: "Title", resolution: resolutions.title, type: "title", value: `AI processed page ${m.original.pageNumber}` },
    { field: names.originalFile, type: "files", assets: [asset("original.pdf", m.original.pdfSha256, "application/pdf"),
      asset(m.original.pageFilename, m.original.sha256, "image/png", { width: m.original.width, height: m.original.height })] },
    ...(profile === "development" ? [{ field: names.originalSha, type: "rich_text", value: m.original.pdfSha256 }] : []),
    ...["clean", "interpreted"].flatMap(mode => [
      { field: names[`${mode}File`], type: "files", assets: [asset(m.outputs[mode].filename, m.outputs[mode].sha256, "image/png", { width: m.outputs[mode].width, height: m.outputs[mode].height })] },
      ...(profile === "development" ? [{ field: names[`${mode}Sha`], type: "rich_text", value: m.outputs[mode].sha256 }] : []),
    ]),
    { field: names.reviewState, type: "select", value: reviewState },
    { field: names.returnTarget, type: "select", value: returnChoice.value },
  ];
  const pageBody = profile === "development" ? await developmentDetails(path.resolve(job), m, metadataSha256, normalized, visual) : null;
  const bodySections = profile === "development" ? [
    { section: "OCR / Layout", kind: "serialized Notion page body", assets: [asset("ocr-raw.json", m.ocr.rawSha256, "application/json"),
      asset("ocr-normalized.json", m.ocr.normalizedSha256, "application/json"), asset("layout.json", m.ocr.layoutSha256, "application/json")],
      textBlockCount: normalized.blocks.length, needsReviewCount: normalized.blocks.filter(b => b.needsReview).length },
    { section: "Provenance / modes", kind: "serialized Notion page body", value: {
      processingMetadataSha256: metadataSha256, sourcePage: m.original.pageNumber, originalPdfSha256: m.original.pdfSha256,
      originalPageSha256: m.original.sha256, ocr: m.ocr,
      modes: Object.fromEntries(["clean", "interpreted"].map(mode => [mode, {
        attempt: m.outputs[mode].attempt, prompt: m.prompts[mode], outputSha256: m.outputs[mode].sha256,
        meaning: mode === "clean" ? "Typed text; minimal restructuring" : "Typed text; stronger restructuring",
      }])),
      ownerVisualReview: visual, approved: false, humanDecision: null, publicationApproved: false,
      providerVerification: "operator-attested, not independently authenticated",
    } },
    { section: "Processing / diagnostics", kind: "serialized Notion page body", value: {
      processingStatus: m.status, recordedAt: m.recordedAt, provider: m.provider,
      attempts: m.attempts, failedAttempts: m.failedAttempts, incompleteAttempts: m.incompleteAttempts,
      note: "Generation snapshot status is historical; later visual PASS does not change Human Approval. Raw private paths/log files and failed images remain local.",
    } },
  ] : [];
  const result = { schemaVersion: 2, profile, mode: "dry-run", networkCalls: 0, externalWrites: 0, executable: false,
    destination, operation: "Prepare one Notion review record; no record created", review, reviewState,
    approved: autoReview?.approved ?? false, returnReady: autoReview?.returnReady ?? false,
    reason: autoReview?.reason ?? "NOT_APPROVED", autoReview, ownerVisualReview: visual,
    returnIntent: returnChoice.resolvedMode, returnChoice,
    properties, bodySections, uploadState: "Not uploaded; local file references only, not a Notion API payload",
    excludes: ["absolute source paths", "credentials", "destination IDs", "failed images", "automatic Return"],
  };
  if (pageBody) Object.defineProperty(result, "developmentPageBody", { value: pageBody, enumerable: false });
  if (profile === "user") Object.defineProperty(result, "userPageBodyPlan", { value: {
    schemaVersion: 1, profile: "user", sections: [
      { heading: "Original", assets: ["page-002.png", "original.pdf"] },
      { heading: "Clean", assets: ["clean.png"] },
      { heading: "Interpreted", assets: ["interpreted.png"] },
      { heading: "Review", values: [returnChoice.value, reviewState, ...autoReview.reasons] },
    ], developmentDetailsIncluded: false,
  }, enumerable: false });
  return result;
}

export function formatProcessingNotionPreview(plan) {
  if (plan.profile === "user") {
    return ["DRY RUN — NO EXTERNAL WRITE", "", "NOTION REVIEW PREVIEW — USER", "",
      `Destination: ${plan.destination.name}`, `Source: ${plan.destination.source}`, "Records: 1", "",
      ...plan.properties.filter(p => !["Review state", "Return target"].includes(p.field)).map(p =>
        `${p.field}: ${p.assets ? p.assets.map(a => a.filename).join(" + ") : p.value}`),
      "", "Clean: typed text, preserving meaning and broad layout", "Interpreted: typed text with stronger restructuring", "",
      `Review State: ${plan.reviewState}`, `Return target: ${plan.returnChoice.label}`,
      `Auto review: ${plan.reason}${plan.autoReview.reasons.length ? ` (${plan.autoReview.reasons.join(", ")})` : ""}`,
      `Return ready: ${plan.returnReady ? "YES" : "NO"}`, "Choosing a return target does not execute Return.", "",
      "Page body: Original / Clean / Interpreted / Review (concise User view)",
      "No upload or record creation. Network calls: 0; External writes: 0", "",].join("\n");
  }
  const lines = ["DRY RUN — NO EXTERNAL WRITE", "", "AI-PROCESSED NOTE → NOTION REVIEW PREVIEW", "",
    "Profile: development",
    `Destination: ${plan.destination.name}`, `Source: ${plan.destination.source}`, "Records: 1", "",
    "Field resolution:", "  logical Title → unique remote title property (resolved by type; existing name preserved)", "",
    "File / field mapping:"];
  for (const p of plan.properties) {
    if (p.assets) for (const a of p.assets) lines.push(`  ${a.filename} → ${p.field} (${a.mimeType})`, `    SHA-256: ${a.sha256}`);
  }
  lines.push("  Original SHA-256 field: PDF hash; page PNG hash retained in provenance", "", `Page content: ${plan.developmentPageBody.children.length} serialized Notion blocks`);
  for (const section of plan.bodySections) {
    lines.push(`  ${section.section}: ${section.assets ? section.assets.map(a => a.filename).join(", ") : "source hashes, OCR provider, prompt versions/hashes, selected attempts, mode differences"}`);
  }
  const diagnostics = plan.bodySections[2].value;
  lines.push(`  Processing status: ${diagnostics.processingStatus}`, `  Image provider: ${diagnostics.provider.provider}; model: ${diagnostics.provider.model}`);
  for (const [mode, record] of Object.entries(plan.bodySections[1].value.modes)) lines.push(`  ${mode} prompt: ${record.prompt.contract}; SHA-256: ${record.prompt.sha256}`);
  for (const attempt of diagnostics.attempts) lines.push(`  Attempt ${attempt.attempt}: ${attempt.status}${attempt.reason ? ` — ${attempt.reason}` : ""}`);
  lines.push(`  OCR: ${plan.bodySections[0].textBlockCount} text blocks; ${plan.bodySections[0].needsReviewCount} need review`, "",
    "Modes: Clean = typed text / minimal restructuring; Interpreted = typed text / stronger restructuring",
    `Return target: ${plan.returnChoice.label} (intent only; both results included)`,
    "Owner Visual Review: PASS — this sample may proceed as a PoC only",
    `Review State: ${plan.reviewState}`, "Human Approval: NOT GRANTED", "approved: false; publication approval: false", "",
    "Operation: Prepare one review record. No upload or record creation.",
    "Network calls: 0; External writes: 0", "Execution: UNAVAILABLE for processing jobs", plan.uploadState,
    "Private local preview; OCR text, source paths and destination IDs are not printed.", "");
  return lines.join("\n");
}

export async function processingNotionPreviewCommand(args) {
  if (args.some(a => a === "--execute" || a.startsWith("--execute="))) throw new Error("Processing-job Notion bridge is preview-only; execute is unavailable.");
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k === "--json" && !options.json) { options.json = true; continue; }
    if (!["--job", "--config", "--destination", "--profile", "--return-target"].includes(k) || options[k] !== undefined || !args[i+1] || args[i+1].startsWith("--")) throw new Error("Invalid, repeated or incomplete Notion preview option.");
    options[k] = args[++i];
  }
  if (!options["--job"]) throw new Error("--job is required.");
  const requestedProfile = options["--profile"] === undefined ? undefined : validateProfile(options["--profile"]);
  const config = await loadConfig(options["--config"] ?? `config/notion-${requestedProfile ?? "user"}.example.json`);
  const plan = await prepareProcessingNotionPreview({ job: options["--job"], config, profile: requestedProfile, returnTarget: options["--return-target"], destinationOverride: options["--destination"] });
  return options.json ? plan : formatProcessingNotionPreview(plan);
}
