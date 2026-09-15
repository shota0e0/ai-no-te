# アイノテ - AI-no-Te -

[English](README.md)

## プロジェクト概要

AINOTEで自由に書いたノートをAIで整え、Notionで確認し、選んだ結果をAINOTEへ戻します。

AI-no-Teは、この流れを試すための独立した実験プロジェクトです。

元のノート（Original）は必ず残します。AIが作った内容で上書きすることはありません。

**AI-no-Teは非公式プロジェクトです。AINOTEやNotionの公式製品ではありません。各サービスの運営元が開発・提供・サポートするものではなく、提携や公認も受けていません。**

## なぜ作ったのか

AIを使ってノートを整理すると、元の内容とAIが作った結果が混ざりやすくなります。何を送るのか、どの結果を採用するのか、誰が確認したのかも分かりにくくなりがちです。

AI-no-Teでは、元のノート、AIが整えた結果、人が確認した結果を分けて扱います。認証情報や自分のノートを用意しなくても、付属のサンプルデータだけで操作の流れを試せます。

「アイノテ」という名前には、人の思考を主役にしたままAIが「合の手」を入れることと、「AIの手」として作業を支えること、という二つの意味を込めています。

AI-no-Teは、AINOTEとは別に開発している非公式プロジェクトです。

## ワークフロー

```text
元のノート（Original）
  -> CleanまたはInterpretedの候補
  -> Pending Review
  -> Human Reviewで確認・承認
  -> 必要に応じてExperimental AINOTE Return
```

## 基本方針

- **元のノートを必ず残します。** AIが作った結果でOriginalを置き換えません。
- **AIの結果は人が確認します。** CleanまたはInterpretedを選ぶだけでは承認になりません。
- **初期状態では外部へ書き込みません。** 通常の機能はdry-runで動き、Experimental AINOTE Returnも、実際のAINOTEへ接続せずに内容を確認できます。
- **画面に機密情報を出しません。** 通常の表示には認証情報や内部の送信先IDを含めません。
- **実験機能は通常の機能から分けています。** 特定のバージョンに依存する処理は`experimental/`以下にまとめています。

## デモ

次のコマンドで、接続や書き込みを行わないデモを実行できます。

```console
npm run demo
```

リポジトリ内の画像は、検証用に作ったサンプルです。

| Original | Clean | Interpreted |
|---|---|---|
| ![検証用のOriginal](fixtures/public-alpha-v0.1/original.svg) | ![検証用のClean](fixtures/public-alpha-v0.1/clean.svg) | ![検証用のInterpreted](fixtures/public-alpha-v0.1/interpreted.svg) |

Cleanの余白調整は、[調整前](fixtures/public-alpha-v0.1/clean-before.svg)と[調整後](fixtures/public-alpha-v0.1/clean.svg)で比較できます。これらのSVGは、基本図形を使って本リポジトリ用に作成しました。手書きの内容、個人のノート、スクリーンショット、本番アカウントのデータ、AI生成画像は含まれていません。

## Public Alphaでできること

通常の機能（Public Core）では、次の内容を試せます。

- Original／Clean／Interpretedのサンプルと、ファイルが変わっていないことを確かめるための情報
- 同じ入力から同じ結果を作るCleanの余白調整
- ノートの選択とSelect All
- ノートごとの返却内容の指定
- レビュー状態の管理
- 外部へ接続せずに使えるCLIと、取り込み前の内容確認
- 明示的に実行しない限りdry-runで動くNotion連携

OCR、画像の領域分割、AIによる画像生成、AINOTEからの実データ取得、自動承認、大規模なGUI、AINOTE Returnの互換性保証は含まれていません。

公開するファイルは、`public-files.json`の`PUBLIC`欄で指定しています。この一覧にないファイルは公開対象ではありません。

## CleanとInterpreted

- **Clean**は、元の内容をなるべく変えずに、見た目や余白を整えます。
- **Interpreted**は、元の内容をもとにAIが一歩踏み込んで整理します。

