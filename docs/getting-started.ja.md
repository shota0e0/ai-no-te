# AI-no-Te Getting Started

[English](getting-started.md)

AI-no-Teでは、Originalを残したままCleanとInterpretedを作り、Notionで確認します。Approvedになった画像は、Experimental Desktop経路で新しいAINOTEノートとして返せます。認証情報や実レコードは含めません。公式OpenModelでの画像返却は引き続き未確認です。

## 1. 始める前に

- AI-no-Teは、独立して開発している非公式のPublic Alphaです。
- 通常の機能は、用意されたサンプルノートだけを使い、外部へ書き込まずに試せます。
- 主な入力方法はExperimental Desktop Inputです。読取り専用ですが、公開されていないDesktop内部構造に依存します。
- Experimental AINOTE Returnは非公式・実験段階で、特定のバージョンと公開されていないAINOTEの動作に依存しています。公式サポートの対象外です。
- Experimental AINOTE Returnを使う前に、大切なAINOTEデータをバックアップしてください。最初は重要でないノートで試してください。

Experimental Desktop Input、通常の機能、Experimental AINOTE Returnでは、安全に使うための条件が異なります。入力やoffline previewを試しただけで、Experimental AINOTE Returnが設定されたり実行されたりすることはありません。

## 2. インストール

現在のPublic AlphaではNode.js 20以上が必要です。Windows 10/11、macOS、Linuxで動かせます。次版では、導入を簡単にするため、ランチャーまたはNode.js同梱方式を検討しています。現時点ではまだ利用できません。

公開されたリポジトリをクローンするか、初心者向けWindows Release ZIPまたはソースのアーカイブをダウンロードして展開します。まず`START_HERE.txt`を読み、展開先でターミナルを開いて次のコマンドを実行してください。

```console
npm install --ignore-scripts
npm test
npm run validate:public
```

Public Alphaには、実行時に使う外部npmパッケージはありません。

用意されているサンプル設定だけで、synthetic offline previewを試せます。普段の設定を保存したり、後で実際のNotion送信先を設定したりする場合は、`config/public-alpha.example.json`をGit管理外の`config/*.local.json`へコピーします。

Windows PowerShell:

```powershell
Copy-Item config/public-alpha.example.json config/public-alpha.local.json
```

macOSまたはLinux:

```sh
cp config/public-alpha.example.json config/public-alpha.local.json
```

仮の値はコピー先だけで変更してください。認証情報は設定ファイルに保存しないでください。

## 3. AINOTE Desktopから取り込む

一般ユーザー向けの主経路はExperimental Desktop Inputです。元ノートを変更せず、Desktop内部のnote/page resourceを読み取ります。公開されていない構造に依存するため、特定のバージョンでしか動かず、AINOTEの更新後に使えなくなる可能性があります。

```console
node src/cli.mjs input desktop-list
node src/cli.mjs input desktop-preview --note note-001 --pages all --output "new-desktop-input-job"
node src/cli.mjs input desktop-import --note note-001 --pages 1 --output "new-desktop-input-job"
```

`desktop-list`と`desktop-preview`はファイルを作りません。`desktop-import`が作るのは新しいローカル保存先だけです。元resourceのハッシュを記録し、AINOTEへの書込みと元ノートの変更は0です。同名ノートが複数ある場合は、一覧に出たaliasを使います。page/resourceの対応が不明な場合は、別のノートやページを推測せず停止します。

取り込んだ`page-NNN.png`または`page-NNN.jpeg`を`process ocr`へ渡します。依存関係と失敗時の扱いは[Experimental Desktop Input](experimental-desktop-input.md)を参照してください。利用できない場合は、このガイド後半のPDF Inputをfallbackとして使えます。

## 4. Offline Previewを試す

以下のサンプルpreviewはPDF入力とは独立しています。PNG化したPDFページを読み込むものではありません。

3件のサンプルノートを使ったpreviewを実行します。

```console
node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview
```

画面の先頭には`DRY RUN — NO EXTERNAL WRITE`と表示されます。架空のノートだけを使い、送信先の表示名、3件の全選択、初期設定のClean、NotionへPending Reviewとして登録する予定の内容を確認できます。AINOTEやNotionには接続しません。

```text
DRY RUN — NO EXTERNAL WRITE

IMPORT PREVIEW

Destination:
  Project Alpha
  Source: Global Default

Notes:
  Select All: ON
  Selected: 3/3

  [✓] Project sketch
      Return: Use Default (Clean)

  [✓] Meeting memo
      Return: Use Default (Clean)

  [✓] Scratch note
      Return: Use Default (Clean)

Operation:
  Create 3 Notion review records
  Review State: Pending Review
```

