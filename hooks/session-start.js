#!/usr/bin/env node
'use strict';
// SessionStart: remind Claude that Codex and Antigravity are available, and of the
// discipline that makes delegating worth it. Silence with TRIBRIDGE_POLICY=off.

if (/^(off|false|0|no)$/i.test(process.env.TRIBRIDGE_POLICY || '')) process.exit(0);

const context = [
  'tribridge is installed: you can delegate to OpenAI Codex (`codex`) and Google Antigravity/Gemini (`agy`)',
  'with `tribridge delegate --to <agent> ...`, and get an independent review of a diff from both with `tribridge review`.',
  'Delegate only bulky, well-specified work or when a different model\'s opinion or capability helps (agy: web search,',
  'audio/video, huge files; codex: precise implementation and line-level review). Do small or judgement-heavy work yourself.',
  'Always verify what comes back — check the `[tribridge] files changed` footer, run the tests, read the diff.',
  'The `tribridge` skill has the details.',
].join(' ');

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
