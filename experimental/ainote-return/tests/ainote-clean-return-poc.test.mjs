import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAinoteHelperEnv,
  resolveAinoteHelperPath,
  resolveInvocationMode,
  runOfflineCheck,
  validateNotionSchema,
} from "../ainote-clean-return-poc.mjs";

test("page.bin golden check passes without communication", async () => {
  await assert.doesNotReject(runOfflineCheck());
});

test("helper child process environment excludes credentials", () => {
  const childEnv = buildAinoteHelperEnv({
    APPDATA: "safe-app-data",
    PATH: "safe-path",
    NOTION_API_KEY: "x",
    SOME_OTHER_SECRET: "x",
  });
  assert.deepEqual(childEnv, { APPDATA: "safe-app-data", PATH: "safe-path" });
});

test("missing external helper fails clearly without fallback", () => {
  assert.throws(
    () => resolveAinoteHelperPath({}),
    /AINOTE_API_HELPER is required.*not bundled/,
  );
});

test("wrapper defaults to offline check and keeps execute explicit", async () => {
  const wrapper = await readFile(
    new URL("../invoke-ainote-clean-return-poc.ps1", import.meta.url),
    "utf8",
  );
  assert.match(wrapper, /else \{ '--offline-check' \}/);
  assert.match(wrapper, /'--execute'/);
  assert.doesNotMatch(wrapper, /else \{ '--execute' \}/);
});

test("direct invocation rejects ambiguous or unknown modes", () => {
  assert.equal(resolveInvocationMode([]), "--offline-check");
  assert.equal(resolveInvocationMode(["--execute"]), "--execute");
  assert.throws(() => resolveInvocationMode(["--execute", "--offline-check"]), /Unsupported mode/);
  assert.throws(() => resolveInvocationMode(["--unknown"]), /Unsupported mode/);
});

test("research README freezes the old schema and rejects current User schema migration", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  for (const field of ["Return state", "Return mode", "Original SHA-256", "Result SHA-256", "AINOTE return ID", "Returned at"]) {
    assert.ok(readme.includes(`\`${field}\``));
  }
  for (const field of ["Review state", "Return target", "Original", "Clean", "Interpreted"]) assert.ok(readme.includes(`\`${field}\``));
  assert.match(readme, /intentionally incompatible/);
  assert.match(readme, /fails closed/);
});

test("legacy schema is explicit and current User schema fails closed", () => {
  const legacy = {
    properties: {
      Title: { type: "title", title: {} },
      "Original SHA-256": { type: "rich_text", rich_text: {} },
      "Result image": { type: "files", files: {} },
      "Result SHA-256": { type: "rich_text", rich_text: {} },
      "Return state": { type: "select", select: { options: [{ name: "Approved" }, { name: "Returned" }] } },
      "Return mode": { type: "select", select: { options: [{ name: "Clean" }] } },
      "AINOTE return ID": { type: "rich_text", rich_text: {} },
      "Returned at": { type: "date", date: {} },
    },
  };
  assert.deepEqual(validateNotionSchema(legacy), []);
  const currentUser = {
    properties: {
      Title: { type: "title", title: {} },
      Original: { type: "files", files: {} },
      Clean: { type: "files", files: {} },
      Interpreted: { type: "files", files: {} },
      "Review state": { type: "select", select: { options: [{ name: "Approved" }] } },
      "Return target": { type: "select", select: { options: [{ name: "Use Default" }, { name: "Clean" }, { name: "Interpreted" }] } },
    },
  };
  const problems = validateNotionSchema(currentUser);
  assert.ok(problems.length > 0);
  assert.ok(problems.some(problem => problem.includes("Return state")));
  assert.ok(problems.some(problem => problem.includes("Result SHA-256")));
});

test("research README discloses undocumented endpoints and Desktop internals", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  for (const route of ["/note/createMixtureNote", "/note/addMixtureImgFile", "/note/saveRichMixtureNote", "/note/getDetail", "/sync/pushOneNote"]) {
    assert.ok(readme.includes(`\`${route}\``));
  }
  for (const dependency of ["db.json", "dir.json", "note_relations.json", "page.bin", "change.json", "note.log", "T5/page data model"]) {
    assert.ok(readme.includes(`\`${dependency}\``) || readme.includes(dependency));
  }
  assert.match(readme, /not documented in the public OpenModel Skill interface/);
});

test("Original protection and explicit write boundary remain documented and implemented", async () => {
  const [readme, source] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../ainote-clean-return-poc.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(readme, /Original is not overwritten, updated, or deleted/);
  assert.match(source, /verifyExistingNotesUnchanged/);
  assert.match(source, /\/note\/createMixtureNote/);
  assert.equal(resolveInvocationMode([]), "--offline-check");
  assert.equal(resolveInvocationMode(["--execute"]), "--execute");
});

test("official adapter and normal CLI do not import or allow experimental transport", async () => {
  const [cli, official] = await Promise.all([
    readFile(new URL("../../../src/cli.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../src/ainote/official-return.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(cli, /experimental[\\/]ainote-return|ainote-clean-return-poc/);
  for (const blocked of ["/note/createMixtureNote", "/note/addMixtureImgFile", "/note/saveRichMixtureNote", "/note/getDetail", "/sync/pushOneNote"]) {
    assert.doesNotMatch(official, new RegExp(blocked.replaceAll("/", "\\/")));
  }
  assert.match(cli, /Return command supports official-preview only/);
});
