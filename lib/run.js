'use strict';
// Spawn a child process with no shell, an optional stdin payload, and a
// wall-clock timeout that kills the whole process tree (agents spawn their own
// children — MCP servers, shells — and a plain kill leaves them holding pipes).

const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (IS_WIN) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000).unref();
    }
  } catch {
    try { child.kill('SIGKILL'); } catch {}
  }
}

/**
 * @param {{cmd:string, args:string[], input?:string|null, cwd?:string, env?:object, timeoutMs?:number}} o
 * @returns {Promise<{code:number|null, stdout:string, stderr:string, timedOut:boolean, ms:number, spawnError?:Error}>}
 */
function runProcess(o) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let child;
    try {
      child = spawn(o.cmd, o.args, {
        cwd: o.cwd || process.cwd(),
        env: o.env || process.env,
        // stdin must never be an inherited TTY/pipe the agent can block on.
        stdio: [o.input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !IS_WIN, // own process group on POSIX so killTree reaches grandchildren
      });
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: String(err), timedOut: false, ms: 0, spawnError: err });
      return;
    }
    const out = [];
    const err = [];
    let timedOut = false;
    let timer = null;
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    if (o.input != null) {
      child.stdin.on('error', () => {}); // agent exited before reading all input
      child.stdin.end(o.input);
    }
    if (o.timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; killTree(child); }, o.timeoutMs);
    }
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: null, stdout: '', stderr: String(e), timedOut: false, ms: Date.now() - t0, spawnError: e });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
        ms: Date.now() - t0,
      });
    });
  });
}

module.exports = { runProcess, killTree, IS_WIN };
