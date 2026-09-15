import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FIXTURE_DIRECTORY = fileURLToPath(
  new URL("../../fixtures/public-alpha-v0.1/", import.meta.url),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export async function loadFixture(directory = DEFAULT_FIXTURE_DIRECTORY) {
  const root = path.resolve(directory);
  const metadata = JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"));

  requireText(metadata.fixtureId, "fixtureId");
  requireText(metadata.title, "title");
  requireText(metadata.provenance, "provenance");
  requireText(metadata.license, "license");
  if (metadata.containsPersonalData !== false) {
    throw new Error("Public fixture must explicitly declare containsPersonalData=false");
  }

  const assets = {};
  for (const kind of ["original", "clean", "interpreted"]) {
    const declaration = metadata.assets?.[kind];
    const filename = requireText(declaration?.file, `assets.${kind}.file`);
    if (path.basename(filename) !== filename) {
      throw new Error(`assets.${kind}.file must be a basename`);
    }
    const bytes = await readFile(path.join(root, filename));
    const digest = sha256(bytes);
    if (digest !== requireText(declaration.sha256, `assets.${kind}.sha256`).toUpperCase()) {
      throw new Error(`${kind} fixture SHA-256 mismatch`);
    }
    assets[kind] = Object.freeze({ kind, filename, digest, bytes });
    requireText(metadata.relationship?.[kind], `relationship.${kind}`);
  }

  return Object.freeze({ metadata: Object.freeze(metadata), assets: Object.freeze(assets) });
}

export function fixtureSummary(fixture) {
  return {
    fixtureId: fixture.metadata.fixtureId,
    title: fixture.metadata.title,
    license: fixture.metadata.license,
    containsPersonalData: fixture.metadata.containsPersonalData,
    assets: Object.fromEntries(
      Object.entries(fixture.assets).map(([kind, asset]) => [
        kind,
        { filename: asset.filename, sha256: asset.digest },
      ]),
    ),
  };
}
