#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig, configPath } = require('../lib/config');
const { delegate, EXIT } = require('../lib/delegate');
const { AGENTS, LABEL } = require('../lib/agents');
const { detectHost } = require('../lib/host');
const jobs = require('../lib/jobs');
const inst = require('../lib/install');

const USAGE = `tribridge — let Claude Code, Codex and Antigravity (agy) delegate to each other.

Usage:
  tribridge delegate --to <agent> [options] "<task>"     (task "-" = read from stdin)
  tribridge review   [--to <a,b>|others] [--base <ref>] [--adversarial] [--dir .] [-- paths...]
  tribridge job start --to <agent> [options] "<task>"   background delegation, prints a job id
  tribridge job status [id] | job result <id> | job cancel <id>
  tribridge doctor                                        check CLIs, sign-in, skill registration
  tribridge install  codex|agy|claude|all                 register the shared skill with a host
  tribridge uninstall codex|agy|all
  tribridge host                                          which agent is running me, and the others
  tribridge config                                        print effective config and its path

Agents: claude | codex | agy        ("others" = every agent except the one running tribridge)

Delegate options:
  --tier fast|balanced|deep   model/effort tier (default balanced; see config)
  --mode read|write|yolo      read (default): no writes · write: edit files in --dir ·
                              yolo: auto-approve everything, machine-wide — throwaway branch only
  --dir <path>                workspace the agent works in (defaults to cwd)
  --model <name>              exact model, overrides the tier
  --effort <level>            reasoning effort, overrides the tier
  --timeout <10m|600s|600>    wall-clock limit (default from config: 600s)
  --raw                       don't append the digest-only output contract
  --json                      print the result as JSON
  --dry-run                   print the resolved command, run nothing

Exit codes: 0 ok · 1 usage · 2 agent failed · 3 empty reply · 10 quota · 11 auth ·
            12 timeout · 13 CLI missing · 14 nested delegation refused · 15 permission denied`;

function die(msg, code = EXIT.usage) {
  process.stderr.write(`tribridge: ${msg}\n`);
  process.exit(code);
}

function parseTimeout(v) {
  const m = /^(\d+)\s*(s|m|h)?$/i.exec(String(v).trim());
  if (!m) die(`bad --timeout "${v}" (use e.g. 300s, 10m)`);
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600 }[(m[2] || 's').toLowerCase()]);
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function resolveTargets(spec) {
  if (!spec) return null;
  if (spec === 'others') {
    const host = detectHost();
    return AGENTS.filter((a) => a !== host);
  }
  const list = spec.split(',').map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!AGENTS.includes(a)) die(`unknown agent "${a}" (use ${AGENTS.join('|')} or "others")`);
  return list;
}

function parseDelegateArgs(argv, cfg) {
  const o = { tier: 'balanced', mode: 'read', timeoutSec: cfg.timeoutSec, raw: false, json: false, dryRun: false, rest: [] };
  const need = (i) => { if (i + 1 >= argv.length) die(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--to': o.to = need(i); i++; break;
      case '--tier': o.tier = need(i); i++; break;
      case '--mode': o.mode = need(i); i++; break;
      case '--dir': o.dir = need(i); i++; break;
      case '--model': o.model = need(i); i++; break;
      case '--effort': o.effort = need(i); i++; break;
      case '--timeout': o.timeoutSec = parseTimeout(need(i)); i++; break;
      case '--base': o.base = need(i); i++; break;
      case '--job-dir': o.jobDir = need(i); i++; break;
      case '--raw': o.raw = true; break;
      case '--json': o.json = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--adversarial': o.adversarial = true; break;
      case '--': o.rest.push(...argv.slice(i + 1)); i = argv.length; break;
      default:
        if (a.startsWith('--')) die(`unknown option ${a}`);
        o.rest.push(a);
    }
  }
  if (!['fast', 'balanced', 'deep'].includes(o.tier)) die(`bad --tier "${o.tier}"`);
  if (!['read', 'write', 'yolo'].includes(o.mode)) die(`bad --mode "${o.mode}"`);
  if (o.dir && !fs.existsSync(o.dir)) die(`--dir does not exist: ${o.dir}`);
  o.dir = o.dir || process.cwd();
  return o;
}

