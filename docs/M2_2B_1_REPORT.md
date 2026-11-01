# M2.2b.1 durable managed lifecycle report

Date: 2026-11-01. Scope: implemented offline persistence foundation; **real Codex App Server execution remains disabled on every platform**.

## 1. Architecture and files changed

Preparation found a clean local `main` at `827a3954574e32492d4796fb3465e90075c4ee15`. Remote GitHub `main` resolved to the same commit through the connected GitHub API; shell remote inspection was unavailable because DNS resolution was restricted. The local branch is `feat/managed-lifecycle-persistence`. No commit, push, merge or publication was performed.

The repository instructions, README, blueprint, roadmap, language policy, managed integration contract, M2.2a report, telemetry store/parser/status, managed transport/session, fixtures and tests were inspected. This change reuses the existing transport and protocol subset; it does not add a provider execution path or change public protocol assumptions.

| Files | Responsibility |
|---|---|
| `src/managed/lifecycle.ts` | Versioned acquisition record, strict bounds, correlation/progression validation and conservative historical projection |
| `src/managed/session.ts` | Required storage root, acquisition/pending admission barriers, bounded automatic publication, sticky failure and draining |
| `src/telemetry/store.ts` | Backward-compatible envelope reader, common lock, atomic joint publication, cross-record validation and POSIX directory sync |
| `src/telemetry/cli.ts` | Single-envelope read-only lifecycle inspection; historical connectivity/outcome and stale managed observations |
| `tests/lifecycle.test.ts` | Durable ordering, no-usage, admission failure, recovery, concurrency, privacy, validation, capacity and compatibility tests |
| `tests/managed.test.ts` | Supply project storage to captures and drain writes before test cleanup |
| `tests/fixtures/managed/server.mjs` | Disk checks before thread/turn admission, no-usage, usage/exit and bounded-queue flood scenarios |
| `README.md`, `docs/BLUEPRINT.md`, `docs/ROADMAP.md`, `docs/MANAGED_APP_SERVER.md`, `docs/CONTEXT_TELEMETRY.md` | Current behavior, compatibility, recovery and remaining prerequisites |
| `docs/M2_2B_1_REPORT.md` | This technical report |

Hooks, assisted handoff, configuration, checkpoints, semantic memory and generated protocol schemas are unchanged.

## 2. Lifecycle persistence model

Lifecycle record schema 1 stores a hashed acquisition UUID, optional hashed thread/turn IDs, acquisition-local sequence, canonical bounded UTC receipt time, connection, turn state, terminal evidence and explicit mock/unverified provenance. It is independent of token counters. An acquisition is recorded and flushed before initialization/thread requests. A validated thread response publishes ready. Turn-pending is committed and flushed before `turn/start`; persistence failure prevents submission and consumes admission without retry. Initialization consent and exactly-one-turn authorization remain distinct.

A serial promise chain captures immutable content-free snapshots in receive order, bounded at 32 queued/active publications. Each snapshot includes lifecycle and, if available, the latest numeric token observation. Their sequence, correlation, connection, outcome and lifecycle receipt time agree. Usage receipt time remains independent and is never refreshed by lifecycle changes. Running, terminal, disconnected, stopped and uncertain transitions publish automatically. Failure/overflow is sticky, stops only the current owned mock transport and is surfaced by flush/persist/stop.

Terminal states require a matching `turn/completed` notification with completed, failed or interrupted status. Terminal evidence is a recorded event from an unverified mock transport, not an authenticity proof or objective verification. Process exit, usage, start responses and interrupt acknowledgments never establish terminal success. No usage is needed to retain acquisition or terminal state.

Bounds: 1,024 bytes per lifecycle record, 64-character hexadecimal identifiers, four-digit-year canonical timestamps, positive safe integer sequences, 64 acquisitions, 64 observation streams and 262,144 bytes per committed envelope. Unknown fields, versions, malformed records and inconsistent cross-record metadata fail closed. Capacity never silently evicts data. No prompts, transcripts, tool results, code, credentials, raw frames, PID or lease are stored.

## 3. Atomicity and durability

Lifecycle and telemetry use one schema-2 envelope with a digest over both collections, under the existing shared exclusive writer lock. A writer rereads committed data under that lock, checks permitted progression and immutable identities, validates the complete prospective envelope, writes an exclusive fixed staging file, syncs/closes it and atomically renames it over the committed file. POSIX syncs the parent storage directory and the publication directory. Ownership-checked cleanup retains a replacement lock.