初期設定はCleanです。必要なノートだけInterpretedに変えられます。ただし、どちらを選んでもHuman Reviewと承認が必要です。

## インストール

通常の機能を動かすには、次の環境が必要です。

- Node.js 20以上
- Windows 10/11、macOS、Linux

リポジトリをクローンしたら、次のコマンドを実行します。

```console
npm install --ignore-scripts
npm run demo
npm test
npm run validate:public
```

Public Alpha v0.1には、実行時に使う外部npmパッケージはありません。

## 設定

`config/public-alpha.example.json`を、`config/*.local.json`形式のファイルへコピーします。この形式のファイルはGitの管理対象外です。送信先に入っている仮の値は手元の環境に合わせて変更し、認証情報は書き込まないでください。

普段使う返却内容とNotionの送信先を保存できます。

```console
node src/cli.mjs preferences --config config/public-alpha.local.json --set-return-mode clean
node src/cli.mjs preferences --config config/public-alpha.local.json --set-destination project-a
```

保存した設定は、機密情報を伏せた状態で確認できます。

```console
node src/cli.mjs preferences --config config/public-alpha.local.json
```

送信先の別名と表示名は画面に出ることがありますが、NotionのデータソースIDや認証情報は表示しません。

## dry-runで試す

外部へ書き込まずに、取り込む内容を確認します。

```console
node src/cli.mjs notion --config config/public-alpha.local.json
```

画面の先頭には`DRY RUN — NO EXTERNAL WRITE`と表示されます。送信先、Select Allの状態、選択したノート数、各ノートの返却内容、Pending Reviewとして行う処理を確認できます。それぞれの設定が初期値なのか個別指定なのかも表示します。

実際のサービスへ接続せずに試す場合は、3件のサンプルデータを使います。

```console
node src/cli.mjs notion --config config/public-alpha.example.json --synthetic-preview
```

`--json`を付けると、プログラムで扱いやすい形式で出力できます。サンプルデータを使った状態では外部へ書き込めません。

## Notion連携

Notionへの書き込みは任意です。実際に書き込むには、次の条件をすべて満たす必要があります。

- `--execute`を付ける
- 設定ファイルの仮の値を実際の値へ変更する
- 指定した環境変数から認証情報を渡す
- 有効な送信先を選ぶ
- ノートを1件以上選ぶ

```console
node src/cli.mjs notion --config config/public-alpha.local.json --execute
```

実行前に、送信先名、選択したノート数、処理内容、返却内容を表示します。Notion側の項目を確認し、Originalのハッシュ値がすでに登録されている場合は処理を中止します。作成するのはPending Reviewのレコードだけです。処理後もPending Reviewのままであることを確認し、Approvedへ変更することはありません。

## Experimental AINOTE Return

`experimental/ainote-return/`には、Human Reviewで承認したCleanまたはInterpretedの結果を使い、AINOTEにノートを新規作成する機能があります。

この機能は非公式で、まだ実験段階です。特定のバージョンに依存しており、AINOTE公式のサポート対象外です。公開されていないAINOTEの動作に依存しているため、AINOTEの更新後に動かなくなる可能性があります。公式のAINOTE APIではなく、互換性は保証されません。AINOTEによる公認や提携はなく、公式サポートを受けた機能でもありません。

実際に書き込むには、`--execute`を付ける必要があります。引数を付けずに起動した場合は、外部へ接続せずに内容だけを確認します。実行するには、Human Reviewで承認済みの対象が1件だけ存在している必要があります。返却結果は別のノートとして作成し、Originalは上書きしません。

AI-no-Teは独立した実験プロジェクトです。この仕組みはAINOTEチームにも共有していますが、非公開のメッセージや、運営元との非公開のやり取りは転載していません。

この機能を動かすには、外部の`ainote_api.py`補助スクリプトが必要です。再配布できるか確認が取れていないため、このリポジトリへの同梱、コピー、自動取得、再配布は行いません。利用できるファイルを各自で用意し、入手元とライセンスを確認してから、`AINOTE_API_HELPER`にファイルパスを設定してください。ファイルが見つからない場合や読み取れない場合は、AINOTEへ書き込む前にエラーで停止します。

