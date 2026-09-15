# AI-no-Te Public Alpha v0.1 boundary

`public-files.json` is the authoritative allowlist for the Public Alpha candidate. A file is not public merely because it exists in the working directory or is not matched by `.gitignore`.

AI-no-Te is an independent, unofficial project. `AINOTE` in this document refers only to the AINOTE product; the similar project name does not imply an official naming relationship, endorsement, partnership, maintenance, or support.

## Classifications

- `PUBLIC`: reviewed files eligible for the Public Alpha candidate.
- `EXPERIMENTAL_NOT_PUBLIC_YET`: retained experiments not selected for this release. The specifically allowlisted AINOTE Return files are public experimental material but remain outside Public Core.
- `PRIVATE`: owner data, real application material, or owner-only proof-of-concept material.
- `GENERATED`: reproducible output, caches, and build/test products.
- `LOCAL_ONLY`: machine configuration, installed dependencies, local runtimes, and legacy scripts.

The `scripts/*` local-only pattern has one deliberate exception: the validation script is named explicitly in `PUBLIC`. Exact allowlist membership wins only for that named file; no other file under `scripts/` is public.

## AINOTE Return isolation

The optional proof of concept, wrapper, and offline tests live under `experimental/ainote-return/`. They are eligible for the Public Alpha candidate only by exact allowlist entry and remain outside Public Core. The path is unofficial, unsupported, version-specific, may break, and is not an official or endorsed AINOTE API.

The experimental caller requires an explicit `AINOTE_API_HELPER` path to an externally supplied `ainote_api.py`; it has no personal Skill fallback and no downloader. The helper is not bundled because redistribution rights are not established. Its child process receives an allowlisted environment, never the Notion credential.

No-argument invocation is an offline check. `--execute` is required for a write, and the transport accepts only a unique pre-existing human-approved record. Removed publication-only provisioning modes cannot manufacture or auto-approve that record.

## Public Core closure

Public Core consists of the offline fixture/review flow and an optional, generic Notion adapter. Its runtime imports resolve to Node built-ins or files named in the PUBLIC allowlist. The default flow is offline, and Notion execution requires the explicit `--execute` option plus non-placeholder local configuration and a credential supplied through an environment variable.

Public UX defaults are stored only in ignored `config/*.local.json` files. Destination aliases and labels may be shown in CLI summaries; Notion data-source IDs and credential values are never included. Return-mode selection records intent only and does not approve a review or invoke the isolated AINOTE return transport.

The Clean fixture is rendered from deterministic semantic spacing categories. `clean-before.svg` is retained solely as synthetic comparison evidence and contains no user-derived content.

The default CLI import preview is human-readable. Owner review may explicitly enable three synthetic note aliases with `--synthetic-preview`; the example config provides two synthetic destination labels. Machine-readable output remains available only when `--json` is requested. Both forms omit credentials and destination data-source IDs. The synthetic catalog does not read live AINOTE or Notion data and is blocked from external execution.
