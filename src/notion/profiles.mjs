import { readFile } from "node:fs/promises";
import { resolveReturnMode } from "../config.mjs";

export function validateProfile(value) {
  if (!["user", "development"].includes(value)) throw new Error("Notion profile must be user or development.");
  return value;
}
export async function loadNotionSchema(profile) {
  validateProfile(profile);
  return JSON.parse(await readFile(new URL(`../../schemas/notion-${profile}.json`, import.meta.url), "utf8"));
}
// A config is owned by exactly one profile; legacy fixture destinations are never adopted.
export function resolveProfileConfig(config, requestedProfile, destinationOverride = "default") {
  const profile = validateProfile(requestedProfile ?? config?.notion?.profile ?? "user");
  const n = config?.notion;
  if (n?.profile !== profile) throw new Error("Profile/config mismatch or untagged legacy config; use a matching profile-specific config.");
  if (n.properties !== undefined || n.states !== undefined) throw new Error("Profile fields/states are defined by schema manifests, not legacy property overrides.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.apiVersion ?? "") || !/^[A-Z][A-Z0-9_]*$/.test(n.credentialEnv ?? "")) throw new Error("Invalid profile API version or credential environment name.");
  const d = n.destinations;
  if (!d || typeof d !== "object" || Array.isArray(d) || !Object.keys(d).length) throw new Error("Profile destinations are required.");
  for (const [key, value] of Object.entries(d)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) || value?.profile !== profile
      || typeof value.name !== "string" || !value.name.trim() || /[\r\n\x00-\x1f]/.test(value.name)
      || typeof value.dataSourceId !== "string" || !value.dataSourceId.trim()) throw new Error("Invalid or cross-profile destination.");
  }
  const defaultMode = resolveReturnMode(config.preferences?.defaultReturnMode);
  const defaultKey = config.preferences?.defaultNotionDestination;
  if (typeof defaultKey !== "string" || !Object.hasOwn(d, defaultKey)) throw new Error("Matching profile default destination is required; no fallback is allowed.");
  const useDefault = ["", "default", "use-default"].includes(String(destinationOverride).trim().toLowerCase());
  const key = useDefault ? defaultKey : destinationOverride;
  if (!Object.hasOwn(d, key)) throw new Error("Destination is not in this profile; no fallback is allowed.");
  return { profile, defaultMode, destination: { name: d[key].name, source: useDefault ? "Global Default" : "This Import Override" } };
}
export function resolveReturnTarget(target = "default", defaultMode = "clean") {
  if (!["default", "clean", "interpreted"].includes(target)) throw new Error("Return target must be default, clean or interpreted.");
  const mode = resolveReturnMode(defaultMode, target);
  return { selection: target, resolvedMode: mode, value: target === "default" ? "Use Default" : target === "clean" ? "Clean" : "Interpreted",
    label: target === "default" ? `Use Default (${mode === "clean" ? "Clean" : "Interpreted"})` : target === "clean" ? "Clean" : "Interpreted" };
}

const USER_REVIEW_STATES = new Set(["Pending Review", "Approved", "Needs Review"]);
const USER_RETURN_TARGETS = Object.freeze({ "Use Default": "default", Clean: "clean", Interpreted: "interpreted" });
export const AUTO_REVIEW_REASONS = Object.freeze({
  ocrSuspicious: "OCR_SUSPICIOUS",
  artifactMissing: "ARTIFACT_MISSING",
  conflictingState: "CONFLICTING_STATE",
  generationFailure: "GENERATION_FAILED",
  targetUnresolved: "TARGET_UNRESOLVED",
});

function singleSelect(value, field) {
  if (Array.isArray(value)) {
    if (value.length !== 1) return { issue: `${field.toUpperCase().replaceAll(" ", "_")}_CONFLICT` };
    [value] = value;
  }
  if (typeof value !== "string" || value.trim() === "") return { issue: `${field.toUpperCase().replaceAll(" ", "_")}_MISSING` };
  return { value: value.trim() };
}

// Pure User-profile contract. Notion properties remain the source of truth; this creates no approval state.
export function evaluateUserReview({ reviewState, returnTarget, defaultReturnMode = "clean", availableArtifacts, recordConsistent = true } = {}) {
  const state = singleSelect(reviewState, "review state");
  const target = singleSelect(returnTarget, "return target");
  const approved = state.value === "Approved";
  let resolvedReturnTarget = null;
  let detail = state.issue ?? target.issue ?? null;

  if (!detail && !USER_REVIEW_STATES.has(state.value)) detail = "UNKNOWN_REVIEW_STATE";
  if (!detail && !Object.hasOwn(USER_RETURN_TARGETS, target.value)) detail = "UNKNOWN_RETURN_TARGET";
  if (!detail) {
    try {
      resolvedReturnTarget = resolveReturnMode(defaultReturnMode, USER_RETURN_TARGETS[target.value]);
    } catch {
      detail = "INVALID_DEFAULT_RETURN_MODE";
    }
  }
  if (!detail && recordConsistent !== true) detail = "RECORD_STATE_INCONSISTENT";
  if (!detail && (availableArtifacts === null || typeof availableArtifacts !== "object" || Array.isArray(availableArtifacts)
    || availableArtifacts[resolvedReturnTarget] !== true)) detail = "TARGET_ARTIFACT_MISSING";

  if (detail) return Object.freeze({ approved, resolvedReturnTarget, returnReady: false, reason: "RETURN_NOT_READY", detail });
  if (state.value === "Needs Review") return Object.freeze({ approved: false, resolvedReturnTarget, returnReady: false, reason: "NEEDS_REVIEW", detail: null });
  if (!approved) return Object.freeze({ approved: false, resolvedReturnTarget, returnReady: false, reason: "NOT_APPROVED", detail: null });
  return Object.freeze({ approved: true, resolvedReturnTarget, returnReady: true, reason: "RETURN_READY", detail: null });
}

