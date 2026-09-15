import { REVIEW_STATES } from "../core/review.mjs";
import { resolveNotionDestination, validateConfig } from "../config.mjs";

const API_BASE = "https://api.notion.com/v1";

function richText(content) {
  return { rich_text: [{ type: "text", text: { content } }] };
}

function title(content) {
  return { title: [{ type: "text", text: { content } }] };
}

function safePlan(config, fixture, destination, selectedNoteCount) {
  return Object.freeze({
    target: destination?.name ?? "Not configured",
    selectedNoteCount,
    operation: selectedNoteCount === 0
      ? "No notes selected; no Notion record will be created"
      : "Create one Notion review record with Original, Clean, and Interpreted fixtures",
    reviewState: config.notion.states.pending,
    fixtureId: fixture.metadata.fixtureId,
    externalWrites: 1,
  });
}

async function notionJson(fetchImpl, config, token, endpoint, { method = "GET", body } = {}) {
  const response = await fetchImpl(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": config.notion.apiVersion,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Never echo an untrusted remote response body or credential.
  }
  if (!response.ok) throw new Error(`Notion request failed with HTTP ${response.status}`);
  return data;
}

function validateSchema(config, schema) {
  const p = schema?.properties ?? {};
  const names = config.notion.properties;
  const required = [
    [names.title, "title"],
    [names.originalFile, "files"],
    [names.originalSha, "rich_text"],
    [names.cleanFile, "files"],
    [names.cleanSha, "rich_text"],
    [names.interpretedFile, "files"],
    [names.interpretedSha, "rich_text"],
    [names.reviewState, "select"],
  ];
  for (const [name, type] of required) {
    if (p[name]?.type !== type) throw new Error(`Notion property ${name} must have type ${type}`);
  }
  const states = new Set(p[names.reviewState]?.select?.options?.map((item) => item.name) ?? []);
  for (const state of [config.notion.states.pending, config.notion.states.approved]) {
    if (!states.has(state)) throw new Error(`Notion review state option is missing: ${state}`);
  }
}

async function uploadAsset(fetchImpl, config, token, pageId, property, shaProperty, asset) {
  const upload = await notionJson(fetchImpl, config, token, "/file_uploads", {
    method: "POST",
    body: { mode: "single_part", filename: asset.filename, content_type: "image/svg+xml" },
  });
  const form = new FormData();
  form.append("file", new File([asset.bytes], asset.filename, { type: "image/svg+xml" }));
  const sent = await fetchImpl(`${API_BASE}/file_uploads/${encodeURIComponent(upload.id)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": config.notion.apiVersion },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!sent.ok) throw new Error(`Notion binary upload failed with HTTP ${sent.status}`);
  await notionJson(fetchImpl, config, token, `/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: {
      properties: {
        [property]: {
          files: [{ type: "file_upload", file_upload: { id: upload.id }, name: asset.filename }],
        },
        [shaProperty]: richText(asset.digest),
      },
    },
  });
}

export function prepareNotionImport(
  config,
  fixture,
  review,
  { destinationOverride = "default", selectedNoteCount = 1 } = {},
) {
  validateConfig(config);
  if (review?.state !== REVIEW_STATES.pending || review.humanDecision !== null) {
    throw new Error("Notion import must start in Pending Review without an automatic approval");
  }
  if (!Number.isInteger(selectedNoteCount) || selectedNoteCount < 0) {
    throw new Error("selectedNoteCount must be a non-negative integer");
  }
  const destination = resolveNotionDestination(config, destinationOverride);
  return safePlan(config, fixture, destination, selectedNoteCount);
}

export async function runNotionImport({
  config,
  fixture,
  review,
  destinationOverride = "default",
  selectedNoteCount = 1,
  execute = false,
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  const plan = prepareNotionImport(config, fixture, review, {
    destinationOverride,
    selectedNoteCount,
  });
  if (!execute) return Object.freeze({ mode: "dry-run", networkCalls: 0, plan });

  if (selectedNoteCount === 0) throw new Error("At least one note must be selected before execution");
  validateConfig(config);
  const destination = resolveNotionDestination(config, destinationOverride);
  if (!destination) throw new Error("A Notion destination must be selected before execution");
  for (const [name, value] of Object.entries({
    alias: destination.key,
    name: destination.name,
    dataSourceId: destination.dataSourceId,
  })) {
    if (/^(REPLACE_WITH_|YOUR_|EXAMPLE_)/i.test(value)) {
      throw new Error(`Notion destination ${name} is still a placeholder`);
    }
  }
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(`Credential is required through ${config.notion.credentialEnv}`);
  }
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  const names = config.notion.properties;
  const schema = await notionJson(
    fetchImpl,
    config,
    token,
    `/data_sources/${encodeURIComponent(destination.dataSourceId)}`,
  );
  validateSchema(config, schema);

  const duplicate = await notionJson(
    fetchImpl,
    config,
    token,
    `/data_sources/${encodeURIComponent(destination.dataSourceId)}/query`,
    {
      method: "POST",
      body: {
        filter: { property: names.originalSha, rich_text: { equals: fixture.assets.original.digest } },
        page_size: 2,
      },
    },
  );
  if ((duplicate?.results?.length ?? 0) !== 0) throw new Error("Fixture already exists in target");

  const page = await notionJson(fetchImpl, config, token, "/pages", {
    method: "POST",
    body: {
      parent: { type: "data_source_id", data_source_id: destination.dataSourceId },
      properties: {
        [names.title]: title(fixture.metadata.title),
        [names.reviewState]: { select: { name: config.notion.states.pending } },
      },
    },
  });

  for (const [kind, fileProperty, shaProperty] of [
    ["original", names.originalFile, names.originalSha],
    ["clean", names.cleanFile, names.cleanSha],
    ["interpreted", names.interpretedFile, names.interpretedSha],
  ]) {
    await uploadAsset(fetchImpl, config, token, page.id, fileProperty, shaProperty, fixture.assets[kind]);
  }

  const finalPage = await notionJson(
    fetchImpl,
    config,
    token,
    `/pages/${encodeURIComponent(page.id)}`,
  );
  const finalState = finalPage?.properties?.[names.reviewState]?.select?.name;
  if (finalState !== config.notion.states.pending) {
    throw new Error("Notion record did not remain in Pending Review");
  }
  return Object.freeze({ mode: "executed", networkCalls: "performed", plan });
}
