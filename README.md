# Paper Inbox（PoC）

紙の書類・手書きメモを、再実行可能なパイプラインでデジタル化するためのNode.js + TypeScript CLIです。現在のPoCは、画像をページ単位でローカルOCRし、JSONキャッシュを作成し、成功した原本だけをアーカイブします。

## PoCの範囲

```text
~/.paper-inbox/inbox/
  ↓ 入力列挙（jpg / jpeg / png / heic / heif / pdf）
  ↓ Queue（既定 concurrency 4）
  ↓ OCR（Apple Vision / macOS）
~/.paper-inbox/cache/*.json
  ↓ OCR成功時のみ
~/.paper-inbox/archive/YYYY-MM-DD/
```

1枚ごとにcacheを書き込むため、途中停止後に再実行できます。有効なcacheがあるページはOCRをスキップします。OCRに失敗した画像は`inbox`に残ります。

このリポジトリには原本画像、OCR結果、途中成果物、個人用Daily Logを保存しません。runtime dataはGit working treeの外にある`~/.paper-inbox`（または`PAPER_INBOX_HOME`）へ置きます。原本画像をGitHubへcommitする機能もありません。

## セットアップ

必要環境：Node.js 20以上、npm、macOSのSwift toolchain、HEICを扱う場合はImageMagick（HEIC delegate付き）。Tesseractを使う場合はTesseract OCRと日本語traineddataも必要です。

macOS（Homebrew）の例：

```bash
brew install tesseract
brew install tesseract-lang
brew install imagemagick
npm install
npm run build
```

実行環境で`tesseract --list-langs`を実行し、`jpn`と`eng`が表示されることを確認してください。Tesseractが未導入の場合、CLIは各画像を失敗として記録し、全体は停止しません。

## CLI

```bash
npx paper-inbox process
npx paper-inbox process --concurrency 4
npx paper-inbox process --force
npx paper-inbox process --runtime-dir /path/to/runtime --lang jpn+eng
npx paper-inbox process --ocr tesseract
npx paper-inbox process --inbox "$HOME/Library/CloudStorage/GoogleDrive-ACCOUNT/My Drive/Paper Inbox" --originals "$(pwd)/originals" --results "$(pwd)/ocr-results"
npm run process -- process --inbox "/path/to/PaperInbox" --force
npm run watch -- --inbox "/path/to/PaperInbox"
npm run classify -- --results ./ocr-results
npm run install:launch-agent
```

`--force`はcacheを無視してOCRします。`--ocr apple-vision`（既定）はmacOSのApple Visionを使い、VisionのRevision 3（回転・手書き認識を改善）と高精度モードで手書きメモを読み取ります。日本語・英語の候補を指定しつつ、自動言語検出も有効にしています。`--ocr tesseract`は印刷文字向けの代替Providerです。`--inbox`または`PAPER_INBOX_INBOX`で入力フォルダを変更できます。`--originals`または`PAPER_INBOX_ORIGINALS`で処理済み原本の保存先を変更できます。既定の保存先はプロジェクト内の`originals/`です。`--results`または`PAPER_INBOX_RESULTS`でOCR結果の保存先を変更できます。既定の保存先はプロジェクト内の`ocr-results/`です。これら2つのフォルダはGit管理対象外です。Google Drive for desktopを使う場合は、Google Drive内の`PaperInbox`フォルダを入力先に指定します。PDFはページごとにOCRし、ページ間を空行で連結します。処理対象は入力フォルダ直下の`.jpg`、`.jpeg`、`.png`、`.heic`、`.heif`、`.pdf`です。HEIC/HEIFはImageMagickでOCR用の一時JPEGへ自動変換し、原本は変換せず`originals/`へ移動します。変換ファイルは処理後に削除します。
`watch`は起動時に既存ファイルを処理し、その後`PaperInbox`への新規ファイル追加を監視します。Google Driveの同期途中に処理しないよう、ファイルサイズが安定するまで待機します。終了は`Ctrl-C`です。
`npm run install:launch-agent`を一度実行すると、macOSログイン時に監視を自動起動し、ファイルイベントに加えて15秒ごとの再スキャンも行います。処理成功・失敗はmacOS通知センターに通知します。標準ログは`~/Library/Logs/PaperInbox/`です。Google Driveの場所が異なる場合は、実行前に`PAPER_INBOX_INBOX=/path/to/PaperInbox npm run install:launch-agent`を指定します。LaunchAgent停止は`launchctl bootout gui/$(id -u)/com.paper-inbox.watch`です。
LaunchAgentの既定OCRはTesseractです（PDFはページ画像へ変換して処理します）。Apple Visionを使う場合は`PAPER_INBOX_OCR=apple-vision npm run install:launch-agent`を指定してください。

OCR JSONは処理後に、本文中の行単位の日付（`20260901`、`20260901 2`、`2026.09.01`など）で自動分類します。分類結果は`ocr-results/by-date/YYYYMMDD/<source>-NNN.json`に保存され、元のOCR JSONは変更しません。既存JSONを再分類する場合は`npm run classify -- --results ./ocr-results`を実行します。日付が見つからないJSONは`by-date/_undated/`に保存されます。

ログにはページごとの`success`、`cached`、`failed`と最終集計を表示します。1枚の失敗は残りの処理を止めません。

## runtime data

```text
~/.paper-inbox/
├── inbox/    未処理画像（既定入力を使う場合）
└── work/     OCR用一時変換ファイルやSwiftヘルパー
```

プロジェクト内の原本保存先：

```text
originals/YYYY-MM-DD/
```

`originals/`は`.gitignore`で除外されます。

プロジェクト内のOCR結果保存先：

```text
ocr-results/<source>.json
```

`ocr-results/`も`.gitignore`で除外されます。

OCR結果にはsource、sourceHash、text、processedAt、sourceDateなどを保存します。sourceHashで画像変更を検知するため、同名ファイルを差し替えても古い結果を再利用しません。sourceDateと、将来文書から抽出するtargetDateは別の概念です。現PoCではtargetDateの抽出は行いません。

## 境界と将来設計

OCRは`OcrProvider`インターフェース越しに呼び出しており、Apple Visionを主Provider、Tesseractを副Providerとして交換できます。Apple VisionのSwiftヘルパーは初回実行時に`work/`へビルドされます。将来の構造化処理は`StructuredDocument`を生成し、`OutputProvider`へ渡す想定です。`PathResolver`はドキュメントを保存先のどこへ配置するかだけを決めます。

したがって、保存先（Local / GitHub / S3 / WebDAVなど）とパス決定（日付 / カテゴリ / テンプレートなど）は分離します。`daily-log`、GitHub API、特定のディレクトリ構造はコアにハードコードしていません。今回のPoCでは実際のOutputProviderやMarkdown生成は実装しません。

## テストと制約

```bash
npm test
```

テストは画像列挙、非画像除外、HEIC前処理、cache利用、OCR成功時のみarchive、失敗継続、mock可能なOCR境界を確認します。HEIC変換はImageMagickのHEIC delegateに依存します。実OCRの精度・速度・メモリは、実画像とTesseract導入後に別途検証してください。

## ロードマップ

1. 隣接ページから文書境界を判定
2. 文書構造を解析し`StructuredDocument`（title / content / targetDate / category / sourcePages）を生成
3. Markdown変換とLocal OutputProvider
4. GitHubOutputProvider + 実際のdaily-logを確認したDailyLogPathResolver
5. S3、WebDAV、その他のOutputProviderとTemplate PathResolver
# paper-index
