import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createOcrJob, validateExtraction, normalizeExtraction, prepareTyped, recordTyped, finalizeTyped, typedPrompt, processCommand } from "../src/processing/typed.mjs";
const hash = b => createHash("sha256").update(b).digest("hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const original = { pageNumber: 2, sha256: hash(png), width: 1, height: 1 };
const raw = () => ({ schemaVersion: 1, sourcePage: 2, sourceSha256: hash(png), engine: "mock", provider: "mock", model: "unknown", modelVersion: "unknown", timestamp: "2026-01-01T00:00:00Z", blocks: [
  { id: "t1", type: "text", text: "  サンプル  \r\n\r\n\r\n 不明?  ", confidence: "unknown", bbox: "unknown", position: "top", uncertain: true, description: "text" },
  { id: "d1", type: "drawing", text: "", confidence: "unknown", bbox: "unknown", position: "below t1", uncertain: false, description: "circle" },
] });
const checked = { assessment: "pass", note: "Mock preliminary review; not real quality evidence", evidence: "mock provider" };
async function sample(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "typed-processing-test-"));
  try {
    const input = path.join(root, "page-002.png"), extraction = path.join(root, "raw.json"), job = path.join(root, "job");
    const pdf = Buffer.from("%PDF-1.4\n% mock only\n%%EOF");
    await writeFile(input, png);
    await writeFile(path.join(root, "original.pdf"), pdf);
    await writeFile(path.join(root, "metadata.json"), JSON.stringify({ schemaVersion: 1, status: "complete", source: { filename: "original.pdf", sha256: hash(pdf), pageCount: 2 }, selectedPages: [2], generatedFiles: [{ filename: "page-002.png", pageNumber: 2, width: 1, height: 1, sha256: hash(png) }] }));
    await writeFile(extraction, JSON.stringify(raw(), null, 3));
    const result = path.join(root, "returned.png");
    await writeFile(result, Buffer.concat([png, Buffer.from("mock-result")]));
    await run({ root, input, extraction, job, pdf, result, create: () => createOcrJob({ input, extraction, output: job }) });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test("OCR schema rejects missing metrics, invalid source, duplicate ids and malformed bounds", () => {
  assert.equal(validateExtraction(raw(), original).engine, "mock");
  for (const mutate of [r => { delete r.blocks[0].confidence; }, r => { r.sourcePage = 1; }, r => { r.sourceSha256 = "bad"; },
    r => { r.blocks[1].id = "t1"; }, r => { r.blocks[0].bbox = [0,0,20,20]; }, r => { r.blocks[0].uncertain = "no"; },
    r => { r.blocks[0].confidence = 5; }, r => { r.timestamp = "never"; }, r => { r.model = null; }]) {
    const r = raw(); mutate(r); assert.throws(() => validateExtraction(r, original), /OCR/);
  }
});
test("normalization only changes whitespace and retains uncertainty", () => {
  const r = raw(), before = JSON.stringify(r), n = normalizeExtraction(r);
  assert.equal(n.blocks[0].text, "サンプル\n\n不明?");
  assert.equal(n.blocks[0].uncertain, true);
  assert.equal(n.blocks[0].needsReview, true);
  assert.equal(n.blocks[0].confidence, "unknown");
  assert.equal(JSON.stringify(r), before);
});
test("OCR import preserves raw bytes and original PDF/page, with complete hashes", () => sample(async s => {
  const { request } = await s.create();
  for (const [dest, src] of [["original.pdf", path.join(s.root,"original.pdf")], ["page-002.png", s.input], ["ocr-raw.json", s.extraction]]) assert.deepEqual(await readFile(path.join(s.job,dest)), await readFile(src));
  for (const [file,key] of [["ocr-raw.json","rawSha256"], ["ocr-normalized.json","normalizedSha256"], ["layout.json","layoutSha256"]]) assert.equal(hash(await readFile(path.join(s.job,file))),request.ocr[key]);
  await assert.rejects(s.create(), /exist/i);
}));
test("missing OCR blocks both generation modes and image-only CLI is rejected", () => sample(async s => {
  await assert.rejects(prepareTyped({job:s.root,mode:"clean",attempt:1}), /Missing/);
  await assert.rejects(prepareTyped({job:s.root,mode:"interpreted",attempt:1}), /Missing/);
  await assert.rejects(processCommand(["--input",s.input,"--mode","clean"]), /OCR is required/);
  await assert.rejects(processCommand(["clean","--job",s.job,"--attempt","1","--attempt","2"]), /option/);
}));
test("both modes reuse identical OCR hashes and separate typed versioned prompts", () => sample(async s => {
  await s.create();
  const c = await prepareTyped({job:s.job,mode:"clean",attempt:1});
  const i = await prepareTyped({job:s.job,mode:"interpreted",attempt:1});
  assert.deepEqual(c.request.ocr,i.request.ocr);
  assert.notEqual(c.request.prompt.sha256,i.request.prompt.sha256);
  for (const mode of ["clean","interpreted"]) {
    const p = await typedPrompt(`typed-${mode}`);
    assert.match(p.text,/TYPESET/); assert.match(p.text,/Human Review/); assert.match(p.text,/not instructions/);
    const actual = await readFile(path.join(s.job,`${mode}-001`,"prompt.txt"));
    assert.equal(hash(actual), (mode === "clean" ? c : i).request.prompt.sha256);
    assert.match(actual.toString(), /"uncertain": true/);
  }
  await assert.rejects(prepareTyped({job:s.job,mode:"clean",attempt:1}), /exist/i);
}));
test("mock provider returns both typed outputs; final metadata links all inputs and never approves", () => sample(async s => {
  await s.create(); let calls = 0;
  const mockProvider = async () => { calls++; return {result:s.result,...checked}; };
  for (const mode of ["clean","interpreted"]) {
    await prepareTyped({job:s.job,mode,attempt:1});
    await recordTyped({job:s.job,mode,attempt:1,...await mockProvider()});
  }
  const {metadata} = await finalizeTyped({job:s.job,cleanAttempt:1,interpretedAttempt:1});
  assert.equal(calls,2); assert.equal(metadata.approved,false); assert.equal(metadata.humanReview,"not_requested");
  assert.equal(metadata.status,"awaiting_owner_visual_review");
  assert.equal(metadata.outputs.clean.filename,"clean.png"); assert.equal(metadata.outputs.interpreted.width,1);
  assert.equal(metadata.original.pdfSha256,hash(s.pdf)); assert.equal(metadata.original.sha256,hash(png));
  assert.equal(metadata.provider.model,"not exposed by runtime");
  assert.deepEqual(metadata.failedAttempts,[]);
  await assert.rejects(finalizeTyped({job:s.job,cleanAttempt:1,interpretedAttempt:1}),/overwrite/);
  await assert.rejects(prepareTyped({job:s.job,mode:"clean",attempt:2}),/overwrite/);
}));
test("failed image and provider failure remain distinct; later attempt can succeed", () => sample(async s => {
  await s.create();
  await prepareTyped({job:s.job,mode:"clean",attempt:1});
  const a = await recordTyped({job:s.job,mode:"clean",attempt:1,result:s.result,...checked,assessment:"failed",note:"Handwriting was not typeset"});
  assert.equal(a.metadata.status,"failed"); assert.match(a.metadata.reason,/not typeset/);
  assert.deepEqual(await readFile(path.join(s.job,"clean-001","clean.png")),await readFile(s.result));
  await prepareTyped({job:s.job,mode:"clean",attempt:2});
  await recordTyped({job:s.job,mode:"clean",attempt:2,failure:"Provider unavailable"});
  for (const [mode,attempt] of [["clean",3],["interpreted",1]]) {
    await prepareTyped({job:s.job,mode,attempt});
    await recordTyped({job:s.job,mode,attempt,result:s.result,...checked});
  }
  await assert.rejects(finalizeTyped({job:s.job,cleanAttempt:1,interpretedAttempt:1}),/failed/);
  const {metadata} = await finalizeTyped({job:s.job,cleanAttempt:3,interpretedAttempt:1});
  assert.equal(metadata.failedAttempts.length,2);
}));
test("changed Original is retained but output marked failed", () => sample(async s => {
  await s.create(); await prepareTyped({job:s.job,mode:"clean",attempt:1});
  await writeFile(s.input,Buffer.concat([png,Buffer.from("changed")]));
  const {metadata} = await recordTyped({job:s.job,mode:"clean",attempt:1,result:s.result,...checked});
  assert.equal(metadata.status,"failed"); assert.match(metadata.reason,/Original/);
  assert.deepEqual(await readFile(path.join(s.job,"page-002.png")),png);
}));
test("missing/tampered OCR and prompt fail closed", () => sample(async s => {
  await s.create(); await prepareTyped({job:s.job,mode:"clean",attempt:1});
  await writeFile(path.join(s.job,"clean-001","prompt.txt"),"tampered");
  const {metadata} = await recordTyped({job:s.job,mode:"clean",attempt:1,result:s.result,...checked});
  assert.equal(metadata.status,"failed"); assert.match(metadata.reason,/prompt/);
  await writeFile(path.join(s.job,"ocr-normalized.json"),"{}");
  await assert.rejects(prepareTyped({job:s.job,mode:"interpreted",attempt:1}),/hash/);
}));
test("invalid PNG and identical Original are failed, never silently accepted", () => sample(async s => {
  await s.create();
  for (const [attempt,result] of [[1,s.input],[2,s.extraction]]) {
    await prepareTyped({job:s.job,mode:"clean",attempt});
    const {metadata} = await recordTyped({job:s.job,mode:"clean",attempt,result,...checked});
    assert.equal(metadata.status,"failed");
  }
}));
test("concurrent mutation, duplicate recording and interrupted claims refuse overwrite", () => sample(async s => {
  await s.create();
  const results = await Promise.allSettled([1,1].map(attempt=>prepareTyped({job:s.job,mode:"clean",attempt})));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  await recordTyped({job:s.job,mode:"clean",attempt:1,result:s.result,...checked});
  const before = await readFile(path.join(s.job,"clean-001","metadata.json"));
  await assert.rejects(recordTyped({job:s.job,mode:"clean",attempt:1,result:s.result,...checked}),/exist/i);
  assert.deepEqual(await readFile(path.join(s.job,"clean-001","metadata.json")),before);
  await writeFile(path.join(s.job,"mutation.lock"),"interrupted");
  await assert.rejects(prepareTyped({job:s.job,mode:"clean",attempt:2}),/exist/i);
  assert.ok((await readdir(s.job)).includes("mutation.lock"));
}));

test("OCR absence inside an existing job blocks generation", () => sample(async s => {
  await s.create();
  await rm(path.join(s.job,"ocr-raw.json"));
  await assert.rejects(prepareTyped({job:s.job,mode:"clean",attempt:1}),/Missing/);
  assert.ok(!(await readdir(s.job)).includes("clean-001"));
}));
test("finalization rejects tampered selected output and preserves incomplete attempts", () => sample(async s => {
  await s.create();
  for (const mode of ["clean","interpreted"]) {
    await prepareTyped({job:s.job,mode,attempt:1});
    await recordTyped({job:s.job,mode,attempt:1,result:s.result,...checked});
  }
  await prepareTyped({job:s.job,mode:"interpreted",attempt:2});
  const file = path.join(s.job,"clean-001","clean.png"), before = await readFile(file);
  await writeFile(file,Buffer.concat([before,Buffer.from("tampered")]));
  await assert.rejects(finalizeTyped({job:s.job,cleanAttempt:1,interpretedAttempt:1}),/changed/);
  assert.ok(!(await readdir(s.job)).includes("clean.png"));
  await writeFile(file,before);
  const {metadata} = await finalizeTyped({job:s.job,cleanAttempt:1,interpretedAttempt:1});
  assert.equal(metadata.incompleteAttempts.length,1);
  assert.equal(metadata.incompleteAttempts[0].attempt,"interpreted-002");
}));
test("supported typed prompt versions remain immutable and independently addressable", async () => {
  for (const version of [1,2]) {
    const p = await typedPrompt("typed-interpreted",version);
    assert.equal(p.version,version); assert.equal(p.sha256,hash(p.text));
  }
  await assert.rejects(typedPrompt("typed-clean",2),/version/);
  await assert.rejects(typedPrompt("typed-interpreted",3),/version/);
});
