# M2.2b.2 managed process containment report

Date: 2026-11-01. Scope: offline POSIX supported subset. **Real Codex App Server execution remains disabled on every platform.**

## 1. Preparation and ownership model

The working tree was clean on `main` at `5f63632051e8d8ad0ae255712d18e4e4a1e29671`. `git fetch origin main` succeeded and local `HEAD` matched `origin/main`. Work is on `feat/managed-process-containment`. No commit, push, merge or publication was performed.

Repository instructions, architecture/security/language policy, telemetry contracts, managed runtime, lifecycle, roadmap, transport/session sources and existing fixtures/tests were reviewed. Only local Node test fixtures were executed. No real Codex launcher, model, credentials, authentication, global configuration, session attachment, daemon, compaction or rollover was used or enabled. Remote access was limited to the explicitly requested Git synchronization and public technical research.

`OwnedProcess` owns the child object created by its own `spawn`, its creation-time PID, and the new POSIX process group established by `detached: true`. Launch uses `shell: false`, explicit arguments, empty environment and pipe streams. The direct child is distinct from its group and descendants. Nothing is discovered by name, enumerated, reconstructed from persisted PIDs, or selected from historical lifecycle state. An independent group is never an intended signal target.

This is a creation-local capability with a limited numeric identity, not an OS ownership handle. Process groups contain ordinary descendants only while those processes remain in that group. A detached/re-grouped descendant escapes; group disappearance cannot detect it. The guarantee is deliberately narrower than arbitrary process-tree containment.

## 2. Files changed

| File | Change |
|---|---|
| `src/managed/process.ts` | Creation-local ownership, bounded shutdown, exit tracking, non-signaling absence verification, sticky result and fixed diagnostic |
| `src/managed/transport.ts` | Delegate process ownership; optional AbortSignal; preserve fail-closed transport and await cleanup |
| `src/managed/session.ts` | Share concurrent stop, preserve uncertain outcome, publish stopped only after successful cleanup, retain background cleanup failures for awaited stop |
| `tests/containment.test.ts` | Nineteen isolated containment and parent-failure tests |
| `tests/fixtures/managed/process-tree.mjs` | Controlled child/grandchild, hung/escaped/early-exit modes, bounded lifetime and emergency channel |
| `tests/fixtures/managed/parent.mjs` | Application-owned signal and unexpected-exit harness |
| `docs/MANAGED_APP_SERVER.md` | Current cleanup contract, platform and crash boundaries, native Windows design |
| `docs/BLUEPRINT.md`, `docs/ROADMAP.md`, `SECURITY.md`, `README.md` | Architecture, milestone and user-facing boundary updates |
| `docs/M2_2B_2_REPORT.md` | This report |

No dependency, storage-schema or production command change is introduced.

## 3. POSIX cleanup behavior

Explicit stop or cancellation closes admission synchronously, rejects all pending requests and destroys pipe streams. Group SIGTERM is followed by up to 150 ms of graceful waiting; SIGKILL follows only while the leader has not been observed exiting. Protocol errors, EOF, process/stream errors, request deadlines and absolute lifetime failure take the immediate forced path. Closing transport pipes before signaling is cancellation, not a protocol shutdown request.

A further exit wait of at most 500 ms and a group-absence polling window of at most 500 ms follow. Worst-case timer budgets are approximately 1,150 ms for graceful cleanup and 1,000 ms for forced cleanup, plus event-loop scheduling. The verification window uses a monotonic clock. These bounds do not guarantee real-time responsiveness if JavaScript or the OS stalls. Stop promises and results are shared across repeated/concurrent calls; signaling cannot restart after a failed result.

No nonzero signal is issued after observed exit or populated child exit/signal status. A group that remains after leader exit is probed only, then reported unconfirmed; no delayed group kill is attempted. A signaling error is considered resolved only if child exit and group absence are subsequently verified. Otherwise every awaited stop reports:

```text
Managed process cleanup is unconfirmed; inspect owned test processes.
```

