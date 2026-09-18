# AI-no-Te Public Component Classifications

`public-files.json` is the authoritative allowlist for the Public Alpha candidate. A file is not public merely because it exists in the working directory or is not matched by `.gitignore`.

AI-no-Te is an independent, unofficial project. `AINOTE` in this document refers only to the AINOTE product; the AI-no-Te name does not imply endorsement, partnership, maintenance, support, or any other official relationship.

## Classifications

- `PUBLIC`: reviewed files eligible for the Public Alpha candidate.
- `EXPERIMENTAL_NOT_PUBLIC_YET`: retained experiments not selected for this release. The specifically allowlisted AINOTE Return files are public experimental material but remain outside Public Core.
- `PRIVATE`: owner data, real application material, or owner-only proof-of-concept material.
- `GENERATED`: reproducible output, caches, and build/test products.
- `LOCAL_ONLY`: machine configuration, installed dependencies, local runtimes, and legacy scripts.

The `scripts/*` local-only pattern has one deliberate exception: the validation script is named explicitly in `PUBLIC`. Only that named file is public; no other file under `scripts/` is included.

## Official / public-safe

- PDF Input fallback: local inspection and selected-page PNG rendering from manually exported AINOTE PDFs, with Original preservation and hash lineage.
- Processing: operator-mediated OCR import, versioned Clean/Interpreted prompts, immutable attempt records, and local finalization.
- Notion: User and Development schemas, profile isolation, Human-on-exception evaluation, and offline processing-job preview.
- Official text-note adapter: an offline, new-note-only plan using documented OpenModel create/read routes.
- Synthetic demo and validators: credential-free public fixtures and deterministic checks.

The real AINOTE PDF -> processing -> User Notion -> Approved/Needs Review flow has been confirmed with private live evidence. Public code contains the reproducible schemas, processing logic, evaluator, and preview surface. Credentials, live upload scripts, real records, and real artifacts remain outside the publication candidate.

## Experimental: public Desktop Input

The preferred input runtime is `src/ainote/desktop-input.mjs`. It lists supported local notes from the unique Desktop `db.json`, resolves an exact note, reads page/resource relationships through the read-only `/note/getDetail` route, and copies or deterministically composites selected page images into a new local processing package. It never updates, deletes, moves, renames, synchronizes, or overwrites an AINOTE note.

This runtime is public but depends on undocumented, version-specific AINOTE Desktop behavior and A2 page models. The installed Skill helper is used for the read-only detail request and is not bundled. `dir.json` is required only to establish a unique data root; note resources are read from the selected note's `res/` directory. `note_relations.json`, `change.json`, sync logs, and write endpoints are not used. See [Experimental Desktop Input](experimental-desktop-input.md).

## Parked: official image Return

The official Skill adapter in `src/ainote/official-return.mjs` accepts current User fields and resolves the selected artifact without requiring legacy Return fields. Its public implementation remains offline and preview-only.

A documented OpenModel live probe confirmed new Markdown note creation and read-back. HTTPS image Markdown, a synthetic PNG data URI, a local path, and a `file://` URI were stored and returned as text, but none rendered as an image in the AINOTE UI. No published image insertion, attachment, or resource-upload route is currently confirmed. Official image Return is parked rather than labeled permanently unsupported.

## Experimental: public Desktop Return

The user-facing runtime is `src/ainote/desktop-return.mjs`. It is included in the public distribution and exposed through explicit preview and execute CLI commands. It consumes the current User fields, enforces Approved/RETURN_READY state, validates the selected local PNG, creates a new image-bearing note, syncs it once, and reads it back. It uses endpoints that are not documented in the public OpenModel Skill interface; it is unsupported, version-specific, and may break. This classification does not apply to the official Skill-to-Desktop OpenModel route.

The earlier PoC, wrapper, boundary README, and tests remain under `experimental/ainote-return/` as compatibility reference material. They preserve the legacy Notion contract and internal-file safety evidence but are not the normal entrypoint. The runtime and PoC are public only by exact allowlist entry.

## Local-only

Installed Skill helpers, private launchers/configuration, credentials, real processing jobs, live Notion upload scripts, capability-probe files, unapproved screenshot captures under `docs/images/`, and AINOTE Desktop internal artifacts are local-only.

The public Experimental runtime detects a local `ainote_api.py` in the installed AINOTE Skill or through an explicit `AINOTE_API_HELPER` path. The helper is `LOCAL_ONLY` and is not bundled because redistribution rights are not established. Its child process receives an allowlisted environment. The public runtime does not receive a Notion credential. The Experimental transport remains separate from the official adapter.

`return desktop-preview` is offline. A write requires both `return desktop-execute` and `--execute`, and the transport accepts only a consistent pre-existing Approved record. Removed publication-only provisioning modes cannot manufacture that record or invoke Return automatically.

## Public behavior

The processing-job Notion bridge (`process notion-preview`) is local and preview-only. The User profile applies five explicit Human-on-exception checks and plans either Approved or Needs Review; the Development profile verifies the private sample-specific visual decision and remains Pending Review. The bridge rejects execution and does not call Return automatically. An Approved User record may be passed separately to the explicit Experimental Desktop Return CLI. No review result makes private jobs eligible for publication. Original preservation and helper non-bundling remain unchanged.

PDF Input remains the official-friendly fallback. It reads PDFs manually exported by the user from AINOTE and produces local page PNGs. Original is the exported PDF; the adapter preserves an exact copy and hash lineage. It uses externally installed Poppler pdfinfo/pdftoppm, with no bundled binary, automatic installation, alternate renderer fallback, or live service call. The default rendering resolution is 300 DPI and pages are explicitly selected. Source PDFs and generated jobs are private local data, never public fixtures. PDF Input does not perform AI processing, Human Review, Notion import, or Experimental AINOTE Return.

The public distribution consists of the offline fixture/review flow, Experimental Desktop Input, the local PDF fallback, processing, an optional generic Notion adapter, and the separated Return adapters. Its JavaScript runtime imports resolve to Node built-ins or files named in the PUBLIC allowlist; Desktop experimental features additionally require the locally installed Skill helper, and PDF commands require the external Poppler executables described above.

Public UX defaults are stored only in ignored `config/*.local.json` files. Destination aliases and labels may be shown in CLI summaries; Notion data-source IDs and credential values are never included. Return-mode selection records intent only and does not approve a review or invoke the isolated AINOTE return transport.

The Clean fixture is rendered from deterministic semantic spacing categories. `clean-before.svg` is retained solely as synthetic comparison evidence and contains no user-derived content.

The default CLI import preview is human-readable. The `--synthetic-preview` option enables three synthetic note aliases; the example config provides two synthetic destination labels. Machine-readable output remains available only when `--json` is requested. Both forms omit credentials and destination data-source IDs. The synthetic catalog does not read live AINOTE or Notion data and is blocked from external execution.
