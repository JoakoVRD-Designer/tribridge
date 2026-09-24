#!/usr/bin/env node
'use strict';
// PreToolUse gate for the tribridge-delegate subagent: allow exactly one
// `tribridge delegate|job|host …` command — no pipes, redirects, chaining, expansion or
// substitution — so the subagent cannot run arbitrary shell or write files.
// Fails closed: any error in the gate itself denies the command.

function deny(why) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `tribridge-delegate may only run a single \`tribridge delegate|job|host ...\` command (${why}).`,
    },
  }));
  process.exit(0);
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try {
    const { isAllowed } = require('./only-tribridge-lib');
    const cmd = JSON.parse(raw).tool_input.command || '';
    const verdict = isAllowed(cmd);
    if (verdict.ok) process.exit(0);
    deny(verdict.why);
  } catch (e) {
    deny(`gate error: ${e.message}`);
  }
});
