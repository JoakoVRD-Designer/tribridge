'use strict';
// Register the shared `tribridge` skill with each host.
//
//   codex  — ~/.codex/skills/tribridge  -> link to <repo>/skills/tribridge
//            (a directory junction on Windows: no admin rights needed)
//   agy    — ~/.gemini/config/skills.json gets {"path": "<repo>/skills"}
//            (agy reads registered skill dirs in place; `~` is not expanded, so absolute)
//   claude — a plugin: installed from inside Claude Code with /plugin (printed, not done here)

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const SKILL_DIR = path.join(SKILLS_DIR, 'tribridge');

function codexSkillLink() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(home, 'skills', 'tribridge');
}
function agySkillsJson() {
  return path.join(process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini'), 'config', 'skills.json');
}
function claudeInstalled() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    return Object.keys(j.plugins || j).some((k) => k.startsWith('tribridge@'));
  } catch { return false; }
}

function samePath(a, b) {
  const n = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

function codexStatus() {
  const link = codexSkillLink();
  try {
    return samePath(fs.realpathSync(link), SKILL_DIR) ? 'installed' : 'conflict';
  } catch { return 'absent'; }
}

function readSkillsJson() {
  const file = agySkillsJson();
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON; not touching it (${e.message})`);
  }
}

function agyStatus() {
  try {
    const entries = readSkillsJson().entries || [];
    return entries.some((e) => e && e.path && samePath(e.path, SKILLS_DIR)) ? 'installed' : 'absent';
  } catch { return 'unreadable'; }
}

function installCodex() {
  const link = codexSkillLink();
  const st = codexStatus();
  if (st === 'installed') return `codex: already installed (${link})`;
  if (st === 'conflict') throw new Error(`codex: ${link} exists and is not this repo's skill; move it away first`);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(SKILL_DIR, link, process.platform === 'win32' ? 'junction' : 'dir');
  return `codex: linked ${link} -> ${SKILL_DIR}`;
}

function uninstallCodex() {
  const link = codexSkillLink();
  if (codexStatus() !== 'installed') return `codex: nothing to remove`;
  // Remove the link itself, never the target's contents.
  const lst = fs.lstatSync(link);
  if (lst.isSymbolicLink() || process.platform === 'win32') fs.rmdirSync(link);
  else throw new Error(`codex: ${link} is a real directory; remove it by hand`);
  return `codex: removed ${link}`;
}

function installAgy() {
  const file = agySkillsJson();
  const cur = readSkillsJson();
  const entries = Array.isArray(cur.entries) ? cur.entries : [];
  if (entries.some((e) => e && e.path && samePath(e.path, SKILLS_DIR))) return `agy: already registered in ${file}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(`${file}.tribridge-backup`)) fs.copyFileSync(file, `${file}.tribridge-backup`);
  cur.entries = [...entries, { path: SKILLS_DIR }];
  fs.writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`);
  return `agy: registered ${SKILLS_DIR} in ${file}`;
}

function uninstallAgy() {
  const file = agySkillsJson();
  const cur = readSkillsJson();
  const entries = Array.isArray(cur.entries) ? cur.entries : [];
  const kept = entries.filter((e) => !(e && e.path && samePath(e.path, SKILLS_DIR)));
  if (kept.length === entries.length) return 'agy: nothing to remove';
  cur.entries = kept;
  fs.writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`);
  return `agy: unregistered ${SKILLS_DIR} from ${file}`;
}

function claudeInstructions() {
  return [
    'claude: plugins install from inside Claude Code. Type these in the Claude Code prompt:',
    `  /plugin marketplace add ${ROOT}`,
    '  /plugin install tribridge@tribridge',
    '  then restart Claude Code so the SessionStart hook loads.',
  ].join('\n');
}

module.exports = {
  ROOT, SKILLS_DIR, installCodex, uninstallCodex, installAgy, uninstallAgy, claudeInstructions,
  codexStatus, agyStatus, claudeInstalled, codexSkillLink, agySkillsJson,
};
