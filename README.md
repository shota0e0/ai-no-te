# アイノテ - AI-no-Te -

[日本語版](README.ja.md)

AI-no-Te is an independent project connecting handwritten AINOTE notes, AI-assisted processing, Notion review, and the optional return of results to a new AINOTE note.

This repository is a public technical record for the AINOTE product and engineering teams, technical reviewers, and collaborators. It documents what has been confirmed with real data, what the public code can reproduce, and where the official and experimental paths diverge.

**Write freely. Organize later.**

## Why

People should not have to change how they think or write for an AI system. AI-no-Te starts with a freely written AINOTE note and organizes it afterward.

The workflow keeps three roles separate:

- **Original**: the exported source, preserved without overwrite.
- **Clean**: typed content with meaning, drawings, and broad layout retained.
- **Interpreted**: the same source reorganized more strongly without inventing facts.

Original is never overwritten by the supplied flows.

## Current workflow

```text
AINOTE
  -> manual PDF export
  -> PDF Input Adapter
  -> OCR / text extraction
  -> Clean + Interpreted
  -> User Notion
  -> Human-on-exception review
       -> Approved
       -> Needs Review
  -> Experimental Desktop Return (explicit execute)
  -> new AINOTE note
```

This flow has been confirmed with real data through the User Notion review stage. Private notes, credentials, live records, and local evidence are not publication candidates.

The public flow uses PDF export deliberately. This is not because a direct AINOTE -> Notion -> AINOTE loop was technically impossible. An earlier Experimental PoC completed that round trip without PDF export by relying on undocumented AINOTE Desktop behavior.

The direct path offers a more natural user experience. Following clarification that community exploration and sharing are acceptable, AI-no-Te now includes the Experimental Desktop Return portion of that path. Direct Desktop input remains a separate lane; the current public input flow continues to use PDF export as the verified, official-friendly option.

The public distribution now includes an Experimental Desktop Return for creating a new image-bearing AINOTE note. The published official OpenModel image route remains unconfirmed; the Experimental route is separate, undocumented, version-dependent, and explicitly invoked.

## Current status

| Capability | Status |
|---|---|
| Real AINOTE PDF export input | Confirmed with AINOTE Air 2 |
| PDF page inspection and 300 DPI PNG rendering | Confirmed |
| OCR / text extraction | Confirmed, operator-mediated |
| Clean generation | Confirmed |
| Interpreted generation | Confirmed |
| User Notion workflow | Confirmed live |
| Human-on-exception review | Confirmed live |
| Official AINOTE text-note creation/read-back | Confirmed live |
| Official AINOTE image Return | **Parked** — no verified public route |
| Experimental Desktop image Return | Available in the public CLI; confirmed through undocumented Desktop behavior |

## Core principles

- Preserve Original and its hash lineage.
- Keep Clean and Interpreted visibly distinct.
- Approve normal completed jobs automatically; ask a person only about clear exceptions.
- Keep public summaries free of credentials, private identifiers, and private note content.
- Prefer documented official interfaces when they provide the required capability; label any Desktop-internal route clearly as Experimental.

## Notion review

The normal User database is structured as:

```text
AI-no-Te
└─ AI-no-Te Imports
```

Its six fields are:

| Field | Purpose |
|---|---|
| Title | Note name |
| Original | Original PDF and selected page image |
| Clean | Typed result with minimal rearrangement |
| Interpreted | Typed result with stronger restructuring |
| Return target | Use Default, Clean, or Interpreted |
| Review state | Pending Review, Approved, or Needs Review |

Development-only OCR, layout, provenance, prompt, model, hash, and failure details are kept out of the User database. See [Notion profiles](docs/notion-profiles.md).

### Human-on-exception

`Pending Review` is temporary while processing or evaluation is incomplete. A completed User job becomes `Approved` unless one or more of these five conditions is present:

1. suspicious OCR;
2. a missing artifact;
3. conflicting state;
4. a current generation failure; or
5. an unresolved return target.

