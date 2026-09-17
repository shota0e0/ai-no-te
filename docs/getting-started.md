# Getting Started with AI-no-Te

[日本語版](getting-started.ja.md)

AI-no-Te preserves Original, prepares Clean and Interpreted results, reviews them in Notion, and can return an approved image as a new AINOTE note through an Experimental Desktop path. Private credentials and live records are not included. The official OpenModel image path remains unconfirmed.

## 1. Before You Start

- AI-no-Te is an independent Public Alpha, not an official AINOTE product.
- You can try Public Core with synthetic notes and no external write.
- Experimental AINOTE Return is unofficial, unsupported, version-specific, and based on non-public AINOTE behavior.
- Back up important AINOTE data before using Experimental AINOTE Return. Start with a non-important note.

Public Core and Experimental AINOTE Return have different safety boundaries. Completing the offline preview does not configure or run the experimental return path.

## 2. Install

Public Core requires Node.js 20 or newer and supports Windows 10/11, macOS, and Linux.

Clone the repository from its published repository URL, or download and extract its source archive. Open a terminal in the repository root, then run:

```console
npm install --ignore-scripts
npm test
npm run validate:public
```

The Public Alpha has no third-party npm runtime packages.

The supplied example configuration is enough for the synthetic offline preview. To keep your own defaults or prepare a real Notion destination later, copy it to a Git-ignored `config/*.local.json` file.

Windows PowerShell:

```powershell
Copy-Item config/public-alpha.example.json config/public-alpha.local.json
```

macOS or Linux:

```sh
cp config/public-alpha.example.json config/public-alpha.local.json
```

Replace placeholders only in the local copy. Do not store credentials in the file.

## 3. Try the Offline Preview

The synthetic preview below is independent of PDF Input. It does not consume rendered PDF pages.

Run the repository's synthetic three-note preview:

```console
node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview
```

The output starts with `DRY RUN — NO EXTERNAL WRITE`. It uses synthetic notes, displays the safe destination label, selects all three notes, applies the default Clean mode, and shows that the proposed Notion records would start in Pending Review. It does not contact AINOTE or Notion.

```text
DRY RUN — NO EXTERNAL WRITE

IMPORT PREVIEW

Destination:
  Project Alpha
  Source: Global Default

Notes:
  Select All: ON
  Selected: 3/3

  [✓] Project sketch
      Return: Use Default (Clean)

  [✓] Meeting memo
      Return: Use Default (Clean)

  [✓] Scratch note
      Return: Use Default (Clean)

Operation:
  Create 3 Notion review records
  Review State: Pending Review
```

> Screenshot TODO: offline preview terminal output. Use `01-offline-preview.png` after an approved, sanitized capture is available.

## 4. Choose What to Send to Notion

The CLI options determine what the preview shows:

- `--notes all` selects every available note. This is also the default.
- `--notes project-sketch,meeting-memo` selects only those synthetic aliases. Select All then becomes OFF and the selected count becomes 2/3.
- The configured destination is shown as `Global Default`.
- `--destination project-beta` changes the destination for this import only and is shown as `This Import Override`.
- Clean is the default return mode.
- `--note-return meeting-memo=interpreted` changes only Meeting memo to Interpreted. It does not approve the result.

Try all three overrides together without an external write:

```console
node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview --notes project-sketch,meeting-memo --destination project-beta --note-return meeting-memo=interpreted
```

The preview will show Project sketch as `Use Default (Clean)`, Meeting memo as `Override → Interpreted`, and Scratch note as unselected.

> Screenshot TODO: partial note selection and destination override. Use `02-note-selection.png` after an approved, sanitized capture is available.

> Screenshot TODO: per-note Interpreted override. Use `03-return-mode.png` after an approved, sanitized capture is available.

## 5. Review in Notion

Notion execution is optional and is not needed for the offline walkthrough above. A processed User record contains the Original, Clean, and Interpreted assets. Pending Review is temporary while processing or evaluation is incomplete.

After processing, AI-no-Te checks only five exceptions: suspicious OCR, missing artifacts, conflicting state, a current generation failure, and an unresolved target. A clear job becomes Approved automatically. An exception becomes Needs Review and remains blocked until a person checks it and changes the property to Approved. Selecting Clean or Interpreted records an intent; it does not change the review decision.