> Screenshot TODO: offline previewのターミナル画面。承認済みの安全な画像を用意できたら、`01-offline-preview.png`を使用します。

## 5. Notionへ送る内容を選ぶ

CLIオプションを使うと、previewに表示する内容を変更できます。

- `--notes all`ですべてのノートを選びます。何も指定しない場合も全選択です。
- `--notes project-sketch,meeting-memo`では、その2件だけを選びます。Select AllはOFF、選択数は2/3になります。
- 設定済みの送信先には`Global Default`と表示します。
- `--destination project-beta`を付けると、今回だけ別の送信先を使い、`This Import Override`と表示します。
- 初期設定の返却内容はCleanです。
- `--note-return meeting-memo=interpreted`を付けると、Meeting memoだけをInterpretedに変更します。この指定だけで承認されることはありません。

部分選択、送信先変更、1件だけInterpretedを同時に確認できます。このコマンドも外部へ書き込みません。

```console
node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview --notes project-sketch,meeting-memo --destination project-beta --note-return meeting-memo=interpreted
```

Project sketchは`Use Default (Clean)`、Meeting memoは`Override → Interpreted`、Scratch noteは未選択と表示されます。

> Screenshot TODO: 部分選択と送信先override。承認済みの安全な画像を用意できたら、`02-note-selection.png`を使用します。

> Screenshot TODO: ノートごとのInterpreted override。承認済みの安全な画像を用意できたら、`03-return-mode.png`を使用します。

## 6. Notionで確認する

ここまでのoffline手順では、Notionへの書き込みは必要ありません。処理済みのUserレコードにはOriginal、Clean、Interpretedが入り、処理中または判定前だけPending Reviewになります。

処理後は、OCRの明らかな異常、artifact欠落、状態の競合、現在の生成失敗、返却先を解決できない状態だけを確認します。問題がなければ自動でApprovedになります。例外がある場合はNeeds Reviewになり、人が確認してApprovedへ変更するまで返却できません。CleanまたはInterpretedの選択は返す内容を指定するだけで、確認状態は変えません。

> Screenshot TODO: Original、Clean、Interpretedと、ApprovedまたはNeeds Reviewを確認できるNotionレコード。承認済みの画像が用意できた場合だけ、`04-notion-review.png`を使用します。

## 7. Approvedの結果をAINOTEへ戻す

公開CLIには、任意で使えるExperimental Desktop Returnが含まれています。公開されていないAINOTE Desktopの動作を使うため、AINOTEの更新後に動かなくなる可能性があり、公式AINOTE APIではありません。返却結果は新しいノートとして作り、Originalは上書きしません。

公式Skill／OpenModelでは、新しいMarkdown／テキストノートの作成と読戻しを確認しています。実機確認では、HTTPS画像、検証用PNGのdata URI、ローカルパス、`file://` URIを保存できましたが、AINOTEの画面では画像として表示されませんでした。公開された画像挿入・添付・ファイル送信の経路も確認できないため、公式経路での画像返却は保留しています。

現在のUserレコードを、`Title`、`Review state`、`Return target`、`Original`、`Clean`、`Interpreted`の6項目を持つローカルJSONとして用意します。選択されるClean／Interpretedのファイル項目には、DesktopがPNGを読めるように`localPath`も指定します。`Use Default`はCleanになります。Needs Review、状態の矛盾、ファイル欠落、不明なtargetは実行できません。

- 先にAINOTE Skillをインストールしてください。`ainote_api.py`はインストール済みSkillから検出し、同梱・ダウンロード・再配布しません。
- まず書込みなしで、選択結果と返却先を確認します。

```console
node src/cli.mjs return desktop-preview --record "user-return.json" --folder-id "<folder-id>" --folder-name "AI-no-Te"
```

- 内容を確認してから実行します。`desktop-execute`と`--execute`の両方が必要です。

```console
node src/cli.mjs return desktop-execute --record "user-return.json" --folder-id "<folder-id>" --folder-name "AI-no-Te" --execute
```

