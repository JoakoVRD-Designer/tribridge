'use strict';
// Which agent is running us, and a clean environment for the agent we launch.
//
// Measured: each agent's shell inherits the markers of every agent above it — an
// agy launched from Claude Code sees CLAUDECODE=1 *and* its own ANTIGRAVITY_* vars,
// plus Claude's messaging token. So detection checks the innermost markers first,
// and childEnv() strips session markers/tokens before handing the env to a delegate.

const HOST_MARKERS = [
  ['agy', /^ANTIGRAVITY_(AGENT|CONVERSATION_ID|TRAJECTORY_ID)$/],
  ['codex', /^CODEX_(THREAD_ID|SANDBOX|SANDBOX_NETWORK_DISABLED|SESSION_ID|CI)$/],
  ['claude', /^CLAUDECODE$/],
];

// Session-scoped variables that identify (or authenticate to) the parent session.
// Config variables such as CLAUDE_CODE_USE_VERTEX or CODEX_HOME are deliberately kept.
const STRIP = [
  /^CLAUDECODE$/,
  /^CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|ENTRYPOINT|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED)$/,
  /^CLAUDE_(PID|EFFORT)$/,
  /^ANTIGRAVITY_(AGENT|AGENTAPI_EXE|CONVERSATION_ID|CSRF_TOKEN|LS_ADDRESS|LS_VERSION|PROJECT_ID|SOURCE_METADATA|TRAJECTORY_ID)$/,
  /^CODEX_(THREAD_ID|SANDBOX|SANDBOX_NETWORK_DISABLED|SESSION_ID)$/,
];

function detectHost(env = process.env) {
  if (env.TRIBRIDGE_HOST) return env.TRIBRIDGE_HOST;
  const keys = Object.keys(env);
  for (const [agent, re] of HOST_MARKERS) if (keys.some((k) => re.test(k))) return agent;
  return null;
}

function childEnv(env = process.env, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!STRIP.some((re) => re.test(k))) out[k] = v;
  return { ...out, ...extra };
}

module.exports = { detectHost, childEnv };
