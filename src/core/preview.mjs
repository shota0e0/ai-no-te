import { resolveReturnMode } from "../config.mjs";

export const SYNTHETIC_PREVIEW_NOTES = Object.freeze([
  Object.freeze({ key: "project-sketch", label: "Project sketch" }),
  Object.freeze({ key: "meeting-memo", label: "Meeting memo" }),
  Object.freeze({ key: "scratch-note", label: "Scratch note" }),
]);

const MODE_LABELS = Object.freeze({ clean: "Clean", interpreted: "Interpreted" });

function usesDefault(value) {
  return [undefined, null, "", "default", "use-default"].includes(
    typeof value === "string" ? value.toLowerCase() : value,
  );
}

export function buildNotePreviewRows(selection, globalDefault, overrides = {}) {
  const known = new Set(selection.catalog.map((note) => note.key));
  for (const key of Object.keys(overrides)) {
    if (!known.has(key)) throw new Error(`Unknown note alias for return override: ${key}`);
  }
  const selected = new Set(selection.selected);
  return Object.freeze(selection.catalog.map((note) => {
    const isSelected = selected.has(note.key);
    if (!isSelected) return Object.freeze({ note: note.label, selected: false });
    const override = overrides[note.key];
    const mode = resolveReturnMode(globalDefault, override);
    return Object.freeze({
      note: note.label,
      selected: true,
      mode,
      modeLabel: MODE_LABELS[mode],
      returnSource: usesDefault(override) ? "default" : "override",
    });
  }));
}

export function destinationSource(destinationOverride) {
  return usesDefault(destinationOverride) ? "Global Default" : "This Import Override";
}

export function formatImportPreview({
  execute,
  destination,
  destinationOverride,
  selection,
  rows,
  reviewState,
}) {
  const lines = [
    execute ? "EXECUTE MODE — EXTERNAL WRITE ENABLED" : "DRY RUN — NO EXTERNAL WRITE",
    "",
    "IMPORT PREVIEW",
    "",
    "Destination:",
    `  ${destination}`,
    `  Source: ${destinationSource(destinationOverride)}`,
    "",
    "Notes:",
    `  Select All: ${selection.selectAll ? "ON" : "OFF"}`,
    `  Selected: ${selection.selectedCount}/${selection.totalCount}`,
    "",
  ];
  for (const row of rows) {
    lines.push(`  [${row.selected ? "✓" : " "}] ${row.note}`);
    if (row.selected) {
      const decision = row.returnSource === "default"
        ? `Use Default (${row.modeLabel})`
        : `Override → ${row.modeLabel}`;
      lines.push(`      Return: ${decision}`);
    }
    lines.push("");
  }
  const noun = selection.selectedCount === 1 ? "record" : "records";
  lines.push(
    "Operation:",
    `  Create ${selection.selectedCount} Notion review ${noun}`,
    `  Review State: ${reviewState}`,
    "",
    "Modes:",
    "  Clean       = minimal interpretation",
    "  Interpreted = stronger AI interpretation",
    "",
    execute ? "External write is enabled." : "No external write will be performed.",
  );
  return `${lines.join("\n")}\n`;
}
