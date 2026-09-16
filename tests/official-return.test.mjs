import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli.mjs";
import { OFFICIAL_NOTE_ROUTES, assertOfficialReturnRoute, planOfficialSkillReturn } from "../src/ainote/official-return.mjs";

const record = overrides => ({
  Title: "Synthetic return preview",
  "Review state": "Approved",
  "Return target": "Use Default",
  Original: [{ name: "original.pdf", mimeType: "application/pdf" }, { name: "page-002.png", mimeType: "image/png" }],
  Clean: [{ name: "clean.png", mimeType: "image/png" }],
  Interpreted: [{ name: "interpreted.png", mimeType: "image/png" }],
  ...overrides,
});

test("Approved + Use Default resolves Clean", () => {
  const plan = planOfficialSkillReturn({ record: record() });
  assert.equal(plan.approved, true); assert.equal(plan.resolvedTarget, "clean"); assert.equal(plan.selectedArtifact.name, "clean.png");
});

test("Approved + Clean selects Clean", () => {
  assert.equal(planOfficialSkillReturn({ record: record({ "Return target": "Clean" }) }).resolvedTarget, "clean");
});

test("Approved + Interpreted selects Interpreted", () => {
  const plan = planOfficialSkillReturn({ record: record({ "Return target": "Interpreted" }) });
  assert.equal(plan.resolvedTarget, "interpreted"); assert.equal(plan.selectedArtifact.name, "interpreted.png");
});

test("Needs Review blocks Return", () => {
  assert.throws(() => planOfficialSkillReturn({ record: record({ "Review state": "Needs Review" }) }), error => error.code === "NEEDS_REVIEW");
});

test("missing resolved artifact blocks Return", () => {
  assert.throws(() => planOfficialSkillReturn({ record: record({ Clean: [] }) }), error => error.code === "TARGET_ARTIFACT_MISSING");
});

test("resolved image must be a safe PNG artifact", () => {
  assert.throws(() => planOfficialSkillReturn({ record: record({ Clean: [{ name: "../clean.png", mimeType: "image/png" }] }) }),
    error => error.code === "INVALID_ARTIFACT_NAME");
  assert.throws(() => planOfficialSkillReturn({ record: record({ Clean: [{ name: "clean.jpg", mimeType: "image/jpeg" }] }) }),
    error => error.code === "INVALID_ARTIFACT_TYPE");
});

test("plan enforces new-note-only and protects Original", () => {
  const plan = planOfficialSkillReturn({ record: record() });
  assert.equal(plan.newNoteOnly, true); assert.deepEqual(plan.originalProtection, { overwrite: false, update: false, delete: false });
  assert.equal(plan.requestPreview.method, "POST"); assert.equal(plan.requestPreview.endpoint, OFFICIAL_NOTE_ROUTES.create);
});

test("current User fields are sufficient; old Return schema is not required", () => {
  const plan = planOfficialSkillReturn({ record: record() });
  assert.deepEqual(plan.inputSummary.fields, ["Review state", "Return target", "Original", "Clean", "Interpreted"]);
  for (const old of ["Return state", "Return mode", "Result SHA-256", "AINOTE return ID", "Returned at"]) assert.equal(old in record(), false);
});

test("official route allowlist contains only documented create/read/sync routes", () => {
  assert.deepEqual(Object.values(OFFICIAL_NOTE_ROUTES), ["/open-model-note/file/create", "/open-model-note/file/content", "/open-model/sync"]);
  for (const route of Object.values(OFFICIAL_NOTE_ROUTES)) assert.equal(assertOfficialReturnRoute(route), route);
});

test("undocumented and internal routes are rejected", () => {
  for (const route of ["/note/createMixtureNote", "/note/addMixtureImgFile", "/sync/pushOneNote"]) {
    assert.throws(() => assertOfficialReturnRoute(route), error => error.code === "UNSUPPORTED_ROUTE");
  }
});

test("offline CLI preview performs no network/write and blocks image/full-loop claims", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "official-return-"));
  try {
    const file = path.join(root, "record.json"); await writeFile(file, JSON.stringify(record()));
    let output = ""; const plan = await main(["return", "official-preview", "--record", file, "--json"], { write: value => { output = JSON.stringify(value); } });
    assert.equal(plan.networkCalls, 0); assert.equal(plan.externalWrites, 0); assert.equal(plan.syncPlanned, false);
    assert.equal(plan.imageReturnCapability, "NO_OFFICIAL_PATH_FOUND"); assert.equal(plan.markdownImageSupport, "NOT_DOCUMENTED");
    assert.equal(plan.imageAttachmentPlanned, false); assert.equal(plan.fullLoopComplete, false);
    assert.ok(!output.includes(root)); assert.ok(!output.includes("/note/")); assert.ok(!output.includes("pushOneNote"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("execute option is rejected before reading input", async () => {
  await assert.rejects(main(["return", "official-preview", "--record", "missing.json", "--execute"], { write() {} }), error => error.code === "EXECUTION_UNAVAILABLE");
});