- 実際の返却には、既にApprovedになっているレコードが必要です。通常の自動確認でApprovedになった場合も、Needs Reviewを人が確認してApprovedへ変えた場合も対象にできます。
- 選んだ結果はAINOTEへ新しいノートとして作成します。Originalは上書きしません。
- 画像挿入、同期、読戻しは1回ずつ実行し、自動retryやrollbackは行いません。途中で失敗した場合や同じコマンドを繰り返した場合は、別のノートが残る可能性があります。
- 実際に書き込む前に大切なデータをバックアップし、最初は重要でないノートで試してください。
- 互換性は保証されません。確認している端末はAINOTE Air 2だけで、他の機種は未確認です。

実行前に、[公式経路の確認結果](official-skill-return.md)と[Experimental Desktop Returnの設定と制限](experimental-ainote-return.md)を読んでください。`experimental/ainote-return/`の従来コードはPoCと互換性確認用の資料として残しており、一般ユーザー向けentrypointではありません。

> Screenshot TODO: Originalが残り、新しいAINOTEノートが作成されたことを確認できる安全な画像。承認済みの画像が用意できた場合だけ、`05-ainote-return.png`を使用します。

## PDF Input

PDF Inputは、互換性確認やトラブル調査に使える、公式の書き出し方法を優先したfallbackです。一般ユーザー向けの主経路ではありません。

PDF入力は手元のファイルだけを扱います。AINOTEやNotionには接続せず、Clean／Interpretedも生成しません。AINOTEで手書きの見た目を含むPDFを書き出し、処理前にページを確認してください。対象はAINOTEのPDF書き出しです。任意のPDFがすべて使えるとは保証しません。

### Popplerを用意する

