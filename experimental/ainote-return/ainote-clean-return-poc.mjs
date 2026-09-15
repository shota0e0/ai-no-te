import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { accessSync, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG = Object.freeze({
  notionVersion: process.env.AINOTE_RETURN_NOTION_VERSION?.trim() || "2026-03-11",
  dataSourceId: process.env.AINOTE_RETURN_DATA_SOURCE_ID?.trim() || "",
  targetTitle: process.env.AINOTE_RETURN_TARGET_TITLE?.trim() || "",
  originalSha: process.env.AINOTE_RETURN_ORIGINAL_SHA256?.trim() || "",
  cleanFilename: process.env.AINOTE_RETURN_IMAGE_FILENAME?.trim() || "selected-result.png",
  cleanSha: process.env.AINOTE_RETURN_IMAGE_SHA256?.trim() || "",
  cleanWidth: Number(process.env.AINOTE_RETURN_IMAGE_WIDTH || 1086),
  cleanHeight: Number(process.env.AINOTE_RETURN_IMAGE_HEIGHT || 1448),
  approvalState: process.env.AINOTE_RETURN_APPROVED_STATE?.trim() || "Approved",
  approvalTarget: process.env.AINOTE_RETURN_MODE?.trim() || "Clean",
  returnedState: process.env.AINOTE_RETURN_RETURNED_STATE?.trim() || "Returned",
  returnTitle: process.env.AINOTE_RETURN_NOTE_TITLE?.trim() || "",
  returnLabel: process.env.AINOTE_RETURN_LABEL?.trim() || "Selected result",
  sourceTitle: process.env.AINOTE_RETURN_SOURCE_TITLE?.trim() || "Source note",
  targetFolderPath: (process.env.AINOTE_RETURN_FOLDER_PATH || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean),
  notionProperties: Object.freeze({
    title: process.env.AINOTE_RETURN_PROPERTY_TITLE?.trim() || "Title",
    originalSha: process.env.AINOTE_RETURN_PROPERTY_ORIGINAL_SHA?.trim() || "Original SHA-256",
    cleanFile: process.env.AINOTE_RETURN_PROPERTY_RESULT_FILE?.trim() || "Result image",
    cleanSha: process.env.AINOTE_RETURN_PROPERTY_RESULT_SHA?.trim() || "Result SHA-256",
    returnState: process.env.AINOTE_RETURN_PROPERTY_STATE?.trim() || "Return state",
    returnTarget: process.env.AINOTE_RETURN_PROPERTY_MODE?.trim() || "Return mode",
    returnId: process.env.AINOTE_RETURN_PROPERTY_ID?.trim() || "AINOTE return ID",
    returnedAt: process.env.AINOTE_RETURN_PROPERTY_RETURNED_AT?.trim() || "Returned at",
  }),
  notionApiBase: "https://api.notion.com/v1",
  ainoteApiBase: "http://127.0.0.1:46588",
  appData:
    process.env.AINOTE_APP_DATA?.trim() ||
    path.join(process.env.APPDATA?.trim() || path.join(os.homedir(), "AppData", "Roaming"), "AINOTE"),
  minimumAutoSyncHeadroomMs: 180_000,
});

const SAFE_KEYS = new Set([
  "stage",
  "success",
  "httpStatus",
  "apiErrorCode",
  "count",
  "pendingNotes",
  "pendingFolders",
  "pendingRelations",
  "filename",
  "fileSize",
  "width",
  "height",
  "sha256",
  "message",
]);

class PocError extends Error {
  constructor(message, stage, details = {}) {
    super(message);
    this.name = "PocError";
    this.stage = stage;
    this.httpStatus = details.httpStatus ?? null;
    this.apiErrorCode = details.apiErrorCode ?? null;
  }
}

function safeLog(fields) {
  const output = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SAFE_KEYS.has(key) && value !== undefined && value !== null) output[key] = value;
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function isPng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= 24 && signature.every((value, index) => bytes[index] === value);
}

