# アイノテ - AI-no-Te -

[日本語版](README.ja.md)

## Project overview

AI-no-Te is an independent experimental project that explores a workflow in which notes written freely on AINOTE can be refined with AI, reviewed in Notion, and optionally returned to AINOTE.

Original remains the Source of Truth, and AI-generated results never overwrite it.

**AI-no-Te is an independent, unofficial project. It is not an official AINOTE or Notion product. Neither vendor maintains, supports, endorses, or partners with the project.**

## Why this exists

Moving note content through AI-assisted cleanup or interpretation creates practical questions: Which content is authoritative? What will be sent? Who approves it? Can the result be returned without overwriting the source?

AI-no-Te makes those boundaries visible. Its Public Core is offline-first and uses synthetic data so that the workflow can be examined without credentials, private notes, or live services.

The name combines the Japanese idea of *ai-no-te*—a supporting interjection that does not replace the main performer—with “AI’s hand,” reflecting AI as an assistant to the user's natural thinking and writing. The wordplay does not imply any naming or official relationship with AINOTE.

## Workflow

```text
Sanitized Original fixture
  -> Clean or Interpreted candidate
  -> Pending Review
  -> explicit Human Review and approval
  -> optional Experimental AINOTE Return
```

## Core principles

- **Original is the Source of Truth.** Derived results never replace it.
- **Human Review is explicit.** Selecting Clean or Interpreted does not approve a result.
- **Writes are opt-in.** Public Core uses dry-run by default; Experimental AINOTE Return uses an offline check by default.
- **Summaries are safe.** Normal output omits credentials and internal destination identifiers.
- **Experiments stay bounded.** Version-specific behavior is isolated from Public Core and labeled accordingly.

## Demo and screenshots

Run the offline demo:

```console
npm run demo
```

The repository includes synthetic visual evidence only:

| Original | Clean | Interpreted |
|---|---|---|
| ![Synthetic Original fixture](fixtures/public-alpha-v0.1/original.svg) | ![Synthetic Clean fixture](fixtures/public-alpha-v0.1/clean.svg) | ![Synthetic Interpreted fixture](fixtures/public-alpha-v0.1/interpreted.svg) |

The Clean spacing comparison is available as [before](fixtures/public-alpha-v0.1/clean-before.svg) and [after](fixtures/public-alpha-v0.1/clean.svg). These SVG files were authored for this repository from basic geometry. They contain no handwriting, private notes, screenshots, production account data, or AI-generated imagery.

## Public Alpha scope

Public Core includes:

- a synthetic Original/Clean/Interpreted fixture set with integrity metadata;
- deterministic Clean spacing rules;
- note selection and Select All behavior;
- per-note return-mode intent;
- explicit review states;
- an offline CLI and human-readable import preview; and
- an optional generic Notion adapter that remains a dry-run unless execution is explicitly requested.

Public Core does not include OCR, segmentation, AI generation, live AINOTE collection, automatic approval, a large GUI, or guaranteed AINOTE Return compatibility.

The exact publication candidate is the sorted `PUBLIC` allowlist in `public-files.json`.

## Clean vs Interpreted

- **Clean** applies minimal interpretation while improving presentation and spacing.
- **Interpreted** allows stronger AI interpretation of the source.

Clean is the default. A note may use Interpreted as an explicit per-note override. This choice records return intent only; Human Review and approval remain separate requirements.

## Installation

Requirements for Public Core:

- Node.js 20 or newer
- Windows 10/11, macOS, or Linux

From a clean clone:

```console
npm install --ignore-scripts
npm run demo
npm test
npm run validate:public
```

Public Alpha v0.1 has no third-party npm runtime packages.

## Configuration

Copy `config/public-alpha.example.json` to a Git-ignored file matching `config/*.local.json`. Replace placeholder destination metadata locally and keep credentials out of the file.

Store normal defaults:

```console
node src/cli.mjs preferences --config config/public-alpha.local.json --set-return-mode clean
node src/cli.mjs preferences --config config/public-alpha.local.json --set-destination project-a
```

Display the safe preference summary:

```console
node src/cli.mjs preferences --config config/public-alpha.local.json
```

Destination aliases and display labels may appear in summaries. Notion data-source IDs and credential values do not.

## Offline and dry-run usage

Preview an import without a network write:

