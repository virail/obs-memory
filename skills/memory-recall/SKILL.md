---
name: memory-recall
description: Recall the user's observed work history from the obs-memory store. Use when the user asks about past work, decisions, files, or topics, and to combine related observations across sessions.
license: MIT
metadata:
  source: "@virail/obs-memory"
---

# Memory recall

You can read the user's observational memory to support continuity across sessions. Use this when the user asks about something that may have been worked on before, references prior context, or when combining history on a topic would help.

## Where memory lives

The store is global:

```
~/.config/opencode/memory/
```

Each session has a folder `<sessionID>/` containing:

- `observations.md` — the raw observation buffer for the session.
- `topics/*.md` — consolidated observations grouped by topic. Each file has YAML frontmatter (`id`, `title`, `summary`, `updated`) followed by observations.
- `journey.md` — a per-consolidation activity log (tag counts, areas, notable content).
- `index.md` — a markdown table of all topics for the session, most recently updated first.

The current session's folder is the one modified most recently.

## How to recall

1. **Current session summary**: read `observations.md`, `index.md`, and `journey.md` in the most recently modified session folder. Report buffer count, topics, and recent journey.
2. **Topic across all sessions**: list `**/topics/*.md`, read the ones whose `title` or `id` matches the requested topic, and combine the findings. If a topic has no file yet, grep the `observations.md` buffers instead.
3. **Everything on a file/knowledge area**: cross-reference the topic files and the indexes via `grep` for the file or area name.

Actionable questions, when they arise:

- If a session has only `observations.md` and no consolidated files, consolidation has not run yet for that session. Say so rather than guessing.
- When combining across sessions, report the session ID each piece of memory came from, so the user can trace provenance.
- If a requested topic has no memory at all, say clearly that nothing was recorded for it — do not fabricate a summary.