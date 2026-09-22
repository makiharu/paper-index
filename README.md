# Paper Inbox（PoC）

紙の書類・手書きメモを、再実行可能なパイプラインでデジタル化するためのNode.js + TypeScript CLIです。現在のPoCは、画像をページ単位でローカルOCRし、JSONキャッシュを作成し、成功した原本だけをアーカイブします。

## PoCの範囲

```text
~/.paper-inbox/inbox/
  ↓ 画像列挙（jpg / jpeg / png / heic / heif）
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
```

`--force`はcacheを無視してOCRします。`--ocr apple-vision`（既定）はmacOSのApple Visionを使い、VisionのRevision 3（回転・手書き認識を改善）と高精度モードで手書きメモを読み取ります。日本語・英語の候補を指定しつつ、自動言語検出も有効にしています。`--ocr tesseract`は印刷文字向けの代替Providerです。PAPER_INBOX_HOMEでruntime directory、`PAPER_INBOX_OCR_LANG`でTesseractの既定OCR言語を変更できます。処理対象は`inbox`直下の`.jpg`、`.jpeg`、`.png`、`.heic`、`.heif`です。HEIC/HEIFはImageMagickでOCR用の一時JPEGへ自動変換し、原本は変換せずarchiveへ移動します。変換ファイルは処理後に削除します。

ログにはページごとの`success`、`cached`、`failed`と最終集計を表示します。1枚の失敗は残りの処理を止めません。

## runtime data

```text
~/.paper-inbox/
├── inbox/    未処理画像
├── archive/  処理済み原本画像（YYYY-MM-DD単位）
├── cache/    ページ単位OCR JSON
└── work/     OCR用一時変換ファイルや将来の解析途中成果物
```

cacheにはsource、sourceHash、text、processedAt、sourceDateなどを保存します。sourceHashで画像変更を検知するため、同名ファイルを差し替えても古いcacheを再利用しません。sourceDateと、将来文書から抽出するtargetDateは別の概念です。現PoCではtargetDateの抽出は行いません。

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