function printResult(r, o, header) {
  if (o.json) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    return;
  }
  const lines = [];
  if (header) lines.push(header);
  if (r.argv) {
    lines.push(r.argv.map((x) => (/[\s"]/.test(x) ? JSON.stringify(x) : x)).join(' '));
    if (r.stdin) lines.push('(task is sent on stdin)');
  }
  if (r.text) lines.push(r.text.trimEnd());
  if (r.kind) lines.push(`[tribridge] ERROR ${r.kind}: ${r.detail || ''}`);
  for (const w of r.warnings || []) lines.push(`[tribridge] warning: ${w}`);
  if (r.changes) lines.push(`[tribridge] files changed (git): ${r.changes.length ? r.changes.join(', ') : 'none'}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------- commands
async function cmdDelegate(argv, cfg) {
  const o = parseDelegateArgs(argv, cfg);
  if (!o.to) die('delegate needs --to <agent>');
  const targets = resolveTargets(o.to);
  if (targets.length !== 1) die('delegate takes exactly one --to agent (use review for several)');
  let task = o.rest.join(' ').trim();
  if (task === '-') task = readStdin();
  else if (!process.stdin.isTTY && o.rest.length === 0) task = readStdin();
  if (!task.trim()) die('no task given');
  const r = await delegate({ ...o, to: targets[0], prompt: task }, cfg);
  printResult(r, o);
  if (o.jobDir) jobs.writeJobExit(o.jobDir, r.exit);
  return r.exit;
}

function gitDiff(dir, base, paths) {
  const run = (args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const tail = paths.length ? ['--', ...paths] : [];
  if (base) {
    const r = run(['diff', base, ...tail]);
    if (r.status !== 0) die(`git diff ${base} failed: ${r.stderr.trim()}`);
    return { diff: r.stdout, scope: `${base}..working tree` };
  }
  let r = run(['diff', 'HEAD', ...tail]);
  if (r.status !== 0) die(`not a git repo (or no commits): ${r.stderr.trim()}`);
  if (r.stdout.trim()) return { diff: r.stdout, scope: 'uncommitted changes' };
  r = run(['diff', 'HEAD~1', 'HEAD', ...tail]);
  return { diff: r.status === 0 ? r.stdout : '', scope: 'last commit' };
}

async function cmdReview(argv, cfg) {
  const o = parseDelegateArgs(argv, cfg);
  if (o.mode !== 'read') die('review is always read-only');
  const targets = resolveTargets(o.to || 'others');
  const { diff, scope } = gitDiff(o.dir, o.base, o.rest);
  if (!diff.trim()) die('nothing to review: the diff is empty');

  const prompt = [
    'You are an independent code reviewer. Another AI model wrote or is reviewing this change too; you will not see its opinion, so be your own judge.',
    `Review this diff (${scope}). You may open files in the workspace for context.`,
    'Find real problems: correctness bugs, security issues, data loss, race conditions, broken edge cases, performance traps.',
    o.adversarial ? 'Also challenge the design: is this the right approach at all? What would break it in production?' : '',
    'Be skeptical but do not invent problems — every finding must point at concrete code.',
    '',
    'Reply ONLY with findings, most severe first, one per line:',
    '  <file>:<line> — <critical|high|medium|low> — <the problem> — <why it breaks / how to trigger>',
    'If you find nothing real, reply exactly: NO FINDINGS',
    '',
    '```diff',
    diff,
    '```',
  ].filter((l) => l !== '').join('\n');

  const tier = argv.includes('--tier') ? o.tier : 'deep';
  const results = await Promise.all(targets.map((to) => delegate({ ...o, to, tier, mode: 'read', raw: true, prompt }, cfg)));
  let ok = 0;
  targets.forEach((to, i) => {
    printResult(results[i], o, `\n## ${LABEL[to]} [${to}]`);
    if (!results[i].kind) ok++;
  });
  if (!o.json) {
    process.stdout.write(`\n[tribridge] ${ok}/${targets.length} reviewers answered. `
      + 'Findings reported independently by 2+ models are the strongest signal; verify every finding against the code before acting.\n');
  }
  return ok > 0 ? 0 : results[0].exit;
}

async function cmdJob(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'start') {
    if (!rest.includes('--to')) die('job start needs --to <agent>');
    const id = jobs.startJob(__filename, rest);
    process.stdout.write(`${id}\n`);
    return 0;
  }
  if (sub === 'status') {
    if (rest[0]) {
      const s = jobs.jobState(rest[0]);
      if (!s) die(`no job ${rest[0]}`);
      process.stdout.write(`${s.id}  ${s.state}  started ${s.started}\n  ${s.args.join(' ').slice(0, 200)}\n`);
      return 0;
    }
    const list = jobs.listJobs();
    if (!list.length) process.stdout.write('no jobs\n');
    for (const s of list.slice(0, 20)) process.stdout.write(`${s.id}  ${s.state.padEnd(14)} ${s.args.join(' ').slice(0, 90)}\n`);
    return 0;
  }
  if (sub === 'result') {
    if (!rest[0]) die('job result <id>');
    const r = jobs.jobResult(rest[0]);
    if (!r.state) die(`no job ${rest[0]}`);
    if (r.state.state === 'running') { process.stdout.write(`${rest[0]} is still running\n`); return 0; }
    process.stdout.write(r.out);
    const errTail = r.err.split(/\r?\n/).filter((l) => l && !l.startsWith('TRIBRIDGE_USAGE')).slice(-10).join('\n');
    if (errTail) process.stderr.write(`${errTail}\n`);
    return r.state.exit ? r.state.exit.exit : 2;
  }
  if (sub === 'cancel') {
    if (!rest[0]) die('job cancel <id>');
    if (!jobs.cancelJob(rest[0])) die(`no job ${rest[0]}`);
    process.stdout.write(`cancelled ${rest[0]}\n`);
    return 0;
  }
  die('job start|status|result|cancel');
}

function cmdInstall(argv, remove) {
  const which = argv[0] === 'all' ? ['codex', 'agy', 'claude'] : argv;
  if (!which.length) die(`${remove ? 'uninstall' : 'install'} codex|agy|claude|all`);
  let code = 0;
  for (const w of which) {
    try {
      if (w === 'codex') process.stdout.write(`${remove ? inst.uninstallCodex() : inst.installCodex()}\n`);
      else if (w === 'agy') process.stdout.write(`${remove ? inst.uninstallAgy() : inst.installAgy()}\n`);
      else if (w === 'claude') process.stdout.write(`${remove ? 'claude: remove it with /plugin uninstall tribridge@tribridge' : inst.claudeInstructions()}\n`);
      else die(`unknown host "${w}"`);
    } catch (e) {
      process.stderr.write(`${e.message}\n`);
      code = 2;
    }
  }
  return code;
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const cfg = loadConfig();
  switch (cmd) {
    case 'delegate': return cmdDelegate(argv, cfg);
    case 'review': return cmdReview(argv, cfg);
    case 'job': return cmdJob(argv);
    case 'doctor': {
      const { doctor } = require('../lib/doctor');
      const r = await doctor();
      process.stdout.write(`${r.text}\n`);
      return r.ok ? 0 : 2;
    }
    case 'install': return cmdInstall(argv, false);
    case 'uninstall': return cmdInstall(argv, true);
    case 'host': {
      const h = detectHost();
      process.stdout.write(`host: ${h || 'unknown (a plain terminal?)'}\nothers: ${AGENTS.filter((a) => a !== h).join(', ')}\n`);
      return 0;
    }
    case 'config':
      process.stdout.write(`${configPath()}\n${JSON.stringify(cfg, null, 2)}\n`);
      return 0;
    case undefined: case '-h': case '--help': case 'help':
      process.stdout.write(`${USAGE}\n`);
      return 0;
    default:
      die(`unknown command "${cmd}"\n\n${USAGE}`);
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`tribridge: ${e.stack || e}\n`); process.exitCode = 2; });
