# Managed App Server foundation (M2.2a)

Date: 2026-11-01. Baseline: installed `codex-cli 0.166.0`. This is a **mock-tested partial foundation**, not an authenticated integration or a production process launcher. Real execution is disabled on every platform. No real App Server was started during implementation.

## Scope and architecture

`src/managed/transport.ts` owns a subprocess and bounded JSONL transport. `src/managed/session.ts` owns capture identity, exact thread/turn correlation, authorization and lifecycle. Both are internal modules used by offline subprocess tests; there is no production process factory. The low-level transport accepts executable arguments for testing and must not be treated as an approved public real-server launcher.

The existing telemetry store accepts schema-1 imported records and schema-2 mock-managed records in the same schema-1 store envelope. Its existing lock, exclusive staging, file sync, digest, link checks, atomic rename, 64-stream limit and 256 KiB publication limit apply to both. There is no history migration. Persistence is an explicit snapshot operation (`capture.persist`), not an automatic event writer or daemon. Each acquisition receives a random UUID independently of provider identities. Only hashed acquisition/thread/turn IDs persist.

No M2.2 architecture review artifact was present in the checkout or attachment. The supplied request and existing blueprint were the available design baseline; a prior review's contents have not been independently verified.

## Verified protocol contracts

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) establishes JSONL over stdio and the initialize/initialized handshake. Installed CLI generation, without starting a server, establishes this version's field contracts. Exact generated files and SHA-256 checksums live in `tests/fixtures/managed/manifest.json`; they include their dependent definitions.

| Contract | Verified shape and use |
|---|---|
| `initialize` | `clientInfo` plus optional capabilities; nonexperimental capability explicitly selected; response includes user agent, Codex home and platform fields, which are discarded |
| `initialized` | Client notification after successful initialization |
| `thread/start` | `cwd`, `ephemeral`, `approvalPolicy`, `approvalsReviewer`, `sandbox` are declared public fields |
| Thread response | Effective approval/sandbox policy and thread identity; foundation checks `never`, reviewer `user`, read-only, explicit network denial, matching cwd and ephemeral flag |
| `turn/start` | Required thread ID and input array; text input includes `text_elements`; one separately authorized submission per capture |
| `turn/started` | Thread ID and turn; `inProgress` marks running |
| `turn/completed` | Thread ID and turn; terminal statuses are `completed`, `failed`, `interrupted` |
| `thread/tokenUsage/updated` | Reuses M2.1 parser, cumulative/latest separation and unknown occupancy |
| `turn/interrupt` | Thread ID and turn ID; acknowledgment alone does not establish interrupted outcome |
| `account/read` | `refreshToken: false` avoids requesting proactive refresh; schema includes nullable account and `requiresOpenaiAuth`; foundation transport prohibits true/omitted refresh flag |
| Server requests | Generated union includes command/file approval, permission approval, user input, dynamic tools, elicitation, and authentication refresh; every request terminates the transport without any response |
| Configuration | `config/read` and `configRequirements/read` schemas retained for future policy verification; not implemented or invoked |

Schema presence does not verify runtime delivery, effective isolation, account availability or absence of all server-owned writes. No account check, credential read, login, refresh or real model call was performed. Runtime validation selects security-relevant fields and envelopes; it is not a general JSON Schema validation engine for every response/item. Mock fixtures include content-bearing items specifically to test field selection and disposal.

## Transport bounds and rejection behavior

The child starts with `shell: false`, separate pipe streams, an empty environment and a new POSIX process group. A fixed 65,536-byte frame buffer collects bytes until LF. Fragmented multibyte UTF-8 is decoded only after a complete frame. Coalesced frames route synchronously without an application notification queue. Invalid UTF-8, blank frames, oversized frames, malformed JSON, duplicate keys (including escaped aliases), nesting over 16 levels, and unsupported envelopes fail closed. The shared strict parser conservatively rejects decimal/exponent number literals even in unrelated notifications; legitimate messages outside this subset can terminate capture.

At most eight requests are pending. Client IDs are positive safe integer counters. Responses require an exact outstanding numeric ID and exactly one result/error; duplicate, foreign, malformed or late responses close the connection. Interleaved notifications route immediately. A false stdin write return stops further admission until drain; there is no waiting application write queue. Existing admitted request bytes remain bounded by Node's stream high-water behavior and the eight-request/frame limits. Each request has a bounded deadline (10–5,000 ms; default 1,000 ms). An absolute 30-second connection lifetime bounds floods and stalled incomplete frames. This conservative foundation is not intended for long real turns.

Stderr is drained and discarded. Raw frames, prompts, responses, server errors, thread previews and item contents are never logged or persisted. Fixed diagnostics expose no provider content. These guarantees concern ContextBridge field selection; numeric covert channels and malicious local code are outside the threat model.

## Lifecycle, authorization and observations

