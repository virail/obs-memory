---
description: Combine all memory across all sessions for a topic
---

Combine everything the user's observational memory stores about the topic: "$ARGUMENTS".

1. Search the global memory store at `~/.config/opencode/memory`.
2. Across every session, read `topics/*.md` whose frontmatter `title` or `id` matches the topic, and read `index.md` for context on that topic.
3. If no topic file matches, grep the per-session `observations.md` buffers for the topic.
4. Produce one consolidated summary: current state of the topic, key facts, changes over time, and which sessions contributed.

Report the session ID and date for each piece of memory. If nothing is recorded for the topic, say so clearly.