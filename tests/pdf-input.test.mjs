import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { inspectPdf, renderPdf, parsePages, discoverPoppler, pdfCommand } from "../src/pdf/input.mjs";

function syntheticPdf(encrypted = false) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 216] /Resources << >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 216 144] /Rotate 90 /Resources << >> /Contents 5 0 R >>",
    "<< /Length 27 >>\nstream\n0 0 0 RG 10 10 m 100 100 l S\nendstream",
  ];
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> >>`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt 6 0 R /ID [<${"00".repeat(16)}> <${"00".repeat(16)}>]` : ""} >>\nstartxref\n${start}\n%%EOF\n`;
  return pdf;
}

test("page selection is explicit, bounded, sorted and deduplicated", () => {
  assert.deepEqual(parsePages("all", 5), [1,2,3,4,5]);
  assert.deepEqual(parsePages("2", 5), [2]);
  assert.deepEqual(parsePages("3,2,2", 5), [2,3]);
  assert.deepEqual(parsePages("2-5", 5), [2,3,4,5]);
  for (const value of [undefined, "", "0", "999", "abc", "4-2", "1,", "-1", "1.5"]) assert.throws(() => parsePages(value, 5));
});
test("missing renderer fails closed without fallback", () => {
  assert.throws(() => discoverPoppler({ AINOTE_PDF_PDFTOPPM: path.resolve("missing-poppler-executable") }), /unavailable/);
  assert.throws(() => discoverPoppler({ AINOTE_PDF_PDFTOPPM: "relative" }), /absolute/);
});
test("unknown PDF options cannot silently select another workflow", async () => {
  await assert.rejects(pdfCommand(["render", "--execute"]), /option/);
  await assert.rejects(pdfCommand(["inspect", "--pages", "all"]), /option/);
});
test("real Poppler PDF inspection, rendering and preservation", async (t) => {
  // This suite deliberately requires the documented external Poppler tools.
  discoverPoppler();
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-no-te-pdf-test-"));
  try {
    const input = path.join(root, "synthetic.pdf");
    await writeFile(input, syntheticPdf());
    const before = await readFile(input);
    const inspected = await inspectPdf(input);
    assert.equal(inspected.pageCount, 2);
    assert.equal(inspected.encrypted, false);
    assert.equal(inspected.pages[1].rotation, 90);
    assert.equal(inspected.pages[0].widthPt, 144);
    assert.deepEqual(await readdir(root), ["synthetic.pdf"]);
    await t.test("single page, PNG dimensions/hash and metadata lineage", async () => {
      const result = await renderPdf(input, "2", { output: path.join(root, "single") });
      assert.deepEqual(result.selectedPages, [2]);
      assert.equal(result.generatedFiles[0].filename, "page-002.png");
      assert.equal(result.generatedFiles[0].width, 600);
      assert.equal(result.generatedFiles[0].height, 900);
      const png = await readFile(path.join(root, "single", "page-002.png"));
      assert.equal(result.generatedFiles[0].sha256, createHash("sha256").update(png).digest("hex"));
      const metadata = JSON.parse(await readFile(path.join(root, "single", "metadata.json")));
      assert.equal(metadata.schemaVersion, 1);
      assert.equal(metadata.dpi, 300);
      assert.equal(metadata.status, "complete");
      assert.equal(metadata.source.sha256, inspected.sha256);
      assert.equal(metadata.renderer.name, "Poppler pdftoppm");
      assert.deepEqual(await readFile(path.join(root, "single", "original.pdf")), before);
      assert.deepEqual(await readFile(input), before);
    });
    await t.test("multi-page order and repeat determinism", async () => {
      const a = await renderPdf(input, "2,1", { output: path.join(root, "multi") });
      const b = await renderPdf(input, "1-2", { output: path.join(root, "repeat") });
      assert.deepEqual(a.generatedFiles.map(p => p.filename), ["page-001.png", "page-002.png"]);
      assert.deepEqual(a.generatedFiles, b.generatedFiles);
    });
    await t.test("existing output and invalid parent rejected unchanged", async () => {
      await mkdir(path.join(root, "existing"));
      await assert.rejects(renderPdf(input, "1", { output: path.join(root, "existing") }), /already exists/);
      assert.deepEqual(await readdir(path.join(root, "existing")), []);
      await assert.rejects(renderPdf(input, "1", { output: path.join(root, "missing", "child") }), /parent/);
      await assert.rejects(renderPdf(input, "999", { output: path.join(root, "invalid") }), /between/);
      assert.ok(!(await readdir(root)).includes("invalid"));
    });
    await t.test("encrypted and invalid source rejected", async () => {
      const locked = path.join(root, "encrypted.pdf");
      await writeFile(locked, syntheticPdf(true));
      await assert.rejects(inspectPdf(locked), /Encrypted/);
      await assert.rejects(inspectPdf(path.join(root, "absent.pdf")), /does not exist/);
      await writeFile(path.join(root, "invalid.pdf"), "not a PDF");
      await assert.rejects(inspectPdf(path.join(root, "invalid.pdf")), /not a PDF/);
    });
    await t.test("render failure preserves source and marks partial job", async () => {
      const tools = discoverPoppler();
      const destination = path.join(root, "partial");
      await assert.rejects(renderPdf(input, "1", { output: destination,
        env: { ...process.env, AINOTE_PDF_PDFTOPPM: path.resolve(tools.pdfinfo) } }), /incomplete/);
      const failure = JSON.parse(await readFile(path.join(destination, "failure.json")));
      assert.equal(failure.status, "incomplete");
      assert.ok(!(await readdir(destination)).includes("metadata.json"));
      assert.deepEqual(await readFile(input), before);
    });
  } finally {
    // Only the directory created by this test is removed.
    await rm(root, { recursive: true, force: true });
  }
});
