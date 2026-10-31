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

### M1.1 — Incremental memory foundation (implemented)

- [x] Provider-neutral versioned events for decisions, tasks, blockers, and notes.
- [x] Append-only local JSONL journal and `memory add` / `memory list`.
- [x] Validation, duplicate detection, bounded records, writer locking, and interrupted-tail recovery.
- [x] Explicit unverified provenance, portable path rules, and heuristic secret rejection.
- [x] Bounded recent memory in checkpoints with legacy snapshot compatibility.
- [x] Recovery, privacy, CLI, compatibility, and portable filesystem tests in the existing OS CI matrix.

### Remaining M1 work


- [ ] Structured tasks, decisions, constraints, evidence, and provenance.
- [ ] Retention policy and journal indexing (append-only journal and process-crash recovery implemented in M1.1).
- [ ] Expanded secret scanning and configurable file allowlists (heuristic rejection and portable path validation implemented in M1.1).
- [ ] Snapshot migrations, backup, and bounded handoff token budgets.
- [ ] Incremental checkpoint triggers and data-redaction controls.
- [ ] Retrieval of selected older evidence without full history injection.

## M2 — Assisted agent integrations

- [ ] Validate supported hook events and payload schemas for both agents.
- [ ] Implement Claude Code skill, local hooks and context telemetry where available.
- [ ] Implement Codex skill, hooks and telemetry where available.
- [x] Implement `next --agent codex` to create a **new** interactive session from verified state.
- [ ] Implement the Claude Code assisted `next` adapter.
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