> Screenshot TODO: sanitized Notion review record showing Original, Clean, Interpreted, and its current Approved or Needs Review state. Use `04-notion-review.png` only after approved evidence is available.

## 6. Return an approved result to AINOTE

The public CLI includes an optional Experimental Desktop Return. It uses undocumented AINOTE Desktop behavior, may stop working after an update, and is not an official AINOTE API. It creates a new note and does not overwrite Original.

The documented official Skill/OpenModel route can create and read back a new Markdown/text note. A live probe stored HTTPS image Markdown, a synthetic PNG data URI, a local path, and a `file://` URI, but none rendered as an image in the AINOTE UI. No public image insertion, attachment, or resource-upload route has been confirmed, so official image Return is parked.

Prepare a local JSON representation of the current User record with exactly these top-level fields: `Title`, `Review state`, `Return target`, `Original`, `Clean`, and `Interpreted`. The selected Clean/Interpreted file item also needs a `localPath` so Desktop can read the PNG. `Use Default` resolves to Clean. `Needs Review`, inconsistent records, missing artifacts, and unknown targets fail closed.

- Install the AINOTE Skill first. Its `ainote_api.py` helper is detected locally but is not bundled, downloaded, or redistributed.
- Preview the exact selected artifact and destination without writing:

```console
node src/cli.mjs return desktop-preview --record "user-return.json" --folder-id "<folder-id>" --folder-name "AI-no-Te"
```

- Execute only after reviewing the preview. Both the execute subcommand and `--execute` are required:

```console
node src/cli.mjs return desktop-execute --record "user-return.json" --folder-id "<folder-id>" --folder-name "AI-no-Te" --execute
```

- A return write requires a pre-existing Approved record. Approval may come from the normal auto-review path or from a person resolving a Needs Review exception.
- The selected result is created as a new AINOTE note. Original is not overwritten.
- The runtime performs image insertion, sync, and read-back once. It does not retry or roll back automatically; a partial failure or repeated command may leave or create another note.
- Back up important data before any experimental write and test first with a non-important note.
- Compatibility is not guaranteed. The documented device check covers AINOTE Air 2 only; other models have not been verified.

Read the [official capability record](official-skill-return.md) and [Experimental Desktop Return setup and limitations](experimental-ainote-return.md) before executing. The older code under `experimental/ainote-return/` is retained as PoC and compatibility reference material; it is not the user-facing entrypoint.

> Screenshot TODO: sanitized evidence of a newly created AINOTE note with Original still present. Use `05-ainote-return.png` only after approved evidence is available.

## PDF Input

PDF Input is local-only. It neither calls AINOTE/Notion nor generates Clean or Interpreted results. Manually export a PDF from AINOTE with the handwritten visual content included; inspect the exported pages before processing. Support is scoped to this AINOTE export workflow, not guaranteed support for arbitrary PDFs.

### Set up Poppler

