# Experimental AINOTE Return

## Status and boundary

This AI-no-Te research transport is optional, experimental, version-specific, unsupported, and outside the stable Public Core. AI-no-Te is independent from the AINOTE product and team. This transport uses AINOTE Desktop behavior that is not documented in the public OpenModel Skill interface and may stop working after any application update. It is not presented as a supported API, and this repository claims no endorsement, partnership, maintenance, or support from the AINOTE team.

The installed official Skill documents OpenModel creation and read-back of a new Markdown note. A live probe confirmed that HTTPS, data URI, local-path, and `file://` image Markdown is stored, but none of those forms rendered as an image in the AINOTE UI. No published image insertion, attachment, or resource-upload route is confirmed, so official image Return is parked. This experimental component records the earlier image-bearing Return PoC and is separate from the documented Skill-to-Desktop OpenModel route. See the [official Skill Return capability record](official-skill-return.md).

The PoC demonstrated image Return through undocumented Desktop endpoints and internal data assumptions. It is not invoked by the current normal PDF -> processing -> User Notion workflow and is not presented as a supported integration. The implementation is frozen as research evidence. Its exact endpoint, internal-file, legacy-schema, helper and failure boundaries are recorded in the [directory README](../experimental/ainote-return/README.md).

## Safety model

- Default invocation is `--offline-check`; it performs no network or application write.
- `--execute` is required for the return operation.
- A unique existing Notion record must already be in the configured Approved state and identify Clean or Interpreted as the selected return target.
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
| External helper | Found in the inspected installed official Skill; local compatibility and redistribution rights are not established |

Because the two AINOTE-specific versions are not established, publication does not imply that third parties can reproduce the result. Record and revalidate your own versions before any execution. Stop if the observed routes, local files, schemas, or approval behavior differ.

## External helper

The caller currently requires `ainote_api.py`. The inspected local official Skill installation contains that helper, but this repository deliberately does not bundle, copy, download, or redistribute it because redistribution rights have not been established. It remains `LOCAL_ONLY` and must be selected explicitly.

You must:

1. Locate a compatible installed copy that you are authorized to use.
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

Issue reports may provide useful community evidence, but there is no compatibility SLA. The AINOTE team is not expected to support this transport as an official feature. Prefer an official interface if one becomes available.
