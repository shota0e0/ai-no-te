import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PLACEHOLDER = /^(REPLACE_WITH_|YOUR_|EXAMPLE_)/i;
const RETURN_MODES = new Set(["clean", "interpreted"]);

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export async function loadConfig(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

export function resolveReturnMode(globalDefault = "clean", perNoteOverride = "default") {
  const normalizedDefault = requireText(globalDefault, "preferences.defaultReturnMode").toLowerCase();
  if (!RETURN_MODES.has(normalizedDefault)) {
    throw new Error("preferences.defaultReturnMode must be clean or interpreted");
  }
  const normalizedOverride = String(perNoteOverride ?? "default").trim().toLowerCase();
  if (["", "default", "use-default"].includes(normalizedOverride)) return normalizedDefault;
  if (!RETURN_MODES.has(normalizedOverride)) {
    throw new Error("Per-note return mode must be default, clean, or interpreted");
  }
  return normalizedOverride;
}

export function resolveNotionDestination(config, perImportOverride = "default") {
  const destinations = config?.notion?.destinations ?? {};
  const requested = String(perImportOverride ?? "default").trim();
  const key = ["", "default", "use-default"].includes(requested.toLowerCase())
    ? String(config?.preferences?.defaultNotionDestination ?? "").trim()
    : requested;
  if (key === "") return null;
  const destination = destinations[key];
  if (!destination) throw new Error(`Unknown Notion destination alias: ${key}`);
  return Object.freeze({
    key,
    name: requireText(destination.name, `notion.destinations.${key}.name`),
    dataSourceId: requireText(
      destination.dataSourceId,
      `notion.destinations.${key}.dataSourceId`,
    ),
  });
}

export function safePreferencesSummary(config) {
  const destination = resolveNotionDestination(config);
  return Object.freeze({
    defaultReturnMode: resolveReturnMode(config?.preferences?.defaultReturnMode),
    defaultNotionDestination: destination?.name ?? "Not configured",
    availableNotionDestinations: Object.values(config?.notion?.destinations ?? {}).map((item) =>
      requireText(item?.name, "notion destination name"),
    ),
  });
}

export function validateConfig(config, { forExecution = false } = {}) {
  const notion = config?.notion;
  if (!notion || typeof notion !== "object") throw new Error("notion config is required");

  resolveReturnMode(config?.preferences?.defaultReturnMode);
  const destinations = notion.destinations;
  if (!destinations || typeof destinations !== "object" || Array.isArray(destinations)) {
    throw new Error("notion.destinations must be an object keyed by safe aliases");
  }
  const entries = Object.entries(destinations);
  if (entries.length === 0) throw new Error("At least one Notion destination is required");
  for (const [key, destination] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) {
      throw new Error("Notion destination aliases may contain letters, numbers, dot, underscore, and hyphen");
    }
    requireText(destination?.name, `notion.destinations.${key}.name`);
    requireText(destination?.dataSourceId, `notion.destinations.${key}.dataSourceId`);
  }
  const destination = resolveNotionDestination(config);

  const required = {
    "notion.apiVersion": notion.apiVersion,
    "notion.credentialEnv": notion.credentialEnv,
    "notion.properties.title": notion.properties?.title,
    "notion.properties.originalFile": notion.properties?.originalFile,
    "notion.properties.originalSha": notion.properties?.originalSha,
    "notion.properties.cleanFile": notion.properties?.cleanFile,
    "notion.properties.cleanSha": notion.properties?.cleanSha,
    "notion.properties.interpretedFile": notion.properties?.interpretedFile,
    "notion.properties.interpretedSha": notion.properties?.interpretedSha,
    "notion.properties.reviewState": notion.properties?.reviewState,
    "notion.states.pending": notion.states?.pending,
    "notion.states.approved": notion.states?.approved,
  };

  for (const [name, value] of Object.entries(required)) requireText(value, name);
  if (notion.states.pending === notion.states.approved) {
    throw new Error("Pending Review and Approved must be distinct states");
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(notion.credentialEnv)) {
    throw new Error("notion.credentialEnv must be an environment variable name");
  }
  if (forExecution) {
    if (!destination) throw new Error("A Notion destination must be selected before execution");
    if (PLACEHOLDER.test(destination.key)) throw new Error("Default Notion destination is still a placeholder");
    if (PLACEHOLDER.test(destination.name)) throw new Error("Notion destination name is still a placeholder");
    if (PLACEHOLDER.test(destination.dataSourceId)) {
      throw new Error("Notion destination data source is still a placeholder");
    }
  }
  return config;
}

export async function persistPreferences(filename, updates = {}) {
  const absolute = path.resolve(filename);
  if (!path.basename(absolute).endsWith(".local.json")) {
    throw new Error("Persistent defaults may only be written to config/*.local.json");
  }
  const config = await loadConfig(absolute);
  validateConfig(config);
  const next = structuredClone(config);
  if (updates.defaultReturnMode !== undefined) {
    next.preferences.defaultReturnMode = resolveReturnMode(updates.defaultReturnMode);
  }
  if (updates.defaultNotionDestination !== undefined) {
    const destination = resolveNotionDestination(next, updates.defaultNotionDestination);
    if (!destination) throw new Error("Default Notion destination cannot be empty");
    next.preferences.defaultNotionDestination = destination.key;
  }
  validateConfig(next);
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, absolute);
  return next;
}

export function hasPublicPlaceholder(value) {
  return typeof value === "string" && PLACEHOLDER.test(value);
}
