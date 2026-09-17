import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { evaluateUserReview } from "../notion/profiles.mjs";

export const DESKTOP_RETURN_ROUTES = Object.freeze({
  create: "/note/createMixtureNote",
  addImage: "/note/addMixtureImgFile",
  saveRich: "/note/saveRichMixtureNote",
  readBack: "/note/getDetail",
  sync: "/sync/pushOneNote",
});

const ROUTES = new Set(Object.values(DESKTOP_RETURN_ROUTES));
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

export class DesktopReturnError extends Error {
  constructor(code, message, stage = "validation", partialState = null) {
    super(message);
    this.name = "DesktopReturnError";
    this.code = code;
    this.stage = stage;
    this.partialState = partialState;
  }
}

function scalar(value, field) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new DesktopReturnError("CONFLICTING_STATE", `${field} must have exactly one value.`);
    [value] = value;
  }
  if (typeof value !== "string" || !value.trim()) throw new DesktopReturnError("MISSING_FIELD", `${field} is required.`);
  return value.trim();
}

function safeText(value, field, max = 200) {
  const text = scalar(value, field);
  if (text.length > max || /[\r\n\u0000-\u001f]/u.test(text)) {
    throw new DesktopReturnError("INVALID_FIELD", `${field} is not safe.`);
  }
  return text;
}

