#!/usr/bin/env bash
# claude-clean.sh — 一鍵清理本機 Claude Code session（說明見同資料夾 README.md）
#   bash ~/.claude/tools/claude-clean/claude-clean.sh            直接執行：停掉殘留／重複的 session，刪掉已結束 session 的對話紀錄
#   bash ~/.claude/tools/claude-clean/claude-clean.sh --dry-run  只列出會做什麼，不停、不刪
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/claude-clean.mjs" "$@"