An exception becomes `Needs Review`. There is no weighted score, overall quality percentage, or collection of fine-grained confidence gates. A person can inspect an exception and change it to Approved. Return-target selection remains independent from the review decision.

## Return to AINOTE

### Official route

The installed official AINOTE Skill documentation and the live capability probe confirm:

- new note creation;
- folder creation;
- Markdown/text content creation;
- note content read-back; and
- an official sync trigger when a write flow requires it.

AI-no-Te's [official Skill Return adapter](docs/official-skill-return.md) is preview-only. It plans a new note through:

- `POST /open-model-note/file/create`
- `GET /open-model-note/file/content`

It consumes the current User fields directly and preserves `Use Default -> Clean`. It never updates, deletes, or overwrites Original.

The live Markdown image probe stored HTTPS, data URI, local-path, and `file://` image syntax successfully. None rendered as an image in the AINOTE UI. No documented image insertion, attachment, or resource-upload route has been confirmed. Official image Return is therefore **parked**.

### Experimental Desktop Return

The public CLI includes `return desktop-preview` and `return desktop-execute`. This runtime consumes the current User fields directly, reuses `Use Default -> Clean`, requires an Approved and consistent record, validates the selected local PNG, and always creates a new note. It never updates, deletes, or overwrites Original.

The runtime uses undocumented AINOTE Desktop endpoints. It is experimental, version-specific, unsupported, outside the published official OpenModel API, and may break after AINOTE updates. There is no compatibility guarantee. An AINOTE Skill installation supplies the required local helper; the helper is detected locally and is not bundled or redistributed.

The earlier implementation under `experimental/ainote-return/` remains as PoC and compatibility reference material. The user-facing runtime is [src/ainote/desktop-return.mjs](src/ainote/desktop-return.mjs). Following clarification that community exploration and sharing are acceptable, AI-no-Te is making this Experimental path available without claiming endorsement, partnership, or official API status.

### Official and Experimental image Return

The official image-capable route remains parked because no published OpenModel image insertion or attachment route has been confirmed. The Experimental Desktop route is available for users who accept its compatibility limits. If an official image-capable route becomes available, it can replace the Desktop transport without changing Original/Clean/Interpreted selection or the Notion review contract.

Text-only note creation is useful evidence, but it is not treated as completion of the AI-no-Te loop because the selected Clean or Interpreted image is not returned.

## Public repository scope

The public repository contains:

- the local PDF Input Adapter and hash lineage;
- the operator-mediated OCR/Clean/Interpreted workflow;
- User and Development Notion schemas and offline preview logic;
- the five-rule Human-on-exception evaluator;
- the official text-note Return preview adapter;
- the user-facing Experimental Desktop Return runtime and offline preview;
- synthetic fixtures and deterministic offline checks; and
- the earlier Experimental Return PoC as compatibility reference material.

The public processing-to-Notion command is preview-only and rejects `--execute`. The live User Notion flow was confirmed with a private local setup; credentials, upload scripts, real records, and private artifacts are not included in the public candidate.

The exact candidate is the sorted `PUBLIC` allowlist in `public-files.json`. See [Public boundaries](docs/public-boundary.md) for component classifications.

## Demo and evidence

Run the synthetic offline demo:

```console
npm run demo
```

| Original | Clean | Interpreted |
|---|---|---|
| ![Synthetic Original fixture](fixtures/public-alpha-v0.1/original.svg) | ![Synthetic Clean fixture](fixtures/public-alpha-v0.1/clean.svg) | ![Synthetic Interpreted fixture](fixtures/public-alpha-v0.1/interpreted.svg) |

The [before](fixtures/public-alpha-v0.1/clean-before.svg) and [after](fixtures/public-alpha-v0.1/clean.svg) Clean fixtures contain only repository-authored synthetic geometry.

See the [Getting Started guide](docs/getting-started.md) for commands, safety constraints, and the difference between confirmed project evidence and the public preview surface.

## Installation and local validation

Requirements:

