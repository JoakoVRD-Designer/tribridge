---
name: tribridge
description: Delegate work to, or get an independent review from, another AI coding agent — Claude Code (claude), OpenAI Codex (codex) or Google Antigravity/Gemini (agy) — through the `tribridge` CLI. Use when the user asks to "ask Codex / Gemini / Claude", "get a second opinion", "cross-review this diff", "delegate", "have another model do X", "search the web with Gemini", "transcribe/understand this video or audio", or when a bulky, well-specified chunk of work (scaffolding, test generation, migrations, long-context reading) is cheaper to hand off than to do yourself. You stay the one who verifies.
---

# tribridge — three agents, one bridge

You are one of three agents: **Claude Code** (`claude`), **Codex** (`codex`), **Antigravity/Gemini** (`agy`).
`tribridge` lets you hand a task to one of the *other* two and get back a digest, or have
them review a diff independently. Run `tribridge host` to see which one you are and
which are "others". Never delegate to yourself.

If `tribridge` is not on PATH, run `node <this skill's folder>/../../bin/tribridge.js` instead.

## When to delegate — and when not to

Delegate when the offloaded work clearly outweighs the round-trip (writing the spec,
waiting, verifying):
- **bulk, well-specified work**: scaffolding, boilerplate, exhaustive test generation, mechanical migrations
- **a second, different-model opinion**: code review, a tricky bug, a design you are unsure about
- **a capability the other agent has and you lack** (see below)

Do **not** delegate small, quick, or judgement-heavy tasks — do those yourself. A tiny delegation costs more than it saves.

## Who is good at what (rules of thumb, not benchmarks)

| agent | reach for it for |
|---|---|
| `agy` (Gemini) | cheap high-volume work, very long files/logs, **Google web search**, **audio / video / image understanding**, Google Cloud |
| `codex` (GPT) | precise implementation, debugging, rigorous line-level code review |
| `claude` | architecture and trade-offs, ambiguous requirements, careful refactors, writing |

## How

```bash
# one task, one agent (read-only by default)
tribridge delegate --to agy --tier fast --dir C:/work/shop "Map every call site of parseConfig in this repo; file:line list only."

# let it edit files in the workspace
tribridge delegate --to codex --mode write --dir C:/work/shop "Add unit tests for src/cart.ts covering the empty-cart and discount cases."

# independent review of the current diff by every other agent, in parallel
tribridge review --dir C:/work/shop    # uncommitted changes (else the last commit)
tribridge review --dir C:/work/shop --base main --adversarial

# long task: run in the background, keep working, collect later
ID=$(tribridge job start --to agy --tier deep "…")
tribridge job status $ID ; tribridge job result $ID
```

## Choosing the model of each agent

Each agent has three tiers (`fast`, `balanced` = default, `deep` = default for reviews), each with a model and a reasoning effort.
When the user asks to switch models ("use GPT-6 Astra in Codex", "Gemini Pro for everything", "Claude Opus for reviews"):

```bash
tribridge models codex                                  # exact ids available (* = in use)
tribridge model set codex gpt-6-astra                   # every tier; saved for later calls
tribridge model set agy gemini-3.1-pro-high --tier deep # only one tier
tribridge model set claude opus --effort high
tribridge model                                         # show the current choice
tribridge model reset codex                             # back to defaults
```

For one call only, pass `--model` / `--effort` (with several reviewers: `--model codex=gpt-6-astra,agy=gemini-3.1-pro-high`).

Options: `--tier fast|balanced|deep` · `--mode read|write|yolo` · `--dir <path>` ·
`--model <exact>` · `--timeout 10m` · `--raw` (no digest contract) · `--dry-run`.

Always pass `--dir <absolute path of the project>` for repo work so the other agent reads real
files — never paste large files into the task. Use an absolute path, not `.`: your terminal may
not start in the project (Antigravity's starts in its own scratch folder). The footer line
`[tribridge] workspace: …` shows the folder the other agent actually worked in. Write the task so it stands alone: the other agent does not
see this conversation. Say what "done" looks like.

**Modes.** `read` cannot write (enforced for claude and codex; for `agy` it is an instruction,
so check the git footer). `write` edits files inside `--dir` (`agy` writes only where the folder
is in its `trustedWorkspaces` or has a `write_file(<dir>)` rule in
`~/.gemini/antigravity-cli/settings.json`; otherwise exit 15). `yolo` auto-approves *everything on the whole machine* — only on a
throwaway branch, and only if the user agreed.

**Long tasks.** If your shell tool has a time limit (Claude Code's is about 2 minutes by
default), use `tribridge job start` rather than waiting on a synchronous call.

## Verifying is your job

The other agent's "done" is a claim, not evidence.
1. Read the `[tribridge]` footer: `files changed (git): …` lists what *actually* changed.
   A write task with "none", or a read task that changed files, needs a look.
2. Check the result yourself: run the tests or build, read the diff (`git diff`), open cited URLs.
3. For reviews: check each finding against the code before acting. Findings reported
   independently by two models are the strongest signal; one model alone may be wrong.
4. Tell the user what you delegated, to whom, and how you verified it.

Keep your own context lean: use the digest, and don't re-read everything the other agent
already processed unless verification needs it. If the footer warns the reply "looks like
a dump", don't ingest it whole — ask again for a digest.

## Exit codes

`0` ok · `2` failed · `3` empty · `10` quota/rate limit (try another agent) · `11` not signed in
(`tribridge doctor` shows the fix) · `12` timeout (raise `--timeout` or narrow the task) ·
`13` CLI missing · `14` nested delegation refused (a delegate cannot delegate again) · `15` permission denied ·
`16` **your own sandbox** blocked launching the other agent.

**If you run inside a sandbox (e.g. Codex):** `tribridge` must start another program outside the
workspace, and that program needs the network. Run `tribridge` commands with escalated / unsandboxed
permissions (ask the user to approve) from the start. On exit `16`, rerun the same command that way.
