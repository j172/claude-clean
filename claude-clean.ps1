# claude-clean.ps1 — 一鍵清理本機 Claude Code session（說明見同資料夾 README.md）
#   & "$HOME\.claude\tools\claude-clean\claude-clean.ps1"            直接執行
#   & "$HOME\.claude\tools\claude-clean\claude-clean.ps1" --dry-run  只列出會做什麼，不停、不刪
node (Join-Path $PSScriptRoot 'claude-clean.mjs') @args
exit $LASTEXITCODE
