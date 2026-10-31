---
name: contextbridge
description: Preserve verifiable project state for a fresh coding-agent session.
---

# ContextBridge (foundation preview)

Use the ContextBridge CLI to prepare a manually validated local work-state checkpoint when the user asks to transfer work into a fresh session.

1. Confirm the project root.
2. Describe the active objective and concrete next step accurately.
3. Review any significant architectural decisions with the user.
4. Invoke the `checkpoint` command with explicit arguments, then `verify`.
5. Explain that this version **does not** install hooks, monitor context-window occupancy, archive the conversation, or start a new Claude Code session. Assisted Codex handoff is available separately through `contextbridge next --agent codex`.

Never claim that a checkpoint contains the full conversation or that a task passed tests unless there is independent evidence. Do not include credentials or hidden reasoning.
