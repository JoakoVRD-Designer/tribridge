'use strict';
// List the models each agent can run, and persist per-agent / per-tier choices.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveBin } = require('./resolve');
const { runProcess } = require('./run');
const { configPath, homeDir } = require('./config');

const TIERS = ['fast', 'balanced', 'deep'];

// Claude Code has no "list models" command; it accepts these aliases and full ids.
const CLAUDE_MODELS = [
  { id: 'haiku', name: 'alias → latest Haiku' },
  { id: 'sonnet', name: 'alias → latest Sonnet' },
  { id: 'opus', name: 'alias → latest Opus' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-sonnet-5', name: 'Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const AGY_EFFORTS = ['low', 'medium', 'high'];

async function call(agent, args) {
  const bin = resolveBin(agent);
  if (!bin) return null;
  return runProcess({ cmd: bin.cmd, args: [...bin.prefix, ...args], input: null, timeoutMs: 60000 });
}

function codexFromJson(text) {
  const j = JSON.parse(text);
  return (j.models || [])
    .filter((m) => m.visibility !== 'hide' && m.visibility !== 'hidden')
    .map((m) => ({
      id: m.slug,
      name: m.display_name || m.slug,
      efforts: (m.supported_reasoning_levels || []).map((l) => l.effort),
    }));
}

/** @returns {Promise<{models: {id,name,efforts?}[], efforts?: string[], note?: string}>} */
async function listModels(agent) {
  if (agent === 'claude') return { models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS, note: 'Claude Code also accepts any full model id.' };
  if (agent === 'agy') {
    const r = await call('agy', ['models']);
    if (!r || r.code !== 0) return { models: [], note: 'could not run `agy models` (installed and signed in?)' };
    const models = r.stdout.split(/\r?\n/).map((l) => l.split('\t')).filter((p) => p.length >= 2 && p[0].trim())
      .map(([id, name]) => ({ id: id.trim(), name: name.trim() }));
    return { models, efforts: AGY_EFFORTS };
  }
  if (agent === 'codex') {
    const r = await call('codex', ['debug', 'models']);
    try { if (r && r.code === 0) return { models: codexFromJson(r.stdout) }; } catch {}
    // Fallback: the cache codex keeps from its last refresh.
    const cache = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json');
    try { return { models: codexFromJson(fs.readFileSync(cache, 'utf8')), note: 'from codex\'s cached list' }; } catch {}
    return { models: [], note: 'could not list codex models (installed and signed in?)' };
  }
  throw new Error(`unknown agent ${agent}`);
}

// ---------------------------------------------------------------- persistence
function readUserConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${configPath()} is not valid JSON; fix or delete it (${e.message})`);
  }
}

function writeUserConfig(cfg) {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`);
}

/** Set model and/or effort for one agent on the given tiers. null leaves a field as it is. */
function setModel(agent, tiers, { model, effort }) {
  const cfg = readUserConfig();
  cfg.tiers = cfg.tiers || {};
  cfg.tiers[agent] = cfg.tiers[agent] || {};
  for (const t of tiers) {
    const cur = cfg.tiers[agent][t] || {};
    if (model !== undefined) cur.model = model;
    if (effort !== undefined) cur.effort = effort;
    cfg.tiers[agent][t] = cur;
  }
  writeUserConfig(cfg);
}

/** Drop user overrides for an agent (or every agent) so the defaults apply again. */
function resetModels(agents) {
  const cfg = readUserConfig();
  if (!cfg.tiers) return;
  for (const a of agents) delete cfg.tiers[a];
  writeUserConfig(cfg);
}

module.exports = { listModels, setModel, resetModels, TIERS };
