import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateUserReview } from "../notion/profiles.mjs";

export const OFFICIAL_NOTE_ROUTES = Object.freeze({
  create: "/open-model-note/file/create",
  readBack: "/open-model-note/file/content",
  sync: "/open-model/sync",
});

export const IMAGE_RETURN_CAPABILITY = "NO_OFFICIAL_PATH_FOUND";
export const MARKDOWN_IMAGE_SUPPORT = "NOT_DOCUMENTED";

export class OfficialReturnPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OfficialReturnPlanError";
    this.code = code;
  }
}

export function assertOfficialReturnRoute(route) {
  if (!Object.values(OFFICIAL_NOTE_ROUTES).includes(route)) {
    throw new OfficialReturnPlanError("UNSUPPORTED_ROUTE", "Only documented OpenModel note routes are allowed.");
  }
  return route;
}

function scalar(value, field) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new OfficialReturnPlanError("CONFLICTING_STATE", `${field} must have exactly one value.`);
    [value] = value;
  }
  if (typeof value !== "string" || !value.trim()) throw new OfficialReturnPlanError("MISSING_FIELD", `${field} is required.`);
  return value.trim();
}

function artifacts(value, field, expectedMimeType) {
  if (!Array.isArray(value) || value.length === 0) throw new OfficialReturnPlanError("ARTIFACT_MISSING", `${field} artifact is missing.`);
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string" || !item.name.trim()
      || item.available === false) throw new OfficialReturnPlanError("ARTIFACT_MISSING", `${field} artifact is unavailable.`);
    const name = item.name.trim();
    if (path.basename(name) !== name || name === "." || name === ".." || name.length > 200
      || /[\r\n\u0000-\u001f`]/u.test(name)) {
      throw new OfficialReturnPlanError("INVALID_ARTIFACT_NAME", `${field} artifact name is unsafe.`);
    }
    const mimeType = typeof item.mimeType === "string" ? item.mimeType.trim().toLowerCase() : "";
    if (expectedMimeType && mimeType !== expectedMimeType) {
      throw new OfficialReturnPlanError("INVALID_ARTIFACT_TYPE", `${field} artifact must be ${expectedMimeType}.`);
    }
    return { name, mimeType: mimeType || "unknown" };
  });
}

function safeTitle(value) {
  const title = scalar(value, "Title");
  if (/[\r\n\u0000-\u001f]/u.test(title) || title.length > 200) throw new OfficialReturnPlanError("INVALID_TITLE", "Title is not safe for a note preview.");
  return title;
}

function markdownFor({ title, resolvedTarget, artifact }) {
  const label = resolvedTarget === "clean" ? "Clean" : "Interpreted";
  return [
    `# ${title}`,
    "",
    `- Selected result: **${label}**`,
    `- Selected artifact: \`${artifact.name}\``,
    "",
    "> Image attachment is not planned because the official OpenModel image-insertion capability is not documented.",
  ].join("\n");
}

