'use strict';
// Health check: for each agent — found? version? signed in? skill registered?

const { resolveBin } = require('./resolve');
const { runProcess } = require('./run');
const { AGENTS, LABEL } = require('./agents');
const inst = require('./install');

const AUTH = {
  claude: { args: ['auth', 'status'], ok: (r) => /"loggedIn"\s*:\s*true/.test(r.stdout), fix: 'claude auth login' },
  codex: { args: ['login', 'status'], ok: (r) => r.code === 0 && /logged in/i.test(r.stdout + r.stderr), fix: 'codex login' },
  agy: { args: ['models'], ok: (r) => r.code === 0 && /gemini|claude|gpt/i.test(r.stdout), fix: 'agy   (run once interactively and sign in)' },
};

function skillStatus(agent) {
  if (agent === 'claude') return inst.claudeInstalled() ? 'installed' : 'absent';
  if (agent === 'codex') return inst.codexStatus();
  return inst.agyStatus();
}

async function checkAgent(agent) {
  const row = { agent, label: LABEL[agent], found: false };
  const bin = resolveBin(agent);
  if (!bin) return { ...row, problem: `not found on PATH (set TRIBRIDGE_${agent.toUpperCase()}_BIN to its full path)` };
  row.found = true;
  row.path = bin.via;
  const call = (args) => runProcess({ cmd: bin.cmd, args: [...bin.prefix, ...args], input: null, timeoutMs: 45000 });
  const [ver, auth] = await Promise.all([call(['--version']), call(AUTH[agent].args)]);
  row.version = (ver.stdout || ver.stderr).trim().split(/\r?\n/)[0] || '?';
  row.signedIn = AUTH[agent].ok(auth);
  if (auth.timedOut) row.problem = 'auth check timed out (the CLI may be hanging)';
  else if (!row.signedIn) row.problem = `not signed in — run: ${AUTH[agent].fix}`;
  row.skill = skillStatus(agent);
  return row;
}

async function doctor() {
  const rows = await Promise.all(AGENTS.map(checkAgent));
  const lines = [`node ${process.version} · ${process.platform}`, ''];
  for (const r of rows) {
    const mark = r.found && r.signedIn ? 'OK ' : '!! ';
    lines.push(`${mark} ${r.label} [${r.agent}]`);
    if (r.found) {
      lines.push(`     path:    ${r.path}`);
      lines.push(`     version: ${r.version}`);
      lines.push(`     auth:    ${r.signedIn ? 'signed in' : 'NOT signed in'}`);
      lines.push(`     skill:   ${r.skill}${r.skill === 'installed' ? '' : `  → tribridge install ${r.agent}`}`);
    }
    if (r.problem) lines.push(`     problem: ${r.problem}`);
  }
  const usable = rows.filter((r) => r.found && r.signedIn).length;
  lines.push('', usable >= 2 ? `${usable}/3 agents usable — delegation works.` : `only ${usable}/3 agents usable — need at least 2 to delegate.`);
  return { ok: usable >= 2, text: lines.join('\n'), rows };
}

module.exports = { doctor };
