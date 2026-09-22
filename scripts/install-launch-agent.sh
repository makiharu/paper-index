#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$PROJECT_DIR/launchd/com.paper-inbox.watch.plist.template"
LABEL="com.paper-inbox.watch"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENT_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/PaperInbox"
NODE_BIN="$(command -v node)"
ENTRYPOINT="$PROJECT_DIR/dist/src/cli/index.js"
DRIVE_ROOT="$(find "$HOME/Library/CloudStorage" -maxdepth 1 -type d -name 'GoogleDrive-*' -print -quit)"
DEFAULT_INBOX="$DRIVE_ROOT/マイドライブ/0_dev/PaperInbox"
INBOX="${PAPER_INBOX_INBOX:-$DEFAULT_INBOX}"
ORIGINALS="${PAPER_INBOX_ORIGINALS:-$PROJECT_DIR/originals}"
RESULTS="${PAPER_INBOX_RESULTS:-$PROJECT_DIR/ocr-results}"
RUNTIME="${PAPER_INBOX_HOME:-$HOME/.paper-inbox}"
OCR="${PAPER_INBOX_OCR:-tesseract}"
PDFTOPPM_DIR="${PAPER_INBOX_PDFTOPPM_DIR:-$(dirname "$(command -v pdftoppm 2>/dev/null || echo /usr/local/bin/pdftoppm)")}"
PATH_VALUE="${PAPER_INBOX_PATH:-$PDFTOPPM_DIR:/usr/local/bin:/usr/local/opt/poppler/bin:/opt/homebrew/bin:/usr/bin:/bin}"

if [[ -z "$DRIVE_ROOT" && -z "${PAPER_INBOX_INBOX:-}" ]]; then
  print -u2 "Google Drive folder was not found. Set PAPER_INBOX_INBOX and retry."
  exit 1
fi

npm --prefix "$PROJECT_DIR" run build
mkdir -p "$AGENT_DIR" "$LOG_DIR" "$ORIGINALS" "$RESULTS" "$RUNTIME"

sed \
  -e "s|__NODE__|${NODE_BIN}|g" \
  -e "s|__ENTRYPOINT__|${ENTRYPOINT}|g" \
  -e "s|__INBOX__|${INBOX}|g" \
  -e "s|__ORIGINALS__|${ORIGINALS}|g" \
  -e "s|__RESULTS__|${RESULTS}|g" \
  -e "s|__RUNTIME__|${RUNTIME}|g" \
  -e "s|__OCR__|${OCR}|g" \
  -e "s|__PATH__|${PATH_VALUE}|g" \
  -e "s|__PROJECT__|${PROJECT_DIR}|g" \
  -e "s|__LOG_DIR__|${LOG_DIR}|g" \
  "$TEMPLATE" > "$PLIST"

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
print "Installed and started $LABEL"
print "Watching: $INBOX"
print "Log: $LOG_DIR/paper-inbox.log"
