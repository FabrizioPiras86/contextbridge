# Roadmap

## M0 — Foundation (current preview)

- [x] CLI skeleton with `init`, `status`, `doctor`, `checkpoint`, and `verify`.
- [x] Local JSON snapshots and Markdown handoff.
- [x] SHA-256 content integrity and pointer-last writes.
- [x] English-only repository assets and contribution policy.
- [x] Node built-in unit and CLI tests.
- [ ] TypeScript package build and dependency lockfile for stable releases.
- [ ] GitHub publication and CI run on all supported platforms.

## M1 — Memory engine

- [ ] Structured tasks, decisions, constraints, evidence, and provenance.
- [ ] Append-only event journal, crash recovery, and retention policy.
- [ ] Secret scanning and robust path/file allowlists.
- [ ] Snapshot migrations, backup, and bounded handoff token budgets.
- [ ] Incremental checkpoint triggers and data-redaction controls.
- [ ] Retrieval of selected older evidence without full history injection.

## M2 — Assisted agent integrations

- [ ] Validate supported hook events and payload schemas for both agents.
- [ ] Implement Claude Code skill, local hooks and context telemetry where available.
- [ ] Implement Codex skill, hooks and telemetry where available.
- [ ] Implement `next` to create a **new** session and initialize it from verified state.
- [ ] Report unsupported capabilities without guessing a context percentage.

## M3 — Managed automatic mode

- [ ] Claude Agent SDK managed adapter.
- [ ] Codex App Server managed adapter.
- [ ] Safe-turn rollover with approval-aware session-state machine.
- [ ] Two-phase handoff commit and recovery after process failure.
- [ ] User-configurable rollover thresholds and modes.

## M4 — Cross-agent transfer

- [ ] Provider-neutral state representation.
- [ ] Claude-to-Codex and Codex-to-Claude test suites.
- [ ] Ensure original user-language content is preserved.

## M5 — Public beta

- [ ] Comparative benchmarks: native compaction versus ContextBridge.
- [ ] Security audit, platform matrix, release automation.
- [ ] npm publication after package-name verification.