Readers see complete old or new committed snapshots, never a lifecycle/token split commit. Competing writers fail safely without automatic retries; all successful independent writes survive subsequent publications. Existing valid data is preserved on validation, contention, staging or pre-rename failure. A reported failure after rename/sync may already have published a complete record: inspect before any manual action.

Uncommitted staging is ignored and never overwritten or promoted, even when it contains a valid terminal candidate. Stale locks block writers without preventing read-only inspection. Confirm no writer is running before manually recovering locks/staging, preserve committed data and archive staging for investigation.

## 4. Crash and restart semantics

| Interruption boundary | Recovery interpretation |
|---|---|
| Before a thread response | Acquisition retained; thread creation/progress unconfirmed |
| Thread recorded, before submission | Exact known thread; no confirmed turn outcome |
| Pending publication before/during start | Submission may or may not have occurred; never replay |
| Running connection loss | Preserve correlation and unknown outcome |
| Usage without terminal event | Numeric observation retained; outcome unconfirmed |
| Terminal without usage | Terminal lifecycle evidence retained; usage unavailable |
| Interrupted publication | Only last committed envelope is authoritative |
| Restart with saved connected state | Current connection unconfirmed, irrespective of age |

Every status record is historical. Nonterminal outcomes are explicitly unconfirmed; committed terminal evidence survives disconnection/exit. Legacy managed observations are also marked historical/stale with unconfirmed current connectivity. Status reads one committed envelope and never writes, promotes staging, removes locks, launches a provider, checks saved PIDs, resumes, replays, retries or terminates historical sessions. No process-liveness inference exists.

## 5. Existing telemetry compatibility

Schema-1 envelopes remain readable. Existing M2.1 schema-1 imported observations and M2.2a schema-2 managed observations retain their strict validation, usage values, hashes and provenance. First lifecycle publication upgrades only the envelope; unrelated observations are preserved. New lifecycle-managed observations require joint matching publication and cannot be overwritten by imports. Duplicate/import ordering and freshness behavior remain unchanged. Active context occupancy and threshold advisories remain unknown.

## 6. Validation

All integration scenarios use isolated Node mock processes, with no credentials, network model requests or real App Server. New tests cover persisted admission ordering, blocked submission on lock/staging/corruption failure, acquisition failure, no usage, usage without terminal evidence, disconnect, bounded queue overflow, historical status at each recovery boundary, valid and partial unpublished staging, stale locks, concurrent lifecycle/import writers, unchanged legacy records, strict schema/correlation, capacity without eviction, linked-path rejection, and collision rejection. Existing privileged-request, separate authorization, canary/privacy, protocol and platform restrictions remain tested.

Validation host: macOS arm64, Node v22.23.2. `npm test` completed with 151 tests: 150 passed, zero failed, and one expected Windows-only skip. This adds 26 tests to the 125-test baseline, including one nested path check. `git diff --check` passed. The existing GitHub Actions Node 22 matrix remains Linux/macOS/Windows. Portable storage/recovery tests run on every host; POSIX subprocess and file-symlink cases skip Windows, which retains its deliberate subprocess restriction. Linux and Windows were not executed locally and are not claimed as validated host results.

## 7. Known limitations

- Post-submission notification publication is bounded and asynchronous. A crash before queued evidence commits leaves the older historical state unconfirmed. This is not exactly-once model submission or an exhaustive event history.
- File sync/rename and POSIX directory sync do not promise universal hardware/power-loss durability. Windows does not use POSIX directory sync; filesystem and hardware semantics still matter.
- Stale locks/staging require deliberate manual recovery after confirming no writer is active. There is no automatic takeover, retention, archive or retry.
- Whole-store publication is bounded but rewrites the envelope. A full collection blocks new acquisitions/streams.
- Digest validation detects corruption, not malicious rewriting of both data and digest. Filesystem checks do not contain hostile concurrent path replacement.
- Mock provenance remains unverified. Existing selected-field protocol validation and process-containment limitations remain; no production runtime evidence is added.

## 8. Remaining real-execution blockers

Production process-local restrictive configuration and resolved-policy/requirements verification are unimplemented. POSIX process groups do not contain escaped descendants or guarantee cleanup on parent crashes; supported platforms need reviewed containment and parent-signal handling, while Windows execution remains disabled. Production stdin bounds/deadlines and separate explicit CLI turn authorization are still required. The original architecture assessment remains unavailable in the checkout. Cross-platform CI evidence, runtime policy review and separately approved authenticated smoke tests are outstanding.

No real App Server was started, authenticated request sent, global Codex setting modified, context-run path enabled, rollover/compaction/session switching implemented or existing hook/handoff behavior altered.