[Poppler公式サイト](https://poppler.freedesktop.org/)と各OSの配布元を確認し、信頼できる配布元から用意してください。Windowsでは対応する実行ファイルとDLL一式が必要です。リポジトリには同梱せず、自動ダウンロード、自動インストール、別の描画ツールへの切り替えも行いません。

`pdfinfo`と`pdftoppm`の両方をPATHから使えるようにします。PowerShellでは、実行ファイルの絶対パスを指定する方法もあります。

```powershell
$env:AINOTE_PDF_PDFTOPPM = 'C:\Poppler\Library\bin\pdftoppm.exe'
$env:AINOTE_PDF_PDFINFO = 'C:\Poppler\Library\bin\pdfinfo.exe'
```

これはパスの例です。自分の環境に合わせて変更してください。ツールが見つからない場合は変換前に停止します。サンプルのデモはNode.jsだけで使えますが、`npm test`にはPopplerも必要です。見つからない場合、PDFの結合テストはスキップせず失敗します。

### 確認してページを選ぶ

```console
node src/cli.mjs pdf inspect --input "note.pdf"
node src/cli.mjs pdf inspect --input "note.pdf" --json
node src/cli.mjs pdf render --input "note.pdf" --pages 2
node src/cli.mjs pdf render --input "note.pdf" --pages 2,3
node src/cli.mjs pdf render --input "note.pdf" --pages 2-5
node src/cli.mjs pdf render --input "note.pdf" --pages all --output "new-pdf-job" --json
```

実際に存在するページ番号を指定してください。inspectはファイルを変更せず、ファイル名、存在確認、SHA-256、暗号化の有無、ページ数、各ページの寸法（pt）と回転を表示します。暗号化されたPDFはinspectでも拒否し、パスワードは受け付けません。描画にはページ指定が必要です。重複した番号は一つにまとめ、元のページ順に並べます。表紙や本文を自動判定しません。

Poppler pdftoppmで、ページ全体を300 DPIのPNGにします。切り抜きや引き伸ばしは行わず、ページの回転を反映します。ファイル名には元のページ番号を使うため、2ページ目だけを選ぶと`page-002.png`になります。

`--output`を省略すると、OSの一時フォルダ内に専用フォルダを作ります。指定する場合は、親フォルダが存在する新しい保存先を指定してください。保存先がすでにある場合は、空でも拒否します。成功時の構成は次のとおりです。

```text
new-pdf-job/
  original.pdf
  metadata.json
  page-001.png
  page-002.png
```

入力PDFは上書きしません。`original.pdf`は元PDFと同じ内容のコピーで、ハッシュ値を照合します。Originalは書き出したPDF、Original page imageはそこから描画したPNGです。OCRで取り出した本文をOriginalとは呼びません。metadataのschema versionは1です。元PDFのファイル名・ハッシュ・ページ数・寸法、選択ページ、描画ツール名とバージョン、DPI、生成日時、各PNGのページ番号・ファイル名・寸法・SHA-256を記録します。状態が`complete`のmetadataがある場合だけ成功です。

出力には自分のノートが含まれます。リポジトリ外に保管してください。一時フォルダは長期保存先ではありません。元の書き出しPDFは別に残し、必要なら成功した出力を自分の非公開の保存先へコピーしてください。自動公開や、既存のNotion previewへの受け渡しは行いません。

### 制限と失敗時の対応

上限は入力512 MiB、PDF全体500ページ、1ページ1億画素、選択したページの合計5億画素です。確認・描画の子プロセスは1回120秒で打ち切ります。上限を超える場合は、書き出す量や選ぶページを減らしてください。処理中は元PDFを変更しないでください。

失敗時は`original.pdf`や一部のPNGが残ることがあります。保存先を表示し、可能なら`failure.json`を残します。未完成の出力を後続処理に使わず、手元で確認して、新しい保存先でやり直してください。既存データを自動で消したり上書きしたりしません。成功前には、入力PDFとコピーのハッシュ値を再確認します。

Windowsで確認したAINOTE Air 2の書き出しサンプルは、寸法の異なる2ページで、手書きと図を含んでいました。Poppler 26.07.0、300 DPIで描画し、同じ環境での再実行では画像のハッシュ値が一致しました。別のバージョンやOSでも一致するという保証ではありません。検証した配布物・build・関連ライブラリを固定し、チェックサムを記録して、更新時は再確認してください。生成日時と保存先は実行ごとに変わります。

PopplerはGPLライセンスの外部ツールです。再配布を検討する場合は、利用する配布物のライセンスを確認してください。MITライセンスの本リポジトリにPopplerの実行ファイルは含めません。Experimental Desktop Returnは任意機能で、別の互換性上の注意があります。

## PDF入力後にAIで処理する

[AI処理の手順](ai-processing.md)に沿って、CodexでOriginalページの文字を読み取り、結果のJSONを保存します。このOCR工程は省略しません。Cleanは手書きを活字に置き換え、配置の変更を最小限にします。Interpretedは同じ本文を使い、構成や配置をより大きく整理します。図は文字と分けて扱います。取得できない信頼度や座標はunknownのまま残し、曖昧な文字を勝手に補完しません。

```console
node src/cli.mjs process ocr --input "pdf-job/page-002.png" --extraction "extraction.json" --output "typed-job"
node src/cli.mjs process clean --job "typed-job" --attempt 1
node src/cli.mjs process interpreted --job "typed-job" --attempt 1
```

ここではOCR結果の取込みとプロンプトの準備だけを行い、AIは呼び出しません。続いて保存されたプロンプトをそのままCodexの画像編集ツールへ渡し、`process record`で結果や失敗を記録します。最後に`process finalize`で比較する試行を指定します。JSONの形式、記録コマンド、失敗時の対応はリンク先の手順にあります。1つの保存先に、元PDF・ページPNG・読取り結果と空白整理後のJSON・配置情報・生成した2枚・ハッシュ値をまとめます。サンプルのNotion previewとは別の処理です。CLIは画像を送信しませんが、Codexでの読取りと生成ではページをOpenAIへ送ります。結果は毎回同じとは限りません。User向けには、5つの例外がある場合だけHuman Reviewへ回します。このコマンドからNotionやReturnを実行することはありません。

## 処理済みjobのNotion取込内容を確認する

### 自分のNotionを用意する（userプロファイル）

1. 自分のワークスペースに、下の6項目を持つデータベースを作ります。利用権限のあるテンプレートを複製し、項目を合わせても構いません。開発者のNotionへのアクセスは不要です。公開済みのAI-no-Teテンプレートはありません。
2. 自分のワークスペース用の内部インテグレーション（接続）を作ります。[Notion公式の設定手順](https://developers.notion.com/guides/get-started/quick-start)を参照してください。
3. 接続に許可するのは、レビューに使うデータベースやページだけにします。無関係な場所へのアクセスは許可しないでください。[アクセス許可の説明](https://developers.notion.com/guides/get-started/authorization)も確認してください。
4. 認証情報は手元の環境変数または秘密情報の保管機能で管理し、`AINOTE_USER_NOTION_TOKEN`を使います。設定JSONやソース、スクリーンショット、チャットには書かないでください。今回のpreviewは認証情報を読みません。
5. `config/notion-user.example.json`を、Git管理外の`config/notion-user.local.json`へコピーします。仮のdata-source IDを自分のものへ置き換え、2か所のprofileは`user`のままにします。開発用は設定ファイルと接続を別にしてください。先に出てきた`public-alpha`設定はサンプル専用で、この6項目の設定とは別です。
6. 自分の設定を指定してpreviewを実行します。公開コマンドは手元の設定とファイルだけを検証し、`--execute`を拒否します。実環境での項目確認、送信、重複確認、読戻しは非公開の手元の環境で検証済みですが、その実行経路と認証情報は公開リポジトリに含めません。

| 必須の項目名 | Notionで選ぶ種類 | 選択肢・内容 |
|---|---|---|
| Title | タイトル | ノートの名前 |
| Original | ファイル＆メディア | 元PDFとページPNG |
| Clean | ファイル＆メディア | 活字化し、配置変更を最小限にした結果 |
| Interpreted | ファイル＆メディア | 活字化し、構成を整理した結果 |
| Review state | セレクト | Pending Review、Approved、Needs Review。Pending Reviewは一時状態 |
| Return target | セレクト | Use Default、Clean、Interpreted。最初はUse Default（初期設定はClean） |

名前と種類は表のとおりにそろえてください。6項目すべてが必須で、ほかの項目は不要です。Notionに1つだけあるタイトル列は、名前ではなく種類から判定するため、Titleへ改名する必要はありません。[項目定義のJSON](../schemas/notion-user.json)にも同じ内容を記載しています。OCRのJSON、プロンプトのハッシュ、失敗の診断情報は通常利用には不要です。[開発用の詳細](notion-profiles.md)に分けています。

```console
node src/cli.mjs process notion-preview --job "typed-job" --profile user --config config/notion-user.local.json
```

developmentプロファイルで3枚を比較する場合は、目視確認のPASSを[処理ガイド](ai-processing.md#preview-a-processed-job-for-notion-review)に沿って別ファイルへ記録します。処理済みjobと確認記録は非公開で保管してください。通常のUser向け自動確認では、このdevelopment用記録は不要です。

```console
node src/cli.mjs process notion-preview --job "typed-job"
node src/cli.mjs process notion-preview --job "typed-job" --profile user --return-target interpreted
```

user previewでは、Original、活字化した2枚、自動確認の結果、返却内容の選択を確認できます。通常はApprovedになり、5つの例外があれば短い理由とともにNeeds Reviewになります。OCRの診断情報やハッシュは表示しません。返却内容を変えるだけでは確認結果や保存済みの初期設定は変わらず、両モードが残ります。`--profile development`では別の設定を使い、Pending Reviewのまま技術的な詳細も表示します。どちらも同じハッシュを検証し、外部呼出し・書込みは0です。previewはNotionのレコードを作りません。サンプル用の`notion`送信コマンドではなく、この確認コマンドを使ってください。`--json`は手元で使う入力計画で、APIへの送信データではありません。公開しないでください。

## スクリーンショット撮影チェックリスト

機密情報を除いた画像が明示的に承認されるまで、スクリーンショットは掲載しません。撮影時は次の内容を確認してください。

| ファイル名 | 開く画面 | 画像に含める内容 | 隠す内容 | 推奨する切り抜き範囲 |
|---|---|---|---|---|
| `01-offline-preview.png` | サンプルpreview実行後のターミナル | dry-run表示、送信先、Select All、3/3、Pending Review | プロンプトのパス、ユーザー名、無関係なウィンドウ | コマンドとpreview全体 |
| `02-note-selection.png` | 部分選択コマンド実行後のターミナル | Select All OFF、2/3、選択／未選択のノート、送信先override | プロンプトのパス、ユーザー名、識別情報 | Destination、Notes、Operation |
| `03-return-mode.png` | 同じ安全な部分選択preview | Use Default (Clean)、Override → Interpreted | プロンプトのパス、ユーザー名、無関係な出力 | 選択したノートの行周辺 |
| `04-notion-review.png` | 機密情報を除いたNotionレコード | Original、Clean、Interpreted、ApprovedまたはNeeds Review | アカウント情報、メール、ワークスペース名、URL、データソースID、token、実際のノート | サンプルレコードの項目だけ |
| `05-ainote-return.png` | 重要でないノートを使った安全なAINOTE結果 | 新しいノートとOriginalが残っていること | 非公開ノート、アカウント／端末識別情報、シリアル番号、ローカルパス | 必要な確認内容だけ |

個人のノート、実際のアカウント識別情報、メールアドレス、端末のシリアル番号、token、ローカルパス、非公開のNotion ID、運営元との非公開メッセージ、開発用のdebug画面は使用しないでください。安全な画像を用意できない場合は、Screenshot TODOを残します。
