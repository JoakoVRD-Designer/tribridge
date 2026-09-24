'use strict';
// Install tribridge as a native plugin in each host, using the host's own installer.
//
//   claude — /plugin marketplace add … + /plugin install (only possible from inside Claude Code)
//   codex  — codex plugin marketplace add <repo> + codex plugin add tribridge@tribridge
//            (manifests: .agents/plugins/marketplace.json, .codex-plugin/plugin.json)
//   agy    — agy plugin install <repo dir>   (manifest: plugin.json; agy copies the folder)
//
// Every host gets its own copy of bin/ and lib/, so the skill works even when the
// `tribridge` command is not on PATH (it falls back to node <plugin>/bin/tribridge.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveBin } = require('./resolve');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'JoakoVRD-Designer/tribridge';

function codexHome() { return process.env.CODEX_HOME || path.join(os.homedir(), '.codex'); }
function geminiHome() { return process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini'); }

function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }

function claudeInstalled() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    return Object.keys(j.plugins || j).some((k) => k.startsWith('tribridge@'));
  } catch { return false; }
}
function codexStatus() { return exists(path.join(codexHome(), 'plugins', 'cache', 'tribridge', 'tribridge')) ? 'installed' : 'absent'; }
function agyStatus() { return exists(path.join(geminiHome(), 'config', 'plugins', 'tribridge', 'plugin.json')) ? 'installed' : 'absent'; }

/** Run an agent CLI subcommand synchronously; throw with its output on failure. */
function runCli(agent, args) {
  const bin = resolveBin(agent);
  if (!bin) throw new Error(`${agent}: CLI not found — install it first (see tribridge doctor)`);
  const r = spawnSync(bin.cmd, [...bin.prefix, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 180000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status !== 0) throw new Error(`${agent} ${args.join(' ')} failed:\n${out}`);
  return out;
}

function installCodex() {
  if (codexStatus() === 'installed') return 'codex: already installed (update with: codex plugin marketplace upgrade tribridge)';
  try { runCli('codex', ['plugin', 'marketplace', 'add', ROOT]); } catch (e) {
    if (!/already/i.test(e.message)) throw e;
  }
  runCli('codex', ['plugin', 'add', 'tribridge@tribridge']);
  return 'codex: installed plugin tribridge@tribridge (restart Codex to load it)';
}

function uninstallCodex() {
  if (codexStatus() !== 'installed') return 'codex: nothing to remove';
  runCli('codex', ['plugin', 'remove', 'tribridge@tribridge']);
  try { runCli('codex', ['plugin', 'marketplace', 'remove', 'tribridge']); } catch {}
  return 'codex: removed plugin tribridge';
}

function installAgy() {
  // agy's own installer copies the folder; reinstalling replaces the copy.
  runCli('agy', ['plugin', 'install', ROOT]);
  return 'agy: installed plugin tribridge (restart Antigravity to load it)';
}

function uninstallAgy() {
  if (agyStatus() !== 'installed') return 'agy: nothing to remove';
  runCli('agy', ['plugin', 'uninstall', 'tribridge']);
  return 'agy: removed plugin tribridge';
}

function claudeInstructions() {
  return [
    'claude: plugins install from inside Claude Code. Type these in the Claude Code prompt:',
    `  /plugin marketplace add ${REPO}`,
    '  /plugin install tribridge@tribridge',
    '  then restart Claude Code.',
  ].join('\n');
}

module.exports = {
  ROOT, installCodex, uninstallCodex, installAgy, uninstallAgy, claudeInstructions,
  codexStatus, agyStatus, claudeInstalled,
};