`cleanup: confirmed` proves observed direct-child exit and numeric-group absence during verification, not all-descendant cleanup, a sandbox, or a terminal model outcome. Missing process/group identity, permission errors, uninterruptible processes, zombies and delayed reaping can prevent confirmation. Successful termination never fabricates a completed/interrupted turn.

A residual race exists between actual OS exit, Node observing exit and numeric PID/group reuse. Checking child status immediately before signaling reduces the window but cannot remove it with Node's documented numeric process-group APIs. This is why no adversarial or production-safe reuse guarantee is claimed. After observed exit, reuse can cause conservative false uncertainty during a harmless probe, never authorize a new signal. Historical records do not authorize probing or signaling at all.

## 4. Windows limitations and researched design

Windows execution fails before spawn in both transport and owner. Existing Windows-only boundary assertions and portable storage/protocol tests remain. There is no taskkill, process-name matching or broad enumeration. Terminating a Windows initial PID alone does not prove descendant cleanup.

Microsoft documents [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) as group-management objects with inherited membership for ordinary CreateProcess children and explicit breakaway exceptions. [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject) documents assignment, nesting constraints and suspended creation. A future native launcher must create the job with kill-on-last-handle-close, retain a non-inheritable controlling handle, prohibit breakaway, create the initial process suspended, assign before resume and fail closed on any error. Child handle inheritance, pre-existing jobs, externally brokered process creation and native crash cleanup need explicit validation. Node's built-in spawn does not expose this complete admission contract. Nothing native is implemented or installed here.

## 5. Parent signals, failures and historical recovery

| Event | Implemented/tested interpretation |
|---|---|
| Application awaits stop | Bounded cleanup; pending/running outcome becomes unknown without terminal evidence |
| Application handles SIGTERM or SIGINT and awaits stop | Test parent demonstrates cleanup; library installs no global handlers |
| AbortSignal cancellation | Reject admission, share graceful cleanup, remove scoped listener; already-aborted signal prevents spawn |
| Uncaught exception with default runtime behavior | Test demonstrates no graceful cleanup guarantee; child can outlive parent |
| Explicit unexpected process.exit | Test demonstrates no async cleanup guarantee |
| Parent SIGKILL | Test demonstrates surviving owned child; JavaScript cannot run cleanup |
| Runtime/native hard crash | Unsupported cleanup; no handler execution guarantee |
| System crash or power loss | No JavaScript cleanup; disk state and last terminal outcome may remain uncertain |

The caller owns signal policy, exit status and coordination with other components. No library signal, exception or exit listeners are added. A caller may catch an exception at an application boundary and attempt bounded shutdown while its runtime is still viable, but this is not a global uncaught-exception recovery guarantee.

Existing M2.2b.1 tests prove that restart inspection reads only committed lifecycle evidence, never saved connectivity as liveness, and never promotes staging or replays a turn. Parent-failure tests here prove process survival boundaries separately; they do not claim terminal persistence after a kill. No process exit establishes a model result. Historical nonterminal outcomes remain unconfirmed.

## 6. Guarantees exercised by tests

The nineteen new cases cover direct child cleanup; multiple in-group descendants including a grandchild; graceful exit during cleanup; repeated/concurrent stop; a SIGTERM-ignoring child and escalation; already-cancelled creation; live cancellation without global handler changes; independent-process survival/responsiveness; leader exit before cleanup with surviving descendants and sticky uncertainty; escaped descendants; exact creation-group signal targets without repeated signaling; injected unresolved permission failure with fixed diagnostics; pending requests during shutdown; spawn failure without raw errors; application SIGTERM/SIGINT; parent explicit exit, uncaught exception and SIGKILL; and concurrent capture shutdown preserving both unknown and verified terminal outcomes.

These tests use temporary directories and bounded marker polling rather than readiness sleeps. Test-owned tree processes have an eight-second self-expiry and a file-based emergency stop channel independent of parent liveness. Teardown requests that channel and waits boundedly for exit markers or non-signaling absence probes. Markers may contain test-only PIDs, never production process authority; teardown never signals a persisted marker PID. The parent harness is held as a live ChildProcess and terminated in teardown if needed. Deliberately killed processes may have no exit marker. This infrastructure is test-only, not a persistent watchdog.