// Human-on-exception policy: five explicit red flags, no score or confidence threshold.
export function evaluateAutoReview({ ocr, artifacts, conflictingState = false, generation, returnTarget, defaultReturnMode = "clean" } = {}) {
  const target = singleSelect(returnTarget, "return target");
  const targetSelection = target.value && Object.hasOwn(USER_RETURN_TARGETS, target.value) ? USER_RETURN_TARGETS[target.value] : null;
  let resolvedReturnTarget = null;
  if (targetSelection) {
    try { resolvedReturnTarget = resolveReturnMode(defaultReturnMode, targetSelection); } catch {}
  }

  const blocks = Array.isArray(ocr?.blocks) ? ocr.blocks : null;
  const ocrText = blocks?.map(item => typeof item?.text === "string" ? item.text : "").join(" ").trim() ?? "";
  const visibleText = ocrText.replace(/\s/gu, "");
  const explicitUnknown = /\uFFFD|\[\s*(?:unresolved|unknown)\s*\]|<\s*(?:unresolved|unknown)\s*>|\u0000/iu.test(ocrText);
  const ocrSuspicious = ocr?.parseFailed === true || (blocks !== null && blocks.length === 0)
    || (ocr?.expectsText === true && visibleText.length < 3) || explicitUnknown;

  const artifactSet = artifacts && typeof artifacts === "object" && !Array.isArray(artifacts) ? artifacts : {};
  const artifactMissing = ["original", "clean", "interpreted"].some(name => artifactSet[name] !== true);
  const targetConflict = Array.isArray(returnTarget) && returnTarget.length !== 1;
  const conflicting = conflictingState === true || targetConflict;
  const generationFailure = generation?.cleanValid === false || generation?.interpretedValid === false;
  const targetUnresolved = !resolvedReturnTarget || artifactSet[resolvedReturnTarget] !== true;
  const redFlags = Object.freeze({ ocrSuspicious, artifactMissing, conflictingState: conflicting, generationFailure, targetUnresolved });
  const reasons = Object.freeze(Object.entries(redFlags).filter(([, flagged]) => flagged).map(([key]) => AUTO_REVIEW_REASONS[key]));
  const approved = reasons.length === 0;
  return Object.freeze({ reviewState: approved ? "Approved" : "Needs Review", approved,
    resolvedReturnTarget, returnReady: approved, reason: approved ? "RETURN_READY" : "NEEDS_REVIEW", reasons, redFlags });
}
export function resolveManifestProperties(manifest, schema) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("Remote schema properties are required.");
  return manifest.properties.map(property => {
    let matches;
    if (property.resolution === "unique-property-by-type") {
      matches = Object.entries(properties).filter(([, actual]) => actual?.type === property.type);
      if (matches.length !== 1) {
        return { logicalField: property.name, expectedType: property.type, required: property.required,
          resolution: property.resolution, classification: matches.length === 0 ? "TITLE_PROPERTY_MISSING" : "TITLE_PROPERTY_AMBIGUOUS" };
      }
    } else {
      const actual = properties[property.name];
      matches = actual ? [[property.name, actual]] : [];
      if (!actual) return { logicalField: property.name, expectedType: property.type, required: property.required,
        resolution: "name-and-type", classification: "MISSING_REMOTE_PROPERTY" };
    }
    const [remoteName, actual] = matches[0];
    let classification = actual.type === property.type ? "READY" : "TYPE_MISMATCH";
    if (classification === "READY" && property.options) {
      const names = new Set(actual.select?.options?.map(option => option.name) ?? []);
      if (property.options.some(option => !names.has(option))) classification = "UNSUPPORTED_MAPPING";
    }
    return { logicalField: property.name, expectedType: property.type, required: property.required,
      resolution: property.resolution ?? "name-and-type", remoteName, remoteId: actual.id, classification };
  });
}
// Pure validator for a supplied Notion data-source schema. No remote schema is fetched here.
export async function validateNotionProfileSchema(profile, schema) {
  const manifest = await loadNotionSchema(profile);
  const resolved = resolveManifestProperties(manifest, schema);
  const invalid = resolved.find(item => item.classification !== "READY");
  if (invalid) throw new Error(`Schema property ${invalid.logicalField} is not compatible: ${invalid.classification}.`);
  return { profile, valid: true, networkCalls: 0, resolved };
}
