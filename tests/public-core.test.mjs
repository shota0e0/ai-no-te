import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../src/cli.mjs";
import {
  loadConfig,
  persistPreferences,
  resolveNotionDestination,
  resolveReturnMode,
  validateConfig,
} from "../src/config.mjs";
import { CLEAN_SPACING, computeCleanLayout, renderCleanSvg } from "../src/core/clean-layout.mjs";
import { DEFAULT_FIXTURE_DIRECTORY, loadFixture } from "../src/core/fixture.mjs";
import { SYNTHETIC_PREVIEW_NOTES } from "../src/core/preview.mjs";
import { createPendingReview, recordHumanApproval, REVIEW_STATES } from "../src/core/review.mjs";
import {
  createNoteSelection,
  noteSelectionSummary,
  resolveSelectedReturnModes,
  toggleAll,
  toggleNote,
} from "../src/core/selection.mjs";
import { runNotionImport } from "../src/notion/adapter.mjs";

const configPath = new URL("../config/public-alpha.example.json", import.meta.url);
const originalPath = new URL("../fixtures/public-alpha-v0.1/original.svg", import.meta.url);
const cleanPath = new URL("../fixtures/public-alpha-v0.1/clean.svg", import.meta.url);
const cleanBeforePath = new URL("../fixtures/public-alpha-v0.1/clean-before.svg", import.meta.url);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

async function executableConfig() {
  const config = structuredClone(await loadConfig(configPath));
  config.preferences.defaultNotionDestination = "project-a";
  config.notion.destinations = {
    "project-a": { name: "Mock review database", dataSourceId: "public-alpha-test-data-source" },
    "project-b": { name: "Second mock project", dataSourceId: "second-test-data-source" },
  };
  return config;
}

function schemaFor(config) {
  const names = config.notion.properties;
  return {
    properties: {
      [names.title]: { type: "title" },
      [names.originalFile]: { type: "files" },
      [names.originalSha]: { type: "rich_text" },
      [names.cleanFile]: { type: "files" },
      [names.cleanSha]: { type: "rich_text" },
      [names.interpretedFile]: { type: "files" },
      [names.interpretedSha]: { type: "rich_text" },
      [names.reviewState]: {
        type: "select",
        select: { options: [{ name: config.notion.states.pending }, { name: config.notion.states.approved }] },
      },
    },
  };
}

test("sanitized fixture is complete and integrity checked", async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.metadata.containsPersonalData, false);
  assert.equal(fixture.metadata.license, "CC0-1.0");
  assert.deepEqual(Object.keys(fixture.assets), ["original", "clean", "interpreted"]);
  for (const asset of Object.values(fixture.assets)) assert.match(asset.digest, /^[0-9A-F]{64}$/);
  assert.equal(Object.isFrozen(fixture), true);
});

test("offline demo performs no external write and preserves Original", async () => {
  const before = digest(await readFile(originalPath));
  let networkCalls = 0;
  const output = [];
  const result = await main(["demo"], {
    write: (value) => output.push(value),
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("offline demo attempted network access");
    },
  });
  const after = digest(await readFile(originalPath));
  assert.equal(result.mode, "offline");
  assert.equal(result.externalWrites, 0);
  assert.equal(result.review.state, REVIEW_STATES.pending);
  assert.equal(result.review.humanDecision, null);
  assert.equal(networkCalls, 0);
  assert.equal(output.length, 1);
  assert.equal(after, before);
});

test("Notion defaults to dry-run and never invokes fetch", async () => {
  let networkCalls = 0;
  const result = await main(["notion", "--config", fileURLToPath(configPath)], {
    write: () => {},
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("dry-run attempted network access");
    },
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.networkCalls, 0);
  assert.equal(networkCalls, 0);
});

test("execution rejects public placeholders before network access", async () => {
  const fixture = await loadFixture();
  const config = await loadConfig(configPath);
  const review = createPendingReview(fixture);
  let networkCalls = 0;
  await assert.rejects(
    runNotionImport({
      config,
      fixture,
      review,
      execute: true,
      token: "mock",
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("placeholder validation was bypassed");
      },
    }),
    /still a placeholder/,
  );
  assert.equal(networkCalls, 0);
});

test("configuration requires distinct review states and a safe credential variable name", async () => {
  const config = await executableConfig();
  validateConfig(config, { forExecution: true });
  config.notion.states.approved = config.notion.states.pending;
  assert.throws(() => validateConfig(config), /must be distinct/);
  config.notion.states.approved = "Approved";
  config.notion.credentialEnv = "unsafe-name";
  assert.throws(() => validateConfig(config), /environment variable name/);
});

