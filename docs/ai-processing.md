# OCR and typed Clean / Interpreted processing

## Meaning and boundaries

Original source (Desktop manifest or PDF) -> Original page image -> OCR / text extraction -> layout/object record -> typed Clean and typed Interpreted.

OCR is mandatory. Both modes reuse the same extraction. Clean replaces handwritten characters with typed text while preserving meaning, drawings and broad layout; it is not merely neater handwriting. Interpreted may reorganize content more strongly without inventing facts. The current Interpreted contract keeps all words and changes hierarchy/placement rather than summarizing. The Original source manifest/PDF and Original page image are never overwritten. OCR text is a derivative, not Original.

## Provider decision and reproduction

This is an **operator-mediated** workflow. A Codex assistant reads the image and returns structured text; the CLI imports that record and prepares prompts. Codex's built-in OpenAI `image_gen` then edits the Original using each saved prompt. The CLI itself makes no network call and implements no standalone OCR or image API client. Third parties need a Codex session with image-reading and image-editing access and must perform the same transfer steps. This is not autonomous full orchestration.

No OCR package, SDK, key, private endpoint, or helper is installed or bundled. If those capabilities are unavailable, stop rather than silently changing providers. Using Codex to read or generate images sends note content to OpenAI; confirm permission before sharing a private note. Account limits and charges apply. The per-call cost is unknown; this guide does not assume it is free. When a model, version, or seed is unavailable, record it as `not exposed by runtime`; record missing metrics as `unknown`. Do not infer hidden models from assistant self-report.

The raw record is the assistant's structured visual extraction, not a response falsely attributed to a standalone OCR service. Provider execution is operator-attested and **not independently verified** by file hashes. AI output is non-deterministic. The process can be repeated, but identical bytes or recognition quality are not guaranteed. Normalization/hashing are deterministic for identical inputs/contracts; timestamps and directories differ.

### OCR candidates

These are capability/installation comparisons, not a comparative accuracy benchmark on this note.

| Candidate | Japanese handwriting / layout | Windows installation | License / cost | Reproduction and visibility |
|---|---|---|---|---|
| Codex multimodal extraction (selected) | Reads text and observes drawings together; mistakes possible; no numeric confidence/boxes here | Available in this session, no installation | Hosted OpenAI service, account terms/limits; call cost unknown | Operator workflow repeatable, output non-deterministic; hidden model/version here |
| Windows OCR | Text lines/word boxes; handwriting quality untested here; not drawing preservation | OS/language support needed; WinRT was inaccessible through this PowerShell runtime | Windows terms; no separate hosted call for the local route | Record OS build/languages; no model control assumed |
| Tesseract | Primarily printed text; handwriting is not its normal strength; drawings need separate handling | Executable/language data needed; not installed here | Apache-2.0; local compute | Pin executable and traineddata; version visible |
| PaddleOCR | Japanese/handwriting and document-parsing options; this sample untested | Python/runtime/model weights needed; not installed here | Apache-2.0 project; local compute or selected service cost | Pin runtime/code/weights; installation and revalidation required |

