# Experimental AINOTE Return research PoC

## Positioning

This directory preserves the earlier image-bearing AINOTE Return proof of concept as research and compatibility evidence. The PoC completed a direct AINOTE -> Notion -> AINOTE round trip, including image return to a newly created note, without using PDF export. It does not use a public AINOTE OpenModel API.

The user-facing Experimental Desktop Return is now [`src/ainote/desktop-return.mjs`](../../src/ainote/desktop-return.mjs). It reuses the confirmed endpoint sequence but accepts the current User schema, provides public CLI preview/execute commands, and avoids the legacy Notion state update in this PoC. Nothing here claims that the undocumented behavior is supported or endorsed.

The official Skill-to-Desktop OpenModel route is separate. AI-no-Te's official adapter is [`src/ainote/official-return.mjs`](../../src/ainote/official-return.mjs); it uses only the documented OpenModel note routes and remains offline and preview-only. Nothing in the normal CLI imports or invokes the files in this directory.

## Frozen compatibility contract

This PoC is frozen against an older Notion Return schema:

- `Return state`
- `Return mode`
- `Original SHA-256`
- `Result SHA-256`
- `AINOTE return ID`
- `Returned at`

The current User profile instead uses:

- `Review state`
- `Return target`
- `Original`
- `Clean`
- `Interpreted`

These contracts are intentionally incompatible. There is no automatic migration or field-name fallback. Passing the current User schema to this PoC fails closed during schema validation. Use the current User fields with the public Experimental Desktop runtime or the official offline adapter; do not adapt a live User record to this legacy PoC.

## Undocumented endpoints

The PoC calls the following Desktop endpoints. Each is classified as `UNDOCUMENTED`: it is used by this research implementation but is not documented in the public OpenModel Skill interface.

| Endpoint | Research-stage purpose | Classification |
|---|---|---|
| `/note/createMixtureNote` | stage a new mixture note | `UNDOCUMENTED` |
| `/note/addMixtureImgFile` | register the PNG resource | `UNDOCUMENTED` |
| `/note/saveRichMixtureNote` | save the rich page payload | `UNDOCUMENTED` |
| `/note/getDetail` | read back staged note details | `UNDOCUMENTED` |
| `/sync/pushOneNote` | push the new note | `UNDOCUMENTED` |

Their presence in an installed Skill implementation does not make them a public or supported API. A Desktop or Skill update may change or remove them without notice.

## Desktop internal dependencies

Execution also inspects or relies on Desktop-internal state:

| Dependency | Use in this PoC |
|---|---|
| `db.json` | note state and sync verification |
| `dir.json` | folder resolution and post-sync verification |
| `note_relations.json` | relation and sync verification |
| `page.bin` | staged T5 page payload verification |
| `change.json` | staged and synchronized resource verification |
| `note.log` / sync logs | pending-change and sync-headroom checks |
| Desktop internal paths | local data-root and note-resource discovery |
| T5/page data model | rich-note structure and image placement |

These formats and paths are not a Public Alpha compatibility promise. The official adapter does not read or mutate any of them.

## Helper boundary

This PoC requires `ainote_api.py` through an explicit absolute `AINOTE_API_HELPER` path. The inspected local official Skill installation contains that helper, but this repository does not copy, vendor, download, or bundle it. The helper is `LOCAL_ONLY`; its redistribution rights are not inferred from local installation. Users must independently confirm that they are authorized to use their installed copy.

A missing or unreadable helper stops before Notion or AINOTE access. The helper child receives an allowlisted environment and does not receive the Notion credential.

## Execution safety

- With no arguments, the wrapper runs `--offline-check`; it performs no network or application write.
- A write requires the explicit `--execute` option.
- `--verify-only` reads Notion and is not an offline mode.
- Return creates a new note. Original is not overwritten, updated, or deleted.
- The PoC verifies that pre-existing note resources are unchanged after execution.
- There is no rollback. A failure can leave partial local or remote state.
- There is no automatic retry, but manually repeating an interrupted execution may create a duplicate or encounter the duplicate-title guard.
- AINOTE Desktop or Skill updates may break endpoints, internal files, or the T5/page representation.
- Back up important AINOTE data and test only with a non-important note after reviewing the code and local versions.

## Commands

Safe default:

```powershell
./experimental/ainote-return/invoke-ainote-clean-return-poc.ps1
```

Read-only Notion verification (networked):

```powershell
./experimental/ainote-return/invoke-ainote-clean-return-poc.ps1 --verify-only
```

Experimental write, which requires separate informed authorization:

```powershell
./experimental/ainote-return/invoke-ainote-clean-return-poc.ps1 --execute
```

These commands operate the legacy PoC and are not the normal user entrypoint. See the [public Experimental Desktop Return guide](../../docs/experimental-ainote-return.md). Prefer the documented OpenModel route whenever it can satisfy the use case.
