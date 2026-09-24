'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { parseCmdShim } = require('../lib/resolve');
const { detectHost, childEnv } = require('../lib/host');
const { isAllowed } = require('../hooks/only-tribridge-lib');
const { adapters } = require('../lib/agents');
const { DEFAULTS } = require('../lib/config');

const CLI = path.join(__dirname, '..', 'bin', 'tribridge.js');
const FAKE = path.join(__dirname, 'fake-agent.js');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tribridge-test-')); }

/** Run the CLI with every agent pointed at the fake. */
function cli(args, { kind = 'codex', behavior = 'ok', env = {}, cwd } = {}) {
  const record = path.join(tmpdir(), 'record.json');
  const home = tmpdir();
  const clean = childEnv(process.env); // tests must not look like they run inside an agent
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    env: {
      ...clean,
      TRIBRIDGE_HOME: home,
      TRIBRIDGE_CLAUDE_BIN: FAKE,
      TRIBRIDGE_CODEX_BIN: FAKE,
      TRIBRIDGE_AGY_BIN: FAKE,
      FAKE_KIND: kind,
      FAKE_BEHAVIOR: behavior,
      FAKE_RECORD: record,
      TRIBRIDGE_DEPTH: '',
      ...env,
    },
  });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(record, 'utf8')); } catch {}
  return { ...r, rec };
}

// ---------------------------------------------------------------- units
test('parseCmdShim finds the exe or js an npm shim launches', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'node_modules', 'x', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'bin', 'x.js'), '');
  const shim = path.join(dir, 'x.cmd');
  fs.writeFileSync(shim, '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\x\\bin\\x.js" %*\r\n');
  assert.strictEqual(parseCmdShim(shim), path.join(dir, 'node_modules', 'x', 'bin', 'x.js'));
});

test('detectHost prefers the innermost agent', () => {
  assert.strictEqual(detectHost({ CLAUDECODE: '1' }), 'claude');
  assert.strictEqual(detectHost({ CLAUDECODE: '1', ANTIGRAVITY_CONVERSATION_ID: 'x' }), 'agy');
  assert.strictEqual(detectHost({ CLAUDECODE: '1', CODEX_THREAD_ID: 'x' }), 'codex');
  assert.strictEqual(detectHost({ PATH: '/bin' }), null);
});

test('childEnv strips session markers and tokens, keeps config', () => {
  const e = childEnv({
    CLAUDECODE: '1', CLAUDE_CODE_MESSAGING_TOKEN: 'secret', ANTIGRAVITY_CSRF_TOKEN: 'secret', CODEX_THREAD_ID: 't',
    CLAUDE_CODE_USE_VERTEX: '1', CODEX_HOME: '/h', PATH: '/bin',
  });
  assert.deepStrictEqual(Object.keys(e).sort(), ['CLAUDE_CODE_USE_VERTEX', 'CODEX_HOME', 'PATH']);
});

test('gate allows one tribridge command and nothing else', () => {
  assert.ok(isAllowed('tribridge delegate --to agy "fix a; b | c"').ok);
  assert.ok(isAllowed("tribridge job start --to codex 'use $HOME literally'").ok);
  for (const bad of [
    'tribridge delegate --to agy x; rm -rf ~',
    'tribridge delegate --to agy "$(cat ~/.ssh/id_rsa)"',
    'tribridge delegate --to agy "$AWS_SECRET_ACCESS_KEY"',
    'tribridge delegate --to agy `id`',
    'tribridge delegate --to agy x > out.txt',
    'tribridge delegate --to agy x\nrm -rf /',
    'cat secrets | tribridge delegate --to agy -',
    'node evil.js delegate',
    'tribridge doctor',
  ]) assert.ok(!isAllowed(bad).ok, bad);
});

test('claude read mode denies anything not pre-approved; yolo bypasses', () => {
  const r = adapters.claude.build({ prompt: 'p', mode: 'read', tier: 'balanced' }, DEFAULTS);
  assert.deepStrictEqual(r.args.slice(-4), ['--permission-mode', 'dontAsk', '--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch']);
  assert.strictEqual(r.input, 'p');
  const y = adapters.claude.build({ prompt: 'p', mode: 'yolo', tier: 'balanced' }, DEFAULTS);
  assert.ok(y.args.includes('bypassPermissions'));
});

test('codex maps modes to sandboxes and reads the prompt from stdin', () => {
  const r = adapters.codex.build({ prompt: 'p', mode: 'write', tier: 'fast', dir: '/w' }, DEFAULTS);
  assert.ok(r.args.join(' ').includes('--sandbox workspace-write'));
  assert.ok(r.args.includes('model_reasoning_effort="low"'));
  assert.strictEqual(r.args[r.args.length - 1], '-');
  assert.strictEqual(process.platform === 'win32', r.args.includes('windows.sandbox="unelevated"'));
});

test('agy moves an over-long prompt into a file instead of argv', () => {
  const r = adapters.agy.build({ prompt: 'x'.repeat(30000), mode: 'read', tier: 'deep', timeoutSec: 600 }, DEFAULTS);
  assert.ok(r.promptFile && fs.existsSync(r.promptFile));
  assert.ok(r.args[r.args.length - 1].includes(r.promptFile));
  assert.ok(r.args.includes('gemini-3.1-pro-high'));
  fs.unlinkSync(r.promptFile);
});

