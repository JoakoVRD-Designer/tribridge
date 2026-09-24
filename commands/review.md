---
description: Independent review of the current diff by Codex and Antigravity (Gemini) in parallel; you reconcile.
argument-hint: "[--base <ref>] [--adversarial] [--to codex,agy] [-- paths]"
---

Run `tribridge review $ARGUMENTS` from the repo root (it can take a few minutes; if your shell
times out, rerun it with a larger Bash timeout).

Then reconcile the findings as the final judge:
- Check every finding against the actual code. Drop what is wrong, and say why.
- Findings raised independently by both reviewers are the strongest signal; single-reviewer ones need a closer look.
- Report the confirmed findings, most severe first, with `file:line`, and your verdict. Do not fix anything unless asked.
