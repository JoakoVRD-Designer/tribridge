'use strict';
// User config lives in ~/.tribridge/config.json (override the dir with TRIBRIDGE_HOME).
// Anything not set there falls back to DEFAULTS.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  timeoutSec: 600,
  digestWarnChars: 8000,
  usageLog: '',
  // Windows only: sandbox flavour passed to codex. "" = use codex's own config.
  codexWindowsSandbox: 'unelevated',
  // Per agent, per tier: which model and reasoning effort to run.
  // model:null means "whatever the agent's own config defaults to".
  tiers: {
    claude: {
      fast: { model: 'haiku', effort: null },
      balanced: { model: 'sonnet', effort: null },
      deep: { model: 'opus', effort: 'high' },
    },
    codex: {
      fast: { model: null, effort: 'low' },
      balanced: { model: null, effort: 'medium' },
      deep: { model: null, effort: 'high' },
    },
    agy: {
      fast: { model: 'gemini-3.8-flash-low', effort: null },
      balanced: { model: 'gemini-3.8-flash-high', effort: null },
      deep: { model: 'gemini-3.1-pro-high', effort: null },
    },
  },
};

function homeDir() {
  return process.env.TRIBRIDGE_HOME || path.join(os.homedir(), '.tribridge');
}

function configPath() {
  return path.join(homeDir(), 'config.json');
}

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null ? merge(base[k], v) : v;
  }
  return out;
}

function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') process.stderr.write(`tribridge: ignoring unreadable ${configPath()}: ${e.message}\n`);
  }
  return merge(DEFAULTS, user);
}

module.exports = { loadConfig, homeDir, configPath, DEFAULTS };