function artifactList(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DesktopReturnError("ARTIFACT_MISSING", `${field} artifact is missing.`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || item.available === false) {
      throw new DesktopReturnError("ARTIFACT_MISSING", `${field} artifact is unavailable.`);
    }
    const name = safeText(item.name, `${field} artifact name`);
    if (path.basename(name) !== name || name === "." || name === ".." || /[`]/u.test(name)) {
      throw new DesktopReturnError("INVALID_ARTIFACT_NAME", `${field} artifact name is unsafe.`);
    }
    const mimeType = typeof item.mimeType === "string" ? item.mimeType.trim().toLowerCase() : "";
    return { name, mimeType, localPath: item.localPath ?? item.path ?? null };
  });
}

function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    throw new DesktopReturnError("INVALID_ARTIFACT_TYPE", "Selected artifact must be a valid PNG.");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 30_000 || height > 30_000) {
    throw new DesktopReturnError("INVALID_IMAGE_DIMENSIONS", "Selected PNG dimensions are invalid.");
  }
  return { width, height };
}

function sourceImageGeometry(width, height) {
  return Object.freeze({
    sourceWidth: width,
    sourceHeight: height,
    width,
    height,
    fit: "source",
    cropped: false,
    pixelDataChanged: false,
  });
}

async function inspectSelectedArtifact(artifact, baseDirectory) {
  if (artifact.mimeType !== "image/png") {
    throw new DesktopReturnError("INVALID_ARTIFACT_TYPE", "Selected artifact must use image/png.");
  }
  if (typeof artifact.localPath !== "string" || !artifact.localPath.trim()) {
    throw new DesktopReturnError("LOCAL_ARTIFACT_REQUIRED", "Selected artifact requires a localPath for Desktop Return.");
  }
  const resolved = path.resolve(baseDirectory, artifact.localPath.trim());
  const info = await lstat(resolved).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 24 || info.size > MAX_IMAGE_BYTES) {
    throw new DesktopReturnError("ARTIFACT_MISSING", "Selected local artifact is missing or unsafe.");
  }
  const bytes = await readFile(resolved);
  const { width, height } = pngSize(bytes);
  return {
    path: resolved,
    width,
    height,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function assertDesktopReturnRoute(route) {
  const base = String(route).split("?", 1)[0];
  if (!ROUTES.has(base)) {
    throw new DesktopReturnError("UNSUPPORTED_ROUTE", "Experimental Desktop Return may use only its disclosed route allowlist.");
  }
  return route;
}

function helperCandidates(source = process.env, homeDirectory = os.homedir()) {
  const candidates = [];
  if (source.CODEX_HOME?.trim()) {
    candidates.push(path.join(path.resolve(source.CODEX_HOME.trim()), "skills", "ainote", "shared", "scripts", "ainote_api.py"));
  }
  candidates.push(path.join(homeDirectory, ".codex", "skills", "ainote", "shared", "scripts", "ainote_api.py"));
  return [...new Set(candidates)];
}

export function resolveInstalledAinoteHelper(source = process.env, options = {}) {
  if (source.AINOTE_API_HELPER?.trim()) {
    const explicit = path.resolve(source.AINOTE_API_HELPER.trim());
    if (path.basename(explicit).toLowerCase() !== "ainote_api.py") {
      throw new DesktopReturnError("HELPER_MISSING", "AINOTE_API_HELPER must point to ainote_api.py.", "helper_check");
    }
    try {
      (options.accessSync ?? accessSync)(explicit, fsConstants.R_OK);
      return explicit;
    } catch {
      throw new DesktopReturnError("HELPER_MISSING", "Configured AINOTE_API_HELPER is missing or unreadable.", "helper_check");
    }
  }
  for (const candidate of helperCandidates(source, options.homeDirectory)) {
    if (path.basename(candidate).toLowerCase() !== "ainote_api.py") continue;
    try {
      (options.accessSync ?? accessSync)(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // Try the next installed-Skill location.
    }
  }
  throw new DesktopReturnError(
    "HELPER_MISSING",
    "Experimental Return requires the installed AINOTE Skill; ainote_api.py was not found.",
    "helper_check",
  );
}

export function buildDesktopHelperEnv(source = process.env) {
  const allowed = [
    "AINOTE_APP_EXE", "AINOTE_BACKGROUND_ARG", "APPDATA", "HOME", "LOCALAPPDATA", "PATH",
    "ProgramFiles", "ProgramFiles(x86)", "PYTHONIOENCODING", "SYSTEMROOT", "SystemRoot", "WINDIR",
    "ComSpec", "PATHEXT", "TEMP", "TMP", "XDG_CONFIG_HOME",
  ];
  return Object.fromEntries(allowed.filter((key) => typeof source[key] === "string").map((key) => [key, source[key]]));
}

function pythonCommand(source = process.env) {
  return source.AINOTE_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
}

function sanitizeDiagnosticText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+\S+/giu, "Bearer <redacted>")
    .replace(/([A-Z_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*)\s*[=:]\s*\S+/giu, "$1=<redacted>")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/giu, "<user-home>")
    .replace(/[A-Z]:\\[^\r\n]*/giu, "<local-path>")
    .slice(0, 500)
    .trim();
}

function helperFailureClassification(result) {
  if (result.error) return "HELPER_LAUNCH_FAILED";
  const text = `${result.stderr ?? ""} ${result.stdout ?? ""}`;
  if (/HTTP\s+4\d\d/iu.test(text)) return "HTTP_4XX";
  if (/HTTP\s+5\d\d/iu.test(text)) return "HTTP_5XX";
  if (/connection.*reset|ECONNRESET/iu.test(text)) return "CONNECTION_RESET";
  if (/connection.*refused|ECONNREFUSED/iu.test(text)) return "CONNECTION_REFUSED";
  if (/timed?\s*out|ETIMEDOUT/iu.test(text)) return "TIMEOUT";
  if (result.status !== 0) return "REQUEST_DISPATCH_FAILED";
  return "PASS";
}

function helperRequest({ route, method = "GET", body, helperPath }, source = process.env) {
  assertDesktopReturnRoute(route);
  const args = [helperPath, "--url", `http://127.0.0.1:46588${route}`, "--method", method, "--no-auto-start"];
  if (body !== undefined) args.push("--body-encoded", encodeURIComponent(JSON.stringify(body)));
  const result = spawnSync(pythonCommand(source), args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    env: buildDesktopHelperEnv(source),
  });
  if (result.error || result.status !== 0) {
    throw new DesktopReturnError("HELPER_REQUEST_FAILED", "AINOTE Desktop request failed.", "desktop_request");
  }
  let data;
  try { data = JSON.parse(result.stdout.trim()); } catch {
    throw new DesktopReturnError("INVALID_DESKTOP_RESPONSE", "AINOTE Desktop response was not JSON.", "desktop_request");
  }
  if (data?.code !== 200) throw new DesktopReturnError("DESKTOP_RESPONSE_FAILED", "AINOTE Desktop rejected the request.", "desktop_request");
  return data;
}

function pageContent({ label, sourceTitle, objectName, width, height, now }) {
  return [
    "---", "version:0", "updateSN:201201029", "bg_layer:初版使用", `updateTime:${now}`, "---",
    label, "", `元ノート: ${sourceTitle}`, "",
    `![image](${JSON.stringify({ width, height, name: objectName })})`, "",
  ].join("\n");
}

async function prepareDesktopReturn({ record, recordDirectory = process.cwd(), defaultReturnMode = "clean", noteTitle, folderId, folderName } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new DesktopReturnError("INVALID_RECORD", "A current User record is required.");
  }
  const title = safeText(noteTitle ?? record.Title, "Title");
  const reviewState = scalar(record["Review state"], "Review state");
  const returnTarget = scalar(record["Return target"], "Return target");
  const original = artifactList(record.Original, "Original");
  const clean = artifactList(record.Clean, "Clean");
  const interpreted = artifactList(record.Interpreted, "Interpreted");
  const review = evaluateUserReview({
    reviewState,
    returnTarget,
    defaultReturnMode,
    availableArtifacts: { clean: clean.length === 1, interpreted: interpreted.length === 1 },
    recordConsistent: original.length > 0 && clean.length === 1 && interpreted.length === 1,
  });
  if (!review.returnReady) {
    throw new DesktopReturnError(review.detail ?? review.reason, "User record is not ready for Experimental Desktop Return.");
  }
  const selected = review.resolvedReturnTarget === "clean" ? clean[0] : interpreted[0];
  const inspected = await inspectSelectedArtifact(selected, recordDirectory);
  const displayGeometry = sourceImageGeometry(inspected.width, inspected.height);
  const destination = {
    id: safeText(folderId, "AINOTE folder ID", 300),
    name: safeText(folderName, "AINOTE folder name"),
  };
  const selectedField = review.resolvedReturnTarget === "clean" ? "Clean" : "Interpreted";
  const plan = Object.freeze({
    schemaVersion: 1,
    mode: "experimental-desktop-preview",
    status: "RETURN_READY",
    approved: true,
    resolvedTarget: review.resolvedReturnTarget,
    selectedArtifact: Object.freeze({ field: selectedField, name: selected.name, mimeType: selected.mimeType, sha256: inspected.sha256, width: inspected.width, height: inspected.height }),
    displayGeometry,
    plannedNoteTitle: title,
    destination: Object.freeze({ name: destination.name, configured: true }),
    endpoints: Object.freeze(Object.values(DESKTOP_RETURN_ROUTES)),
    helperBundled: false,
    helperSource: "installed AINOTE Skill",
    experimental: true,
    documentedOpenModelApi: false,
    newNoteOnly: true,
    originalProtection: Object.freeze({ overwrite: false, update: false, delete: false }),
    syncPlanned: true,
    readBackPlanned: true,
    automaticRetry: false,
    networkCalls: 0,
    externalWrites: 0,
    warning: "Uses undocumented AINOTE Desktop behavior and may stop working after a Desktop update. Creates a new note; Original is not overwritten.",
    duplicateRisk: "Repeating execute may create another note; there is no automatic retry or rollback.",
    inputFields: Object.freeze(["Review state", "Return target", "Original", "Clean", "Interpreted"]),
  });
  return { plan, inspected, destination, title, sourceTitle: safeText(record.Title, "Title"), selectedField };
}

