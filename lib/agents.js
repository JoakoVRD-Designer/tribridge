'use strict';
// One adapter per agent CLI. Each turns a uniform request into that CLI's
// headless invocation and turns its output back into a uniform result.
//
// Uniform request: { prompt, dir, mode: read|write|yolo, tier: fast|balanced|deep,
//                    model?, effort?, timeoutSec, extraDirs: [] }
// Uniform result:  { text, kind: null|failed|empty|quota|auth|timeout|denied,
//                    detail?, model?, usage: {input, output, costUsd?}, warnings: [] }
//
// Mode semantics, per agent (the closest honest mapping each CLI offers):
//   read  — may read files and search; must not write.
//   write — may edit files inside --dir; no arbitrary shell.
//   yolo  — everything auto-approved. Machine-wide on every agent, not just --dir.

const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENTS = ['claude', 'codex', 'agy'];
const LABEL = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity (Gemini)' };

function classify(text) {
  const s = String(text || '');
  if (/quota|rate.?limit|\b429\b|resource.?exhausted|usage limit|too many requests/i.test(s)) return 'quota';
  if (/not (logged|signed) in|please (log|sign) ?in|unauthori[sz]ed|\b401\b|authentication (failed|required)|invalid api key|login required|run .{0,20}login/i.test(s)) return 'auth';
  return null;
}

function lastJson(stdout) {
  const s = String(stdout || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  // Some CLIs print banners first; take the last line that parses.
  const lines = s.split(/\r?\n/).reverse();
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('{')) { try { return JSON.parse(t); } catch {} }
  }
  return null;
}

function pick(cfg, agent, req) {
  const t = (cfg.tiers[agent] || {})[req.tier] || {};
  return { model: req.model || t.model || null, effort: req.effort || t.effort || null };
}

// ---------------------------------------------------------------- claude
const CLAUDE_READ_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch';
const CLAUDE_WRITE_TOOLS = 'Read,Glob,Grep,Edit,Write,MultiEdit,NotebookEdit,WebSearch,WebFetch';

const claude = {
  build(req, cfg) {
    const { model, effort } = pick(cfg, 'claude', req);
    const args = ['-p', '--output-format', 'json', '--no-session-persistence'];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    for (const d of req.extraDirs || []) args.push('--add-dir', d);
    if (req.mode === 'yolo') {
      args.push('--permission-mode', 'bypassPermissions');
    } else {
      // dontAsk: anything not pre-approved is denied instead of waiting for a human.
      args.push('--permission-mode', 'dontAsk', '--allowedTools',
        req.mode === 'write' ? CLAUDE_WRITE_TOOLS : CLAUDE_READ_TOOLS);
    }
    return { args, input: req.prompt, cwd: req.dir, model };
  },
  parse(res, req, built) {
    const out = { text: '', kind: null, model: built.model, usage: {}, warnings: [] };
    const j = lastJson(res.stdout);
    if (!j) {
      out.kind = res.code === 0 ? 'empty' : (classify(res.stderr) || 'failed');
      out.detail = res.stderr.trim().slice(-800);
      return out;
    }
    out.text = typeof j.result === 'string' ? j.result : '';
    const u = j.usage || {};
    out.usage = {
      input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      output: u.output_tokens || 0,
      costUsd: j.total_cost_usd,
    };
    const mu = j.modelUsage && Object.keys(j.modelUsage);
    if (mu && mu.length) out.model = mu.join(',');
    const denied = (j.permission_denials || []).map((d) => d.tool_name || d.tool || JSON.stringify(d));
    if (denied.length) out.warnings.push(`permission denied for: ${[...new Set(denied)].join(', ')}`);
    if (j.is_error) {
      out.kind = classify(`${j.result} ${j.api_error_status || ''} ${res.stderr}`) || 'failed';
      out.detail = String(j.result || j.subtype || '').slice(0, 800);
    } else if (!out.text.trim()) {
      out.kind = denied.length ? 'denied' : 'empty';
    }
    return out;
  },
};

