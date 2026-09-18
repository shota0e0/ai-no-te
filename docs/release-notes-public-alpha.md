# AI-no-Te Public Alpha v0.1.0-alpha.1

AINOTEで書いたノートをAIで整理し、Notionで確認して、必要な結果を新しいAINOTEノートへ戻すPublic Alphaです。

**Windowsで試す場合は、Release Assetsの `ai-no-te-public-alpha-windows.zip` をダウンロードしてください。**

展開後、まず `START_HERE.txt` を読んでください。

> GitHubが自動生成する `Source code (zip)` / `Source code (tar.gz)` は、通常の導入用パッケージではありません。

**AI-no-Teは独立したコミュニティプロジェクトです。AINOTE / iFLYTEK / Notionの公式製品・公式ツールではありません。**

---

## このPublic Alphaでできること

- Experimental Desktop InputでAINOTE Desktopのノートを読み取る
- 手書き内容からClean / Interpretedを作る
- Notionで結果を確認する
- 通常は自動でApprovedにし、例外がある場合だけ人が確認する
- Experimental Desktop Returnで結果を新しいAINOTEノートとして戻す
- PDF Inputをfallbackとして利用する
- Originalは上書きしない

---

## 利用前に

Experimental Desktop Input / Returnは、公開されていないAINOTE Desktopの動作に依存するversion-dependentな機能です。

AINOTE Desktopの更新後に動かなくなる可能性があります。最初は重要でないノートで試し、必要なデータは事前にバックアップしてください。

現在のWindows版Public AlphaにはNode.js 20以上が必要です。一部のDesktop機能では、AINOTE Desktopとインストール済みのAINOTE Skillも必要です。

必要な外部helperはZIPへ同梱していません。

次版では、導入を簡単にするため、ランチャーまたはNode.js同梱方式を検討しています。

---

## はじめに読むもの

1. `START_HERE.txt`
2. `docs/getting-started.ja.md`

英語版: `docs/getting-started.md`

---

## English

AI-no-Te is an independent community project, not an official product or tool of AINOTE, iFLYTEK, or Notion.

**For Windows setup, download `ai-no-te-public-alpha-windows.zip` from the Release Assets and read `START_HERE.txt` after extracting it.** Do not use GitHub's automatically generated `Source code (zip)` or `Source code (tar.gz)` for the normal setup flow.

This Public Alpha supports Experimental Desktop Input, Clean / Interpreted processing, User Notion review with Human-on-exception, Experimental Desktop Return to a new note, and PDF Input as a fallback. Original notes are not overwritten.

Experimental Desktop Input and Return depend on undocumented, version-specific AINOTE Desktop behavior and may stop working after an update. Back up important data and begin with a non-important note. The Windows package requires Node.js 20 or newer; some Desktop features also require AINOTE Desktop and the installed AINOTE Skill. The external helper is not bundled.

See `docs/getting-started.md` for the English setup guide. A launcher or a package with Node.js bundled is being considered for a future version.
