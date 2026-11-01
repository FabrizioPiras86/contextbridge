# Roadmap

## M0 — Foundation (current preview)

- [x] CLI skeleton with `init`, `status`, `doctor`, `checkpoint`, and `verify`.
- [x] Local JSON snapshots and Markdown handoff.
- [x] SHA-256 content integrity and pointer-last writes.
- [x] English-only repository assets and contribution policy.
- [x] Node built-in unit and CLI tests.
- [ ] TypeScript package build and dependency lockfile for stable releases.
- [ ] GitHub publication.
- [x] Baseline macOS/Linux/Windows CI (completed according to the supplied M2.2b.3 request).

## M1 — Memory engine

### M1.1 — Incremental memory foundation (implemented)

- [x] Provider-neutral versioned events for decisions, tasks, blockers, and notes.
- [x] Append-only local JSONL journal and `memory add` / `memory list`.
- [x] Validation, duplicate detection, bounded records, writer locking, and interrupted-tail recovery.
- [x] Explicit unverified provenance, portable path rules, and heuristic secret rejection.
- [x] Bounded recent memory in checkpoints with legacy snapshot compatibility.
- [x] Recovery, privacy, CLI, compatibility, and portable filesystem tests in the existing OS CI matrix.

### M1.2 — Opt-in Codex automatic memory capture (supported subset implemented)

- [x] Strict, bounded `SessionStart` / `Stop` adapter feeding the M1.1 journal.
- [x] Deterministic extraction from explicitly labeled assistant memory blocks.
- [x] Stable delivery IDs, replay checks, continuation guard, and watchdog.
- [x] Explicit project-local installation, status, dry-run, safe uninstall, and conflict detection.
- [x] Mocked offline tests and documented CLI/IDE manual verification.
- [x] Authenticated live CLI smoke test and adapter-specific VS Code memory-capture validation (completed by the project owner; owner-reported evidence).
- [ ] Expand the checked Codex version matrix after contract verification.
- [ ] Evidence-backed or model-assisted extraction from additional sources.

### Remaining M1 work


- [ ] Structured tasks, decisions, constraints, evidence, and provenance.
- [ ] Retention policy and journal indexing (append-only journal and process-crash recovery implemented in M1.1).
- [ ] Expanded secret scanning and configurable file allowlists (heuristic rejection and portable path validation implemented in M1.1).
- [ ] Snapshot migrations, backup, and bounded handoff token budgets.
- [ ] Incremental checkpoint triggers and data-redaction controls.
- [ ] Retrieval of selected older evidence without full history injection.

## M2 — Assisted agent integrations

- [x] Validate the documented Codex `SessionStart` / `Stop` payload subset for M1.2.
- [ ] Validate supported Claude Code hook events and payload schemas.
- [ ] Implement Claude Code skill, local hooks and context telemetry where available.
- [x] Implement opt-in Codex project-local hooks for labeled memory capture.
- [ ] Implement broader Codex skills and supported telemetry.
- [x] Implement `next --agent codex` to create a **new** interactive session from verified state.
- [ ] Implement the Claude Code assisted `next` adapter.
- [x] Report unsupported context occupancy without guessing a context percentage.

### M2.1 — Context telemetry foundation (supported subset implemented)

- [x] Inspect official documentation and installed Codex 0.166.0 generated schemas.
- [x] Provider-neutral versioned observations separated from semantic memory.
- [x] Strict bounded App Server token notification parser with explicit provenance.
- [x] Opt-in local stdin import and bounded, locked, atomic observation storage.
- [x] Independent capture/thread streams, replay handling, caller-supplied ordering, and freshness.
- [x] `context status` with unavailable/supported/stale states and unknown active occupancy.
- [x] Deterministic advisory evaluator for future verified active-context measurements, including exact boundaries.
- [x] Offline privacy, corruption, portability, regression tests, and documented limitations.
- [ ] Managed continuous App Server event capture with verified lifecycle and observation metadata.
- [ ] A documented, justified measurement of active context occupancy.
- [ ] Supported continuous telemetry integration for interactive Codex CLI and existing VS Code sessions.
- [x] Baseline M2.2b.2 suite green in the macOS/Linux/Windows CI matrix (user-provided evidence; local runs are separate).

