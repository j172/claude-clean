# claude-clean

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)](#)
[![Node.js ≥ 18](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-session%20cleanup-D97757?logo=anthropic&logoColor=white)](https://docs.claude.com/en/docs/claude-code/overview)
[![PowerShell](https://img.shields.io/badge/PowerShell-ready-5391FE?logo=powershell&logoColor=white)](#一行指令)
[![Bash](https://img.shields.io/badge/Bash-ready-4EAA25?logo=gnubash&logoColor=white)](#一行指令)
[![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=black)](claude-clean.mjs)
[![No dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#)
[![Last commit](https://img.shields.io/github/last-commit/j172/claude-clean)](https://github.com/j172/claude-clean/commits/main)
[![Repo size](https://img.shields.io/github/repo-size/j172/claude-clean)](https://github.com/j172/claude-clean)
[![GitHub stars](https://img.shields.io/github/stars/j172/claude-clean?style=social)](https://github.com/j172/claude-clean/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/j172/claude-clean)](https://github.com/j172/claude-clean/issues)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/j172/claude-clean/pulls)
[![正體中文](https://img.shields.io/badge/docs-%E6%AD%A3%E9%AB%94%E4%B8%AD%E6%96%87-blue)](#)

> **English:** One command to clean up local Claude Code sessions on Windows. It stops orphaned or duplicate `claude.exe` processes (using the `~/.claude/sessions/<PID>.json` registry), deletes transcripts of sessions that have ended, and always keeps each project's `memory/` and every live session. Run `node ~/.claude/tools/claude-clean/claude-clean.mjs --dry-run` first to preview. Zero dependencies; Node.js 18+.

一鍵清理 Windows 本機的 Claude Code session：停掉殘留或重複的 `claude.exe`，刪掉已經結束的 session 留下的對話紀錄，並保留記憶檔和執行中的 session。

> 刪掉舊的對話紀錄只會省**硬碟空間**，不會省 token。吃 token 的是還開著、對話很長的 session；要省 token，就讓它交接後重開。

需求：Windows、Node.js 18 以上、Claude Code。

## 安裝

```powershell
git clone https://github.com/j172/claude-clean "$HOME\.claude\tools\claude-clean"
```

## 一行指令

| 在哪裡執行 | 直接執行 | 只看不做 |
|---|---|---|
| Claude Code 輸入框 | `! node ~/.claude/tools/claude-clean/claude-clean.mjs` | 後面加 ` --dry-run` |
| PowerShell | `node "$HOME\.claude\tools\claude-clean\claude-clean.mjs"` | 後面加 ` --dry-run` |
| Git Bash | `bash ~/.claude/tools/claude-clean/claude-clean.sh` | 後面加 ` --dry-run` |

- 開頭的 `!` 表示直接在本機執行，不經過 Claude。這一行要**單獨**送出，跟其他文字放在同一則訊息就不會執行。
- 也可以在 PowerShell 用 `& "$HOME\.claude\tools\claude-clean\claude-clean.ps1"`，效果相同。

## 它會做什麼

1. **列出執行中的 session**：名稱、PID、專案資料夾、啟動時間；從 Claude Code 裡執行時，會標出「← 本視窗」。
   資料來源是 `~/.claude/sessions/<PID>.json`，每個執行中的 session 都會有一份。
2. **停掉該停的 `claude.exe`**（用 `taskkill /T /F`），依序判斷：
   - **名稱含 `DELETE` 的 session（最優先）**：想關哪個視窗，就先把它改名成例如「PG1 DELETE」（不分大小寫），再跑一次這個工具；
   - 沒有登記檔的殘留程序，例如視窗重開後留下的舊程序；
   - 同名重複的 session，只留最新開的那個（忘了加 DELETE 時的保險）。
   - **永遠不碰**：Chrome 擴充功能的 Claude Code、執行這個指令的 session 本身。
   - **不在名冊上、而且閒置的 session**（選用，需要 `roster.txt`）：在本資料夾放一個 `roster.txt`，每行一個正式 session 名稱（範例見 `roster.example.txt`，`roster.txt` 不進 git）。不在名冊上的 session，只要**已經開超過 2 小時、而且 30 分鐘內沒有任何對話紀錄寫入**，就會自動停掉；剛開的或還在動的只列出、先保留。
3. **刪掉該刪的檔案**：
   - `~/.claude/projects/<專案>/` 中，對應 session **已經不在執行**的對話紀錄 `<id>.jsonl` 和同名資料夾；
   - TokenEconomizer 留下的空 `te-side` 資料夾；
   - `~/.claude/sessions/` 裡已經結束的 PID 登記檔。
4. **永遠保留**：
   - 每個專案的 `memory/`；
   - 執行中 session 的對話紀錄；
   - 10 分鐘內剛寫入的紀錄，下次執行再清。
5. **結果**：印在畫面上，同時附加到本資料夾的 `claude-clean.log`（不進 git）。

## 注意

- 被停掉的 session 如果正在工作，手上的工作會中斷。不確定時先跑 `--dry-run`，看「要停的程序」有哪些。
- 刪掉的對話紀錄**救不回來**，`claude --resume` 也找不到了。記憶檔不受影響。
- 從 PowerShell 或 Git Bash 執行時，沒有「本視窗」可以排除。正常的 session 都有登記檔、名稱也不重複，不會被停掉。
- Claude Code 內建自動清理：在 `~/.claude/settings.json` 設 `"cleanupPeriodDays": 7`，7 天前的舊紀錄會自動刪除，平常不跑這支也沒關係。
- Claude Code 官方的 `claude project purge` 會**連 `memory/` 一起刪**，跟這支不同。

## 授權

[MIT](LICENSE) © 2026 j172.tw