test("return mode defaults to Clean and resolves note-only overrides", () => {
  assert.equal(resolveReturnMode(), "clean");
  assert.equal(resolveReturnMode("clean", "default"), "clean");
  assert.equal(resolveReturnMode("interpreted", "default"), "interpreted");
  assert.equal(resolveReturnMode("interpreted", "clean"), "clean");
  assert.equal(resolveReturnMode("clean", "interpreted"), "interpreted");
  assert.throws(() => resolveReturnMode("clean", "automatic"), /Per-note return mode/);
});

test("global defaults persist only in ignored local config", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-no-te-preferences-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const localConfig = path.join(directory, "public-alpha.local.json");
  await writeFile(localConfig, await readFile(configPath));
  const source = JSON.parse(await readFile(localConfig, "utf8"));
  source.preferences.defaultNotionDestination = "project-alpha";
  await writeFile(localConfig, `${JSON.stringify(source, null, 2)}\n`);

  await persistPreferences(localConfig, {
    defaultReturnMode: "interpreted",
    defaultNotionDestination: "project-beta",
  });
  const reloaded = await loadConfig(localConfig);
  assert.equal(reloaded.preferences.defaultReturnMode, "interpreted");
  assert.equal(reloaded.preferences.defaultNotionDestination, "project-beta");
  assert.equal(resolveNotionDestination(reloaded).name, "Project Beta");
  await assert.rejects(
    persistPreferences(fileURLToPath(configPath), { defaultReturnMode: "clean" }),
    /only be written to config\/\*\.local\.json/,
  );
});

test("per-note return mode stays separate from Human Approval", async () => {
  const fixture = await loadFixture();
  const review = createPendingReview(fixture);
  const selection = toggleAll(createNoteSelection([
    { key: "a", label: "Note A" },
    { key: "b", label: "Note B" },
  ]), true);
  assert.deepEqual(resolveSelectedReturnModes(selection, "clean", { b: "interpreted" }), [
    { note: "Note A", mode: "clean" },
    { note: "Note B", mode: "interpreted" },
  ]);
  assert.equal(review.state, REVIEW_STATES.pending);
  assert.equal(review.humanDecision, null);
});

test("Select All follows conventional parent-child behavior", () => {
  const notes = [
    { key: "a", label: "Note A" },
    { key: "b", label: "Note B" },
    { key: "c", label: "Note C" },
  ];
  let selection = toggleAll(createNoteSelection(notes), true);
  assert.deepEqual(noteSelectionSummary(selection), {
    totalCount: 3,
    selectedCount: 3,
    selectAll: true,
    selectedLabels: ["Note A", "Note B", "Note C"],
  });
  selection = toggleNote(selection, "b", false);
  assert.equal(noteSelectionSummary(selection).selectAll, false);
  selection = toggleNote(selection, "b", true);
  assert.equal(noteSelectionSummary(selection).selectAll, true);
  selection = toggleAll(selection, false);
  assert.equal(noteSelectionSummary(selection).selectedCount, 0);
  assert.equal(noteSelectionSummary(selection).selectAll, false);

  const empty = toggleAll(createNoteSelection([]), true);
  assert.deepEqual(noteSelectionSummary(empty), {
    totalCount: 0,
    selectedCount: 0,
    selectAll: false,
    selectedLabels: [],
  });
});

test("destination default and per-import override resolve by safe alias", async () => {
  const config = await executableConfig();
  assert.equal(resolveNotionDestination(config).name, "Mock review database");
  assert.equal(resolveNotionDestination(config, "project-b").name, "Second mock project");
  assert.equal(config.preferences.defaultNotionDestination, "project-a");
  const fixture = await loadFixture();
  const preview = await runNotionImport({
    config,
    fixture,
    review: createPendingReview(fixture),
    destinationOverride: "project-b",
  });
  assert.equal(preview.plan.target, "Second mock project");
  assert.equal(config.preferences.defaultNotionDestination, "project-a");
});

test("missing destination blocks execution and dry-run reveals no internal ID", async () => {
  const fixture = await loadFixture();
  const config = await executableConfig();
  const review = createPendingReview(fixture);
  config.preferences.defaultNotionDestination = "";
  const preview = await runNotionImport({ config, fixture, review });
  assert.equal(preview.plan.target, "Not configured");
  assert.equal(JSON.stringify(preview), JSON.stringify(preview).replaceAll("public-alpha-test-data-source", ""));
  let calls = 0;
  await assert.rejects(
    runNotionImport({
      config,
      fixture,
      review,
      execute: true,
      token: "mock",
      fetchImpl: async () => { calls += 1; },
    }),
    /destination must be selected/,
  );
  assert.equal(calls, 0);
});