### M2.2a — Managed App Server foundation (partial; mock-only)

- [x] Preserve version-pinned generated schemas and checksums for handshake, lifecycle, auth checks and privileged requests.
- [x] Bounded stdio JSONL transport with separate pipes, UTF-8 framing, duplicate-key/depth checks, request admission and deadlines.
- [x] Independent acquisition identity, exact correlation, lifecycle state machine and separate single-turn authorization.
- [x] Reject every server request without response; discard content and stderr.
- [x] Schema-2 mock-managed observation snapshots alongside unchanged schema-1 imports.
- [x] Actual Node mock subprocess tests, canaries, interruption, uncertainty, backpressure and persistence recovery.
- [x] Prepare `context run` as an explicitly disabled command on all platforms.
- [ ] Production process-local configuration and resolved-policy verification.
- [x] M2.2b.1: persist acquisition/lifecycle without a token event and serialize bounded automatic publication (mock-only).
- [ ] OS containment, parent-signal handling and cross-platform cleanup evidence (Windows execution disabled).
- [ ] M2.2b: separately authorized live smoke test after all [prerequisites](MANAGED_APP_SERVER.md#required-m22b-prerequisites-and-live-smoke-test).

### M2.2b.1 — Durable managed lifecycle foundation (implemented; mock-only)

- [x] Versioned, bounded, strictly validated content-free acquisition records with hashed correlation.
- [x] Durable acquisition and pending-turn admission barriers; failed persistence prevents submission.
- [x] Shared atomic lifecycle/usage publication, bounded serial queue and concurrent-writer exclusion.
- [x] Terminal evidence independent of token usage; running, disconnected and uncertain outcomes retained.
- [x] Read-only historical status with explicitly unconfirmed connectivity/outcomes and no automatic action.
- [x] Offline mock, corruption, capacity, restart, interrupted-publication and compatibility tests.
- [x] Expanded baseline suite validated by the macOS/Linux/Windows CI matrix (user-provided evidence in M2.2b.3 request).
- [ ] Real execution remains blocked by effective process policy, containment and separately authorized validation.

See [M2.2b.1 technical report](M2_2B_1_REPORT.md). No hooks, assisted handoff or global Codex configuration changes.

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

## M2.2b.2 — Managed process containment (offline supported subset)

- [x] Creation-local POSIX ownership, bounded graceful/forced cleanup, shared concurrent stop and sticky uncertainty diagnostics.
- [x] Offline macOS/Linux process-tree fixtures, cancellation and application-owned signal handling tests; Windows fail-closed boundary retained.
- [x] Revoke group signaling after observed leader exit; document residual numeric identity races and escaped descendants.
- [x] Document unexpected parent failures and a future Windows Job Object design.
- [x] Merged M2.2b.2 baseline green in the macOS/Linux/Windows CI matrix (user-provided evidence in M2.2b.3 request).
- [ ] Strong OS containment for escaped descendants and parent hard failures; real execution remains disabled.

See [M2.2b.2 report](M2_2B_2_REPORT.md) for exact guarantees, validation and remaining prerequisites.


## M2.2b.3 — Managed runtime policy verification (implemented offline subset)

- [x] Verify pinned 0.166.0 config/read, configRequirements/read and effective thread contracts against retained schemas/checksums.
- [x] Strict bounded mock policy admission with explicit requested, resolved, administrative, effective-thread and unsupported-runtime evidence.
- [x] Independent offline-harness isolation assertions required before mock thread creation; production eligibility always false.
- [x] Durable acquisition, policy reads, effective thread verification and ready ordering; revalidation before a separately authorized turn.
- [x] Negative mock cases for missing/ambiguous/conflicting evidence, unsafe policies, integrations, protocol failures, privacy and cleanup errors.
- [x] Document process-local isolation candidates and unsupported guarantees without changing global configuration.
- [ ] Run this revision's expanded suite in macOS/Linux/Windows CI; baseline matrix evidence does not validate new changes.
- [ ] Prove startup-side-effect isolation, complete capability restrictions, stronger OS containment and authenticated enforcement before enabling any real launcher.

See [M2.2b.3 report](M2_2B_3_REPORT.md). Real App Server execution remains disabled.