export async function planDesktopReturn(options) {
  return (await prepareDesktopReturn(options)).plan;
}

export async function diagnoseDesktopCreate(options = {}, dependencies = {}) {
  const prepared = await prepareDesktopReturn(options);
  const helperPath = dependencies.helperPath ?? resolveInstalledAinoteHelper(dependencies.env ?? process.env, dependencies.helperOptions);
  const source = dependencies.env ?? process.env;
  const spawn = dependencies.spawnSync ?? spawnSync;
  const createPayload = {
    dirId: prepared.destination.id,
    dirName: prepared.destination.name,
    isTop: "0",
    noteName: prepared.title,
    contentText: "",
  };
  const serialized = JSON.stringify(createPayload);
  const encoded = encodeURIComponent(serialized);
  const healthRoute = "/open-model-note/health";
  const result = spawn(pythonCommand(source), [
    helperPath,
    "--url", `http://127.0.0.1:46588${healthRoute}`,
    "--method", "GET",
    "--no-auto-start",
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    env: buildDesktopHelperEnv(source),
  });
  const classification = helperFailureClassification(result);
  let stdoutJson = null;
  try { stdoutJson = JSON.parse(String(result.stdout ?? "").trim()); } catch { /* Report parse state only. */ }
  const httpCode = Number.isInteger(stdoutJson?.code) ? stdoutJson.code : null;
  const processStarted = !result.error;
  const requestReachedDesktop = httpCode !== null ? "YES" : processStarted && result.status !== 0 ? "UNKNOWN" : "NO";
  return Object.freeze({
    mode: "desktop-create-diagnostic",
    writeRequestSent: false,
    ainoteWrites: 0,
    helperFound: true,
    helperProcessStarted: processStarted,
    helperExitCode: Number.isInteger(result.status) ? result.status : null,
    stdoutPresent: Boolean(result.stdout),
    stderrPresent: Boolean(result.stderr),
    sanitizedStdout: stdoutJson ? `valid JSON response (code ${httpCode ?? "unknown"})` : sanitizeDiagnosticText(result.stdout),
    sanitizedStderr: sanitizeDiagnosticText(result.stderr),
    exceptionType: result.error?.name ?? null,
    sanitizedException: sanitizeDiagnosticText(result.error?.message),
    failureStage: classification === "PASS" ? null : processStarted ? "DESKTOP_HEALTH_REQUEST" : "HELPER_LAUNCH",
    failureClassification: classification,
    requestReachedDesktop,
    httpCategory: httpCode === null ? null : `${Math.floor(httpCode / 100)}XX`,
    desktopPortResolvedBy: "installed AINOTE Skill helper",
    targetEndpointResolved: DESKTOP_RETURN_ROUTES.create,
    targetEndpointDispatched: false,
    createPayloadSerialized: Boolean(serialized && encoded),
    createPayloadFields: Object.freeze(Object.keys(createPayload)),
    createPayloadContainsDisplayMetadata: false,
    displayMetadataStage: "saveRichMixtureNote (after create and image add)",
    displayMetadataRelated: "NO",
  });
}

