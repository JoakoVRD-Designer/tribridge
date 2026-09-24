'use strict';
// Find an agent CLI without going through a shell.
//
// On Windows npm installs `.cmd` shims. Node refuses to spawn those without
// `shell: true`, and a shell means quoting arbitrary prompts through cmd.exe —
// so we read the shim and spawn the real target (`.exe` directly, `.js` via node).

const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function pathDirs() {
  const raw = process.env.PATH || process.env.Path || '';
  return raw.split(path.delimiter).filter(Boolean);
}

function fromTarget(target) {
  if (/\.(c|m)?js$/i.test(target)) return { cmd: process.execPath, prefix: [target], via: target };
  return { cmd: target, prefix: [], via: target };
}

/** Parse an npm-style `.cmd` shim and return the file it launches, or null. */
function parseCmdShim(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const re = /"%~?dp0%\\?([^"%]+?\.(?:exe|c?js|mjs))"/gi;
  let m;
  let last = null;
  while ((m = re.exec(txt))) last = m[1];
  if (!last) return null;
  const target = path.join(path.dirname(file), last);
  return isFile(target) ? target : null;
}

const FALLBACKS = {
  agy: () => [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe'),
    path.join(os.homedir(), '.local', 'bin', 'agy'),
  ],
  claude: () => [
    path.join(os.homedir(), '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  ],
  codex: () => [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ],
};

/**
 * @param {string} name  claude | codex | agy
 * @returns {{cmd:string, prefix:string[], via:string} | null}
 */
function resolveBin(name) {
  const override = process.env[`TRIBRIDGE_${name.toUpperCase()}_BIN`];
  if (override) return isFile(override) ? fromTarget(override) : null;

  for (const dir of pathDirs()) {
    if (IS_WIN) {
      const exe = path.join(dir, `${name}.exe`);
      if (isFile(exe)) return fromTarget(exe);
      const cmd = path.join(dir, `${name}.cmd`);
      if (isFile(cmd)) {
        const target = parseCmdShim(cmd);
        if (target) return fromTarget(target);
      }
    } else {
      const bin = path.join(dir, name);
      try {
        fs.accessSync(bin, fs.constants.X_OK);
        if (isFile(bin)) return fromTarget(bin);
      } catch {}
    }
  }
  for (const p of (FALLBACKS[name] || (() => []))()) {
    if (p && isFile(p)) return fromTarget(p);
  }
  return null;
}

module.exports = { resolveBin, parseCmdShim };