// ---------------------------------------------------------------- codex
const codex = {
  build(req, cfg) {
    const { model, effort } = pick(cfg, 'codex', req);
    const lastFile = path.join(os.tmpdir(), `tribridge-codex-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '-o', lastFile];
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    // Measured on Windows (codex 0.156): the default "elevated" sandbox cannot create
    // processes when codex is launched by another program, so every shell/read fails.
    // The unelevated (restricted-token) sandbox works and still enforces --sandbox.
    if (process.platform === 'win32' && cfg.codexWindowsSandbox) {
      args.push('-c', `windows.sandbox="${cfg.codexWindowsSandbox}"`);
    }
    if (req.mode === 'yolo') args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('--sandbox', req.mode === 'write' ? 'workspace-write' : 'read-only');
    if (req.dir) args.push('-C', req.dir);
    for (const d of req.extraDirs || []) args.push('--add-dir', d);
    args.push('-'); // prompt on stdin: no argv length limit, no quoting
    return { args, input: req.prompt, cwd: req.dir, model, lastFile };
  },
  parse(res, req, built) {
    const out = { text: '', kind: null, model: built.model, usage: {}, warnings: [] };
    try { out.text = fs.readFileSync(built.lastFile, 'utf8'); } catch {}
    try { fs.unlinkSync(built.lastFile); } catch {}
    if (!out.text.trim() && res.code === 0) out.text = res.stdout;
    const m = /^model:\s*(\S+)/m.exec(res.stderr);
    if (m) out.model = m[1];
    const tok = /tokens used\s*[\r\n]+\s*([\d,.]+)/i.exec(res.stderr);
    if (tok) out.usage = { total: Number(tok[1].replace(/[,.]/g, '')) };
    if (res.code !== 0) {
      out.kind = classify(res.stderr) || 'failed';
      out.detail = res.stderr.trim().slice(-800);
    } else if (!out.text.trim()) {
      out.kind = 'empty';
    }
    return out;
  },
};

// ---------------------------------------------------------------- agy
// agy -p takes the prompt as argv. Windows caps a command line at ~32K chars, so a
// long prompt goes to a temp file the agent is pointed at instead.
const AGY_ARGV_LIMIT = 24000;
const AGY_NO_TERMINAL = 'Terminal commands are not available in this run: read, search and edit files only '
  + 'with your file-viewing, file-search and file-editing tools.\n\n';
const AGY_READ_ONLY ='READ-ONLY TASK: do not create, modify, move or delete any file, and do not run '
  + 'commands that change anything. If the task below asks for changes, describe them instead of making them.\n\n';

const agy = {
  build(req, cfg) {
    const { model, effort } = pick(cfg, 'agy', req);
    const args = ['--output-format', 'json', '--print-timeout', `${Math.max(30, req.timeoutSec - 15)}s`];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (req.dir) args.push('--add-dir', req.dir);
    for (const d of req.extraDirs || []) args.push('--add-dir', d);
    // agy has no workspace-scoped write grant on the command line: 'write' relies on a
    // write_file(<dir>) rule in ~/.gemini/antigravity-cli/settings.json; 'yolo' approves all.
    if (req.mode === 'yolo') args.push('--dangerously-skip-permissions');

    // agy has no enforceable read-only mode headless. Measured on 1.2.9: a trusted
    // workspace auto-approves writes even without a grant, and `--mode plan` makes the
    // agent give up with an empty reply on any task. So read mode is an instruction
    // here, backed by the git footer that reports any file that changed anyway.
    // Measured on 1.2.9: without a command() grant, Flash often opens a file with a
    // terminal command first, gets auto-denied, and ends the turn with no reply (exit 15,
    // 3/3 runs). Told to use its file tools, it answered 3/3.
    let prompt = req.prompt;
    if (req.mode !== 'yolo') prompt = AGY_NO_TERMINAL + prompt;
    if (req.mode === 'read') prompt = AGY_READ_ONLY + prompt;
    let promptFile = null;
    if (Buffer.byteLength(prompt, 'utf8') > AGY_ARGV_LIMIT) {
      const dir = path.join(os.tmpdir(), 'tribridge');
      fs.mkdirSync(dir, { recursive: true });
      promptFile = path.join(dir, `prompt-${process.pid}-${Date.now()}.md`);
      fs.writeFileSync(promptFile, prompt);
      args.push('--add-dir', dir);
      prompt = `Your complete task is in the file ${promptFile}. Read that whole file first, then do exactly what it says.`;
    }
    args.push('-p', prompt); // -p takes the prompt as its value and must be last
    return { args, input: null, cwd: req.dir, model, promptFile };
  },
  parse(res, req, built) {
    if (built.promptFile) { try { fs.unlinkSync(built.promptFile); } catch {} }
    const out = { text: '', kind: null, model: built.model, usage: {}, warnings: [] };
    const j = lastJson(res.stdout);
    if (!j) {
      out.text = res.code === 0 ? res.stdout : '';
      if (res.code !== 0) { out.kind = classify(res.stderr) || 'failed'; out.detail = res.stderr.trim().slice(-800); }
      else if (!out.text.trim()) out.kind = 'empty';
      return out;
    }
    out.text = typeof j.response === 'string' ? j.response : (j.result || '');
    const u = j.usage || {};
    out.usage = { input: (u.input_tokens || 0) + (u.cache_read_tokens || 0), output: (u.output_tokens || 0) + (u.thinking_tokens || 0) };
    if (j.conversation_id) out.conversationId = j.conversation_id;
    const denied = j.denied_actions || [];
    if (denied.length) {
      const names = denied.map((d) => (typeof d === 'string' ? d : d.display_name || d.action || d.tool || JSON.stringify(d)));
      out.warnings.push(`agy auto-denied: ${names.join(', ')}`);
    }
    if (/print timeout .*partial output/i.test(res.stderr)) {
      out.kind = 'timeout';
      out.detail = 'agy hit --print-timeout; the reply above is partial';
    } else if (j.status && j.status !== 'SUCCESS') {
      const msg = JSON.stringify(j.error || j.message || j.status);
      out.kind = classify(`${msg} ${res.stderr}`) || 'failed';
      out.detail = msg.slice(0, 800);
    } else if (!out.text.trim()) {
      out.kind = denied.length ? 'denied' : 'empty';
    } else if (denied.length && req.mode !== 'read') {
      out.kind = 'denied';
    }
    return out;
  },
};

module.exports = { AGENTS, LABEL, adapters: { claude, codex, agy }, classify, lastJson };
