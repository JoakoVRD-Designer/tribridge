# Changelog

## 0.1.0 — 2026-09-23

- First version: `delegate`, `review`, `job`, `doctor`, `install`, `host`, `config`.
- Adapters for Claude Code (`claude -p`), Codex (`codex exec`) and Antigravity (`agy -p`).
- Claude Code plugin (skill, 4 commands, `tribridge-delegate` subagent with a fail-closed Bash gate, SessionStart hook).
- Shared skill registered with Codex (`~/.codex/skills`) and Antigravity (`~/.gemini/config/skills.json`).
