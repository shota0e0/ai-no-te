# Experimental Desktop Input

Experimental Desktop Input is the preferred public input route for AI-no-Te. It reads an existing AINOTE Desktop note without exporting a PDF, selects exact pages, and creates a private local package for the existing OCR and Clean/Interpreted workflow.

It is a community Experimental feature. It depends on undocumented, version-specific AINOTE Desktop data and the read-only `/note/getDetail` response. It is not part of the published official OpenModel API and may stop working after a Desktop update. The source note is never updated, moved, renamed, deleted, synchronized, or overwritten.

## Commands

List supported local notes:

```console
node src/cli.mjs input desktop-list
```

Use the displayed `note-001` style alias, or an exact unique title, to preview an import:

```console
node src/cli.mjs input desktop-preview --note note-001 --pages all --output "new-desktop-input-job"
```

Create the local processing input package explicitly:

```console
node src/cli.mjs input desktop-import --note note-001 --pages 1 --output "new-desktop-input-job"
```

Preview creates no job. Import creates only a new local directory. Existing output directories are refused. All three commands perform zero AINOTE writes and zero Notion writes.

The completed package contains `metadata.json` and one `page-NNN.png` or `page-NNN.jpeg` for each selected page. `metadata.json` records the source type, note/detail hashes, selected pages, resource hashes, page dimensions, derivation, and the read-only boundary. It deliberately omits internal note IDs and Desktop paths.

Pass a selected page to the same downstream OCR command used for PDF Input:

```console
node src/cli.mjs process ocr --input "new-desktop-input-job/page-001.png" --extraction "extraction.json" --output "typed-job"
```

## Selection and failure behavior

- The list uses temporary safe aliases and displays note titles. An exact title must match one note; duplicate titles require the alias.
- Page selection is explicit (`all`, `1`, `1,3`, or `1-3`). There is no silent page fallback.
- A missing or ambiguous data root, malformed note, unsupported page model, missing resource, conflicting layer canvas, or changed source stops the import.
- No other note or page is substituted after a failure.
- Handwriting layers are composited on their existing canvas without cropping or resizing. A full-page snapshot or a single image attachment is copied byte-for-byte.

## Internal dependency classification

| Component | Classification | Use |
|---|---|---|
| `db.json` | REQUIRED | Read-only note catalog and exact identity selection |
| `dir.json` | REQUIRED | Unique Desktop data-root validation; contents are not needed |
| `/note/getDetail` | REQUIRED | Read-only page/resource relationships |
| note `res/` directory | REQUIRED | Selected page image and handwriting-layer bytes |
| A2 `pageInfoList` / `pages` model | REQUIRED | Page ordering and resource discovery |
| T5 `page.bin` | OPTIONAL | May describe a page, but is not required when an exact image relation exists |
| `note_relations.json` | NOT_USED | No relation or sync mutation is performed |
| `change.json` | NOT_USED | Input does not stage or verify writes |
| `note.log` / sync logs | NOT_USED | Input never invokes sync |
| installed `ainote_api.py` | REQUIRED | Sends the read-only detail request; detected locally, never bundled |

The helper comes from the user's installed AINOTE Skill. AI-no-Te does not copy, download, vendor, or redistribute it, and does not infer redistribution rights from local installation.

## PDF fallback

PDF Input remains available when Desktop internals are unavailable, incompatible, or need troubleshooting. It uses a manually exported AINOTE PDF and externally installed Poppler. Both routes produce page images and source lineage accepted by the same typed processing flow; PDF is the official-friendly compatibility fallback rather than the primary user path.
