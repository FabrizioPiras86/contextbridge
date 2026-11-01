# M2.2a implementation report

Date: 2026-11-01. Result: **safe partial completion: mock-only foundation; real execution disabled**.

## 1. Architecture implemented

A bounded owned-subprocess transport feeds a separate managed capture state machine. Capture identity is an independent UUID; thread identity comes only from the explicit thread-start response. Token parsing reuses M2.1. Version-2 managed observations coexist with existing imported records in the same bounded, locked atomic store. Persistence is an explicit snapshot operation, not continuous event publication. [Full design and limitations](MANAGED_APP_SERVER.md).

Preparation verified clean `main` at `f08abb1`, fetched origin and found `main...origin/main` at `0 0`. Work is on `feat/managed-app-server-foundation`. The architecture review mentioned in the request was not present in the supplied files or repository; no claim is made to having reviewed it. No commit, push, merge or publication occurred.

## 2. Files created and modified

| Files | Change |
|---|---|
| `src/managed/transport.ts` (new) | Stdio framing, request routing, strict admission, deadlines, content-free diagnostics and owned POSIX group cleanup |
| `src/managed/session.ts` (new) | Capture identity, exact correlation, explicit state machine, single-turn authorization, interrupt and explicit persistence |
| `src/telemetry/model.ts` | Version-2 metadata and explicit mock/client-receipt/local-order provenance |
| `src/telemetry/codex.ts` | Reusable strict JSON parser and strict version-2 observation validation through the existing token validator |
| `src/telemetry/store.ts` | Include lifecycle metadata in replay/report comparison; preserve version-1 reads |
| `src/telemetry/cli.ts` | Prepared disabled command and lifecycle-aware stale status |
| `src/cli.ts` | Explain disabled managed command in help |
| `tests/managed.test.ts` (new) | Mock-boundary, lifecycle, privacy, authorization, storage and platform tests |
| `tests/fixtures/managed/server.mjs` (new) | Actual isolated Node subprocess with hostile protocol scenarios |
| `tests/fixtures/managed/*.json` (new) | 22 unmodified generated schema files and a checksum manifest |
| `README.md`, `docs/BLUEPRINT.md`, `docs/ROADMAP.md`, `docs/CONTEXT_TELEMETRY.md` | Scope, behavior and remaining work |
| `docs/MANAGED_APP_SERVER.md` (new) | Protocol assumptions, bounds, safety limits and M2.2b procedure |
| `docs/M2_2A_REPORT.md` (new) | This report |

## 3. Verified protocol contracts

Installed CLI reported `codex-cli 0.166.0`. Only `--version`, schema help and `app-server generate-json-schema` were executed; no real server was launched. Generated schemas preserve initialize/initialized, thread start, turn start/start notification/completion/token usage/interrupt, server approval/permission/auth-refresh request unions, account availability checks and configuration read/requirements response contracts. Every preserved schema has a manifest checksum checked in tests. The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) was fetched; version-specific schemas remain the field baseline. Schema availability is not authenticated runtime evidence.

## 4. CLI commands implemented

`context run --agent codex --project PATH --yes` is a prepared disabled interface: it rejects malformed options, requires explicit initialization consent and agent selection, then fails before provider spawn, prompt input or telemetry writes. There is no CLI model-turn path or implicit turn authorization. Existing status/import commands continue working; stopped/disconnected managed streams are reported stale. Normal context status remains read-only.

## 5. Process and lifecycle behavior

The mock subprocess uses no shell, empty inherited environment, separate stdin/stdout/stderr and a POSIX process group. A fixed 64 KiB frame buffer, 16-level JSON limit, eight pending requests, no application write/notification queues, backpressure rejection, 1-second default request deadline and 30-second absolute lifetime bound work and memory. Fixed errors replace raw server diagnostics. EOF, process exit, child signals, transport failure and deadlines reject pending work and stop the owned group. Stop waits at most 500 ms after SIGKILL; graceful production shutdown is not implemented.

All requested capture states exist in memory. Exact thread/turn checks reject foreign activity and conflicting turn identities. Matching duplicate terminal events and late start notifications cannot restart a terminal turn. Interrupt acknowledgment is not interruption confirmation. Uncertain submission/termination never triggers retry, resume or replay. Production parent-signal containment and arbitrary descendant cleanup remain unimplemented.

## 6. Privacy and authorization guarantees

Initialization and exactly-one-turn authorization are separate internal inputs. Generic dispatch rejects turn-start; the single-use turn path checks authorization and bounded UTF-8 input before submission. All server-initiated requests terminate the connection without a response, including auth refresh and privileged operations. Account-read dispatch requires `refreshToken: false`; no login method is exposed. Known content notifications are discarded; unreviewed notification methods fail closed.

