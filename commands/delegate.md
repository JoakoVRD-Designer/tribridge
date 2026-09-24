---
description: Delegate a task to another AI agent (Claude Code, Codex or Antigravity/Gemini — not yourself) via tribridge, then verify the result.
argument-hint: "--to claude|codex|agy [--tier fast|balanced|deep] [--mode read|write] <task>"
---

Delegate this task with the `tribridge` skill: $ARGUMENTS

1. Run `tribridge host` to see which agent you are; never delegate to yourself. If no `--to` was given,
   pick the agent that fits (agy: bulk work, web search, audio/video, huge files · codex: precise
   implementation, debugging · claude: architecture, careful refactors). If the task is small, do it yourself.
2. Write the task so it stands alone — the other agent cannot see this conversation. Say what done looks like.
3. Run `tribridge delegate --to <agent> --dir <repo root> [--mode write] "<task>"`. If it may take more
   than ~2 minutes, use `tribridge job start …` instead, and collect it with `/tribridge:jobs`.
4. Verify: read the `[tribridge] files changed` footer, run the tests or build, review `git diff`.
5. Report what you delegated, to whom, and how you verified it.
