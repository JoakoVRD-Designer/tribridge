---
description: See or switch which model Claude Code, Codex and Antigravity (Gemini) use when tribridge delegates to them.
argument-hint: "[<agent> <model> [--tier fast|balanced|deep|all] [--effort <level>]] | list [agent] | reset [agent]"
---

Manage tribridge's model choice. Arguments: $ARGUMENTS

- No arguments: run `tribridge model` and show the user the current model/effort per agent and tier.
- `list [agent]`: run `tribridge models [agent]` and show the available models (the `*` ones are in use).
- `reset [agent]`: run `tribridge model reset [agent]`.
- Otherwise the user named an agent and a model, possibly loosely ("codex gpt 6 astra", "gemini pro"):
  run `tribridge models <agent>` to find the exact id, then
  `tribridge model set <agent> <exact-id> [--tier …] [--effort …]`. Without `--tier` it applies to every tier.
  If the name matches several models, ask the user which one.

Show the resulting table. The change is saved and used by every later delegation and review.