export function verifyDesktopReturnDetail(data, { expectedNoteId, expectedTitle, objectName } = {}) {
  const prop = data?.data?.prop;
  const note = data?.data?.note;
  const content = note?.content;
  const pages = content?.pages;
  const usesPostSyncShape = prop && typeof prop === "object" && !Array.isArray(prop);
  const returnedNoteId = usesPostSyncShape ? prop.noteId : note?.noteId;
  const returnedTitle = usesPostSyncShape ? prop.noteName : note?.noteName;
  const page = Array.isArray(pages) && pages.length === 1 ? pages[0] : null;
  const attachments = page?.attachmentSrc;
  const attachmentKeys = attachments && typeof attachments === "object" && !Array.isArray(attachments)
    ? Object.keys(attachments)
    : [];
  const contentIdentityPresent = content?.noteId !== undefined || page?.noteId !== undefined;
  const contentIdentityConsistent = !contentIdentityPresent
    || (content?.noteId !== undefined && page?.noteId !== undefined && String(content.noteId) === String(page.noteId));
  const pageSources = page?.src;
  const postSyncPageValid = !usesPostSyncShape
    || (pageSources && typeof pageSources === "object" && !Array.isArray(pageSources)
      && typeof pageSources["page.bin"] === "string" && pageSources["page.bin"].trim()
      && Number(prop.localActionV2) === 0 && Number(prop.isDel) === 0);

  if (typeof expectedNoteId !== "string" || !expectedNoteId
    || typeof expectedTitle !== "string" || !expectedTitle
    || typeof objectName !== "string" || !objectName
    || returnedNoteId !== expectedNoteId || returnedTitle !== expectedTitle
    || content?.source !== "T5" || !page || !contentIdentityConsistent || !postSyncPageValid
    || attachmentKeys.length !== 1 || attachmentKeys[0] !== objectName || attachments[objectName] !== objectName) {
    throw new DesktopReturnError("READ_BACK_FAILED", "AINOTE note read-back did not match the new image note.", "read_back");
  }
  return Object.freeze({
    valid: true,
    shape: usesPostSyncShape ? "post-sync-prop" : "legacy-note",
    noteIdentityMatched: true,
    titleMatched: true,
    imageRelationMatched: true,
    synchronized: usesPostSyncShape,
  });
}

