'use strict';
// Run one request against one agent: guard, resolve, snapshot, run, parse, report.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { adapters, AGENTS } = require('./agents');
const { resolveBin } = require('./resolve');
const { runProcess } = require('./run');
const { childEnv } = require('./host');

const EXIT = { ok: 0, usage: 1, failed: 2, empty: 3, quota: 10, auth: 11, timeout: 12, missing: 13, recursion: 14, denied: 15 };

const HINT = {
  failed: 'the agent failed; see detail. Try a sharper task or --tier deep.',
  empty: 'the agent returned nothing. Try a sharper task or --tier deep.',
  quota: 'quota / rate limit hit. Retry later or use another agent (--to).',
  auth: 'not signed in. Run `tribridge doctor` for the sign-in command.',
  timeout: 'timed out. Raise --timeout or narrow the task.',
  missing: 'CLI not found. Run `tribridge doctor`.',
  recursion: 'refusing a nested delegation (a delegate may not delegate again).',
  denied: 'the agent was denied a permission it needed. For writes use --mode write. agy writes only inside a '
    + 'workspace listed in trustedWorkspaces or covered by a write_file(<dir>) rule in ~/.gemini/antigravity-cli/settings.json; '
    + 'running commands needs a command(<name>) rule, or --mode yolo on a throwaway branch.',
};

const DIGEST_CONTRACT = `

---
OUTPUT CONTRACT (from the orchestrating agent — follow it exactly):
- Reply with a compact digest, not a dump. Never paste whole files or long logs into the reply.
- Anything bulky belongs in files; name the files instead.
- End with a block exactly like:
===DIGEST===
files changed: <paths, or "none">
key decisions: <bullets>
risks / open questions: <bullets, or "none">
how to verify: <exact commands or checks>
===END===`;

// ---------------------------------------------------------------- git snapshot
// A write that "succeeded" but touched nothing is the most common silent failure
// of delegated work, so every run inside a git repo reports what actually changed.
function gitSnapshot(dir) {
  if (!dir) return null;
  const r = spawnSync('git', ['-C', dir, 'status', '--porcelain=v1', '-uall', '-z'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const top = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const snap = new Map();
  const parts = r.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (status[0] === 'R' || status[0] === 'C') i++; // rename/copy: next field is the source
    let stamp = 'gone';
    try { const s = fs.statSync(path.join(top, file)); stamp = `${s.size}:${s.mtimeMs}`; } catch {}
    snap.set(file, `${status}|${stamp}`);
  }
  return snap;
}

function diffSnapshots(before, after) {
  if (!before || !after) return null;
  const changed = [];
  for (const [f, v] of after) if (before.get(f) !== v) changed.push(f);
  for (const f of before.keys()) if (!after.has(f)) changed.push(f); // reverted / committed
  return changed.sort();
}

// ---------------------------------------------------------------- usage log
function logUsage(cfg, record) {
  const line = `TRIBRIDGE_USAGE ${JSON.stringify(record)}`;
  process.stderr.write(`${line}\n`);
  const file = process.env.TRIBRIDGE_USAGE_LOG || cfg.usageLog;
  if (file) { try { fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`); } catch {} }
}

/**
 * @param {object} req  { to, prompt, dir, mode, tier, model, effort, timeoutSec, raw, dryRun }
 * @param {object} cfg  loaded config
 * @returns {Promise<{exit:number, text:string, kind:string|null, detail?:string, warnings:string[], changes:string[]|null, argv?:string[]}>}
 */
async function delegate(req, cfg) {
  const depth = Number(process.env.TRIBRIDGE_DEPTH || 0);
  if (depth >= 1 && !process.env.TRIBRIDGE_ALLOW_NESTED) {
    return { exit: EXIT.recursion, text: '', kind: 'recursion', detail: HINT.recursion, warnings: [], changes: null };
  }
  if (!AGENTS.includes(req.to)) {
    return { exit: EXIT.usage, text: '', kind: 'usage', detail: `unknown agent "${req.to}" (use ${AGENTS.join('|')})`, warnings: [], changes: null };
  }
  const bin = resolveBin(req.to);
  if (!bin && !req.dryRun) {
    return { exit: EXIT.missing, text: '', kind: 'missing', detail: `${req.to}: ${HINT.missing}`, warnings: [], changes: null };
  }

  const dir = req.dir ? path.resolve(req.dir) : undefined;
  const full = { ...req, dir, prompt: req.raw ? req.prompt : req.prompt + DIGEST_CONTRACT, extraDirs: req.extraDirs || [] };
  const adapter = adapters[req.to];
  const built = adapter.build(full, cfg);
  const argv = [...(bin ? bin.prefix : []), ...built.args];

  if (req.dryRun) {
    if (built.promptFile) { try { fs.unlinkSync(built.promptFile); } catch {} }
    return { exit: 0, text: '', kind: null, warnings: [], changes: null, argv: [bin ? bin.cmd : req.to, ...argv], stdin: built.input != null };
  }

  const warnings = [];
  if (req.mode === 'yolo') warnings.push(`--mode yolo auto-approves every action of ${req.to} on this whole machine, not just --dir.`);

  const before = gitSnapshot(dir);
  const res = await runProcess({
    cmd: bin.cmd,
    args: argv,
    input: built.input,
    cwd: dir,
    env: childEnv(process.env, { TRIBRIDGE_DEPTH: String(depth + 1) }),
    timeoutMs: req.timeoutSec * 1000,
  });
  const after = gitSnapshot(dir);

  let out;
  if (res.spawnError) {
    out = { text: '', kind: 'missing', detail: String(res.spawnError), usage: {}, warnings: [] };
  } else {
    out = adapter.parse(res, full, built);
    if (res.timedOut) { out.kind = 'timeout'; out.detail = `killed after ${req.timeoutSec}s`; }
  }
  warnings.push(...out.warnings);

  const changes = diffSnapshots(before, after);
  if (req.mode === 'read' && changes && changes.length) {
    warnings.push(`read-only run, yet ${changes.length} file(s) changed — inspect them.`);
  }
  if (req.mode !== 'read' && !out.kind && changes && changes.length === 0) {
    warnings.push('write run finished but git sees no changed files — the write may not have happened.');
  }
  const limit = Number(cfg.digestWarnChars) || 0;
  if (limit > 0 && out.text.length > limit) {
    warnings.push(`reply is ${out.text.length} chars — looks like a dump, not a digest. Don't ingest it whole; ask for a digest.`);
  }

  const exit = out.kind ? (EXIT[out.kind] ?? EXIT.failed) : EXIT.ok;
  logUsage(cfg, {
    agent: req.to, model: out.model || null, tier: req.model ? null : req.tier, mode: req.mode,
    ms: res.ms, exit, ...out.usage, ...(out.conversationId ? { conversationId: out.conversationId } : {}),
  });
  return {
    exit,
    text: out.text,
    kind: out.kind,
    detail: out.kind ? [out.detail, HINT[out.kind]].filter(Boolean).join(' — ') : undefined,
    warnings,
    changes,
  };
}

module.exports = { delegate, EXIT, DIGEST_CONTRACT, gitSnapshot, diffSnapshots };
