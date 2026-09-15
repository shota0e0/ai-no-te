# Experimental AINOTE Return

## Status and boundary

This AI-no-Te component is optional, unofficial, experimental, version-specific, unsupported, and outside the stable Public Core. AI-no-Te is independent from the AINOTE product and team. This component uses undocumented AINOTE Desktop behavior and may stop working after any application update. It is not an official AINOTE API, and this repository claims no endorsement, partnership, maintenance, or support from the AINOTE team.

The AINOTE team has indicated that no officially supported path currently exists for creating a new AINOTE note containing the selected result. That status is paraphrased here only to explain why this code remains experimental.

## Safety model

- Default invocation is `--offline-check`; it performs no network or application write.
- `--execute` is required for the return operation.
- A unique existing Notion record must already be in the configured human-approved state and identify Clean or Interpreted as the selected return target.
- This component does not create an approval record, automatically approve a record, or treat return-mode selection as approval.
- The returned result is created as a new AINOTE note. Original is not overwritten.
- The caller checks pending local changes, duplicate titles, sync headroom, downloaded image metadata/hash, and unchanged existing note files.
- Logs use an allowlist and must not contain credentials, private paths, note content, or destination identifiers.

`--verify-only` reads the configured Notion return record. It is not an offline mode and does not write to AINOTE.

## Compatibility record

| Component | Public Alpha record |
|---|---|
| Operating system | Windows 10/11 for the PowerShell wrapper |
| Node.js | 20 or newer |
| Python | A real local Python executable; version not established |
| Notion API | `2026-03-11` |
| AINOTE Desktop | Exact compatible build not established in public evidence |
| External helper | Compatible version/source/license not established; user-supplied only |

Because the two AINOTE-specific versions are not established, publication does not imply third-party reproducibility. Record and revalidate your own versions before any execution. Stop if observed routes, local files, schemas, or approval behavior differ.

## External helper

The caller currently requires `ainote_api.py`. It is deliberately not bundled, copied, downloaded, or redistributed because its redistribution right has not been established.

You must:

1. Obtain or locate a compatible copy through a source you are authorized to use.
2. Review its provenance, license, and behavior yourself.
3. Set `AINOTE_API_HELPER` to its absolute local path.

There is no implicit Codex Skill path and no download fallback. A missing, unreadable, or differently named helper fails at `helper_check` before any Notion or AINOTE request.

## Local configuration

Keep configuration in the process environment or in a private launcher that is excluded from Git. Never add the values to this repository.

Required before `--execute`:

```text
AINOTE_API_HELPER
AINOTE_RETURN_DATA_SOURCE_ID
AINOTE_RETURN_TARGET_TITLE
AINOTE_RETURN_ORIGINAL_SHA256
AINOTE_RETURN_IMAGE_SHA256
AINOTE_RETURN_NOTE_TITLE
AINOTE_RETURN_FOLDER_PATH       # folder segments separated by >
AINOTE_NOTION_CREDENTIAL_TARGET # Windows Credential Manager generic credential name
```

Common optional mappings:

```text
AINOTE_APP_DATA
AINOTE_RETURN_MODE              # Clean or Interpreted; must match the approved record
AINOTE_RETURN_IMAGE_FILENAME
AINOTE_RETURN_IMAGE_WIDTH
AINOTE_RETURN_IMAGE_HEIGHT
AINOTE_RETURN_LABEL
AINOTE_RETURN_SOURCE_TITLE
AINOTE_RETURN_APPROVED_STATE
AINOTE_RETURN_RETURNED_STATE
AINOTE_RETURN_PROPERTY_TITLE
AINOTE_RETURN_PROPERTY_ORIGINAL_SHA
AINOTE_RETURN_PROPERTY_RESULT_FILE
AINOTE_RETURN_PROPERTY_RESULT_SHA
AINOTE_RETURN_PROPERTY_STATE
AINOTE_RETURN_PROPERTY_MODE
AINOTE_RETURN_PROPERTY_ID
AINOTE_RETURN_PROPERTY_RETURNED_AT
```

Property defaults are generic English labels and must be overridden if the local Notion schema uses different names. Clean/Interpreted selection is expressed by `AINOTE_RETURN_MODE`; it does not relax the human-approval query.

## Commands

Safe offline check (also the wrapper default):

```powershell
./experimental/ainote-return/invoke-ainote-clean-return-poc.ps1
```

Read-only status check, with local configuration and credential already prepared:

```powershell
./experimental/ainote-return/invoke-ainote-clean-return-poc.ps1 --verify-only
```

Experimental write, only after independent version validation and explicit human approval:

```powershell
./experimental/ainote-return/invoke-ainote-clean-return-poc.ps1 --execute
```

The wrapper reads the Notion secret from the configured Windows Credential Manager target, places it in the child environment only for the run, and removes it afterward. The helper child receives only an allowlisted environment and never receives the Notion credential.

## Support expectation

Issues may be useful as community evidence, but there is no compatibility SLA. Do not ask the AINOTE team to support this transport as an official feature. Prefer an official interface if one becomes available.
