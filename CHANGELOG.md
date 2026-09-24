# Changelog

## 0.3.1 — 2026-09-24

- agy: told to use its file tools instead of the terminal when commands are not granted. Measured on
  agy 1.2.9: Flash tried a terminal command first, was auto-denied and ended with no reply (exit 15,
  3/3 runs); with the instruction it answered 3/3.
- One automatic retry on transient network errors (e.g. agy's sign-in check failing with `EOF`), only
  when nothing was produced and no file changed.
- Footer now shows `[tribridge] workspace: <dir>`, and warns when `--dir` is Antigravity's scratch
  folder (its terminal starts there, so `--dir .` typed inside agy missed the project). The skill asks
  for an absolute project path.

## 0.3.0 — 2026-09-24

- Native plugin in all three hosts: Codex (`codex plugin marketplace add JoakoVRD-Designer/tribridge`,
  via `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`) and Antigravity
  (`agy plugin install <clone>`, via `plugin.json`), alongside the Claude Code plugin.
- `tribridge install codex|agy` now runs those native installers instead of linking skills by hand.
- Commands and the delegate subagent are host-neutral (agy loads them too) and check `tribridge host` first.
- Codex CLI is found in the npm folder even when it is not on PATH.

## 0.2.0 — 2026-09-24

- `tribridge models [agent]`: the models each agent can actually run (live from `codex debug models` and `agy models`; Claude aliases and ids).
- `tribridge model set|show|reset`: switch each agent's model and effort, per tier or all tiers, saved in `~/.tribridge/config.json`; unknown models and unsupported effort levels are rejected.
- `/tribridge:model` command in Claude Code.
- `--model` / `--effort` accept a per-agent map (`codex=…,agy=…`); `review` no longer sends one agent's model to every reviewer.

## 0.1.0 — 2026-09-23

- First version: `delegate`, `review`, `job`, `doctor`, `install`, `host`, `config`.
- Adapters for Claude Code (`claude -p`), Codex (`codex exec`) and Antigravity (`agy -p`).
- Claude Code plugin (skill, 4 commands, `tribridge-delegate` subagent with a fail-closed Bash gate, SessionStart hook).
- Shared skill registered with Codex (`~/.codex/skills`) and Antigravity (`~/.gemini/config/skills.json`).
