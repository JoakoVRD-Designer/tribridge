# Changelog

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
