# Experimental AINOTE Desktop Return

## Status and boundary

Experimental Desktop Return is included in the public AI-no-Te distribution. It lets a user return an Approved Clean or Interpreted PNG as a new AINOTE note. The user-facing runtime is [`src/ainote/desktop-return.mjs`](../src/ainote/desktop-return.mjs), exposed by the public CLI.

This transport is experimental, version-specific, unsupported, and based on undocumented AINOTE Desktop behavior. It is outside the published official OpenModel API and may stop working after an AINOTE Desktop or Skill update. There is no compatibility guarantee. AI-no-Te remains an independent community project; availability of this runtime does not claim endorsement, partnership, maintenance, or official API status.

Following clarification that community exploration and sharing are acceptable, AI-no-Te is making this Experimental path available to users. The project does not quote private correspondence or interpret that clarification as product support.

The official OpenModel adapter remains separate and preview-only. Official note creation and read-back are confirmed, but a published official image insertion, attachment, or resource-upload route has not been confirmed. See the [official Skill Return capability record](official-skill-return.md).

## User contract

The runtime reads the current User record fields directly:

- `Title`
- `Review state`
- `Return target`
- `Original`
- `Clean`
- `Interpreted`

It does not require the old PoC fields `Return state`, `Return mode`, `Result SHA-256`, `AINOTE return ID`, or `Returned at`.

Return-target resolution is unchanged:

- `Use Default` -> Clean
- `Clean` -> Clean
- `Interpreted` -> Interpreted

`Review state` must be `Approved`. This may be the normal Human-on-exception result or a manual approval after a `Needs Review` exception. A missing artifact, conflicting value, unknown target, non-Approved state, or missing local PNG fails closed.

The local JSON supplied to the CLI represents the six current User properties. The selected Clean/Interpreted file item also needs a `localPath`; this is a local runtime locator inside the file descriptor, not a new Notion property.

## Behavior and safety

- Preview performs no network call or AINOTE write.
- Execute requires both the `desktop-execute` subcommand and an explicit `--execute` option.
- The selected PNG is validated locally before the helper is resolved or Desktop is contacted.
- The image object uses the PNG's source dimensions. The runtime does not crop, resize, resample, or otherwise change the PNG.
- Return always creates a new AINOTE note. Original is not overwritten, updated, or deleted.
- Image registration, rich-note save, sync, and read-back verification run once.
- There is no automatic retry or rollback.
- A partial failure can leave a local or synchronized note. Repeating execute may create another note.
- A missing installed Skill helper stops before any AINOTE request.
- Preview and normal default commands cannot accidentally execute the transport.

Back up important AINOTE data and start with a non-important note. Review the preview, selected file, destination folder, Desktop version, and Skill installation before execute.

## Undocumented route allowlist

The public Experimental runtime isolates these five Desktop routes:

| Endpoint | Purpose | Classification |
|---|---|---|
| `/note/createMixtureNote` | Create a new local note | `UNDOCUMENTED` |
| `/note/addMixtureImgFile` | Register the selected PNG | `UNDOCUMENTED` |
| `/note/saveRichMixtureNote` | Save the image-bearing rich page | `UNDOCUMENTED` |
| `/note/getDetail` | Read back the new note | `UNDOCUMENTED` |
| `/sync/pushOneNote` | Synchronize the new note | `UNDOCUMENTED` |

No other Desktop or OpenModel route is accepted by this runtime. Use of these routes does not make them public or supported AINOTE APIs.

## Installed Skill helper

The runtime requires `ainote_api.py` from an installed AINOTE Skill. It checks, in order:

1. the explicit `AINOTE_API_HELPER` path, when set;
2. `$CODEX_HOME/skills/ainote/shared/scripts/ainote_api.py`; and
3. the corresponding default `.codex/skills/ainote/` location under the current home directory.

The repository does not copy, vendor, download, or bundle the helper. Download ZIP and release packages contain the JavaScript runtime and documentation, but not the externally supplied Skill helper. If it cannot be found, execution stops with: `Experimental Return requires the installed AINOTE Skill`.

The helper child receives an allowlisted environment and does not receive Notion credentials. The public runtime does not call Notion or update a Notion record.

## Commands

Preview without a write:

```console
node src/cli.mjs return desktop-preview --record "user-return.json" --folder-id "<folder-id>" --folder-name "AI-no-Te"
```

Diagnose helper launch, health access, and create-payload serialization without dispatching the create request:

```console
node src/cli.mjs return desktop-diagnose-create --record "user-return.json" --folder-id "<folder-id>" --folder-name "AI-no-Te"
```

The diagnostic sends only a read-only note-service health request. It reports sanitized process status and confirms that the create endpoint was not dispatched.

Explicit Experimental write:

```console
node src/cli.mjs return desktop-execute --record "user-return.json" --folder-id "<folder-id>" --folder-name "AI-no-Te" --execute
```

Do not commit record JSON, local paths, folder identifiers, real note content, or execution output. They are private local inputs and evidence.

## Earlier PoC and compatibility reference

The earlier implementation under [`experimental/ainote-return/`](../experimental/ainote-return/README.md) remains public as research and compatibility reference material. It records the fuller internal-file safety checks and the legacy Notion contract used by the original round-trip PoC. It is not the user-facing runtime and does not define the current User schema.

The earlier PoC inspected Desktop-internal files such as `db.json`, `dir.json`, `note_relations.json`, `page.bin`, `change.json`, and `note.log`, plus the T5/page data model. The new public runtime does not read those files; it verifies the newly created note through the Desktop read-back route instead.

## Support expectation

Issue reports may provide useful community evidence, but there is no compatibility SLA. The AINOTE team is not expected to support this transport as an official feature. Prefer an official image-capable interface if one becomes available.
