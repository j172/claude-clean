// claude-clean.mjs — 一鍵清理本機 Claude Code session（Windows）
//
// 做三件事：
//   1. 停掉「該停的」claude.exe（依序判斷；另有：不在 roster.txt 名冊、已開超過 2 小時且閒置 30 分鐘的也會停）：
//      0. 名稱含 DELETE（不分大小寫）的 session：使用者用改名標記要關，最優先
//      a. 沒有登記檔（~/.claude/sessions/<PID>.json）的殘留程序
//      b. 同名重複的 session，只留最新開的那個
//      永遠不碰：Chrome 擴充功能的 Claude Code、執行本工具的 session 自己。
//   2. 刪掉「該刪的」檔案：
//      a. ~/.claude/projects/<專案>/ 底下，對應 session 已經不在執行的對話紀錄 <id>.jsonl 與同名資料夾
//         （10 分鐘內剛寫入的先不刪，下次再清；每個專案的 memory/ 永遠保留）
//      b. TokenEconomizer 留下、裡面沒有檔案的 te-side 空資料夾
//      c. ~/.claude/sessions/ 裡已經結束的 PID 登記檔（<PID>.json 與 <PID>.*.key）
//   3. 把結果印出來，並附加到本工具資料夾的 claude-clean.log
//
// 用法（也可經由 claude-clean.sh／claude-clean.ps1 呼叫）：
//   node claude-clean.mjs            直接執行
//   node claude-clean.mjs --dry-run  只列出會做什麼，不停程序、不刪檔

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry-run');
const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const PROJECTS = path.join(CLAUDE, 'projects');
const SESSIONS = path.join(CLAUDE, 'sessions');
const LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude-clean.log');
const RECENT_MS = 10 * 60 * 1000;

const out = [];
const say = (s = '') => { out.push(s); console.log(s); };

// ---- 讀取所有程序（PID、父 PID、名稱）----
function listProcesses() {
  const ps = 'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | ForEach-Object { "{0}|{1}|{2}" -f $_.ProcessId,$_.ParentProcessId,$_.Name }';
  const txt = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const map = new Map();
  for (const line of txt.split(/\r?\n/)) {
    const [pid, ppid, name] = line.split('|');
    if (pid && name) map.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), name: name.trim() });
  }
  return map;
}

// ---- 讀取 session 登記檔 ----
function readRegistry() {
  const reg = [];
  if (!fs.existsSync(SESSIONS)) return reg;
  for (const f of fs.readdirSync(SESSIONS)) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(SESSIONS, f), 'utf8'));
      reg.push({ file: f, pid: Number(j.pid), sessionId: j.sessionId, name: j.name || '(未命名)', cwd: j.cwd || '', startedAt: Number(j.startedAt) || 0 });
    } catch { /* 壞掉的登記檔略過 */ }
  }
  return reg;
}

const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('zh-TW', { hour12: false }) : '-');
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
function sizeOf(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    let t = 0;
    for (const e of fs.readdirSync(p)) t += sizeOf(path.join(p, e));
    return t;
  } catch { return 0; }
}
function hasFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile()) return true;
    if (e.isDirectory() && hasFiles(path.join(dir, e.name))) return true;
  }
  return false;
}

say(`=== claude-clean ${DRY ? '（--dry-run：只列出，不執行）' : ''} ${new Date().toLocaleString('zh-TW', { hour12: false })} ===`);

// ---- 1. 找出該停的 claude.exe ----
const procs = listProcesses();
const claudes = [...procs.values()].filter((p) => p.name.toLowerCase() === 'claude.exe');
// 上層程序中有 Chrome（擴充功能的 Claude Code 是 chrome.exe → cmd.exe → claude.exe）
const underChrome = (p) => {
  for (let cur = procs.get(p.ppid), i = 0; cur && i < 6; cur = procs.get(cur.ppid), i++) {
    if (cur.name.toLowerCase() === 'chrome.exe') return true;
  }
  return false;
};

