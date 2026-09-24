#!/usr/bin/env node
'use strict';
// Stand-in for claude / codex / agy in tests. Behaviour comes from FAKE_BEHAVIOR:
//   ok | quota | auth | hang | write | empty | agy-denied | env
// It records argv + stdin to FAKE_RECORD (if set) so tests can assert on them.

const fs = require('fs');
const path = require('path');

const kind = process.env.FAKE_KIND; // claude | codex | agy
const behavior = process.env.FAKE_BEHAVIOR || 'ok';
const argv = process.argv.slice(2);
let stdin = '';
try { if (!process.stdin.isTTY) stdin = fs.readFileSync(0, 'utf8'); } catch {}
if (process.env.FAKE_RECORD) fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv, stdin, cwd: process.cwd(), env: process.env }));

if (behavior === 'hang') setInterval(() => {}, 1000);
else run();

function reply(text) {
  if (kind === 'claude') {
    process.stdout.write(JSON.stringify({ result: text, is_error: false, usage: { input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.01, permission_denials: [] }));
  } else if (kind === 'codex') {
    const o = argv[argv.indexOf('-o') + 1];
    fs.writeFileSync(o, text);
    process.stderr.write('model: fake-gpt\ntokens used\n1,234\n');
  } else {
    process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: text, usage: { input_tokens: 3, output_tokens: 4 } }));
  }
}

function run() {
  switch (behavior) {
    case 'ok': reply('DONE'); break;
    case 'empty': reply(''); break;
    case 'env': reply(Object.keys(process.env).filter((k) => /^(CLAUDE|ANTIGRAVITY|CODEX|TRIBRIDGE)/.test(k)).sort().join(' ')); break;
    case 'write': fs.writeFileSync(path.join(process.cwd(), 'made-by-agent.txt'), 'x'); reply('wrote it'); break;
    case 'quota':
      process.stderr.write('Error: 429 Too Many Requests: rate limit exceeded\n');
      process.exit(1);
      break;
    case 'auth':
      if (kind === 'agy') { process.stdout.write(JSON.stringify({ status: 'ERROR', error: 'authentication required: please sign in' })); process.exit(1); }
      process.stderr.write('Not logged in. Please run login.\n');
      process.exit(1);
      break;
    case 'flaky': {
      const marker = `${process.env.FAKE_RECORD}.flaky`;
      if (!fs.existsSync(marker)) {
        fs.writeFileSync(marker, '1');
        process.stderr.write('Eligibility check failed: Get "https://example/userinfo": EOF\n');
        process.exit(1);
      }
      reply('DONE');
      break;
    }
    case 'agy-denied':
      process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: '', denied_actions: [{ tool: 'write_file' }] }));
      break;
    default: process.exit(9);
  }
}
