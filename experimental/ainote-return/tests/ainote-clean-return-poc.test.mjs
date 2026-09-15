import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAinoteHelperEnv,
  resolveAinoteHelperPath,
  resolveInvocationMode,
  runOfflineCheck,
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
