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
5. When the user requests a fresh Codex session, explain that `contextbridge next --agent codex` starts one interactively in the project directory from the latest verified checkpoint. Run it in the user's terminal with `--project` if needed.
6. Explain that this version **does not** install hooks, monitor context-window occupancy, archive the conversation, or perform automatic rollover.

Never claim that a checkpoint contains the full conversation or that a task passed tests unless there is independent evidence. Do not include credentials or hidden reasoning.