export async function executeDesktopReturn(options = {}, dependencies = {}) {
  if (options.execute !== true) {
    throw new DesktopReturnError("EXPLICIT_EXECUTE_REQUIRED", "Experimental Desktop Return requires explicit --execute.", "execute_gate");
  }
  const prepared = await prepareDesktopReturn(options);
  const helperPath = dependencies.helperPath ?? resolveInstalledAinoteHelper(dependencies.env ?? process.env, dependencies.helperOptions);
  const request = dependencies.request ?? ((input) => helperRequest({ ...input, helperPath }, dependencies.env ?? process.env));
  const partial = { noteCreated: false, imageAdded: false, richNoteSaved: false, synced: false, readBackVerified: false };
  try {
    const created = await request({ route: assertDesktopReturnRoute(DESKTOP_RETURN_ROUTES.create), method: "POST", body: {
      dirId: prepared.destination.id, dirName: prepared.destination.name, isTop: "0", noteName: prepared.title, contentText: "",
    } });
    const localId = created?.data?.noteId;
    if (typeof localId !== "string" || !localId.toLowerCase().startsWith("local")) {
      throw new DesktopReturnError("CREATE_FAILED", "AINOTE did not return a new local note identity.", "create");
    }
    partial.noteCreated = true;
    const added = await request({ route: assertDesktopReturnRoute(DESKTOP_RETURN_ROUTES.addImage), method: "POST", body: {
      noteId: localId, srcPath: prepared.inspected.path, index: 0, objectName: `pic_${Date.now()}.png`,
    } });
    const objectName = added?.data?.objectName;
    if (typeof objectName !== "string" || !objectName.endsWith(".png")) {
      throw new DesktopReturnError("IMAGE_ADD_FAILED", "AINOTE did not register the selected PNG.", "add_image");
    }
    partial.imageAdded = true;
    const content = pageContent({ label: `${prepared.selectedField} result`, sourceTitle: prepared.sourceTitle, objectName,
      width: prepared.plan.displayGeometry.width, height: prepared.plan.displayGeometry.height, now: Date.now() });
    await request({ route: assertDesktopReturnRoute(DESKTOP_RETURN_ROUTES.saveRich), method: "POST", body: {
      noteId: localId, index: 0, content, hwCount: 2, summary: `${prepared.selectedField} / ${prepared.sourceTitle}`,
    } });
    partial.richNoteSaved = true;
    const pushed = await request({ route: assertDesktopReturnRoute(`${DESKTOP_RETURN_ROUTES.sync}?noteId=${encodeURIComponent(localId)}`) });
    const formalId = pushed?.data?.data?.newId;
    if (pushed?.data?.code !== 0 || typeof formalId !== "string" || formalId.toLowerCase().startsWith("local")) {
      throw new DesktopReturnError("SYNC_FAILED", "AINOTE sync did not confirm the new note.", "sync");
    }
    partial.synced = true;
    const remoteDetail = await request({ route: assertDesktopReturnRoute(`${DESKTOP_RETURN_ROUTES.readBack}?noteId=${encodeURIComponent(formalId)}`) });
    verifyDesktopReturnDetail(remoteDetail, {
      expectedNoteId: formalId,
      expectedTitle: prepared.title,
      objectName,
    });
    partial.readBackVerified = true;
    return Object.freeze({ success: true, mode: "experimental-desktop-execute", status: "RETURN_COMPLETE",
      resolvedTarget: prepared.plan.resolvedTarget, selectedArtifact: prepared.plan.selectedArtifact,
      newNoteCreated: true, synced: true, readBackVerified: true, originalOverwritten: false,
      writes: 1, retries: 0 });
  } catch (error) {
    if (error instanceof DesktopReturnError) {
      error.partialState = Object.freeze({ ...partial });
      throw error;
    }
    throw new DesktopReturnError("EXECUTION_FAILED", "Experimental Desktop Return stopped after a partial failure.", "execute", Object.freeze({ ...partial }));
  }
}