詳しい設定と制限は、[Experimental AINOTE Returnの説明](docs/experimental-ainote-return.md)を参照してください。

### Experimental AINOTE Returnを使う前に

Experimental AINOTE Returnは、公開されていないAINOTEの動作を使う実験機能です。AINOTEの更新などにより、突然動かなくなったり、想定と異なる結果になったりする可能性があります。

実際のAINOTEへ書き込む前に、必要なデータをバックアップしてください。最初は重要でないノートを使い、自分の環境で問題なく動くことを確認してください。

AI-no-Teは、AINOTE本体や端末での動作、保存データの完全性、将来の互換性を保証しません。内容を確認したうえで、各自の判断で利用してください。

## セキュリティとプライバシー

- 認証情報、`.env`、手元の設定、個人のファイルパス、非公開の識別情報、実際のノート内容、運営元との非公開のやり取りはコミットしないでください。
- 公開するサンプルはすべて架空のデータです。実際のAINOTEやNotionのデータは必要ありません。
- 通常の画面には、認証情報やNotionのデータソースIDを表示しません。
- 補助スクリプトには、動作に必要な環境変数だけを渡します。Notionの認証情報は渡しません。
- 初期状態では、通常の機能もExperimental AINOTE Returnも外部へ書き込みません。
- 返却内容を選ぶことと、Human Reviewで承認することは別です。
- Originalは残したままにし、このリポジトリの処理で上書きすることはありません。

公開前に[公開チェックリスト](docs/publication-checklist.md)を確認してください。

## 対応・検証環境

| 項目 | 確認している範囲 |
|---|---|
| 通常の機能を動かせるOS | Windows 10/11、macOS、Linux |
| Experimental AINOTE Return用PowerShellスクリプト | Windows 10/11のみ |
| Node.js | 20以上 |
| Notion APIのバージョン | `2026-03-11` |
| Experimental AINOTE Return用Python | 手元で実行できるPythonが必要。検証した正確なバージョンは未確認 |
| AINOTE Desktop | 対応を確認できた正確なバージョンは、公開可能な記録では未確認 |
| AINOTE端末 | AINOTE Air 2で確認。他の機種では未確認 |
| 外部の補助スクリプト | 対応バージョン、入手元、ライセンスは未確認。利用者が用意したものだけを使用 |

確認できていないバージョンは推測せず、未確認と記載しています。Experimental AINOTE Returnを使う場合は、自分の環境で使っているバージョンを記録し、事前に動作を確認してください。

## 既知の制限

- Public Alphaは動作例を示すもので、本番サービスではありません。今後も同じように動くことを保証するものではありません。
- Experimental AINOTE Returnは、公開されていないローカル通信や保存形式を前提にしています。
- AINOTEの更新によって、データ構造、通信方法、同期処理、ローカルファイルが変わる可能性があります。
- 対応する補助スクリプトを用意し、自分の環境で動作確認をしなければ、同じ手順を再現できません。
- 公式の返却方法が利用できるようになった場合は、実験機能から切り替える予定です。

## ロードマップ

- 実際のサービスへ接続せずに試せる状態を保つ。
- Originalを必ず残し、初期状態をPending Reviewに保つ。
- 個人データを公開せず、ほかの環境でも再現できる動作記録を集める。
- 記録したバージョンごとにExperimental AINOTE Returnを確認する。
- 公式のAINOTE返却方法が利用できるようになった場合は、そちらを優先する。

## ライセンス

本リポジトリで作成したコードとドキュメントはMIT Licenseで提供します。サンプルデータには、`metadata.json`に記載したCC0-1.0の権利放棄が適用されます。外部の補助スクリプトのライセンスと再配布条件は、利用者自身で確認してください。

AI-no-Teは、そのライセンスや再配布権を主張しません。
