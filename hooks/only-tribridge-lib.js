'use strict';

/**
 * Allow exactly one `tribridge delegate|job …` command. Outside single quotes, refuse
 * every shell metacharacter and every `$` (expansion could ship an env secret or a
 * file's contents to an external model).
 */
function isAllowed(cmd) {
  const s = String(cmd).trim();
  if (!/^tribridge\s+(delegate|job)\b/.test(s)) return { ok: false, why: 'not a tribridge delegate/job command' };
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '\n' || c === '\r') return { ok: false, why: 'newline' };
    if (quote === '"') {
      if (c === '\\') { i++; continue; }
      if (c === '"') quote = null;
      else if (c === '`' || c === '$') return { ok: false, why: `"${c}" inside double quotes` };
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '\\') { i++; continue; }
    if (/[;&|<>`$(){}*?~!]/.test(c)) return { ok: false, why: `shell metacharacter "${c}"` };
  }
  if (quote) return { ok: false, why: 'unterminated quote' };
  return { ok: true };
}

module.exports = { isAllowed };
