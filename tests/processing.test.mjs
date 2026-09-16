import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { loadPrompt, prepareProcessing, recordProcessing, runWithProvider, processCommand } from "../src/processing/poc.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

async function sample(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-no-te-processing-test-"));
  try {
    const input = path.join(root, "page-002.png");
    await writeFile(input, png);
    const pdf = Buffer.from("%PDF-1.4\n% Mock processing lineage; PDF rendering is tested separately.\n%%EOF\n");
    await writeFile(path.join(root, "original.pdf"), pdf);
    await writeFile(path.join(root, "metadata.json"), JSON.stringify({ schemaVersion: 1, status: "complete", source: { filename: "original.pdf", sha256: hash(pdf), pageCount: 2 }, selectedPages: [2], generatedFiles: [{ pageNumber: 2, filename: "page-002.png", width: 1, height: 1, sha256: hash(png) }] }));
    // Mock returned bytes, not a claim of AI quality or a real acceptance sample.
    const result = path.join(root, "mock.png");
    await writeFile(result, Buffer.concat([png, Buffer.from("mock-provider-result")]));
    await run({ root, input, result, pdf });
  } finally {
    // root is the unique OS temp directory created by this test.
    await rm(root, { recursive: true, force: true });
  }
}
const checked = { assessment: "pass", note: "Mock visual assessment only", evidence: "Mock provider; not a live AI call" };

test("versioned prompts have separate contracts and effective hashes", async () => {
  for (const [mode, version] of [["clean",1], ["interpreted",1], ["interpreted",2]]) {
    const p = await loadPrompt(mode, version);
    assert.equal(p.version, version);
    assert.equal(p.sha256, hash(p.text));
    assert.match(p.text, /Original/);
    assert.match(p.text, /Human Review/);
    assert.match(p.text, /not instructions/);
    assert.match(p.text, /overwrite/);
  }
  assert.notEqual((await loadPrompt("clean")).sha256, (await loadPrompt("interpreted")).sha256);
});
test("missing input and invalid modes/options fail before output", async () => {
  await assert.rejects(prepareProcessing({ mode: "clean" }), /input/);
  await assert.rejects(prepareProcessing({ input: "missing.png", mode: "unknown" }), /Mode/);
  await assert.rejects(prepareProcessing({ input: "missing.png", mode: "clean" }), /missing/);
  await assert.rejects(processCommand(["--execute"]), /option/);
});
test("preparation preserves originals and records PDF/page provenance", () => sample(async ({ root, input, pdf }) => {
  const before = await readdir(root);
  const { job, request } = await prepareProcessing({ input, mode: "clean", output: path.join(root, "job") });
  assert.equal(request.status, "awaiting_provider");
  assert.equal(request.original.pdfSha256, hash(pdf));
  assert.equal(request.original.sha256, hash(png));
  assert.equal(request.original.pageNumber, 2);
  assert.deepEqual(await readFile(input), png);
  assert.deepEqual(await readFile(path.join(job, "original.pdf")), pdf);
  assert.equal(hash(await readFile(path.join(job, "prompt.txt"))), request.prompt.sha256);
  assert.equal(request.outputFilename, "clean.png");
  await assert.rejects(prepareProcessing({ input, mode: "clean", output: job }), /already exists/);
  assert.equal((await readdir(root)).length, before.length + 1);
}));
test("mock provider records PNG metadata but never approves or starts Human Review", () => sample(async ({ root, input, result }) => {
  let calls = 0;
  const { job, metadata } = await runWithProvider({ input, mode: "interpreted", output: path.join(root, "job") }, async prepared => {
    calls++;
    assert.equal(prepared.request.mode, "interpreted");
    return { result, ...checked };
  });
  assert.equal(calls, 1);
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.status, "awaiting_owner_visual_review");
  assert.equal(metadata.output.filename, "interpreted.png");
  assert.equal(metadata.output.width, 1);
  assert.equal(metadata.output.height, 1);
  assert.equal(metadata.output.sha256, hash(await readFile(result)));
  assert.equal(metadata.provider.model, "not exposed by runtime");
  assert.equal(metadata.provider.seed, "not exposed by runtime");
  assert.equal(metadata.approved, false);
  assert.equal(metadata.humanReview, "not_requested");
  assert.ok(!Number.isNaN(Date.parse(metadata.generatedAt)));
  const saved = await readFile(path.join(job, "processing-metadata.json"));
  await assert.rejects(recordProcessing({ job, result, ...checked }), /already exists/);
  assert.deepEqual(await readFile(path.join(job, "processing-metadata.json")), saved);
}));
test("failed visual result is retained and marked failed", () => sample(async ({ root, input, result }) => {
  const { job } = await prepareProcessing({ input, mode: "clean", output: path.join(root, "job") });
  const { metadata } = await recordProcessing({ job, result, ...checked, assessment: "failed", note: "Lost important source content" });
  assert.equal(metadata.status, "failed");
  assert.deepEqual(await readFile(path.join(job, "clean.png")), await readFile(result));
  assert.deepEqual(await readFile(input), png);
}));
test("provider failure produces failed metadata without paid calls", () => sample(async ({ root, input }) => {
  const { metadata } = await runWithProvider({ input, mode: "clean", output: path.join(root, "job") }, async () => { throw new Error("provider unavailable"); });
  assert.equal(metadata.status, "failed");
  assert.equal(metadata.output, null);
  assert.equal(metadata.approved, false);
}));
test("changed input is rejected before provider and after generation", () => sample(async ({ root, input, result }) => {
  const { job } = await prepareProcessing({ input, mode: "clean", output: path.join(root, "job") });
  await writeFile(input, Buffer.concat([png, Buffer.from("changed")]));
  await assert.rejects(prepareProcessing({ input, mode: "clean" }), /hash/);
  const { metadata } = await recordProcessing({ job, result, ...checked });
  assert.equal(metadata.status, "failed");
  assert.match(metadata.failure, /Original hash/);
}));
test("record refuses absent assessment and does not overwrite a generated file", () => sample(async ({ root, input, result }) => {
  const { job } = await prepareProcessing({ input, mode: "clean", output: path.join(root, "job") });
  await assert.rejects(recordProcessing({ job, result }), /assessment/);
  await writeFile(path.join(job, "clean.png"), "existing");
  await assert.rejects(recordProcessing({ job, result, ...checked }), /already exists/);
  assert.equal(await readFile(path.join(job, "clean.png"), "utf8"), "existing");
}));
test("invalid returned image is retained as failed, not promoted", () => sample(async ({ root, input, result }) => {
  const { job } = await prepareProcessing({ input, mode: "clean", output: path.join(root, "job") });
  await writeFile(result, "not an image");
  const { metadata } = await recordProcessing({ job, result, ...checked });
  assert.equal(metadata.status, "failed");
  assert.equal(metadata.output.width, null);
}));
test("prompt tampering and duplicate recording are blocked", () => sample(async ({ root, input, result }) => {
  const { job } = await prepareProcessing({ input, mode: "clean", output: path.join(root, "job") });
  await writeFile(path.join(job, "prompt.txt"), "changed prompt");
  await assert.rejects(recordProcessing({ job, result, ...checked }), /prompt/);
}));