// 自己：優先用 Claude Code 設定的 CLAUDE_PID，否則從本程序往上找第一個 claude.exe
let selfPid = Number(process.env.CLAUDE_PID) || 0;
for (let cur = procs.get(process.pid), i = 0; !selfPid && cur && i < 20; cur = procs.get(cur.ppid), i++) {
  if (cur.name.toLowerCase() === 'claude.exe') { selfPid = cur.pid; break; }
}

const reg = readRegistry();
const regByPid = new Map(reg.map((r) => [r.pid, r]));
const alivePids = new Set(claudes.map((p) => p.pid));
const aliveReg = reg.filter((r) => alivePids.has(r.pid));

const toStop = [];
const stopSet = new Set();
const addStop = (pid, name, why) => { if (!stopSet.has(pid)) { stopSet.add(pid); toStop.push({ pid, name, why }); } };
// 0. 名稱含 DELETE（不分大小寫）：使用者用改名標記「這個要關」，優先處理
for (const r of aliveReg) {
  if (r.pid === selfPid) continue;
  if (/delete/i.test(r.name)) addStop(r.pid, r.name, '名稱含 DELETE（使用者標記要關）');
}
// a. 沒有登記檔的殘留程序
for (const p of claudes) {
  if (p.pid === selfPid) continue;
  if (underChrome(p)) continue; // Chrome 擴充功能，不碰
  if (!regByPid.has(p.pid)) addStop(p.pid, '-', '沒有登記檔（殘留程序）');
}
// b. 同名重複：保留最新開的
const byName = new Map();
for (const r of aliveReg) {
  if (stopSet.has(r.pid)) continue; // 已因 DELETE 標記要停的，不參與同名比較
  const k = r.name.toLowerCase();
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(r);
}
for (const list of byName.values()) {
  if (list.length < 2) continue;
  list.sort((a, b) => b.startedAt - a.startedAt);
  for (const r of list.slice(1)) {
    if (r.pid === selfPid) continue;
    addStop(r.pid, r.name, `同名重複，保留較新的 PID ${list[0].pid}`);
  }
}