test("dry-run summary includes selected count and destination without identifiers", async () => {
  const output = [];
  const result = await main([
    "notion",
    "--config",
    fileURLToPath(configPath),
    "--synthetic-preview",
    "--json",
  ], {
    write: (value) => output.push(value),
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(output[0].selectedNoteCount, 3);
  assert.equal(output[0].totalNoteCount, 3);
  assert.equal(output[0].selectAll, true);
  assert.equal(output[0].target, "Project Alpha");
  assert.equal(output[0].operation, "Create 3 Notion review records");
  assert.deepEqual(output[0].returnModes, [
    { note: "Project sketch", mode: "clean" },
    { note: "Meeting memo", mode: "clean" },
    { note: "Scratch note", mode: "clean" },
  ]);
  assert.equal(JSON.stringify(output[0]).includes("REPLACE_WITH_PROJECT_ALPHA_DATA_SOURCE_ID"), false);
});

test("human preview renders all required synthetic scenarios without network access", async () => {
  let networkCalls = 0;
  const run = async (extraArgs = []) => {
    const output = [];
    await main([
      "notion",
      "--config",
      fileURLToPath(configPath),
      "--synthetic-preview",
      ...extraArgs,
    ], {
      write: (value) => output.push(value),
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("dry-run attempted network access");
      },
    });
    assert.equal(output.length, 1);
    return output[0];
  };

  const normal = await run();
  assert.ok(normal.startsWith("DRY RUN — NO EXTERNAL WRITE\n"));
  assert.match(normal, /Destination:\n  Project Alpha\n  Source: Global Default/);
  assert.match(normal, /Select All: ON/);
  assert.match(normal, /Selected: 3\/3/);
  assert.match(normal, /\[✓\] Project sketch/);
  assert.match(normal, /\[✓\] Meeting memo/);
  assert.match(normal, /\[✓\] Scratch note/);
  assert.equal(normal.match(/Return: Use Default \(Clean\)/g)?.length, 3);
  assert.match(normal, /Clean       = minimal interpretation/);
  assert.match(normal, /Interpreted = stronger AI interpretation/);
  assert.ok(normal.endsWith("No external write will be performed.\n"));

  const override = await run(["--note-return", "meeting-memo=interpreted"]);
  assert.equal(override.match(/Return: Use Default \(Clean\)/g)?.length, 2);
  assert.match(override, /\[✓\] Meeting memo\n      Return: Override → Interpreted/);

  const explicitClean = await run(["--note-return", "meeting-memo=clean"]);
  assert.match(explicitClean, /\[✓\] Meeting memo\n      Return: Override → Clean/);

  const partial = await run(["--notes", "project-sketch,meeting-memo"]);
  assert.match(partial, /Select All: OFF/);
  assert.match(partial, /Selected: 2\/3/);
  assert.match(partial, /\[ \] Scratch note/);

  const destinationOverride = await run(["--destination", "project-beta"]);
  assert.match(destinationOverride, /Destination:\n  Project Beta\n  Source: This Import Override/);
  assert.equal(networkCalls, 0);
});

test("execute-request preview uses a distinct banner before validation and performs no test write", async () => {
  const output = [];
  let networkCalls = 0;
  await assert.rejects(
    main(["notion", "--config", fileURLToPath(configPath), "--execute"], {
      write: (value) => output.push(value),
      token: "mock",
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("placeholder validation was bypassed");
      },
    }),
    /still a placeholder/,
  );
  assert.ok(output[0].startsWith("EXECUTE MODE — EXTERNAL WRITE ENABLED\n"));
  assert.equal(networkCalls, 0);
});

test("synthetic preview catalog cannot enter external execution", async () => {
  const output = [];
  let networkCalls = 0;
  await assert.rejects(
    main([
      "notion",
      "--config",
      fileURLToPath(configPath),
      "--synthetic-preview",
      "--execute",
    ], {
      write: (value) => output.push(value),
      token: "mock",
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("synthetic preview attempted network access");
      },
    }),
    /cannot be used for external execution/,
  );
  assert.equal(output.length, 0);
  assert.equal(networkCalls, 0);
});