- Node.js 20 or newer
- Windows 10/11, macOS, or Linux

```console
npm install --ignore-scripts
npm run demo
npm test
npm run validate:public
```

There are no third-party npm runtime packages. PDF Input additionally requires an external Poppler installation (`pdfinfo` and `pdftoppm`); Poppler is not bundled or installed automatically.

## PDF Input

Manually export an AINOTE note as PDF, inspect it, and render explicitly selected pages:

```console
node src/cli.mjs pdf inspect --input "note.pdf"
node src/cli.mjs pdf render --input "note.pdf" --pages 2
```

Rendering uses Poppler at 300 DPI and preserves page order and aspect ratio. A new private job contains an unchanged `original.pdf`, selected page PNGs, and `metadata.json` with PDF/PNG hashes. Original is not overwritten. See [PDF setup](docs/getting-started.md#pdf-input).

## Processing and Notion preview

The processing CLI imports operator-produced OCR JSON, prepares versioned Clean and Interpreted prompts, records attempts, and finalizes selected outputs. It does not autonomously call an AI provider.

```console
node src/cli.mjs process notion-preview --job "typed-job" --profile user
```

The public command validates local lineage and produces an offline plan. It does not upload to Notion and rejects `--execute`. See the [AI processing guide](docs/ai-processing.md) and [Notion profile contract](docs/notion-profiles.md).

## Security and privacy

- Do not commit credentials, `.env` files, private paths, private identifiers, real notes, or private vendor communication.
- Real PDF jobs, OCR text, generated images, Notion records, and live capability-probe evidence remain private/local.
- Public fixtures are synthetic.
- Original is preserved throughout the supplied workflow.
- No review result automatically invokes AINOTE Return.

### Before using Experimental AINOTE Return

Experimental AINOTE Return relies on non-public, unsupported AINOTE behavior. AINOTE updates may cause it to stop working or produce unexpected results.

Before writing to AINOTE, back up any important data. Start with a non-important note and confirm the behavior in your own environment.

AI-no-Te does not guarantee how AINOTE or the device will behave, the integrity of stored data, or future compatibility. Use this feature only after reviewing and accepting these limitations.

Execution must be requested explicitly with `--execute`. The returned result is a new note; Original is not overwritten. See [Experimental AINOTE Return](docs/experimental-ainote-return.md).

## Supported and tested environment

| Component | Current record |
|---|---|
| Public local tooling | Windows 10/11, macOS, Linux |
| Node.js | 20 or newer |
| Notion API configuration | `2026-03-11` |
| AINOTE device | Tested with AINOTE Air 2; other AINOTE models have not been verified |
| Official OpenModel live probe | Note create/read-back confirmed; exact public image route not confirmed |
| Experimental wrapper | Windows 10/11; exact compatible Desktop/helper versions not established publicly |

## Known limitations

- The public repository is a technical Public Alpha, not a production service or compatibility SLA.
- OCR and image generation are operator-mediated and non-deterministic.
- The public Notion bridge is preview-only even though the workflow has been validated live with private local tooling.
- Official image Return is parked because the tested Markdown references did not render and no public image route has been confirmed.
- Experimental Desktop Return is available but remains unsupported and version-sensitive because it uses undocumented behavior.

## Independence

AI-no-Te is an independent experimental project. It is not an official product of AINOTE, iFLYTEK, or Notion, and this repository makes no claim of endorsement, partnership, maintenance, or support by those organizations.

## Roadmap

- Keep Original preservation and the six-field User review contract stable.
- Keep normal review limited to the five explicit exception categories.
- Replace the Experimental Desktop transport if an official image-capable route becomes available.
- Keep Experimental Return explicit, version-dependent, new-note-only, and separate from the official adapter.
- Collect reproducible evidence without publishing private notes or identifiers.

## License

Repository-authored code and documentation are available under the MIT License. Synthetic fixtures carry the CC0-1.0 dedication recorded in their metadata. No license or redistribution right is asserted for externally supplied helper code.
