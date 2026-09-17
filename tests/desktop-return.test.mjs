import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/cli.mjs";
import {
  DESKTOP_RETURN_ROUTES,
  assertDesktopReturnRoute,
  buildDesktopHelperEnv,
  diagnoseDesktopCreate,
  executeDesktopReturn,
  planDesktopReturn,
  resolveInstalledAinoteHelper,
  verifyDesktopReturnDetail,
} from "../src/ainote/desktop-return.mjs";

function png(width = 64, height = 32) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "desktop-return-"));
  await writeFile(path.join(root, "clean.png"), png());
  await writeFile(path.join(root, "interpreted.png"), png(80, 40));
  const record = overrides => ({
    Title: "Synthetic desktop return",
    "Review state": "Approved",
    "Return target": "Use Default",
    Original: [{ name: "original.pdf", mimeType: "application/pdf" }],
    Clean: [{ name: "clean.png", mimeType: "image/png", localPath: "clean.png" }],
    Interpreted: [{ name: "interpreted.png", mimeType: "image/png", localPath: "interpreted.png" }],
    ...overrides,
  });
  return { root, record };
}

const options = (root, record) => ({ record, recordDirectory: root, folderId: "folder-1", folderName: "AI-no-Te" });

test("current User schema and Use Default resolve Clean", async () => {
  const { root, record } = await fixture();
  try {
    const plan = await planDesktopReturn(options(root, record()));
    assert.equal(plan.resolvedTarget, "clean"); assert.equal(plan.selectedArtifact.name, "clean.png");
    assert.deepEqual(plan.inputFields, ["Review state", "Return target", "Original", "Clean", "Interpreted"]);
    for (const legacy of ["Return state", "Return mode", "Result SHA-256", "Return ID", "Returned at"]) assert.equal(legacy in record(), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Clean and Interpreted select their matching artifacts", async () => {
  const { root, record } = await fixture();
  try {
    assert.equal((await planDesktopReturn(options(root, record({ "Return target": "Clean" })))).selectedArtifact.name, "clean.png");
    assert.equal((await planDesktopReturn(options(root, record({ "Return target": "Interpreted" })))).selectedArtifact.name, "interpreted.png");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Needs Review and missing artifacts block Return", async () => {
  const { root, record } = await fixture();
  try {
    await assert.rejects(planDesktopReturn(options(root, record({ "Review state": "Needs Review" }))), error => error.code === "NEEDS_REVIEW");
    await assert.rejects(planDesktopReturn(options(root, record({ Clean: [] }))), error => error.code === "ARTIFACT_MISSING");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("plan is offline, new-note-only and protects Original", async () => {
  const { root, record } = await fixture();
  try {
    const plan = await planDesktopReturn(options(root, record()));
    assert.equal(plan.externalWrites, 0); assert.equal(plan.networkCalls, 0); assert.equal(plan.newNoteOnly, true);
    assert.deepEqual(plan.originalProtection, { overwrite: false, update: false, delete: false });
    assert.equal(plan.syncPlanned, true); assert.equal(plan.readBackPlanned, true); assert.equal(plan.automaticRetry, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Desktop image display uses exact source dimensions without cropping or pixel changes", async () => {
  const { root, record } = await fixture();
  try {
    await writeFile(path.join(root, "clean.png"), png(875, 1798));
    const plan = await planDesktopReturn(options(root, record()));
    assert.deepEqual(plan.displayGeometry, {
      sourceWidth: 875, sourceHeight: 1798, width: 875, height: 1798,
      fit: "source", cropped: false, pixelDataChanged: false,
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("execute requires an explicit gate before helper resolution", async () => {
  await assert.rejects(executeDesktopReturn({ execute: false }), error => error.code === "EXPLICIT_EXECUTE_REQUIRED");
  await assert.rejects(main(["return", "desktop-execute", "--record", "missing.json", "--folder-id", "x", "--folder-name", "x"], { write() {} }),
    error => error.code === "EXPLICIT_EXECUTE_REQUIRED");
});

test("no-write create diagnostic captures helper launch failure and redacts secrets", async () => {
  const { root, record } = await fixture(); const calls = [];
  try {
    const error = Object.assign(new Error("spawn C:\\Users\\private-user\\python.exe EPERM TOKEN=top-secret"), { code: "EPERM" });
    const result = await diagnoseDesktopCreate(options(root, record()), {
      helperPath: "synthetic-helper",
      env: { PATH: "safe", PYTHONIOENCODING: "utf-8" },
      spawnSync(command, args) { calls.push({ command, args }); return { error, status: null, stdout: "", stderr: "" }; },
    });
    assert.equal(result.failureStage, "HELPER_LAUNCH");
    assert.equal(result.failureClassification, "HELPER_LAUNCH_FAILED");
    assert.equal(result.helperExitCode, null);
    assert.equal(result.requestReachedDesktop, "NO");
    assert.equal(result.writeRequestSent, false); assert.equal(result.ainoteWrites, 0);
    assert.doesNotMatch(result.sanitizedException, /private-user|top-secret/);
    assert.equal(calls.length, 1); assert.match(calls[0].args.join(" "), /open-model-note\/health/);
    assert.doesNotMatch(calls[0].args.join(" "), /createMixtureNote/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("no-write diagnostic captures nonzero HTTP stderr without dispatching create", async () => {
  const { root, record } = await fixture();
  try {
    const result = await diagnoseDesktopCreate(options(root, record()), {
      helperPath: "synthetic-helper",
      spawnSync() { return { error: null, status: 1, stdout: "", stderr: "HTTP 500: synthetic failure at C:\\Users\\private-user\\file TOKEN=top-secret" }; },
    });
    assert.equal(result.failureClassification, "HTTP_5XX");
    assert.equal(result.failureStage, "DESKTOP_HEALTH_REQUEST");
    assert.equal(result.helperExitCode, 1); assert.equal(result.stderrPresent, true);
    assert.doesNotMatch(result.sanitizedStderr, /private-user|top-secret/);
    assert.equal(result.targetEndpointDispatched, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("successful diagnostic proves payload serialization but excludes display metadata and all writes", async () => {
  const { root, record } = await fixture();
  try {
    const result = await diagnoseDesktopCreate(options(root, record()), {
      helperPath: "synthetic-helper",
      spawnSync() { return { error: null, status: 0, stdout: '{"code":200,"data":{"enabled":true}}', stderr: "" }; },
    });
    assert.equal(result.failureClassification, "PASS"); assert.equal(result.helperExitCode, 0);
    assert.equal(result.requestReachedDesktop, "YES"); assert.equal(result.httpCategory, "2XX");
    assert.equal(result.createPayloadSerialized, true);
    assert.deepEqual(result.createPayloadFields, ["dirId", "dirName", "isTop", "noteName", "contentText"]);
    assert.equal(result.createPayloadContainsDisplayMetadata, false);
    assert.equal(result.displayMetadataRelated, "NO");
    assert.equal(result.writeRequestSent, false); assert.equal(result.ainoteWrites, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing installed Skill helper has a clear error", () => {
  assert.throws(() => resolveInstalledAinoteHelper({}, { homeDirectory: path.join(os.tmpdir(), "no-such-home"), accessSync() { throw new Error("missing"); } }),
    error => error.code === "HELPER_MISSING" && /installed AINOTE Skill/.test(error.message));
});

test("installed Skill helper is detected without bundling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainote-skill-"));
  try {
    const helper = path.join(root, "skills", "ainote", "shared", "scripts", "ainote_api.py");
    await mkdir(path.dirname(helper), { recursive: true }); await writeFile(helper, "# synthetic test helper\n");
    assert.equal(resolveInstalledAinoteHelper({ CODEX_HOME: root }), helper);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit helper path fails closed and child environment excludes credentials", () => {
  assert.throws(() => resolveInstalledAinoteHelper({ AINOTE_API_HELPER: "wrong.py" }), error => error.code === "HELPER_MISSING");
  const child = buildDesktopHelperEnv({ PATH: "safe", SystemRoot: "safe-root", NOTION_API_KEY: "secret", OTHER_SECRET: "secret" });
  assert.deepEqual(child, { PATH: "safe", SystemRoot: "safe-root" });
});

test("only disclosed undocumented endpoints are allowed", () => {
  for (const route of Object.values(DESKTOP_RETURN_ROUTES)) assert.equal(assertDesktopReturnRoute(route), route);
  assert.throws(() => assertDesktopReturnRoute("/open-model-note/file/create"), error => error.code === "UNSUPPORTED_ROUTE");
  assert.throws(() => assertDesktopReturnRoute("/note/delete"), error => error.code === "UNSUPPORTED_ROUTE");
});

const successfulPostSyncDetail = (overrides = {}) => ({
  code: 200,
  data: {
    prop: {
      noteId: "note-1",
      noteName: "Synthetic desktop return",
      localActionV2: 0,
      isDel: 0,
      ...overrides.prop,
    },
    note: {
      type: 20,
      content: {
        noteId: 101,
        source: "T5",
        pages: [{
          noteId: 101,
          src: { "page.bin": "page.bin" },
          attachmentSrc: { "pic_1.png": "pic_1.png" },
          ...overrides.page,
        }],
        ...overrides.content,
      },
      ...overrides.note,
    },
  },
});

const verifyDetail = data => verifyDesktopReturnDetail(data, {
  expectedNoteId: "note-1",
  expectedTitle: "Synthetic desktop return",
  objectName: "pic_1.png",
});

test("actual successful post-sync returned-note shape passes", () => {
  assert.deepEqual(verifyDetail(successfulPostSyncDetail()), {
    valid: true,
    shape: "post-sync-prop",
    noteIdentityMatched: true,
    titleMatched: true,
    imageRelationMatched: true,
    synchronized: true,
  });
});

test("legacy returned-note shape remains supported when identity, title, and relation match", () => {
  assert.equal(verifyDetail({ data: { note: {
    noteId: "note-1",
    noteName: "Synthetic desktop return",
    content: { source: "T5", pages: [{ attachmentSrc: { "pic_1.png": "pic_1.png" } }] },
  } } }).shape, "legacy-note");
});

test("read-back rejects missing image, wrong note, wrong relation, Original misidentification, and malformed responses", () => {
  const invalid = [
    successfulPostSyncDetail({ page: { attachmentSrc: {} } }),
    successfulPostSyncDetail({ prop: { noteId: "wrong-note" } }),
    successfulPostSyncDetail({ page: { attachmentSrc: { "other.png": "other.png" } } }),
    successfulPostSyncDetail({ prop: { noteName: "Original" } }),
    { code: 200, data: { note: { content: { pages: "not-an-array" } } } },
  ];
  for (const detail of invalid) {
    assert.throws(() => verifyDetail(detail), error => error.code === "READ_BACK_FAILED");
  }
});

test("mock execute creates one new image note, syncs and reads back without retry", async () => {
  const { root, record } = await fixture(); const calls = []; let savedContent = "";
  try {
    await writeFile(path.join(root, "clean.png"), png(875, 1798));
    const request = async ({ route, body }) => {
      calls.push(route);
      if (route === DESKTOP_RETURN_ROUTES.create) return { code: 200, data: { noteId: "local-1" } };
      if (route === DESKTOP_RETURN_ROUTES.addImage) return { code: 200, data: { objectName: "pic_1.png" } };
      if (route === DESKTOP_RETURN_ROUTES.saveRich) { savedContent = body.content; return { code: 200, data: {} }; }
      if (route.startsWith(DESKTOP_RETURN_ROUTES.sync)) return { code: 200, data: { code: 0, data: { newId: "note-1" } } };
      if (route.startsWith(`${DESKTOP_RETURN_ROUTES.readBack}?noteId=note-1`)) return successfulPostSyncDetail();
      throw new Error(`unexpected ${route}`);
    };
    const result = await executeDesktopReturn({ ...options(root, record()), execute: true }, { helperPath: "synthetic-helper", request });
    assert.equal(result.writes, 1); assert.equal(result.retries, 0); assert.equal(result.readBackVerified, true);
    assert.match(savedContent, /"width":875,"height":1798/);
    assert.deepEqual(calls.map(route => route.split("?", 1)[0]), [
      DESKTOP_RETURN_ROUTES.create, DESKTOP_RETURN_ROUTES.addImage, DESKTOP_RETURN_ROUTES.saveRich,
      DESKTOP_RETURN_ROUTES.sync, DESKTOP_RETURN_ROUTES.readBack,
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("partial failure is reported and never retried", async () => {
  const { root, record } = await fixture(); let calls = 0;
  try {
    await assert.rejects(executeDesktopReturn({ ...options(root, record()), execute: true }, { helperPath: "synthetic-helper", request: async ({ route }) => {
      calls += 1;
      if (route === DESKTOP_RETURN_ROUTES.create) return { code: 200, data: { noteId: "local-1" } };
      throw new Error("synthetic failure");
    } }), error => error.code === "EXECUTION_FAILED" && error.partialState.noteCreated === true);
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("desktop preview CLI performs no write and does not expose local paths or folder ID", async () => {
  const { root, record } = await fixture();
  try {
    const file = path.join(root, "record.json"); await writeFile(file, JSON.stringify(record()));
    let output = "";
    const result = await main(["return", "desktop-preview", "--record", file, "--folder-id", "private-folder-id", "--folder-name", "AI-no-Te"],
      { write(value) { output = typeof value === "string" ? value : JSON.stringify(value); } });
    assert.match(result, /DRY RUN/); assert.match(result, /EXPERIMENTAL DESKTOP RETURN/);
    assert.match(result, /AINOTE display: 64 x 32 \(source dimensions; no crop or pixel change\)/);
    assert.doesNotMatch(output, new RegExp(root.replaceAll("\\", "\\\\"))); assert.doesNotMatch(output, /private-folder-id/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("official adapter remains separate and default workflow cannot execute Desktop Return", async () => {
  const [official, cli] = await Promise.all([
    readFile(new URL("../src/ainote/official-return.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/cli.mjs", import.meta.url), "utf8"),
  ]);
  for (const route of Object.values(DESKTOP_RETURN_ROUTES)) assert.ok(!official.includes(route));
  assert.match(cli, /desktopReturnCommand/);
  const demo = await main(["demo"], { write() {} }); assert.equal(demo.externalWrites, 0);
});

test("public distribution includes the Desktop Return runtime", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public-files.json", import.meta.url), "utf8"));
  assert.ok(manifest.classifications.PUBLIC.includes("src/ainote/desktop-return.mjs"));
  assert.ok(manifest.classifications.PUBLIC.includes("tests/desktop-return.test.mjs"));
});