States: initializing, ready, turn-pending, turn-running, turn-completed, turn-failed, turn-interrupted, disconnected, stopped, unknown-outcome. Initialization consent and exactly-one-turn consent are separate boolean inputs in the internal API. Generic request dispatch rejects `turn/start`; only the dedicated single-use method can submit it. A prompt must be a nonempty valid UTF-8 Buffer no larger than 8,192 bytes. No production stdin-to-turn path exists yet. No prompt is supplied through command-line arguments.

Thread identity comes only from the successful thread-start response. Foreign-thread telemetry is discarded; a conflicting turn within the selected thread closes the connection. Notifications may precede the turn-start response. Duplicate matching terminal notifications and late started events cannot reactivate a terminal turn. A lost response or connection during a pending/running turn yields unknown outcome. No retry, resume, reattachment, replay, thread guessing, rollover or threshold interruption occurs. Explicit interrupt waits for a terminal notification to establish outcome; stop alone cannot confirm completion or interruption.

Schema-2 records retain numeric usage plus `managed.connection`, `managed.turn`, `managed.completeness`, `managed.receiptAt`, acquisition/thread/turn hashes, client observation time and monotonically increasing local receive ordering. Provenance is explicitly `managed-stdio-mock`, client-receipt/local-receive, verified schema and **unverified origin**. Ordering gaps are allowed. `observedAt` remains the usage receipt time; lifecycle updates have a separate receipt time. `complete` means usage plus a terminal lifecycle event were observed, not exhaustive transcript delivery or verified model success. Disconnected/stopped streams are stale in status even when their usage timestamp is recent. Context utilization and threshold advisories remain unknown.

**Persistence limitation:** no record is persisted before the first valid usage notification. Initialization failures and turns without usage have in-memory state only. The foundation stores latest snapshots when explicitly asked; it does not guarantee a final lifecycle publication after a process crash. Fixing this requires a separate validated acquisition journal/model before real execution. Leftover `pending.json` is ignored by readers and blocks subsequent writes; no automatic promotion or lock takeover occurs. Existing M2.1 crash-recovery instructions remain authoritative.

## CLI and platform boundaries

```text
contextbridge context run --agent codex --project PATH --yes
```

This is a prepared, deliberately disabled command. Without `--yes` it reports missing initialization consent. With consent it reports that real execution is disabled and exits nonzero before reading stdin, spawning a process or writing telemetry. `--yes` never grants turn permission. No model-input option exists. Existing `context status` stays read-only; `context ingest` retains its existing consent and compatibility.

On macOS/Linux, shutdown sends SIGKILL only to the process group created for the owned mock child, rejects pending requests, destroys pipe handles, and waits up to 500 ms for exit. Request failures, EOF, child exit, transport errors and the absolute lifetime use this path. Immediate termination is conservative; graceful production shutdown is not implemented. A process that escapes its group is not contained. This is not an OS sandbox or a guarantee about arbitrary descendants; no global process-name matching occurs. Parent fatal signals/crashes cannot guarantee cleanup, and no external watchdog is supplied.

Windows subprocess execution fails before spawn. There is no tested Windows Job Object containment, process-tree cleanup or native launcher path. Linux tests are portable POSIX tests but were not executed locally. Local macOS test evidence does not imply results on other hosts.

## Required M2.2b prerequisites and live smoke test

Real execution must remain disabled until these prerequisites are implemented and reviewed:

1. Review the original architecture assessment and reconcile the persistence and process containment gaps.
2. Establish process-local restrictive configuration using documented version-specific controls: disable hooks, MCP/plugins and other extensions, command/tool execution, provider analytics and unwanted network operations. An empty environment and read-only thread sandbox do not establish this policy. Verify resolved config and requirements before creating a thread or sending any input. Never edit global settings or select a different model implicitly.
3. Provide OS-level containment or explicitly disable unsupported operating systems; cover parent signals, fatal exits, hung children, detached descendants, PID/group lifetime and bounded cleanup. Validate macOS/Linux separately; Windows needs its own tested containment path.
4. Persist acquisition/connection/turn lifecycle independently of usage, serialize bounded event publication, and define crash/restart unknown outcomes without replay.
5. Add separate explicit user initialization and one-turn authorization to the real CLI. Read only bounded prompt bytes from stdin with a deadline, never argv. Authenticate only using an already authorized account; `account/read` must not request refresh or persist account details. Never initiate login or credential copying.
6. Run all offline tests and the platform matrix first. Increase production turn deadlines only with bounded failure semantics and appropriate tests.

Only after separate approval for authenticated validation: pin and check CLI 0.166.0, record the host/runtime and policy evidence, initialize one owned ephemeral read-only thread, check authentication availability without refresh, and obtain explicit permission for one harmless bounded stdin prompt. Observe exact correlated start/usage/terminal notifications, persist content-free metadata, inspect every local artifact and diagnostics for canaries, then stop and verify owned-process cleanup. Test interruption as a separately authorized additional capture/turn, never an automatic retry. Record any provider-owned persistence; do not claim ephemeral mode prevents every Codex-owned write. Stop on policy mismatch, privileged requests, missing correlation, uncertain outcome or cleanup failure. No existing CLI/VS Code session interception is authorized by this smoke test.
