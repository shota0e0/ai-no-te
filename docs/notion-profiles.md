# Development and User Notion profiles

## Confirmed workflow state

The real processing-to-Notion path has been validated with a private local setup. A User database named `AI-no-Te Imports` was created under an `AI-no-Te` parent, its six-field schema was read back, one processing record was uploaded and read back, and the Human-on-exception policy was verified against that record. Development data remained separate.

Those credentials, remote identifiers, records, file uploads, and local live-operation scripts are not public. The commands described in this document are the reproducible public schema and preview surface; they do not perform the live upload.

## Profile isolation

`process notion-preview` defaults to `user` and loads `config/notion-user.example.json`. `--profile development` selects the separate development example. An explicit `--config` selects only that file; if `--profile` is also given, both must match. With no CLI profile, the explicit config's profile is used. Unknown profiles, untagged legacy configs, mismatched destination tags and missing defaults are rejected. There is no cross-profile destination fallback or config merge.

Each config contains `notion.profile`, a profile-specific credential environment-variable name, and a profile tag on every destination. Use separate ignored local config files and separate integrations/databases. Do not point a user configuration at development data. Offline validation checks the tags and configured structure; it cannot prove who owns an ID or whether a credential has the intended permissions. Users supply their own workspace, database/data source and integration. No developer workspace access or identifier is required.

The older `config/public-alpha.example.json` remains for the synthetic fixture flow. It is not accepted by the profile bridge. New profile configs intentionally omit its technical property mappings. The profile schema manifests define logical fields and types instead; legacy overrides are rejected. Do not use the old fixture uploader for these jobs. This public bridge remains **preview-only**, rejects `--execute`, and performs no network call or local file write.

## Reproducible schemas

The [user manifest](../schemas/notion-user.json) and [development manifest](../schemas/notion-development.json) specify each logical field, API type, required flag, meaning, and select options or defaults. All listed properties are required for their respective profile; these initial manifests define no optional database properties. In the Development profile, logical `Title` resolves by type and canonical property ID to the data source's one existing `title` property; its display name is neither fixed nor renamed. Zero or multiple title properties are rejected. Other fields continue to resolve by name and type. Notion UI type names are Title, Files & media, Select, and Text (API `rich_text`). Do not use Status instead of Select for these manifests.

| User property | Type | Meaning |
|---|---|---|
| Title | title | Note name |
| Original | files | Unchanged Desktop source manifest or PDF, plus the selected Original page image |
| Clean | files | Typed text with minimal rearrangement |
| Interpreted | files | Typed text with stronger restructuring |
| Return target | select | Use Default / Clean / Interpreted; starts Use Default |
| Review state | select | Pending Review / Approved / Needs Review; Pending Review is temporary |

User records contain no OCR JSON, prompt hashes, logs, model debug data or failure diagnostics. Both images are present even when Clean is selected for return. The CLI shows `Use Default (Clean)` initially; the stored select value is `Use Default`. If the local default is explicitly changed to Interpreted, the preview resolves and displays it accordingly. `--return-target clean` or `--return-target interpreted` changes only the proposed record's intent, not local defaults or approval.

The development schema adds `Original SHA-256`, `Clean SHA-256`, and `Interpreted SHA-256` as rich_text fields. Original holds the Desktop source manifest or PDF together with the selected page image. The Original hash property identifies that source manifest/PDF, and the page hash remains in provenance. These three hash fields are **not requirements for user databases**.

Development page content also includes:

- OCR / Layout: readable normalized text, formatted raw OCR blocks, layout items, and uncertainty counts.
- Provenance / modes: source/page hashes, OCR provider/model, prompt versions/hashes, selected attempts, output hashes and mode differences, visual-review attestation.
- Processing / diagnostics: generation snapshot status/date, image provider/model information, all recorded attempt statuses/hashes, failure reasons and incomplete attempts.

Processing snapshot statuses are historical. A separate later visual PASS does not rewrite them. Failed images, full request files with private paths, credentials and destination IDs are not included as planned uploads. Private job files remain available locally for deeper debugging. Development details can include sensitive note-derived content or failure reasons: never publish these plans or show development output to normal users by default.

## Integrity and review

Both profiles call the same finalized-job verifier and use identical Original/Clean/Interpreted bytes and hashes. Asset references in local JSON retain hashes for integrity even in the user profile; these are transport-plan data, not extra user database columns. The user profile omits technical page content. A local JSON plan is not a ready HTTP request or proof of upload, and should remain private.

The Development profile remains `Pending Review`, `approved: false`, `humanDecision: null`. The User profile applies the Human-on-exception policy below after processing finishes. Owner Visual Review PASS applies only to continuing the PoC with that sample; it is not a User review decision, Return permission, or publication approval. Return-target changes do not approve a result. The preview does not implement Return execution.

## Human-on-exception review contract

For the User profile, `Pending Review` is a temporary processing or pre-decision state. A completed job becomes `Approved` automatically when all five checks are clear. It becomes `Needs Review` only for suspicious OCR, a missing required artifact, conflicting state, a current generation failure, or an unresolved return target. There is no weighted score, overall quality percentage, or confidence threshold. Unknown OCR confidence alone is not suspicious, and a historical failed attempt does not block a valid final Clean and Interpreted result.

`Needs Review` records remain unapproved and not return-ready. A person can inspect the exception and change the property to `Approved`. The `Review state` property remains the source of truth; no second approval value is stored in the page body.

Return selection is evaluated separately. With the default return mode set to Clean, `Use Default` resolves to Clean, `Clean` resolves to Clean, and `Interpreted` resolves to Interpreted. A record is return-ready only when its Review state is Approved, the return target resolves to exactly one mode, the corresponding artifact exists, and the record is internally consistent. Missing, unknown, or conflicting property values fail closed. This evaluation does not execute Experimental AINOTE Return.

The User page's Review section explains the two Notion properties. It shows the current Return target and Review state. When the state is `Needs Review`, it also shows short, user-facing reasons for the applicable red flags. It neither includes a diagnostic dump nor stores a separate approval or return-selection state.

## Commands

```console
node src/cli.mjs process notion-preview --job "typed-job" --profile user
node src/cli.mjs process notion-preview --job "typed-job" --profile user --return-target interpreted
node src/cli.mjs process notion-preview --job "typed-job" --profile development
node src/cli.mjs process notion-preview --job "typed-job" --profile development --config config/notion-development.local.json --json
```

Example IDs are placeholders. Follow the [user setup](getting-started.md) or [Japanese instructions](getting-started.ja.md) for your own environment. No hosted template is published; create an equivalent database from the manifest, or duplicate a template you are authorized to use and compare its properties with the manifest. No developer template or workspace is required.

`validateNotionProfileSchema(profile, schema)` in [profiles.mjs](../src/notion/profiles.mjs) is a pure checker for an explicitly supplied data-source schema. Without making a network call, it rejects missing or incorrect property types, ambiguous Development title mappings, and missing select options. Development preview also builds a readable Notion-block page body for OCR, layout, provenance, and processing diagnostics, while keeping those private details out of its printed and JSON summaries. The public preview uses the manifests and checks local config; it does not fetch or validate a live destination. Live record creation and file upload, duplicate checks, read-back, and failure handling were validated with private local tooling and are intentionally excluded from the executable public path.

Notion's official [connection setup](https://developers.notion.com/guides/get-started/quick-start) and [authorization guide](https://developers.notion.com/guides/get-started/authorization) explain integration access and local token handling. Grant access only to the relevant review database/page. This local app does not publish an OAuth integration or template, create a connection, or grant access on anyone's behalf.
