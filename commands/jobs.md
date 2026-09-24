---
description: List, collect or cancel background tribridge delegations.
argument-hint: "[result <id> | cancel <id>]"
---

If `$ARGUMENTS` is empty run `tribridge job status`; otherwise run `tribridge job $ARGUMENTS`.
For a finished job's result, verify it before relying on it (footer, tests, diff), as with any delegation.
