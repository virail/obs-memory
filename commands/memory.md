---
description: Show the current session's memory buffer, index, and journey
---

Show a breakdown of the current session's observational memory.

1. Find the current session folder in `~/.config/opencode/memory` (the folder modified most recently).
2. Read `observations.md` (the raw buffer), `index.md` (topics), and `journey.md` (activity log).
3. Report:
   - Buffer: character count and number of observations.
   - Topics: the table from `index.md`.
   - Journey: the recent segments from `journey.md`.
   - Any topic files under `topics/` not yet in the index.

If the session has only `observations.md` and no consolidated files, state that consolidation has not run yet.