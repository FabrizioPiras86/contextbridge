# Agent integrations

The files under `integrations/` are development templates, not automatically installed integrations.

`contextbridge next --agent codex` is implemented in the CLI and does not require installing these templates. It starts a fresh interactive session using verified snapshot data. Claude Code handoff remains unimplemented.

The foundation preview intentionally does **not** include active hooks. In M2, adapters will install and validate provider-specific hooks against documented event payloads. The managed wrappers will be added in M3.

Do not manually copy unfinished integration files into production agent configuration before validation.