References: [Windows recognizer languages](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.availablerecognizerlanguages), [Tesseract](https://tesseract-ocr.github.io/tessdoc/), [handwriting FAQ](https://github.com/tesseract-ocr/tessdoc/blob/main/FAQ.md), [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [PP-OCRv5 capabilities](https://paddlepaddle.github.io/PaddleOCR/v3.0.0/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html). The selected option avoids a new heavy dependency; it is not claimed more accurate than engines not tested here.

## 1. Extract and import

Keep the selected page with the complete Desktop Input or PDF Input `metadata.json`. Ask the image-reading assistant to inspect that exact page using [OCR v1](../prompts/ocr-v1.txt), supplying the page number and hash from the input package. Save its JSON response privately without correcting its words. Record ambiguous readings with `uncertain: true`; use `unknown` for confidence/bbox not returned by the provider. Rough verbal positions are observations, not measurements.

The schema example below is illustrative, not a real OCR result. Replace placeholders and blocks with the actual response. IDs must be unique. Types are `text`, `drawing`, `arrow`, `unknown`; non-text blocks have empty text and describe visible shapes rather than assumed meaning. Numeric bbox, when actually supplied, is [x,y,width,height] in source pixels. Numeric confidence must be provider-supplied in 0..1, never estimated.

```json
{
  "schemaVersion": 1,
  "sourcePage": 2,
  "sourceSha256": "<source image SHA-256>",
  "engine": "<actual engine>",
  "provider": "<actual provider>",
  "model": "not exposed by runtime",
  "modelVersion": "not exposed by runtime",
  "timestamp": "<actual ISO-8601 extraction time>",
  "blocks": [
    {"id":"t1","type":"text","text":"<visible text>","confidence":"unknown","bbox":"unknown","position":"upper-left","uncertain":true,"description":"text region"},
    {"id":"d1","type":"drawing","text":"","confidence":"unknown","bbox":"unknown","position":"below t1","uncertain":false,"description":"rounded outline"}
  ]
}
```

```console
node src/cli.mjs process ocr --input "desktop-input-job/page-001.png" --extraction "extraction.json" --output "typed-job"
```

This command imports OCR output; it does not run OCR. It validates the schema and Desktop/PDF source-page lineage before creating a new job. The parent directory must exist; `--output` is required and must not already exist. Raw bytes are preserved exactly in `ocr-raw.json`. `ocr-normalized.json` changes only whitespace and newlines, without spelling repair, added words, or completion. Uncertainty remains; unavailable confidence also sets `needsReview: true`. `layout.json` separately retains types, positions, and supplied boxes. No segmentation or cropping is performed.

## 2. Prepare both modes

```console
node src/cli.mjs process clean --job "typed-job" --attempt 1
node src/cli.mjs process interpreted --job "typed-job" --attempt 1
```

Each verifies originals/OCR and creates an exclusive `clean-001` or `interpreted-001` directory with `request.json` and `prompt.txt`. Defaults: [typed Clean v2](../prompts/typed-clean-v2.txt), [typed Interpreted v3](../prompts/typed-interpreted-v3.txt). These contracts omit known AI-no-Te processing/report labels while preserving genuine headings from the source note. They do not crop the page. Earlier prompt versions remain available through explicit `--version` values so existing artifact lineage remains reproducible. Historical image-only prompts and module tests remain for regression evidence, but the public CLI no longer dispatches that route.

Effective prompts contain the versioned base (CRLF normalized to LF and trimmed), followed by normalized text and layout as labeled, untrusted JSON. Base and effective hashes are recorded. Image and text content are treated as data, not instructions. Do not silently add sample-specific instructions, edit saved prompts, or reuse a version for a different contract.

## 3. Generate and assess

Have Codex view the copied Original page, read the mode's exact saved `prompt.txt`, and submit both to the built-in `image_gen` tool. Use Original for both modes, never Clean as the source for Interpreted. The CLI has no API fallback or automatic upload.

Compare each returned PNG with Original and OCR text. Check typeset text, all words, uncertainty, recognizable drawings, clipping, invented content and the mode's layout contract. Interpreted must show restructuring beyond alignment. Record changes to dimensions, glyphs or background texture. Do not post-resize output without a separately recorded processing step.

```console
node src/cli.mjs process record --job "typed-job" --mode clean --attempt 1 --result "returned-clean.png" --assessment pass --note "Text and drawings checked; preliminary only" --evidence "Actual tool result reference and saved prompt used"
node src/cli.mjs process record --job "typed-job" --mode interpreted --attempt 1 --result "returned-interpreted.png" --assessment pass --note "Typed text and restructuring checked; preliminary only" --evidence "Actual tool result reference and saved prompt used"
```

`pass` is preliminary, not Human Review approval; every result remains `approved: false`. For inadequate output, use `--assessment failed` and explain why in `--note`. If no image returns, use `--failure "Provider unavailable"` instead of result/assessment. Failed bytes and reasons remain in the attempt directory. Retry with another attempt number (1..999); never overwrite an old attempt.

## 4. Assemble the review package

Select preliminary-pass attempts explicitly:

```console
node src/cli.mjs process finalize --job "typed-job" --clean-attempt 1 --interpreted-attempt 1
```

This verifies hashes and copies selected results to the job root. It neither approves output nor sends anything to Notion or AINOTE Return. Failed or altered selected outputs are rejected. `--json` returns local machine-readable records which may contain private paths/content; do not publish them.

```text
typed-job/
  original-source.json  # or original.pdf for PDF fallback
  page-001.png          # selected Desktop/PDF page image
  ocr-raw.json
  ocr-normalized.json
  layout.json
  ocr-prompt.txt
  ocr-job.json
  clean-001/        (prompt.txt, request.json, recording-claim.json, clean.png, metadata.json)
  interpreted-001/  (prompt.txt, request.json, recording-claim.json, interpreted.png, metadata.json)
  clean.png
  interpreted.png
  finalization-claim.json
  processing-metadata.json
```

Schema 2 metadata links the Original source kind/hash and page number; OCR provider, model, time, prompt, and raw/normalized/layout hashes; both image-prompt versions and hashes; returned PNG hashes and dimensions; attempt evidence; local recording time; failed or incomplete attempts; and pending visual review. Source paths remain in private `ocr-job.json` for rechecking. Keep the upstream Desktop/PDF input job until finalization. The recording time is not presented as the provider's generation time.

Existing jobs, attempts, claims, outputs and final metadata are never overwritten. Mutations use an exclusive job lock. After interruption preserve and inspect the partial job; do not delete claims to force retries. Start a new job if a lock/finalization claim remains, or a new attempt for a recorded failure. Failed finalization may leave root images and `finalization-failure.json`; without successful final metadata it is incomplete. Finalized jobs are closed; further work uses a new job. Real inputs, OCR text and images are private artifacts, excluded from the public candidate.

## Preview a processed job for Notion review

For a Development-profile comparison, record a person's explicit PASS on the three-image visual comparison in a private `owner-visual-review.json` beside the finalized job. This permission applies only to continuing the PoC with that sample; it is not a User-profile review decision or permission to publish. Do not change the immutable `processing-metadata.json`: its pending visual status describes the earlier generation snapshot. The sidecar records the later decision and binds it to the SHA-256 of those exact metadata bytes. The normal User preview does not require this Development attestation.

The sidecar schema contains `schemaVersion: 1`, `owner_visual_review: "PASS"`, `owner_visual_review_at` (ISO-8601 recording time), `owner_visual_review_note` (the person's actual observation), `processingMetadataSha256`, `scope: "poc_next_step_only"`, `approved: false`, `humanDecision: null`, and `publicationApproved: false`. Record a PASS only after the person explicitly provides that decision for the exact sample. The recording time does not assert when the visual inspection occurred. This is a local attestation, not a cryptographic signature or independently authenticated identity.

```console
node src/cli.mjs process notion-preview --job "typed-job"
node src/cli.mjs process notion-preview --job "typed-job" --profile development
node src/cli.mjs process notion-preview --job "typed-job" --json
```

This bridge is **preview-only**. `--execute` is rejected before reading the job; the bridge cannot upload or create records. The existing `notion` upload flow does not accept processing-job arguments. The preview reads no credentials from the environment, queries no API schema, and writes no files. Destination labels come from the matching profile config; property names come from its schema manifest. These local definitions do not prove that a matching Notion destination or schema exists. The default example destination is still a placeholder.

The default `user` profile has six primary fields and omits technical page content. It applies the five-check Human-on-exception policy: a clear job becomes Approved; suspicious OCR, missing artifacts, conflicting state, a current generation failure, or an unresolved target produces Needs Review. Pending Review is temporary. Use `--profile development` for detailed diagnostics; it remains Pending Review and requires the sample-specific visual sidecar. Configs and destinations are profile-tagged and cannot silently fall back across profiles. See [Notion profiles and manifests](notion-profiles.md) for normal-user setup, field types, and validation. Return target is separate from review state and defaults to Use Default (Clean).

The preview prepares one record per selected page. The following detailed mapping applies to the **development profile**, not the normal-user schema:

| Local input | Planned field / page content | Meaning |
|---|---|---|
| `original-source.json` or `original.pdf` + `page-NNN.*` | `Original` files field | Preserved Desktop manifest/PDF and selected page image |
| Source SHA-256 | `Original SHA-256` | Desktop manifest or PDF identity; page hash is retained separately in provenance |
| `clean.png` + its hash | `Clean`, `Clean SHA-256` | Typed text with minimal restructuring |
| `interpreted.png` + its hash | `Interpreted`, `Interpreted SHA-256` | Typed text with stronger restructuring |
| `ocr-raw.json`, `ocr-normalized.json`, `layout.json` | Planned attachments in an `OCR / Layout` page-body section | Raw extraction, reusable text and visual regions; no new database properties required by this plan |
| Verified hashes, OCR provider, prompt contracts/versions, selected attempts, visual decision | Planned structured `Provenance / modes` page-body section | A selected summary, not a raw upload of private request files |
| New review record | `Review state` = `Pending Review` | `humanDecision: null`, `approved: false` |
| Return intent | `Return target` = `Use Default`, `Clean`, or `Interpreted` | Never an approval action |

Both generated modes are included regardless of configured return intent. Choosing Clean as return intent does not discard Interpreted, change the review result, or invoke Return. Every preview rechecks Original files, OCR derivation, selected outputs, prompts and attempt evidence. Development preview also verifies the sidecar binding. Modified files and failed or incomplete finalization are rejected.

JSON output is a local input plan, **not a Notion API payload**: attachments have local filenames/hashes and no upload IDs or public URLs. Normal text preview omits OCR contents, source paths and destination IDs. Development JSON additionally includes detailed provenance and diagnostics; user JSON retains local asset hashes but omits those page-body sections. Treat both forms as private local evidence. Absolute source paths, raw request files and failed images are not planned uploads. Keep all source job files private and stable; the upstream Original files are still needed for validation.

Actual PNG/PDF upload, remote schema verification, duplicate checking, record creation and read-back were confirmed with a private local User Notion setup. Those live-operation scripts, credentials, identifiers, records and real artifacts are not part of this public bridge. The public command remains preview-only. Multi-page identity, API limits and partial-upload recovery are therefore not offered as a reproducible public execution path; two pages from one PDF still share its PDF hash and require page-aware handling. No completed AINOTE image-Return loop is claimed. The existing SVG fixture uploader remains separate, and Experimental AINOTE Return is not invoked by this workflow.

## Validation and limitations

Normal tests use mocked providers, never paid AI calls. They cover OCR schema, uncertainty, whitespace-only normalization, shared lineage, missing OCR, prompt versions, names, failures, concurrent work and overwrite refusal. PDF integration tests still require Poppler. PNG checks validate headers/dimensions/hashes, not full decoding or semantic correctness. Hashes do not prove every glyph is accurate or authenticate a provider.

One small sample does not establish accuracy for dense handwriting, complex diagrams or other devices. Confidence and boxes remain unknown where unavailable; unknown confidence alone is not an auto-review red flag. Typed glyphs in PNG are pixels, not an editable text layer; reusable text is in JSON. The review decision never invokes Experimental AINOTE Return automatically.
