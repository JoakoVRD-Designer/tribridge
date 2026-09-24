'use strict';
// Background delegations: fire now, collect later. Each job is a directory under
// ~/.tribridge/jobs/<id> holding meta.json, out.txt, err.txt and (when done) exit.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { homeDir } = require('./config');
const { killTree, IS_WIN } = require('./run');

function jobsDir() { return path.join(homeDir(), 'jobs'); }
function jobDir(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`bad job id: ${id}`);
  return path.join(jobsDir(), id);
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Start `tribridge delegate <args>` detached; returns the job id. */
function startJob(cliPath, delegateArgs) {
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const out = fs.openSync(path.join(dir, 'out.txt'), 'w');
  const err = fs.openSync(path.join(dir, 'err.txt'), 'w');
  const child = spawn(process.execPath, [cliPath, 'delegate', '--job-dir', dir, ...delegateArgs], {
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    cwd: process.cwd(),
  });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    id, pid: child.pid, args: delegateArgs, cwd: process.cwd(), started: new Date().toISOString(),
  }, null, 2));
  child.unref();
  fs.closeSync(out);
  fs.closeSync(err);
  return id;
}

function jobState(id) {
  const dir = jobDir(id);
  const meta = readJson(path.join(dir, 'meta.json'));
  if (!meta) return null;
  const exit = readJson(path.join(dir, 'exit.json'));
  let state;
  if (exit) state = exit.cancelled ? 'cancelled' : `done (exit ${exit.exit})`;
  else state = isAlive(meta.pid) ? 'running' : 'died';
  return { ...meta, state, exit };
}

function listJobs() {
  let ids = [];
  try { ids = fs.readdirSync(jobsDir()); } catch {}
  return ids.sort().reverse().map(jobState).filter(Boolean);
}

function jobResult(id) {
  const dir = jobDir(id);
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  return { state: jobState(id), out: read('out.txt'), err: read('err.txt') };
}

function cancelJob(id) {
  const st = jobState(id);
  if (!st) return false;
  if (st.state === 'running') {
    killTree({ pid: st.pid, exitCode: null, kill() {} });
    if (!IS_WIN) { try { process.kill(st.pid, 'SIGTERM'); } catch {} }
  }
  if (!st.exit) fs.writeFileSync(path.join(jobDir(id), 'exit.json'), JSON.stringify({ exit: 130, cancelled: true }));
  return true;
}

function writeJobExit(dir, exit) {
  try { fs.writeFileSync(path.join(dir, 'exit.json'), JSON.stringify({ exit, finished: new Date().toISOString() })); } catch {}
}

module.exports = { startJob, listJobs, jobResult, cancelJob, jobState, writeJobExit };