Existing tests additionally cover malformed/oversized/deep/invalid-UTF8 frames, EOF, missing/late/duplicate responses, deadlines, backpressure, stderr floods, privileged requests receiving zero responses, separate single-use turn authorization, no automatic turn/retry, canary exclusion from diagnostics/storage/memory/snapshots/handoffs, and Windows execution denial. No expected result was changed to hide failure.

## 7. Unsupported guarantees and stronger designs

This milestone cannot guarantee cleanup of escaped descendants, kernel-blocked processes, numeric identity reuse races, parent SIGKILL or simultaneous runtime failure. The mock group mechanism is not a hostile-process boundary. An unconfirmed cleanup remains a sticky failure; automatic retries, stale-PID termination and model-turn retries are prohibited. Even confirmed group cleanup does not establish that escaped processes do not exist.

A concrete future Linux design is a restricted cgroup v2 per acquisition, with the launcher admitted before execution and no permission for workload processes to migrate out. An external owner must invoke `cgroup.kill` and verify `cgroup.events` populated state; the [kernel cgroup v2 contract](https://docs.kernel.org/admin-guide/cgroup-v2.html) supplies these primitives. A short-lived supervisor holding the cgroup and watching a private parent pipe can react to parent death; supervisor failure still needs an independent OS service/lifetime policy. This is a proposed design, not implemented or tested here. No persistent daemon is installed.

Windows Job Object handle-close policy is a concrete kernel-supported direction for parent failure. No equivalent all-descendant, kill-on-parent-death guarantee is established here for macOS using Node alone. macOS real execution must remain disabled until reviewed native/OS containment, or an isolated guest execution boundary with owned guest termination, is implemented and tested. A process-group helper alone does not solve detached descendants or its own fatal failure. No platform design can run JavaScript after power loss, and process containment does not settle model-side outcome uncertainty.

## 8. Validation results

Local host: macOS (Darwin), Node v22.23.2. `npm test`: **170 tests, 169 passed, zero failed, one expected Windows-only skip**. This preserves the 151-test baseline and adds 19 containment tests. All 19 containment cases passed within the final full suite. `git diff --check` passed.

The existing GitHub Actions Node 22 matrix targets macOS, Linux and Windows. Linux POSIX cases and Windows portable/fail-closed cases are supplied but were not executed locally for this revision. No remote CI run, authenticated runtime smoke test, power-loss test or native-crash test is claimed. Early implementation runs exposed exit timing and diagnostic handling issues; the final suite passes without weakening baseline expectations.

## 9. M2.2a / M2.2b.1 compatibility

Frame/pending/deadline/lifetime bounds, strict protocol validation, approval denial and single-turn authorization are preserved. All pending requests reject once shutdown starts. Stderr and raw frames remain discarded. The owner adds no logging, persisted PID, raw output, environment capture or credentials. Lifecycle and observations stay provider-neutral at the core and retain explicit mock/unverified provenance.

No schema migration or historical rewrite occurs. Durable admission, shared-lock atomic publication, capacity, corruption rejection and staging recovery remain unchanged. Session stop shares one promise, sets pending/running turns uncertain before transport cleanup and records stopped only after limited cleanup succeeds. On cleanup failure it preserves disconnected/uncertain metadata and surfaces the error. Terminal evidence still comes exclusively from matching turn/completed notifications, never stop, process exit or interrupt acknowledgment. Assisted handoff/hooks and disabled context run remain unchanged.

## 10. Remaining prerequisites for real managed execution

Real execution requires stronger reviewed containment for each enabled OS, macOS/Linux/Windows CI evidence, effective process-local configuration and resolved policy/requirements checks, prevention of hooks/plugins/tool/network side effects, production bounded stdin and deadlines, separate explicit initialization/one-turn consent, and authenticated runtime validation approved separately. Reconcile the original architecture assessment when available. Validate provider-owned persistence and exact source/version/correlation; never equate ephemeral mode with absence of all provider writes. Maintain historical uncertainty, no automatic turn retries, and no attachment to existing CLI/IDE sessions.

M2.2b.2 implements the safe offline subset; it does not clear the production containment gate.
