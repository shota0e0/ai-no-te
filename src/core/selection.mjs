import { resolveReturnMode } from "../config.mjs";

function normalizeNotes(notes) {
  if (!Array.isArray(notes)) throw new Error("notes must be an array");
  const normalized = notes.map((note) => {
    if (typeof note?.key !== "string" || note.key.trim() === "") throw new Error("note key is required");
    if (typeof note?.label !== "string" || note.label.trim() === "") throw new Error("note label is required");
    return Object.freeze({ key: note.key.trim(), label: note.label.trim() });
  });
  if (new Set(normalized.map((note) => note.key)).size !== normalized.length) {
    throw new Error("note keys must be unique");
  }
  return normalized;
}

export function createNoteSelection(notes, selectedKeys = []) {
  const catalog = normalizeNotes(notes);
  const available = new Set(catalog.map((note) => note.key));
  const selected = new Set(selectedKeys);
  for (const key of selected) {
    if (!available.has(key)) throw new Error(`Unknown note alias: ${key}`);
  }
  return Object.freeze({ catalog: Object.freeze(catalog), selected: Object.freeze([...selected]) });
}

export function toggleAll(selection, checked) {
  return createNoteSelection(
    selection.catalog,
    checked === true ? selection.catalog.map((note) => note.key) : [],
  );
}

export function toggleNote(selection, key, checked) {
  const selected = new Set(selection.selected);
  if (checked === true) selected.add(key);
  else selected.delete(key);
  return createNoteSelection(selection.catalog, [...selected]);
}

export function noteSelectionSummary(selection) {
  const selected = new Set(selection.selected);
  const selectedNotes = selection.catalog.filter((note) => selected.has(note.key));
  return Object.freeze({
    totalCount: selection.catalog.length,
    selectedCount: selectedNotes.length,
    selectAll: selection.catalog.length > 0 && selectedNotes.length === selection.catalog.length,
    selectedLabels: Object.freeze(selectedNotes.map((note) => note.label)),
  });
}

export function resolveSelectedReturnModes(selection, globalDefault, overrides = {}) {
  const selected = new Set(selection.selected);
  return Object.freeze(
    selection.catalog
      .filter((note) => selected.has(note.key))
      .map((note) => Object.freeze({
        note: note.label,
        mode: resolveReturnMode(globalDefault, overrides[note.key]),
      })),
  );
}
