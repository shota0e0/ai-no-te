# Official Skill Return Adapter and Capability Record

## Boundary

The official adapter is offline and preview-only. It accepts the current User fields `Review state`, `Return target`, `Original`, `Clean`, and `Interpreted`, then reuses the existing readiness evaluator. `Use Default` resolves through the configured default, initially Clean. It does not require the legacy Experimental Return schema.

This adapter remains separate from the public Experimental Desktop Return in `src/ainote/desktop-return.mjs`. The official adapter uses only documented OpenModel routes; the Experimental runtime uses a distinct allowlist of undocumented Desktop routes for image Return. Neither classification changes the other.

Only these documented OpenModel routes are allowed in a plan:

- `POST /open-model-note/file/create` for a new Markdown note.
- `GET /open-model-note/file/content` for a future text read-back.
- `/open-model/sync` only if a future documented live flow establishes that it is required after creation.

The public adapter has no live execution path. It can plan only a new note; it never plans to update, delete, or overwrite Original. It performs no network request, helper invocation, Desktop startup, Notion operation, or AINOTE write. `--execute` is rejected before the input record is read.

```console
node src/cli.mjs return official-preview --record "user-record.json"
node src/cli.mjs return official-preview --record "user-record.json" --json
```

The local JSON input uses the User property names directly. File entries need a safe `name`; the selected Clean or Interpreted entry must declare `mimeType: "image/png"`. This validation selects the future Return input; it does not upload or embed the PNG. Private URLs, IDs and credentials are neither required nor printed.

## Documentation audit

The documentation audit covered the installed official Skill documentation and source, the OpenModel Note API reference, and related shared references. It looked for image insertion, attachments, file-resource uploads, Markdown images, local paths, `file://`, data URIs, and remote image URLs.

| Capability | Result |
|---|---|
| Image insertion endpoint | Not documented |
| Attachment endpoint | Not documented |
| File resource endpoint/upload | Not documented |
| Markdown image syntax | `NOT_DOCUMENTED` |
| Local filesystem path | Not documented |
| `file://` URL | Not documented |
| Data URI | Not documented |
| Remote image URL | Not documented |

Before live testing, the documentation-only result was `NOT_DOCUMENTED`, and the adapter classified image transport as `NO_OFFICIAL_PATH_FOUND`. The preview therefore includes no Markdown image syntax or attachment request. Its Markdown contains only the selected mode and artifact filename and explicitly states that the image is not attached.

## Live Markdown image capability probe

A single disposable note was created through the documented `POST /open-model-note/file/create` route and read back once through `GET /open-model-note/file/content`. It used only public-safe or synthetic inputs. No User, Clean, or Interpreted artifact was sent.

The note separated four image sources:

| Probe | Stored and returned | Rendered as an image in AINOTE UI |
|---|---|---|
| Public HTTPS PNG | Yes | No |
| Small synthetic PNG data URI | Yes | No |
| Local `C:/...` path to the synthetic PNG | Yes | No |
| `file:///C:/...` URI to the same PNG | Yes | No |

The exact Markdown image strings and probe markers survived read-back. This confirms storage, not usable image rendering. The probe used no retry, sync, deletion, undocumented route, internal database or file access, User Return, or Notion write.

## Current decision

Official text-note creation and content read-back are confirmed. An official image insertion, attachment, or resource-upload route is not currently confirmed, and the tested Markdown forms did not render. Official image Return is therefore **parked**, not declared permanently unsupported.

The adapter remains a valid official text-note transport plan, but text-only Return is not an AI-no-Te full loop and does not satisfy Clean or Interpreted image Return.

The undocumented `/note/*` routes, `/sync/pushOneNote`, Desktop databases/resources/logs and the T5/page model are forbidden in this adapter. Experimental AINOTE Return remains isolated and does not become an official path.