function plainText(property) {
  return (property?.rich_text ?? []).map((item) => item.plain_text ?? "").join("");
}

function titleText(property) {
  return (property?.title ?? []).map((item) => item.plain_text ?? "").join("");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function resolveNotionToken() {
  const token = process.env.NOTION_API_KEY?.trim();
  if (token && process.env.AINOTE_RETURN_NOTION_TOKEN_SOURCE === "WindowsCredentialManager") {
    return token;
  }
  throw new PocError("Dedicated Notion credential is missing", "credential_check");
}

function assertExecutionConfig() {
  const required = [
    ["AINOTE_RETURN_DATA_SOURCE_ID", CONFIG.dataSourceId],
    ["AINOTE_RETURN_TARGET_TITLE", CONFIG.targetTitle],
    ["AINOTE_RETURN_ORIGINAL_SHA256", CONFIG.originalSha],
    ["AINOTE_RETURN_IMAGE_SHA256", CONFIG.cleanSha],
    ["AINOTE_RETURN_NOTE_TITLE", CONFIG.returnTitle],
    ["AINOTE_RETURN_FOLDER_PATH", CONFIG.targetFolderPath.join(">")],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new PocError(`Missing required local configuration: ${missing.join(", ")}`, "config_check");
  }
  if (!Number.isInteger(CONFIG.cleanWidth) || !Number.isInteger(CONFIG.cleanHeight)) {
    throw new PocError("Image dimensions must be integers", "config_check");
  }
}

async function notionJson(stage, endpoint, { token, method = "GET", body } = {}) {
  const response = await fetch(`${CONFIG.notionApiBase}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": CONFIG.notionVersion,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  safeLog({
    stage,
    httpStatus: response.status,
    apiErrorCode: response.ok ? undefined : data?.code ?? "non_json_error",
    success: response.ok,
  });
  if (!response.ok) {
    throw new PocError("Notion API request failed", stage, {
      httpStatus: response.status,
      apiErrorCode: data?.code ?? "non_json_error",
    });
  }
  return data;
}

function validateNotionSchema(dataSource) {
  const p = dataSource?.properties ?? {};
  const required = [
    [CONFIG.notionProperties.title, "title"],
    [CONFIG.notionProperties.originalSha, "rich_text"],
    [CONFIG.notionProperties.cleanFile, "files"],
    [CONFIG.notionProperties.cleanSha, "rich_text"],
    [CONFIG.notionProperties.returnState, "select"],
    [CONFIG.notionProperties.returnTarget, "select"],
    [CONFIG.notionProperties.returnId, "rich_text"],
    [CONFIG.notionProperties.returnedAt, "date"],
  ];
  const problems = [];
  for (const [name, expected] of required) {
    if (!p[name]) problems.push(`${name}: missing`);
    else if (p[name].type !== expected) problems.push(`${name}: expected ${expected}`);
  }
  for (const [property, option] of [
    [CONFIG.notionProperties.returnState, CONFIG.approvalState],
    [CONFIG.notionProperties.returnState, CONFIG.returnedState],
    [CONFIG.notionProperties.returnTarget, CONFIG.approvalTarget],
  ]) {
    const options = new Set(p[property]?.select?.options?.map((item) => item.name) ?? []);
    if (!options.has(option)) problems.push(`${property}: missing option ${option}`);
  }
  return problems;
}

async function findApprovedNotionRecord(token) {
  const schema = await notionJson(
    "notion_schema",
    `/data_sources/${encodeURIComponent(CONFIG.dataSourceId)}`,
    { token },
  );
  const problems = validateNotionSchema(schema);
  if (problems.length) throw new PocError(problems.join("; "), "notion_schema");

  const result = await notionJson(
    "notion_target_query",
    `/data_sources/${encodeURIComponent(CONFIG.dataSourceId)}/query`,
    {
      token,
      method: "POST",
      body: {
        filter: {
          and: [
            {
              property: CONFIG.notionProperties.title,
              title: { equals: CONFIG.targetTitle },
            },
            {
              property: CONFIG.notionProperties.originalSha,
              rich_text: { equals: CONFIG.originalSha },
            },
          ],
        },
        page_size: 2,
      },
    },
  );
  const count = result?.results?.length ?? 0;
  safeLog({ stage: "notion_target_unique", count, success: count === 1 });
  if (count !== 1) throw new PocError("Notion target is not unique", "notion_target_unique");

  const page = await notionJson(
    "notion_target_retrieve",
    `/pages/${encodeURIComponent(result.results[0].id)}`,
    { token },
  );
  const p = page.properties ?? {};
  const approved = p[CONFIG.notionProperties.returnState]?.select?.name === CONFIG.approvalState;
  const cleanSelected = p[CONFIG.notionProperties.returnTarget]?.select?.name === CONFIG.approvalTarget;
  const returnIdEmpty = plainText(p[CONFIG.notionProperties.returnId]) === "";
  const returnedAtEmpty = p[CONFIG.notionProperties.returnedAt]?.date == null;
  const cleanHash = plainText(p[CONFIG.notionProperties.cleanSha]);
  const files = p[CONFIG.notionProperties.cleanFile]?.files ?? [];
  const cleanFile = files.length === 1 ? files[0] : null;
  const validHostedFile =
    cleanFile?.type === "file" &&
    typeof cleanFile?.file?.url === "string" &&
    cleanFile.file.url.startsWith("https://") &&
    cleanFile.name === CONFIG.cleanFilename;
  if (
    titleText(p[CONFIG.notionProperties.title]) !== CONFIG.targetTitle ||
    !approved ||
    !cleanSelected ||
    !returnIdEmpty ||
    !returnedAtEmpty ||
    cleanHash !== CONFIG.cleanSha ||
    !validHostedFile
  ) {
    throw new PocError("Notion approval gate failed", "notion_approval");
  }
  safeLog({ stage: "notion_approval", success: true });
  return { page, cleanUrl: cleanFile.file.url };
}

async function downloadCleanOnce(url, destination) {
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(60_000) });
  safeLog({ stage: "clean_get", httpStatus: response.status, success: response.ok });
  if (!response.ok) {
    throw new PocError("Clean image GET failed", "clean_get", { httpStatus: response.status });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!isPng(bytes)) throw new PocError("Clean image is not PNG", "clean_verify");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const digest = sha256(bytes);
  if (
    width !== CONFIG.cleanWidth ||
    height !== CONFIG.cleanHeight ||
    digest !== CONFIG.cleanSha
  ) {
    throw new PocError("Clean image metadata or SHA-256 mismatch", "clean_verify");
  }
  await import("node:fs/promises").then(({ writeFile }) => writeFile(destination, bytes, { flag: "wx" }));
  safeLog({
    stage: "clean_verify",
    filename: CONFIG.cleanFilename,
    fileSize: bytes.length,
    width,
    height,
    sha256: digest,
    success: true,
  });
  return { bytes, width, height, digest };
}

function pythonCommand() {
  return process.env.AINOTE_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
}

export function buildAinoteHelperEnv(source = process.env) {
  const allowedKeys = [
    "AINOTE_APP_EXE",
    "AINOTE_BACKGROUND_ARG",
    "APPDATA",
    "HOME",
    "LOCALAPPDATA",
    "PATH",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "PYTHONIOENCODING",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "XDG_CONFIG_HOME",
  ];
  return Object.fromEntries(
    allowedKeys.filter((key) => typeof source[key] === "string").map((key) => [key, source[key]]),
  );
}

export function resolveAinoteHelperPath(source = process.env) {
  const configured = source.AINOTE_API_HELPER?.trim();
  if (!configured) {
    throw new PocError(
      "AINOTE_API_HELPER is required and must point to an externally supplied ainote_api.py file; the helper is not bundled",
      "helper_check",
    );
  }
  const resolved = path.resolve(configured);
  if (path.basename(resolved).toLowerCase() !== "ainote_api.py") {
    throw new PocError("AINOTE_API_HELPER must point to ainote_api.py", "helper_check");
  }
  try {
    accessSync(resolved, fsConstants.R_OK);
  } catch {
    throw new PocError("Configured AINOTE_API_HELPER is missing or unreadable", "helper_check");
  }
  return resolved;
}

function ainoteRequest(stage, route, { method = "GET", body } = {}) {
  const args = [
    resolveAinoteHelperPath(),
    "--url",
    `${CONFIG.ainoteApiBase}${route}`,
    "--method",
    method,
    "--no-auto-start",
  ];
  if (body !== undefined) args.push("--body-encoded", encodeURIComponent(JSON.stringify(body)));
  const result = spawnSync(pythonCommand(), args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    env: buildAinoteHelperEnv(),
  });
  if (result.error || result.status !== 0) {
    safeLog({ stage, success: false, message: "AINOTE local request failed" });
    throw new PocError("AINOTE local request failed", stage);
  }
  let data;
  try {
    data = JSON.parse(result.stdout.trim());
  } catch {
    throw new PocError("AINOTE response is not JSON", stage);
  }
  if (data?.code !== 200) throw new PocError("AINOTE application response failed", stage);
  safeLog({ stage, success: true });
  return data;
}

async function resolveDataRoot() {
  const base = path.join(CONFIG.appData, "data");
  const entries = await readdir(base, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(base, entry.name);
    try {
      await access(path.join(candidate, "db.json"));
      await access(path.join(candidate, "dir.json"));
      candidates.push(candidate);
    } catch {
      // Not an active note data root.
    }
  }
  if (candidates.length !== 1) throw new PocError("AINOTE data root is not unique", "data_root");
  return candidates[0];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function pendingCounts(db, dirs, relations) {
  return {
    pendingNotes: (db.list ?? []).filter((item) => Number(item.localActionV2 ?? 0) !== 0).length,
    pendingFolders: (dirs.list ?? []).filter((item) => Number(item.localAction ?? 0) !== 0).length,
    pendingRelations: (relations.list ?? []).filter((item) => Number(item.localAction ?? 0) !== 0).length,
  };
}

function resolveTargetFolder(dirs) {
  const list = dirs.list ?? [];
  const byKey = new Map();
  for (const item of list) {
    if (item.dirId) byKey.set(String(item.dirId), item);
    if (item.tempId) byKey.set(String(item.tempId), item);
  }
  const matches = [];
  for (const item of list) {
    const names = [];
    const seen = new Set();
    let current = item;
    while (current) {
      names.unshift(String(current.dirName ?? ""));
      const parent = String(current.pid ?? "0");
      if (parent === "0" || !parent || seen.has(parent)) break;
      seen.add(parent);
      current = byKey.get(parent);
    }
    if (stableJson(names) === stableJson(CONFIG.targetFolderPath)) matches.push(item);
  }
  if (matches.length !== 1) throw new PocError("Target folder is not unique", "folder_check");
  const folder = matches[0];
  const cloudBacked =
    typeof folder.dirId === "string" &&
    folder.dirId !== "0" &&
    !folder.dirId.toLowerCase().startsWith("local");
  if (!cloudBacked || Number(folder.localAction ?? 0) !== 0) {
    throw new PocError("Target folder is not cloud-backed and clean", "folder_check");
  }
  safeLog({ stage: "folder_check", count: 1, success: true });
  return folder;
}

function syncStateFromLog(text) {
  const marker = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+)\].*?(--start sync all--|--finish sync all--)/g;
  let match;
  let lastStart = null;
  let lastFinish = null;
  while ((match = marker.exec(text))) {
    const when = new Date(match[1]).getTime();
    if (match[2].includes("start")) lastStart = when;
    else lastFinish = when;
  }
  if (lastStart == null || lastFinish == null || lastStart > lastFinish) {
    throw new PocError("AINOTE sync state is unsafe or unknown", "sync_state");
  }
  const nextExpected = lastStart + 15 * 60_000;
  if (nextExpected - Date.now() < CONFIG.minimumAutoSyncHeadroomMs) {
    throw new PocError("Not enough headroom before expected automatic sync", "sync_state");
  }
  return { lastStart, lastFinish };
}

async function assertSyncSafe(expectedLastStart = null) {
  const text = await readFile(path.join(CONFIG.appData, "log", "note.log"), "utf8");
  const state = syncStateFromLog(text);
  if (expectedLastStart != null && state.lastStart !== expectedLastStart) {
    throw new PocError("Automatic sync started during PoC", "sync_state");
  }
  safeLog({ stage: "sync_state", success: true });
  return state;
}

async function hashFile(file) {
  return sha256(await readFile(file));
}

async function walkFiles(root) {
  const output = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(full)));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

async function snapshotExistingNotes(dataRoot, db) {
  const records = new Map();
  const files = new Map();
  for (const note of db.list ?? []) {
    const key = String(note.noteId);
    records.set(key, stableJson(note));
    const noteDir = path.join(dataRoot, key);
    try {
      for (const file of await walkFiles(noteDir)) {
        files.set(path.relative(dataRoot, file), await hashFile(file));
      }
    } catch {
      // Some downloaded notes may not have a local resource directory.
    }
  }
  return { records, files };
}

async function verifyExistingNotesUnchanged(dataRoot, before) {
  const db = await readJson(path.join(dataRoot, "db.json"));
  const current = new Map((db.list ?? []).map((note) => [String(note.noteId), stableJson(note)]));
  for (const [key, value] of before.records) {
    if (current.get(key) !== value) throw new PocError("Existing note metadata changed", "existing_notes_verify");
  }
  for (const [relative, digest] of before.files) {
    const file = path.join(dataRoot, relative);
    if ((await hashFile(file)) !== digest) {
      throw new PocError("Existing note file changed", "existing_notes_verify");
    }
  }
  safeLog({ stage: "existing_notes_verify", count: before.records.size, success: true });
}

function buildPageContent(objectName, now) {
  return [
    "---",
    "version:0",
    "updateSN:201201029",
    "bg_layer:初版使用",
    `updateTime:${now}`,
    "---",
    CONFIG.returnLabel,
    "",
    `元ノート: ${CONFIG.sourceTitle}`,
    `Notionレコード: ${CONFIG.targetTitle}`,
    "",
    `![image](${JSON.stringify({
      width: CONFIG.cleanWidth,
      height: CONFIG.cleanHeight,
      name: objectName,
    })})`,
    "",
  ].join("\n");
}

async function assertObjectNameUnique(dataRoot, existingSnapshot, objectName) {
  const suffix = `${path.sep}res${path.sep}${objectName}`.toLowerCase();
  for (const relative of existingSnapshot.files.keys()) {
    if (relative.toLowerCase().endsWith(suffix)) {
      throw new PocError("Generated image objectName is not unique", "object_name_check");
    }
  }
  const all = await walkFiles(dataRoot);
  const matches = all.filter((file) => path.basename(file) === objectName);
  if (matches.length !== 1) throw new PocError("Generated image objectName is not unique", "object_name_check");
  safeLog({ stage: "object_name_check", count: 1, success: true });
}

async function stageLocalNote({ dataRoot, folder, cleanPath, cleanSha, syncStart }) {
  const created = ainoteRequest("local_note_create", "/note/createMixtureNote", {
    method: "POST",
    body: {
      dirId: folder.dirId,
      dirName: folder.dirName,
      isTop: "0",
      noteName: CONFIG.returnTitle,
      contentText: "",
    },
  });
  const localId = created?.data?.noteId;
  if (typeof localId !== "string" || !localId.toLowerCase().startsWith("local")) {
    throw new PocError("New local note identity is invalid", "local_note_create");
  }

  const added = ainoteRequest("image_register", "/note/addMixtureImgFile", {
    method: "POST",
    body: {
      noteId: localId,
      srcPath: cleanPath,
      index: 0,
      objectName: `pic_${Date.now()}.png`,
    },
  });
  const objectName = added?.data?.objectName;
  const imagePath = added?.data?.imagePath;
  if (typeof objectName !== "string" || typeof imagePath !== "string") {
    throw new PocError("Image registration response is invalid", "image_register");
  }
  if ((await hashFile(imagePath)) !== cleanSha) {
    throw new PocError("AINOTE image copy SHA-256 mismatch", "image_copy_verify");
  }
  safeLog({ stage: "image_copy_verify", sha256: cleanSha, success: true });

  const content = buildPageContent(objectName, Date.now());
  ainoteRequest("page_bin_save", "/note/saveRichMixtureNote", {
    method: "POST",
    body: {
      noteId: localId,
      index: 0,
      content,
      hwCount: 2,
      summary: `${CONFIG.returnLabel} / ${CONFIG.sourceTitle}`,
    },
  });

  const detail = ainoteRequest(
    "local_note_detail",
    `/note/getDetail?noteId=${encodeURIComponent(localId)}`,
  );
  const note = detail?.data?.note;
  const page = note?.content?.pages?.[0];
  const pageObject = page?.src?.["page.bin"];
  const attachments = page?.attachmentSrc ?? {};
  if (
    note?.content?.source !== "T5" ||
    note?.content?.pages?.length !== 1 ||
    attachments[objectName] !== objectName ||
    Object.keys(attachments).length !== 1 ||
    typeof pageObject !== "string" ||
    page?.src?.["thumbnail.jpeg"]
  ) {
    throw new PocError("Staged T5 page model is invalid", "page_model_verify");
  }
  const noteDir = path.join(dataRoot, localId);
  const pagePath = path.join(noteDir, "res", pageObject);
  if ((await readFile(pagePath, "utf8")) !== content) {
    throw new PocError("page.bin content mismatch", "page_bin_verify");
  }
  safeLog({ stage: "page_bin_verify", success: true });

  const change = await readJson(path.join(noteDir, "change.json"));
  const changes = change.changes ?? [];
  const expected = new Map([
    [objectName, "image"],
    [pageObject, "attachment"],
  ]);
  if (
    changes.length !== 2 ||
    changes.some((item) => expected.get(item.fid) !== item.type)
  ) {
    throw new PocError("change.json contains unexpected resources", "change_json_verify");
  }
  safeLog({ stage: "change_json_verify", count: changes.length, success: true });

  const db = await readJson(path.join(dataRoot, "db.json"));
  const dirs = await readJson(path.join(dataRoot, "dir.json"));
  const relations = await readJson(path.join(dataRoot, "note_relations.json"));
  const pending = pendingCounts(db, dirs, relations);
  const pendingItems = (db.list ?? []).filter((item) => Number(item.localActionV2 ?? 0) !== 0);
  if (
    pending.pendingNotes !== 1 ||
    pending.pendingFolders !== 0 ||
    pending.pendingRelations !== 0 ||
    pendingItems[0]?.noteId !== localId
  ) {
    throw new PocError("Unexpected pending AINOTE changes after staging", "pending_recheck");
  }
  safeLog({ stage: "pending_recheck", ...pending, success: true });
  await assertSyncSafe(syncStart);
  return { localId, objectName, pageObject, noteDir };
}

async function pushOneNote({ dataRoot, localId, objectName, pageObject, syncStart }) {
  const response = ainoteRequest(
    "push_one_note",
    `/sync/pushOneNote?noteId=${encodeURIComponent(localId)}`,
  );
  const inner = response?.data;
  const formalId = inner?.data?.newId;
  if (inner?.code !== 0 || typeof formalId !== "string" || formalId.toLowerCase().startsWith("local")) {
    throw new PocError("pushOneNote did not confirm remote creation", "push_one_note");
  }
  await assertSyncSafe(syncStart);

  const db = await readJson(path.join(dataRoot, "db.json"));
  const created = (db.list ?? []).filter((item) => item.noteId === formalId && item.noteName === CONFIG.returnTitle);
  if (created.length !== 1 || Number(created[0].localActionV2 ?? 0) !== 0) {
    throw new PocError("Cloud-created note did not converge locally", "cloud_note_verify");
  }
  const formalDir = path.join(dataRoot, formalId);
  const imagePath = path.join(formalDir, "res", objectName);
  const pagePath = path.join(formalDir, "res", pageObject);
  if ((await hashFile(imagePath)) !== CONFIG.cleanSha || !(await stat(pagePath)).isFile()) {
    throw new PocError("Cloud-created note resources are invalid", "cloud_note_verify");
  }
  const changes = (await readJson(path.join(formalDir, "change.json"))).changes ?? [];
  if (changes.length !== 0) {
    throw new PocError("Uploaded note still has pending resources", "cloud_note_verify");
  }
  safeLog({ stage: "cloud_note_verify", success: true });
  return formalId;
}

async function updateNotionReturned({ token, pageId, formalId }) {
  const returnedAt = new Date().toISOString();
  await notionJson("notion_return_update", `/pages/${encodeURIComponent(pageId)}`, {
    token,
    method: "PATCH",
    body: {
      properties: {
        [CONFIG.notionProperties.returnState]: { select: { name: CONFIG.returnedState } },
        [CONFIG.notionProperties.returnId]: {
          rich_text: [{ type: "text", text: { content: formalId } }],
        },
        [CONFIG.notionProperties.returnedAt]: { date: { start: returnedAt } },
      },
    },
  });
  const page = await notionJson(
    "notion_return_verify",
    `/pages/${encodeURIComponent(pageId)}`,
    { token },
  );
  const p = page.properties ?? {};
  const valid =
    p[CONFIG.notionProperties.returnState]?.select?.name === CONFIG.returnedState &&
    plainText(p[CONFIG.notionProperties.returnId]) === formalId &&
    Number.isFinite(Date.parse(p[CONFIG.notionProperties.returnedAt]?.date?.start ?? ""));
  if (!valid) throw new PocError("Notion return-state verification failed", "notion_return_verify");
  safeLog({ stage: "notion_return_verify", success: true });
}

async function verifyReturnStatusReadOnly() {
  const token = resolveNotionToken();
  const result = await notionJson(
    "notion_status_query",
    `/data_sources/${encodeURIComponent(CONFIG.dataSourceId)}/query`,
    {
      token,
      method: "POST",
      body: {
        filter: {
          and: [
            { property: CONFIG.notionProperties.title, title: { equals: CONFIG.targetTitle } },
            {
              property: CONFIG.notionProperties.originalSha,
              rich_text: { equals: CONFIG.originalSha },
            },
          ],
        },
        page_size: 2,
      },
    },
  );
  if ((result?.results?.length ?? 0) !== 1) {
    throw new PocError("Notion target is not unique", "notion_status_verify");
  }
  const page = await notionJson(
    "notion_status_retrieve",
    `/pages/${encodeURIComponent(result.results[0].id)}`,
    { token },
  );
  const p = page.properties ?? {};
  const valid =
    p[CONFIG.notionProperties.returnState]?.select?.name === CONFIG.returnedState &&
    p[CONFIG.notionProperties.returnTarget]?.select?.name === CONFIG.approvalTarget &&
    plainText(p[CONFIG.notionProperties.returnId]) !== "" &&
    Number.isFinite(Date.parse(p[CONFIG.notionProperties.returnedAt]?.date?.start ?? "")) &&
    plainText(p[CONFIG.notionProperties.cleanSha]) === CONFIG.cleanSha;
  if (!valid) throw new PocError("Notion return status is incomplete", "notion_status_verify");
  safeLog({ stage: "notion_status_verify", success: true });
}

// Publication hardening intentionally omits historical record-provisioning helpers.
// Human approval must already exist before the experimental transport can run.

export async function runOfflineCheck() {
  const content = buildPageContent("example.png", 1);
  if (
    !content.includes(CONFIG.returnLabel) ||
    !content.includes(`元ノート: ${CONFIG.sourceTitle}`) ||
    !content.includes(CONFIG.targetTitle) ||
    !content.includes(
      `![image]({"width":${CONFIG.cleanWidth},"height":${CONFIG.cleanHeight},"name":"example.png"})`,
    )
  ) {
    throw new PocError("page.bin golden check failed", "offline_check");
  }
  safeLog({ stage: "offline_check", success: true });
}

export async function runPoc() {
  await runOfflineCheck();
  assertExecutionConfig();
  resolveAinoteHelperPath();
  const token = resolveNotionToken();
  const { page, cleanUrl } = await findApprovedNotionRecord(token);

  ainoteRequest("ainote_health", "/open-model-note/health");
  const dataRoot = await resolveDataRoot();
  const dbPath = path.join(dataRoot, "db.json");
  const dirPath = path.join(dataRoot, "dir.json");
  const relationsPath = path.join(dataRoot, "note_relations.json");
  const [db, dirs, relations] = await Promise.all([
    readJson(dbPath),
    readJson(dirPath),
    readJson(relationsPath),
  ]);
  const pending = pendingCounts(db, dirs, relations);
  safeLog({ stage: "pending_check", ...pending, success: Object.values(pending).every((v) => v === 0) });
  if (Object.values(pending).some((value) => value !== 0)) {
    throw new PocError("AINOTE has pending local changes", "pending_check");
  }
  if ((db.list ?? []).some((item) => item.noteName === CONFIG.returnTitle)) {
    throw new PocError("Return note title already exists", "duplicate_note_check");
  }
  safeLog({ stage: "duplicate_note_check", count: 0, success: true });
  const folder = resolveTargetFolder(dirs);
  const sync = await assertSyncSafe();
  const existingSnapshot = await snapshotExistingNotes(dataRoot, db);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ainote-clean-return-"));
  const cleanPath = path.join(tempDir, CONFIG.cleanFilename);
  let cleanCreated = false;
  try {
    const clean = await downloadCleanOnce(cleanUrl, cleanPath);
    cleanCreated = true;
    const staged = await stageLocalNote({
      dataRoot,
      folder,
      cleanPath,
      cleanSha: clean.digest,
      syncStart: sync.lastStart,
    });
    await assertObjectNameUnique(dataRoot, existingSnapshot, staged.objectName);
    const formalId = await pushOneNote({
      dataRoot,
      localId: staged.localId,
      objectName: staged.objectName,
      pageObject: staged.pageObject,
      syncStart: sync.lastStart,
    });
    await verifyExistingNotesUnchanged(dataRoot, existingSnapshot);
    await updateNotionReturned({ token, pageId: page.id, formalId });
    safeLog({ stage: "complete", success: true, message: "PASS" });
  } finally {
    if (cleanCreated) await unlink(cleanPath).catch(() => {});
    await rmdir(tempDir).catch(() => {});
  }
}

export function resolveInvocationMode(args) {
  const supported = new Set(["--offline-check", "--verify-only", "--execute"]);
  if (args.length === 0) return "--offline-check";
  if (args.length !== 1 || !supported.has(args[0])) {
    throw new PocError("Unsupported mode; use --offline-check, --verify-only, or --execute", "mode_check");
  }
  return args[0];
}

async function main() {
  try {
    const mode = resolveInvocationMode(process.argv.slice(2));
    if (mode === "--verify-only") {
      assertExecutionConfig();
      await verifyReturnStatusReadOnly();
    }
    else if (mode === "--execute") await runPoc();
    else await runOfflineCheck();
  } catch (error) {
    safeLog({
      stage: error?.stage ?? "failed",
      success: false,
      httpStatus: error?.httpStatus,
      apiErrorCode: error?.apiErrorCode,
      message: error?.message ?? "Unknown error",
    });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
