# Agent integrations

The files under `integrations/` are development templates, not automatically installed integrations.

`contextbridge next --agent codex` is implemented in the CLI and does not require installing these templates. It starts a fresh interactive session using verified snapshot data. Claude Code handoff remains unimplemented.

Optional Codex hooks are implemented through the explicit `contextbridge hooks install --agent codex` workflow, independently of these templates. Installation requires opt-in and the checked Codex version; provider trust review remains separate. See [the hook contract](../docs/CODEX_HOOKS.md). No hooks are installed by package installation, `init`, `checkpoint`, or `next`. Claude hooks and real managed execution remain unavailable.

Do not manually copy unfinished integration files into production agent configuration before validation.
