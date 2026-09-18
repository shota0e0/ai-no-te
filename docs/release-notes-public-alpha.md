# AI-no-Te Public Alpha — Release Notes Draft

AI-no-Te is an independent community project for moving an AINOTE note through AI-assisted processing, User Notion review, and an optional return to a new AINOTE note. It is not an official product or tool of AINOTE, iFLYTEK, or Notion.

## Included in this Public Alpha

- Experimental Desktop Input reads selected AINOTE Desktop pages without changing the source note.
- Clean preserves meaning, drawings, and broad layout while converting handwriting to typed text.
- Interpreted reorganizes the same content more strongly without adding facts.
- User Notion uses a six-field review record and Human-on-exception: normal completed work is Approved automatically, while five clear exception types become Needs Review.
- Experimental Desktop Return can create a new image-bearing AINOTE note from an Approved result.
- PDF Input remains an official-friendly fallback for compatibility and troubleshooting.
- Original is preserved and is never overwritten by the supplied flows.

## Before you start

Experimental Desktop Input and Return depend on undocumented, version-specific AINOTE Desktop behavior. They may stop working after an AINOTE update and are not official OpenModel APIs. Back up important data and begin with a non-important note.

The Windows Release ZIP requires Node.js 20 or newer. Some Desktop features also require AINOTE Desktop and the installed AINOTE Skill. The external helper is not bundled.

A launcher or a distribution with Node.js bundled is being considered for a future version to simplify setup. This is not yet committed functionality.

Start with `START_HERE.txt`, then follow `docs/getting-started.ja.md` or `docs/getting-started.md`.