export function formatDesktopReturnPreview(plan) {
  return [
    "DRY RUN — NO AINOTE WRITE", "", "EXPERIMENTAL DESKTOP RETURN PREVIEW",
    "Uses undocumented AINOTE Desktop behavior; compatibility is not guaranteed.",
    `Approved: ${plan.approved ? "YES" : "NO"}`,
    `Resolved target: ${plan.resolvedTarget}`,
    `Selected artifact: ${plan.selectedArtifact.field} / ${plan.selectedArtifact.name}`,
    `Source image: ${plan.displayGeometry.sourceWidth} x ${plan.displayGeometry.sourceHeight}`,
    `AINOTE display: ${plan.displayGeometry.width} x ${plan.displayGeometry.height} (source dimensions; no crop or pixel change)`,
    `Planned note title: ${plan.plannedNoteTitle}`,
    `Destination folder: ${plan.destination.name}`,
    "Creates a new note; Original overwrite/update/delete: 0",
    "Sync and read-back: planned", "Automatic retry: NO", plan.duplicateRisk,
    "Network calls: 0; AINOTE writes: 0", "",
  ].join("\n");
}

function commandOptions(args, executeCommand) {
  const options = { execute: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--json" && options.json === false) { options.json = true; continue; }
    if (key === "--execute" && options.execute === false) { options.execute = true; continue; }
    if (!["--record", "--default-mode", "--note-title", "--folder-id", "--folder-name"].includes(key)
      || options[key] !== undefined || typeof args[index + 1] !== "string" || args[index + 1].startsWith("--")) {
      throw new DesktopReturnError("INVALID_OPTION", "Invalid, repeated, or incomplete Experimental Desktop Return option.");
    }
    options[key] = args[++index];
  }
  if (!options["--record"] || !options["--folder-id"] || !options["--folder-name"]) {
    throw new DesktopReturnError("MISSING_OPTION", "--record, --folder-id, and --folder-name are required.");
  }
  if (executeCommand !== options.execute) {
    throw new DesktopReturnError("EXPLICIT_EXECUTE_REQUIRED", executeCommand
      ? "desktop-execute requires --execute." : "desktop-preview does not accept --execute.", "execute_gate");
  }
  return options;
}

export async function desktopReturnCommand(command, args = [], dependencies = {}) {
  if (!["desktop-preview", "desktop-execute", "desktop-diagnose-create"].includes(command)) {
    throw new DesktopReturnError("UNKNOWN_COMMAND", "Return command supports official-preview, desktop-preview, desktop-diagnose-create, or desktop-execute.");
  }
  const executeCommand = command === "desktop-execute";
  const options = commandOptions(args, executeCommand);
  const file = path.resolve(options["--record"]);
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES) {
    throw new DesktopReturnError("UNSAFE_RECORD_FILE", "Record input is missing or unsafe.");
  }
  const record = JSON.parse(await readFile(file, "utf8"));
  const input = { record, recordDirectory: path.dirname(file), defaultReturnMode: options["--default-mode"] ?? "clean",
    noteTitle: options["--note-title"], folderId: options["--folder-id"], folderName: options["--folder-name"], execute: options.execute };
  if (executeCommand) return executeDesktopReturn(input, dependencies);
  if (command === "desktop-diagnose-create") return diagnoseDesktopCreate(input, dependencies);
  const plan = await planDesktopReturn(input);
  return options.json ? plan : formatDesktopReturnPreview(plan);
}