Obtain Poppler from a distribution you trust; consult the [upstream project](https://poppler.freedesktop.org/) and your platform package provider. Windows needs a compatible binary distribution with its supporting DLLs. The repository does not bundle Poppler, download it, install it, or use another renderer as fallback.

Both `pdfinfo` and `pdftoppm` must be on PATH. Alternatively set absolute executable paths, for example in PowerShell:

```powershell
$env:AINOTE_PDF_PDFTOPPM = 'C:\Poppler\Library\bin\pdftoppm.exe'
$env:AINOTE_PDF_PDFINFO = 'C:\Poppler\Library\bin\pdfinfo.exe'
```

These paths are examples; use the paths in your installation. Missing tools fail before conversion. The synthetic demo still needs only Node.js. Running `npm test` also requires Poppler and fails rather than skipping PDF integration tests when it is missing.

### Inspect, select, and render

```console
node src/cli.mjs pdf inspect --input "note.pdf"
node src/cli.mjs pdf inspect --input "note.pdf" --json
node src/cli.mjs pdf render --input "note.pdf" --pages 2
node src/cli.mjs pdf render --input "note.pdf" --pages 2,3
node src/cli.mjs pdf render --input "note.pdf" --pages 2-5
node src/cli.mjs pdf render --input "note.pdf" --pages all --output "new-pdf-job" --json
```

Use only page numbers present in your PDF. Inspection is read-only and reports the basename, existence, SHA-256, encryption status, page count, page sizes in points, and rotations. Inspection also rejects encrypted PDFs; passwords are not accepted. Selection is required for rendering. Lists and ranges are deduplicated and sorted in source page order. There is no automatic cover/content classification.

Poppler's `pdftoppm` renders full pages at 300 DPI without cropping or stretching. It respects page rotation. Filenames retain the original page numbers: selecting page 2 produces `page-002.png`.

Without `--output`, a unique directory is created in the OS temporary directory. With `--output`, specify a new job directory whose parent already exists. Any existing target, even an empty directory, is refused. The successful job contains:

```text
new-pdf-job/
  original.pdf
  metadata.json
  page-001.png
  page-002.png
```

The input PDF is never overwritten. `original.pdf` is an exact copy, checked against the source hash. Original means the exported PDF; Original page image means its rendered PNG, not extracted OCR text. Metadata schema version 1 records the source basename/hash/page count/page geometry, selected pages, renderer name/version, DPI, timestamp, and each PNG's page number, filename, dimensions, and SHA-256. Only a `complete` metadata record indicates success.

Outputs contain private note content; keep them outside the repository. The temporary directory is not durable storage: retain the original export separately and copy a successful job to your own private storage if needed. No output is automatically published or sent to the existing Notion preview.

### Limits and recovery

Limits are 512 MiB per input, 500 PDF pages, 100 million pixels per page and 500 million pixels per selected job. Each inspection/render subprocess has a 120-second timeout. Use a smaller export or select fewer pages if a limit is exceeded. Keep the source stable while processing.

A failed job may retain `original.pdf` and some PNGs. It reports its directory and writes `failure.json` when possible; do not pass incomplete output to later processing. Review it locally and retry into a new directory. Existing data is not deleted or overwritten automatically. A successful job verifies the original input and copied PDF hashes again.

The Windows feasibility sample from AINOTE Air 2 had two differently sized pages, including handwriting and a drawing. Poppler 26.07.0 rendered it at 300 DPI. Identical output hashes were observed on repeat runs in that same environment; this is not a guarantee across versions or operating systems. Pin the tested distribution/build and supporting libraries, record their checksums, and revalidate when updating. Timestamps and job directories intentionally differ between runs.

Poppler is an external GPL-licensed tool; review the chosen distribution's licenses before redistribution. No Poppler binary is included in this MIT-licensed repository. Experimental Desktop Return remains optional and keeps its separate compatibility warnings.

## AI processing after PDF Input

Follow the [processing guide](ai-processing.md) to have Codex extract text from the selected Original page and save the raw JSON. OCR is mandatory: Clean uses typed text with minimal rearrangement; Interpreted reorganizes that same text more strongly. Drawings remain separate visual regions. Unknown confidence/boxes and uncertain text are not silently completed.

```console
node src/cli.mjs process ocr --input "pdf-job/page-002.png" --extraction "extraction.json" --output "typed-job"
node src/cli.mjs process clean --job "typed-job" --attempt 1
node src/cli.mjs process interpreted --job "typed-job" --attempt 1
```

These commands import OCR and prepare prompts; they do not run AI. Next, use the exact saved prompts with Codex's built-in image editor, record each result or failure with `process record`, and explicitly select attempts with `process finalize`. The guide specifies the schema, recording commands, and failure recovery. One job preserves the Original PDF/page, raw and normalized OCR, layout, both images, and hash lineage. This operator-mediated process is separate from the synthetic Notion preview. The CLI uploads nothing, but using Codex to read or generate images sends the page to OpenAI. Results are non-deterministic. The User policy sends only the five explicit exceptions to Human Review. These commands trigger no Notion or Return action.

## Preview the processed job for Notion

### Your own Notion: user profile

1. In your own workspace, create a review database with the six required properties below. Alternatively duplicate a template you are authorized to use and check the same properties. No hosted AI-no-Te template or developer workspace access is required.
2. Create an internal Notion integration/connection for your workspace, following the [official setup](https://developers.notion.com/guides/get-started/quick-start).
3. Grant the connection access only to the relevant review database/page using Notion's connection controls. Do not grant unrelated workspace access. See [authorization](https://developers.notion.com/guides/get-started/authorization).
4. Keep your credential in your own local environment/secret store under `AINOTE_USER_NOTION_TOKEN`. Do not put it in the JSON config, source code, screenshots or chat. This preview does not read the token.
5. Copy `config/notion-user.example.json` to ignored `config/notion-user.local.json`. Replace its placeholder data-source ID with your own, keeping both profile tags set to `user`. Use a different tagged config/integration for development. The earlier `public-alpha` config is for the synthetic fixture flow, not this user schema.
6. Run the preview with that local config. The public command checks local config/lineage only and rejects `--execute`. Live schema validation, upload, duplicate checking, and read-back were confirmed with a private local setup, but that executable upload path and its credentials are not included in the public repository.

| Required property name | Notion UI type | Options / meaning |
|---|---|---|
| Title | Title | Note name |
| Original | Files & media | Original PDF and page PNG |
| Clean | Files & media | Typed text, minimal rearrangement |
| Interpreted | Files & media | Typed text, stronger restructuring |
| Review state | Select | Pending Review, Approved, Needs Review; Pending Review is temporary |
| Return target | Select | Use Default, Clean, Interpreted; starts Use Default (initially Clean) |

Use these exact names/types; all six are required, no other database properties are needed. The unique Notion title property is resolved by type and does not need to be renamed. The reproducible [user schema manifest](../schemas/notion-user.json) includes each field's meaning. OCR JSON, prompt hashes and failure diagnostics are not user requirements; [development details](notion-profiles.md) are separate. No Notion template is published by this repository.

```console
node src/cli.mjs process notion-preview --job "typed-job" --profile user --config config/notion-user.local.json
```

For a Development-profile comparison, record the person's explicit sample-specific visual PASS as described in the [processing guide](ai-processing.md#preview-a-processed-job-for-notion-review). Keep that sidecar and the complete processing job private. The User auto-review path does not require this Development attestation.

```console
node src/cli.mjs process notion-preview --job "typed-job"
node src/cli.mjs process notion-preview --job "typed-job" --profile user --return-target interpreted
```

The default User preview shows Original, both typed images, the auto-review result, and the return choice without OCR diagnostics or hashes. A normal job becomes Approved; an explicit exception becomes Needs Review with short reasons. Changing the return target does not change the review result or saved defaults. Both modes remain included. `--profile development` uses separate configuration, remains Pending Review, and shows technical details. Both profiles verify the same hashes with zero network calls or external writes. The preview creates no Notion record. Use this bridge, not the fixture-only `notion` uploader. `--json` exposes a private local plan, not an API payload; do not publish it.

## Screenshot Capture Checklist

No screenshot is included until a sanitized capture has been explicitly approved. Use this checklist when preparing one:

| Filename | Screen to open | Must be visible | Must be hidden | Recommended crop |
|---|---|---|---|---|
| `01-offline-preview.png` | Terminal after the synthetic preview command | dry-run banner, destination, Select All, 3/3, Pending Review | prompt path, username, unrelated windows | Crop to the command and complete preview |
| `02-note-selection.png` | Terminal after the partial-selection command | Select All OFF, 2/3, checked and unchecked notes, destination override | prompt path, username, identifiers | Crop to Destination, Notes, and Operation |
| `03-return-mode.png` | Same sanitized partial preview | Use Default (Clean), Override → Interpreted | prompt path, username, unrelated output | Crop tightly around the selected note rows |
| `04-notion-review.png` | Sanitized Notion review record | Original, Clean, Interpreted, Approved or Needs Review | account identity, email, workspace name, URL, data-source ID, token, real notes | Crop to the synthetic record fields only |
| `05-ainote-return.png` | Sanitized AINOTE result using a non-important note | newly created note and evidence that Original remains | private notes, account/device identifiers, serial number, local paths | Crop to the minimum evidence needed |

Do not use private notes, real account identifiers, email addresses, device serials, tokens, local paths, private Notion IDs, vendor messages, or raw development/debug screens. If a clean capture is not available, leave the corresponding Screenshot TODO in place.