```console
node src/cli.mjs notion --config config/public-alpha.local.json
```

The normal preview begins with `DRY RUN — NO EXTERNAL WRITE`. It shows the destination label and source, Select All state, selected/total note count, each note's return mode and decision source, and the Pending Review operation.

Use the repository's safe three-note preview catalog for offline review:

```console
node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview
```

Machine-readable output is available with `--json`. The synthetic preview catalog is blocked from external execution.

## Notion integration

Notion execution is optional. An actual write requires all of the following:

- an explicit `--execute` option;
- non-placeholder local configuration;
- a credential supplied through the configured environment variable;
- a valid destination; and
- at least one selected note.

```console
node src/cli.mjs notion --config config/public-alpha.local.json --execute
```

Before execution, the CLI prints the safe destination name, selected-note count, operation summary, and resolved return mode. The adapter validates the schema, refuses duplicate Original hashes, creates only Pending Review records, and verifies that they remain pending. It never marks a record Approved.

Live Notion execution was not performed during the final documentation step.

## Experimental AINOTE Return

`experimental/ainote-return/` contains an optional path that can create a new AINOTE note from a human-approved Clean or Interpreted result.

This path is **unofficial, experimental, version-specific, unsupported, based on non-public AINOTE behavior, and may break after AINOTE updates**. It is not an official AINOTE API. There is no compatibility guarantee, and this repository makes no claim of endorsement, partnership, supported API access, or vendor support.

Execution must be requested explicitly with `--execute`; no-argument invocation performs an offline check. A unique, pre-existing human-approved record is required. The returned result is created as a new note, and Original is not overwritten.

The workflow has been shared with the AINOTE team, but this repository is an independent experimental project. No private message or private vendor communication is reproduced here.

The current caller requires an external `ainote_api.py` helper. That helper is not bundled, copied, downloaded, or redistributed because its redistribution rights have not been established. Users must lawfully obtain or locate a compatible copy, review its provenance and license, and set `AINOTE_API_HELPER` to its local path. A missing or unreadable helper fails clearly before the return operation begins.

See [Experimental AINOTE Return setup and limitations](docs/experimental-ainote-return.md).

## Security and privacy

- Do not commit credentials, `.env` files, local configuration, private paths, private identifiers, real note content, or private vendor communication.
- Public fixtures are synthetic and require no live AINOTE or Notion data.
- Credentials and Notion data-source IDs are omitted from normal summaries.
- The helper process receives an allowlisted environment and does not receive the Notion credential.
- Public Core is dry-run by default. Experimental AINOTE Return is offline by default.
- Human Review remains distinct from return-mode selection.
- Original is preserved and is never overwritten by the supplied flows.

Review [the publication checklist](docs/publication-checklist.md) before publishing.

## Supported and tested environment

| Component | Public Alpha record |
|---|---|
| Public Core operating systems | Windows 10/11, macOS, Linux |
| Experimental wrapper | Windows 10/11 only |
| Node.js | 20 or newer |
| Notion API configuration | `2026-03-11` |
| Python for Experimental Return | Real local executable required; exact tested version not established |
| AINOTE Desktop | Exact compatible build not established in public evidence |
| External helper | Compatible version, source, and license not established; user-supplied only |

Unknown versions are documented without guessing. Independently record and validate the complete local environment before using Experimental AINOTE Return.

## Known limitations

- Public Alpha provides reference behavior, not a production service or compatibility SLA.
- Experimental AINOTE Return depends on undocumented local routes and storage assumptions.
- AINOTE updates may change schemas, routes, sync behavior, or local files.
- Third parties cannot reproduce Experimental Return without an independently obtained compatible helper and environment validation.
- Live AINOTE Return compatibility was not tested during publication hardening or this documentation review.
- An official return interface should replace the experimental path if one becomes available.

## Roadmap

- Keep Public Core offline-first, Original-first, and Pending Review by default.
- Collect reproducible compatibility evidence without publishing private data.
- Revalidate Experimental AINOTE Return against explicitly recorded versions.
- Prefer an official AINOTE return interface if one becomes available.
- Revisit returned-content framing only in a separately approved UX step.

## License

Repository-authored code and documentation are available under the MIT License. The synthetic fixtures carry the CC0-1.0 dedication recorded in their metadata. No license or redistribution right is asserted for externally supplied helper code.