// ---------------------------------------------------------------- end to end (fake agents)
for (const kind of ['claude', 'codex', 'agy']) {
  test(`${kind}: success returns the reply, appends the digest contract, logs usage`, () => {
    const r = cli(['delegate', '--to', kind, 'do the thing'], { kind });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /DONE/);
    assert.match(r.stderr, /TRIBRIDGE_USAGE \{"agent":"/);
    const sent = kind === 'agy' ? r.rec.argv[r.rec.argv.length - 1] : r.rec.stdin;
    assert.match(sent, kind === 'agy' ? /^READ-ONLY TASK[\s\S]*do the thing[\s\S]*===DIGEST===/ : /^do the thing[\s\S]*===DIGEST===/);
  });
}

test('--raw sends the task untouched', () => {
  const r = cli(['delegate', '--to', 'codex', '--raw', 'just this'], { kind: 'codex' });
  assert.strictEqual(r.rec.stdin, 'just this');
});

test('quota -> exit 10, auth -> exit 11, empty -> exit 3', () => {
  assert.strictEqual(cli(['delegate', '--to', 'codex', 'x'], { kind: 'codex', behavior: 'quota' }).status, 10);
  assert.strictEqual(cli(['delegate', '--to', 'codex', 'x'], { kind: 'codex', behavior: 'auth' }).status, 11);
  assert.strictEqual(cli(['delegate', '--to', 'agy', 'x'], { kind: 'agy', behavior: 'auth' }).status, 11);
  assert.strictEqual(cli(['delegate', '--to', 'claude', 'x'], { kind: 'claude', behavior: 'empty' }).status, 3);
});

test('agy denied write -> exit 15 with the fix in the message', () => {
  const r = cli(['delegate', '--to', 'agy', '--mode', 'write', 'x'], { kind: 'agy', behavior: 'agy-denied' });
  assert.strictEqual(r.status, 15);
  assert.match(r.stdout, /write_file/);
});

test('a hung agent is killed at --timeout -> exit 12', () => {
  const t0 = Date.now();
  const r = cli(['delegate', '--to', 'codex', '--timeout', '2s', 'x'], { kind: 'codex', behavior: 'hang' });
  assert.strictEqual(r.status, 12);
  assert.ok(Date.now() - t0 < 20000);
});

test('a delegate cannot delegate again -> exit 14', () => {
  const r = cli(['delegate', '--to', 'codex', 'x'], { env: { TRIBRIDGE_DEPTH: '1' } });
  assert.strictEqual(r.status, 14);
});

test('the delegate does not inherit the parent session token', () => {
  const r = cli(['delegate', '--to', 'codex', '--raw', 'x'], {
    kind: 'codex', behavior: 'env', env: { CLAUDECODE: '1', CLAUDE_CODE_MESSAGING_TOKEN: 'secret' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /CLAUDE_CODE_MESSAGING_TOKEN|CLAUDECODE/);
  assert.match(r.stdout, /TRIBRIDGE_DEPTH/);
});

test('git footer reports what a write run changed, and flags a write that changed nothing', () => {
  const repo = tmpdir();
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const w = cli(['delegate', '--to', 'codex', '--mode', 'write', '--dir', repo, 'x'], { kind: 'codex', behavior: 'write' });
  assert.match(w.stdout, /files changed \(git\): made-by-agent\.txt/);
  const n = cli(['delegate', '--to', 'codex', '--mode', 'write', '--dir', repo, 'x'], { kind: 'codex', behavior: 'ok' });
  assert.match(n.stdout, /may not have happened/);
});

test('review sends the diff to every agent except the host', () => {
  const repo = tmpdir();
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  const r = cli(['review', '--dir', repo], { kind: 'codex', env: { TRIBRIDGE_HOST: 'claude' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /## Codex \[codex\]/);
  assert.match(r.stdout, /## Antigravity \(Gemini\) \[agy\]/);
  assert.doesNotMatch(r.stdout, /## Claude Code/);
});

test('background job: start, then collect the result', async () => {
  const home = tmpdir();
  const env = { ...childEnv(process.env), TRIBRIDGE_HOME: home, TRIBRIDGE_CODEX_BIN: FAKE, FAKE_KIND: 'codex', FAKE_BEHAVIOR: 'ok', TRIBRIDGE_DEPTH: '' };
  const start = spawnSync(process.execPath, [CLI, 'job', 'start', '--to', 'codex', 'x'], { encoding: 'utf8', env });
  const id = start.stdout.trim();
  assert.match(id, /^\d{14}-[0-9a-f]{6}$/);
  let res;
  for (let i = 0; i < 60; i++) {
    res = spawnSync(process.execPath, [CLI, 'job', 'result', id], { encoding: 'utf8', env });
    if (!/still running/.test(res.stdout)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.match(res.stdout, /DONE/);
  assert.strictEqual(res.status, 0);
});