ContextBridge retains only validated numeric usage, hashes and fixed lifecycle/provenance metadata. Canary prompts/items/server errors/stderr are excluded from telemetry, semantic memory, snapshots, handoffs and surfaced errors. Tests verify these artifact boundaries. No raw transport log exists. Tests do not prove prevention of malicious numeric covert channels, provider-owned writes or hostile local code. No credentials were accessed/copied and no global configuration, model or permission setting was changed. All model-turn integration tests used only the Node mock.

## 7. M2.1 compatibility

Schema-1 observations are read with the original strict validation. New schema-2 observations are separately validated and projected through those same numeric/identity rules. An integration test imports a schema-1 observation, saves a managed observation and verifies the imported object remains unchanged. Both share existing capacity, staging, lock and recovery behavior. No config, journal, handoff or checkpoint migration occurs. Occupancy and advisories remain unknown; cumulative/latest/window ratios are never computed.

## 8. Tests and results

The final `npm test` run passed 124 of 125 tests, with zero failures and one expected platform skip (Windows-only fail-closed execution test on this macOS host). There are 31 new managed tests; 30 ran locally. Existing 94 tests remain passing. `git diff --check` passed. Runtime: macOS arm64, Node v22.23.2. Linux and Windows were not executed or claimed.

New coverage includes handshake and effective mock policy checks; request rejection; invalid JSON/UTF-8, duplicate keys, oversized/deep/partial frames; fragmented multibyte characters; coalesced frames; pending limits and stdin backpressure; stderr flooding; delayed/missing responses; malformed/unknown response IDs; foreign threads; notifications preceding responses; duplicate/late lifecycle events; successful/failed/interrupted turns; unknown outcomes after drops; hung children; child signals and another process remaining available; separate consent, single-use authorization and invalid prompt rejection; no observed automatic approval response; canary-free persisted artifacts; M2.1 coexistence and unpromoted incomplete staging. The existing telemetry tests retain broader corruption, capacity and locking coverage.

This is not exhaustive OS containment testing. Detached-descendant escape, fatal parent-signal cleanup and real provider policy/configuration behavior remain unvalidated. The explicit Windows execution path fails closed and POSIX mock tests skip there.

## 9. Unsupported platforms and features

Real execution is disabled on **all platforms**. Windows mock subprocess execution is also disabled. No production launcher, documented process-local configuration assembly/effective-config verification, login, live turn CLI, daemon, automatic publication, reattachment, rollover, compaction or existing CLI/VS Code capture is provided. Capture state before the first usage event is not persisted. Explicit snapshots do not guarantee final lifecycle durability after a crash. Full runtime validation of all App Server response/item schemas is not implemented; only the conservative selected subset is supported.

## 10. Remaining risks before authenticated validation

POSIX group cleanup cannot contain a descendant that detaches and cannot guarantee cleanup after the parent crashes. Empty environment and a read-only ephemeral thread do not prove hooks/plugins/MCP, telemetry or other provider side effects are disabled. Resolved process-local policies must be verified before real startup/turns. Ephemeral mode does not establish absence of all Codex-owned persistence. Lifecycle must be durable independently of token usage and bounded publication must be serialized. Storage retains M2.1's ordinary sync/rename and hostile-path-race limitations. These gaps are why real execution was stopped at the disabled boundary instead of claiming complete M2.2a support.

## 11. Exact M2.2b requirements

The [required prerequisites and live procedure](MANAGED_APP_SERVER.md#required-m22b-prerequisites-and-live-smoke-test) are authoritative. Before a live smoke test: reconcile the missing architecture review; implement reviewed process-local restrictive configuration plus effective policy/requirements checks; establish tested OS containment and parent-signal cleanup or disable the platform; persist lifecycle without usage; implement a bounded stdin CLI with separate one-turn authorization; and pass offline/platform checks.

Then obtain explicit approval for authenticated validation, pin CLI 0.166.0, record host/runtime/policy evidence, use an already authorized account with no proactive refresh/login/credential copying, initialize exactly one owned ephemeral read-only thread and obtain separate authorization for one harmless bounded stdin prompt. Observe exact start/usage/terminal correlation, persist only content-free metadata, inspect all artifacts/diagnostics with canaries, stop, and verify owned-process cleanup. A separate interrupt test needs another separately authorized turn. Stop on policy mismatch, privileged requests, missing correlation, uncertain outcome or cleanup failure. Never retry/replay automatically. Record actual provider-owned persistence and cross-platform results without extrapolation.
