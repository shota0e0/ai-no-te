import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadConfig,
  persistPreferences,
  safePreferencesSummary,
} from "./config.mjs";
import { fixtureSummary, loadFixture } from "./core/fixture.mjs";
import { createPendingReview } from "./core/review.mjs";
import {
  buildNotePreviewRows,
  destinationSource,
  formatImportPreview,
  SYNTHETIC_PREVIEW_NOTES,
} from "./core/preview.mjs";
import {
  createNoteSelection,
  noteSelectionSummary,
  resolveSelectedReturnModes,
  toggleAll,
} from "./core/selection.mjs";
import { runNotionImport } from "./notion/adapter.mjs";
import { pdfCommand } from "./pdf/input.mjs";
import { processCommand } from "./processing/typed.mjs";
import { processingNotionPreviewCommand } from "./notion/processing-preview.mjs";
import { officialReturnPreviewCommand } from "./ainote/official-return.mjs";
import { desktopReturnCommand } from "./ainote/desktop-return.mjs";

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function repeatedOptions(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) values.push(option(args.slice(index), name));
  }
  return values;
}

function returnOverrides(args) {
  return Object.fromEntries(repeatedOptions(args, "--note-return").map((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1) throw new Error("--note-return requires NOTE_ALIAS=default|clean|interpreted");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const write = dependencies.write ?? ((value) => process.stdout.write(
    typeof value === "string" ? value : `${JSON.stringify(value)}\n`,
  ));
  const command = args[0] ?? "demo";
  if (command === "return") {
    const returnCommand = args[1];
    const result = returnCommand === "official-preview"
      ? await officialReturnPreviewCommand(args.slice(2))
      : await desktopReturnCommand(returnCommand, args.slice(2), dependencies.desktopReturnDependencies);
    write(result);
    return result;
  }
  if (command === "notion" && args.some(a => /^(--job|--processing-job)(=|$)/.test(a))) {
    throw new Error("Processing jobs require process notion-preview --job; the existing notion upload flow does not accept them.");
  }
  if (command === "process") {
    const result = args[1] === "notion-preview"
      ? await processingNotionPreviewCommand(args.slice(2))
      : await processCommand(args.slice(1));
    write(result);
    return result;
  }
  if (command === "pdf") {
    const result = await pdfCommand(args.slice(1));
    write(result);
    return result;
  }
  const configFile = path.resolve(
    option(args, "--config", path.join("config", "public-alpha.example.json")),
  );

  if (command === "preferences") {
    let config = await loadConfig(configFile);
    const defaultReturnMode = option(args, "--set-return-mode", undefined);
    const defaultNotionDestination = option(args, "--set-destination", undefined);
    if (defaultReturnMode !== undefined || defaultNotionDestination !== undefined) {
      config = await persistPreferences(configFile, { defaultReturnMode, defaultNotionDestination });
    }
    const result = { mode: "preferences", ...safePreferencesSummary(config) };
    write(result);
    return result;
  }

  const fixture = await loadFixture(dependencies.fixtureDirectory);
  const review = createPendingReview(fixture);

  if (command === "demo") {
    const result = { mode: "offline", externalWrites: 0, fixture: fixtureSummary(fixture), review };
    write(result);
    return result;
  }
  if (command !== "notion") throw new Error(`Unknown command: ${command}`);

  const config = await loadConfig(configFile);
  const execute = args.includes("--execute");
  const syntheticPreview = args.includes("--synthetic-preview");
  const catalog = dependencies.noteCatalog ?? (syntheticPreview
    ? SYNTHETIC_PREVIEW_NOTES
    : [{ key: "sample", label: fixture.metadata.title }]);
  const requestedNotes = option(args, "--notes", "all");
  let selection = createNoteSelection(catalog);
  if (requestedNotes.toLowerCase() === "all") selection = toggleAll(selection, true);
  else if (requestedNotes.toLowerCase() !== "none") {
    selection = createNoteSelection(catalog, requestedNotes.split(",").map((item) => item.trim()));
  }
  const selectionSummary = noteSelectionSummary(selection);
  const destinationOverride = option(args, "--destination", "default");
  const overrides = returnOverrides(args);
  const returnModes = resolveSelectedReturnModes(
    selection,
    config.preferences?.defaultReturnMode,
    overrides,
  );
  const previewRows = buildNotePreviewRows(selection, config.preferences?.defaultReturnMode, overrides);
  if (syntheticPreview && execute) {
    throw new Error("Synthetic preview catalog cannot be used for external execution");
  }
  const preview = await runNotionImport({
    config,
    fixture,
    review,
    destinationOverride,
    selectedNoteCount: selectionSummary.selectedCount,
    execute: false,
  });
  const machineOutput = {
    mode: execute ? "execute-requested" : "dry-run",
    target: preview.plan.target,
    destinationSource: destinationSource(destinationOverride),
    selectAll: selectionSummary.selectAll,
    totalNoteCount: selectionSummary.totalCount,
    selectedNoteCount: selectionSummary.selectedCount,
    selectedNotes: selectionSummary.selectedLabels,
    returnModes,
    operation: syntheticPreview
      ? `Create ${selectionSummary.selectedCount} Notion review ${selectionSummary.selectedCount === 1 ? "record" : "records"}`
      : preview.plan.operation,
    reviewState: preview.plan.reviewState,
    externalWrites: execute ? "requires explicit execution" : 0,
  };
  if (args.includes("--json")) write(machineOutput);
  else write(formatImportPreview({
    execute,
    destination: preview.plan.target,
    destinationOverride,
    selection: selectionSummary,
    rows: previewRows,
    reviewState: preview.plan.reviewState,
  }));
  if (!execute) return preview;

  const token = dependencies.token ?? process.env[config.notion.credentialEnv];
  return runNotionImport({
    config,
    fixture,
    review,
    destinationOverride,
    selectedNoteCount: selectionSummary.selectedCount,
    execute: true,
    token,
    fetchImpl: dependencies.fetchImpl,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ success: false, message: error.message })}\n`);
    process.exitCode = 1;
  });
}