say('');
say('--- 執行中的 session（名稱 / PID / 專案 / 啟動時間）---');
for (const r of aliveReg.sort((a, b) => a.name.localeCompare(b.name))) {
  say(`  ${r.name.padEnd(16)} ${String(r.pid).padStart(6)}  ${r.cwd}  ${fmtTime(r.startedAt)}${r.pid === selfPid ? '  ← 本視窗' : ''}`);
}
// 名冊：同資料夾 roster.txt（每行一個正式 session 名稱，# 開頭為註解）。
// 不在名冊上的 session：開了超過 2 小時、而且 30 分鐘內沒有任何對話紀錄寫入（閒置）→ 自動停。
// 剛開的或還在動的只列出、不停，避免誤停新開還沒命名的視窗。
const ROSTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'roster.txt');
const MIN_AGE_MS = 2 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
function lastWriteOf(sessionId) {
  if (!sessionId || !fs.existsSync(PROJECTS)) return 0;
  for (const d of fs.readdirSync(PROJECTS)) {
    const f = path.join(PROJECTS, d, `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return fs.statSync(f).mtimeMs;
  }
  return 0;
}
if (fs.existsSync(ROSTER)) {
  const roster = new Set(fs.readFileSync(ROSTER, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.toLowerCase()));
  const off = aliveReg.filter((r) => !roster.has(r.name.toLowerCase()) && !stopSet.has(r.pid) && r.pid !== selfPid);
  const nowMs = Date.now();
  const keepList = [];
  for (const r of off) {
    const age = nowMs - r.startedAt;
    const idle = nowMs - lastWriteOf(r.sessionId);
    if (age > MIN_AGE_MS && idle > IDLE_MS) addStop(r.pid, r.name, `不在名冊、已開 ${Math.round(age / 3600000)} 小時、閒置 ${Math.round(idle / 60000)} 分鐘`);
    else keepList.push(r);
  }
  say('');
  say(`--- 不在名冊但先保留的 session（剛開不到 2 小時，或 30 分鐘內還有動作）：${keepList.length} 個 ---`);
  for (const r of keepList) say(`  ${r.name.padEnd(16)} ${String(r.pid).padStart(6)}  ${r.cwd}  ${fmtTime(r.startedAt)}`);
}

say('');
say(`--- 要停的程序：${toStop.length} 個 ---`);
for (const s of toStop) say(`  PID ${s.pid}  ${s.name}  （${s.why}）`);

const stopped = new Set();
if (!DRY) {
  for (const s of toStop) {
    try {
      execFileSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore' });
      stopped.add(s.pid);
    } catch { say(`  ！PID ${s.pid} 停止失敗（可能已結束）`); }
  }
}

// ---- 2. 該刪的檔案 ----
const liveIds = new Set(aliveReg.filter((r) => !stopped.has(r.pid)).map((r) => r.sessionId));
const now = Date.now();
const del = [];

if (fs.existsSync(PROJECTS)) {
  for (const proj of fs.readdirSync(PROJECTS, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const pdir = path.join(PROJECTS, proj.name);

    // b. te-side 空資料夾
    if (proj.name.includes('-te-side-')) {
      if (!hasFiles(pdir)) del.push({ p: pdir, why: 'TokenEconomizer 空資料夾', size: 0, dir: true });
      continue;
    }

    // a. 已結束 session 的對話紀錄
    for (const e of fs.readdirSync(pdir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const id = e.name.slice(0, -6);
      if (liveIds.has(id)) continue; // 執行中，保留
      const fp = path.join(pdir, e.name);
      const st = fs.statSync(fp);
      if (now - st.mtimeMs < RECENT_MS) continue; // 10 分鐘內剛寫入，下次再清
      del.push({ p: fp, why: `${proj.name} 已結束的對話紀錄`, size: st.size });
      const sib = path.join(pdir, id);
      if (fs.existsSync(sib) && fs.statSync(sib).isDirectory()) del.push({ p: sib, why: '同名資料夾', size: sizeOf(sib), dir: true });
    }
  }
}

// c. 已結束 PID 的登記檔
if (fs.existsSync(SESSIONS)) {
  const stillAlive = new Set([...alivePids].filter((p) => !stopped.has(p)));
  for (const f of fs.readdirSync(SESSIONS)) {
    const m = f.match(/^(\d+)\./);
    if (!m) continue;
    if (stillAlive.has(Number(m[1]))) continue;
    const fp = path.join(SESSIONS, f);
    del.push({ p: fp, why: '已結束 PID 的登記檔', size: fs.statSync(fp).size });
  }
}

say('');
const total = del.reduce((t, d) => t + d.size, 0);
say(`--- 要刪的檔案：${del.length} 項，共 ${mb(total)} ---`);
for (const d of del) if (d.size > 1048576) say(`  ${mb(d.size).padStart(10)}  ${d.p}`);
const small = del.filter((d) => d.size <= 1048576).length;
if (small) say(`  （另有 ${small} 項小於 1 MB 的檔案／資料夾）`);

if (!DRY) {
  let ok = 0;
  for (const d of del) {
    // 安全：只刪 ~/.claude/projects 或 ~/.claude/sessions 底下的東西，且絕不刪 memory
    const rel = path.relative(CLAUDE, d.p);
    if (rel.startsWith('..') || !(rel.startsWith('projects') || rel.startsWith('sessions'))) continue;
    if (d.p.split(path.sep).includes('memory')) continue;
    try { fs.rmSync(d.p, { recursive: !!d.dir, force: true }); ok++; } catch { say(`  ！刪除失敗：${d.p}`); }
  }
  say('');
  say(`完成：停止 ${stopped.size} 個程序，刪除 ${ok} 項，釋放約 ${mb(total)}。`);
} else {
  say('');
  say('（dry-run：沒有停止任何程序，也沒有刪除任何檔案）');
}

try {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, out.join('\n') + '\n\n');
} catch { /* 寫紀錄失敗不影響結果 */ }