export function planOfficialSkillReturn({ record, defaultReturnMode = "clean", noteTitle } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new OfficialReturnPlanError("INVALID_RECORD", "A User record is required.");
  const title = safeTitle(noteTitle ?? record.Title);
  const reviewState = scalar(record["Review state"], "Review state");
  const returnTarget = scalar(record["Return target"], "Return target");
  const original = artifacts(record.Original, "Original");
  const clean = Array.isArray(record.Clean) && record.Clean.length ? artifacts(record.Clean, "Clean", "image/png") : [];
  const interpreted = Array.isArray(record.Interpreted) && record.Interpreted.length ? artifacts(record.Interpreted, "Interpreted", "image/png") : [];
  const review = evaluateUserReview({ reviewState, returnTarget, defaultReturnMode,
    availableArtifacts: { clean: clean.length === 1, interpreted: interpreted.length === 1 } });
  if (!review.returnReady) throw new OfficialReturnPlanError(review.detail ?? review.reason, "User record is not ready for Return.");
  const selected = review.resolvedReturnTarget === "clean" ? clean[0] : interpreted[0];
  if (!selected) throw new OfficialReturnPlanError("TARGET_ARTIFACT_MISSING", "Resolved artifact is missing.");

  const createEndpoint = assertOfficialReturnRoute(OFFICIAL_NOTE_ROUTES.create);
  const readBackEndpoint = assertOfficialReturnRoute(OFFICIAL_NOTE_ROUTES.readBack);
  const markdown = markdownFor({ title, resolvedTarget: review.resolvedReturnTarget, artifact: selected });
  return Object.freeze({
    schemaVersion: 1,
    mode: "offline-preview",
    approved: review.approved,
    resolvedTarget: review.resolvedReturnTarget,
    selectedArtifact: Object.freeze({ field: review.resolvedReturnTarget === "clean" ? "Clean" : "Interpreted", ...selected }),
    plannedNoteTitle: title,
    plannedMarkdown: markdown,
    plannedOfficialEndpoint: createEndpoint,
    readBackEndpoint,
    syncPlanned: false,
    newNoteOnly: true,
    originalProtection: Object.freeze({ overwrite: false, update: false, delete: false }),
    requestPreview: Object.freeze({ method: "POST", endpoint: createEndpoint, body: Object.freeze({ parentId: "0", name: title, markdown }) }),
    readBackPreview: Object.freeze({ method: "GET", endpoint: readBackEndpoint, verifies: Object.freeze(["new note name", "normalized text content"]) }),
    imageReturnCapability: IMAGE_RETURN_CAPABILITY,
    markdownImageSupport: MARKDOWN_IMAGE_SUPPORT,
    imageAttachmentPlanned: false,
    fullLoopComplete: false,
    officialRoutesOnly: true,
    networkCalls: 0,
    externalWrites: 0,
    inputSummary: Object.freeze({ fields: Object.freeze(["Review state", "Return target", "Original", "Clean", "Interpreted"]), originalArtifacts: original.length }),
  });
}

export function formatOfficialSkillReturnPreview(plan) {
  return [
    "DRY RUN — NO AINOTE WRITE",
    "",
    "OFFICIAL OPENMODEL RETURN PREVIEW",
    `Approved: ${plan.approved ? "YES" : "NO"}`,
    `Resolved target: ${plan.resolvedTarget}`,
    `Selected artifact: ${plan.selectedArtifact.field} / ${plan.selectedArtifact.name}`,
    `Planned note title: ${plan.plannedNoteTitle}`,
    "Planned markdown:", plan.plannedMarkdown,
    `Create endpoint: ${plan.plannedOfficialEndpoint}`,
    `Read-back endpoint: ${plan.readBackEndpoint}`,
    `Sync planned: ${plan.syncPlanned ? "YES" : "NO"}`,
    `Image Return: ${plan.imageReturnCapability}`,
    `Markdown image support: ${plan.markdownImageSupport}`,
    "New note only; Original overwrite/update/delete: 0",
    "Network calls: 0; AINOTE writes: 0",
    "Text-only preview is not a completed AI-no-Te full loop.",
    "",
  ].join("\n");
}

export async function officialReturnPreviewCommand(args = []) {
  if (args.some(item => item === "--execute" || item.startsWith("--execute="))) {
    throw new OfficialReturnPlanError("EXECUTION_UNAVAILABLE", "Official Return adapter is preview-only.");
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--json" && options.json === undefined) { options.json = true; continue; }
    if (!["--record", "--default-mode", "--note-title"].includes(key) || options[key] !== undefined
      || typeof args[index + 1] !== "string" || args[index + 1].startsWith("--")) {
      throw new OfficialReturnPlanError("INVALID_OPTION", "Invalid, repeated, or incomplete official Return preview option.");
    }
    options[key] = args[++index];
  }
  if (!options["--record"]) throw new OfficialReturnPlanError("MISSING_RECORD", "--record is required.");
  const file = path.resolve(options["--record"]);
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new OfficialReturnPlanError("UNSAFE_RECORD_FILE", "Record input is missing or unsafe.");
  const record = JSON.parse(await readFile(file, "utf8"));
  const plan = planOfficialSkillReturn({ record, defaultReturnMode: options["--default-mode"] ?? "clean", noteTitle: options["--note-title"] });
  return options.json ? plan : formatOfficialSkillReturnPreview(plan);
}