test("synthetic preview catalog has three safe notes and two safe destinations", async () => {
  assert.deepEqual(SYNTHETIC_PREVIEW_NOTES.map((note) => note.label), [
    "Project sketch",
    "Meeting memo",
    "Scratch note",
  ]);
  const config = await loadConfig(configPath);
  assert.equal(Object.keys(config.notion.destinations).length, 2);
  assert.deepEqual(Object.values(config.notion.destinations).map((item) => item.name), [
    "Project Alpha",
    "Project Beta",
  ]);
});

test("empty note selection blocks execution before network access", async () => {
  const fixture = await loadFixture();
  const config = await executableConfig();
  const review = createPendingReview(fixture);
  let calls = 0;
  await assert.rejects(
    runNotionImport({
      config,
      fixture,
      review,
      selectedNoteCount: 0,
      execute: true,
      token: "mock",
      fetchImpl: async () => { calls += 1; },
    }),
    /At least one note/,
  );
  assert.equal(calls, 0);
});

test("Clean spacing is deterministic, semantic, non-overlapping, and preserves Original", async () => {
  const originalBefore = digest(await readFile(originalPath));
  const before = await readFile(cleanBeforePath, "utf8");
  const after = await readFile(cleanPath, "utf8");
  const layout = computeCleanLayout();
  assert.equal(renderCleanSvg(), renderCleanSvg());
  assert.equal(after, renderCleanSvg());
  assert.notEqual(before, after);
  assert.equal(new Set(Object.values(CLEAN_SPACING)).size, 5);
  assert.equal(layout.circle.cx - layout.circle.radius - (layout.table.x + layout.table.width), CLEAN_SPACING.shapeToShape);
  assert.equal(layout.arrow.top - layout.shapeGroupBottom, CLEAN_SPACING.shapeGroupToArrow);
  assert.equal(layout.text.top - layout.arrow.bottom, CLEAN_SPACING.shapeGroupToText);
  assert.equal(layout.table.y - layout.titleBaseline, CLEAN_SPACING.section);
  const firstBaseline = layout.text.top + layout.text.fontSize;
  assert.equal(layout.text.secondBaseline - layout.text.fontSize - firstBaseline, CLEAN_SPACING.textBlockInternal);
  assert.ok(layout.circle.cx - layout.circle.radius > layout.table.x + layout.table.width);
  assert.ok(layout.arrow.top > layout.shapeGroupBottom);
  assert.ok(layout.text.top > layout.arrow.bottom);
  assert.equal(digest(await readFile(originalPath)), originalBefore);
  assert.match(after, /Goal: review the sample[\s\S]*before publishing/);
});

test("human approval is an explicit transition with no automatic bypass", async () => {
  const fixture = await loadFixture(DEFAULT_FIXTURE_DIRECTORY);
  const pending = createPendingReview(fixture);
  assert.equal(pending.state, REVIEW_STATES.pending);
  assert.equal(pending.humanDecision, null);
  assert.throws(() => recordHumanApproval(pending), /Explicit human confirmation/);
  assert.throws(
    () => recordHumanApproval(pending, { reviewer: "Human reviewer", confirmed: false }),
    /Explicit human confirmation/,
  );
  const approved = recordHumanApproval(pending, { reviewer: "Human reviewer", confirmed: true });
  assert.equal(approved.state, REVIEW_STATES.approved);
  assert.equal(approved.humanDecision.decision, "approve");
});

test("mocked explicit Notion execution creates only a Pending Review record", async () => {
  const fixture = await loadFixture();
  const config = await executableConfig();
  const review = createPendingReview(fixture);
  const pageId = "mock-page";
  const queue = [
    schemaFor(config),
    { results: [] },
    { id: pageId },
    { id: "upload-original" }, {}, {},
    { id: "upload-clean" }, {}, {},
    { id: "upload-interpreted" }, {}, {},
    { properties: { [config.notion.properties.reviewState]: { select: { name: config.notion.states.pending } } } },
  ];
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method ?? "GET", body: options.body });
    assert.notEqual(options.headers?.Authorization, undefined);
    assert.ok(queue.length > 0, "unexpected mock request");
    return response(queue.shift());
  };

  const result = await runNotionImport({
    config,
    fixture,
    review,
    execute: true,
    token: "mock",
    fetchImpl,
  });
  assert.equal(result.mode, "executed");
  assert.equal(queue.length, 0);
  const createPage = requests.find((request) => request.url.endsWith("/pages") && request.method === "POST");
  assert.ok(createPage);
  const body = JSON.parse(createPage.body);
  assert.equal(
    body.properties[config.notion.properties.reviewState].select.name,
    config.notion.states.pending,
  );
  assert.notEqual(config.notion.states.pending, config.notion.states.approved);
});
