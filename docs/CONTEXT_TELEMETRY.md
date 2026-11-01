# Local context telemetry (M2.1)

ContextBridge can validate and explicitly import one Codex App Server token-usage notification at a time. Live capture is **not implemented**. No Codex process, provider connection, network listener, global setting, extension attachment, or model request is involved. Normal initialization and memory/handoff operations leave telemetry disabled and create no telemetry directory.

## Verified contract and research

Research date: 2026-11-01. Installed executable: `codex-cli 0.166.0`.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) documents `thread/tokenUsage/updated`, client initialization, and version-specific schema generation. App Server is a client/server integration surface; availability of its protocol does not grant access to an existing interactive session.

The installed CLI generated both JSON Schema and TypeScript bindings using:

```bash
codex app-server generate-json-schema --out /tmp/contextbridge-codex-0166-schema
codex app-server generate-ts --out /tmp/contextbridge-codex-0166-ts
```

The generated `v2/ThreadTokenUsageUpdatedNotification.json` is preserved unchanged in `tests/fixtures/telemetry/codex-0.166.0-token-usage.schema.json`. The generated `ServerNotification` union confirms the method name. The JSON schema, unlike the generated TypeScript alias, makes `modelContextWindow` optional and `cacheWriteInputTokens` optional with default zero. Missing/null windows normalize to null; missing cache-write counts normalize to zero, but null counts are invalid. Only the declared version `0.166.0` is supported; changing a version label is not contract verification.

The [version-pinned public protocol mapping](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1841) maps `total` and `last` from the corresponding core counters, with a nullable context-window size. Required params are `threadId`, `turnId`, and `tokenUsage`; required usage objects are `total` and `last`. The envelope contains `method` and `params`; optional `jsonrpc` must equal `2.0`. Request IDs, responses, unrelated methods, unknown fields, duplicate JSON keys, and unsupported shapes are rejected.

The [version-pinned core implementation](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/protocol/src/protocol.rs#L2338) accumulates usage in `total_token_usage` and replaces `last_token_usage`. It can also synthesize total-only counts when filling a context limit. A reasoning-inclusion flag exists in core but is absent from the public notification. Core UI percentage helpers are implementation details, not a public guarantee that this event measures the current active context. ContextBridge therefore preserves reported counters without deriving occupancy.

## Field meanings

Each of `total` (cumulative reported usage) and `last` (latest reported usage, not necessarily an entire turn) has this breakdown:

| Field | Meaning in the supported adapter |
|---|---|
| `inputTokens` | Reported input-token count |
| `cachedInputTokens` | Reported cached input count; never added again to input |
| `cacheWriteInputTokens` | Reported cache-write input count; omitted means zero |
| `outputTokens` | Reported output-token count |
| `reasoningOutputTokens` | Reported reasoning output count; never added again to output |
| `totalTokens` | Source-reported aggregate; may include unattributed synthetic counts |

`modelContextWindow` is the reported model context-window size, or unknown. It is neither a token count consumed nor a request quota. ContextBridge does not infer the model, underlying model provider, effective UI budget, or remaining rate-limit allowance from it.

Validation intentionally supports a conservative subset: counts must be nonnegative JavaScript safe integers, encoded as integer JSON literals without decimal/exponent notation. This prevents fractional or underflowing literals from silently rounding into an accepted integer. Cached/cache-write input cannot exceed input, reasoning output cannot exceed output, and total cannot be smaller than input plus output. Latest counts cannot exceed corresponding cumulative counts in one notification. Totals larger than input plus output are retained because synthetic counts need not have a complete breakdown. Sums are compared using `BigInt` to avoid overflow. Zero/negative/unsafe/fractional/nonfinite windows are rejected. Unsupported but legitimate future/provider-specific conventions require adapter review, not relaxed validation.

## Commands and explicit opt-in

Use an initialized project. From a checkout, substitute `node bin/contextbridge.mjs` for `contextbridge`.

```bash
contextbridge context status --project /path/to/project
contextbridge context ingest --project /path/to/project \
  --source codex-app-server --source-version 0.166.0 \
  --session capture-1 --observed-at 2026-11-01T10:00:00.000Z \
  --sequence 1 --yes < token-usage-notification.json
contextbridge context status --project /path/to/project \
  --session capture-1 --thread thread-1
```

`ingest` reads exactly one UTF-8 JSON notification from stdin. The import is opt-in for that invocation only. No persistent telemetry toggle is enabled, and existing `privacy.telemetry: false` remains unchanged: no background or remote collection is introduced. Unknown/repeated options and missing metadata fail closed. Input is capped at 16,384 bytes, 16 JSON nesting levels, and a five-second stdin deadline. Avoid piping a complete App Server stream: it can contain conversation content and is not accepted by this command.

`--session` names a local acquisition epoch selected by the caller. It is not Codex's `thread.sessionId`, which this notification does not include. Use a new acquisition ID for a separate collector/session epoch or when ordering is reset. `--sequence` is a positive safe integer, increasing per acquisition/thread pair, assigned in source order by the capture process. `--observed-at` must be the original observation time in canonical UTC ISO format with milliseconds; future observations are rejected. Import time must not be substituted for an old event's observation time. The event has no timestamp, sequence, event ID, or authenticated session-root metadata: ContextBridge cannot independently verify the caller's ordering, time, version declaration, or origin.

This is an offline/local import route. It does not claim demonstrated authenticated App Server event delivery. A human-authored payload can satisfy the schema, so provenance distinguishes verified schema from unverified origin and caller-supplied metadata.

## Observation model, ordering, and status

Version-1 observations contain provider/source identifiers, hashed acquisition/thread/turn IDs, observation timestamp, ordering watermark, separate optional cumulative/latest usage, optional window size, context measurement state, and explicit provenance. `provider: codex` identifies the agent integration; it does not assert OpenAI is the underlying model provider. The generic model permits absent usage and absent turn IDs for future adapters. The current parser requires all fields mandated by its supported notification.

The store retains one latest snapshot for each `(provider, source, acquisition, thread)` pair. It never adds usage from notifications, threads, or acquisitions. Status lists independent streams or selects one using both original `--session` and `--thread` IDs. It never guesses which stream belongs to the user's currently open agent.

- Lower sequences are ignored as `out-of-order`.
- Equal sequences with matching reports are `duplicate`, without refreshing age; changed reports at the same sequence fail.
- Higher sequences with older observation times are ignored as `out-of-order`.
- Identical consecutive reports at higher sequences advance the ordering watermark but preserve the original report's age. This is deliberately conservative; unchanged usage is not a heartbeat.
- Other higher-sequence reports replace the snapshot, including decreasing counts or changed window sizes. No increase is summed and no decrease is interpreted as a confirmed compaction/reset.

Deduplication concerns the retained snapshot and ordering watermark, not an unbounded historical event index. Old reports replayed with their original sequences cannot supersede a newer watermark. A caller that assigns a new sequence and time to an old changed payload can misrepresent history; the source provides no event identity to detect that. No accounting total is incremented even in that case.

Interrupted turns need no completed-turn assumption: valid usage is retained as a report, without asserting success or completion. Compaction is not inferred from counters. Compaction/lifecycle notifications are unsupported and rejected; no stale pre-compaction measurement can become a verified occupancy through this adapter.

`context status` emits JSON with capability, provider/source/version, `liveCapture: false`, status, per-stream freshness/provenance/counters, and unknown utilization/advisory. No record means `unavailable`. Fresh records yield `supported`; any nonfresh record in a multi-stream listing yields aggregate `stale`, with each individual freshness shown. Five minutes after the retained observation (`age >= 300000 ms`) it is stale. A future-dated stored observation, for example after clock rollback, has `freshness: unknown` and cannot trigger an advisory. Read-only status creates no telemetry files. Corrupt stores produce an error rather than a misleading unavailable state.

## Calculations and advisory thresholds

The Codex adapter always stores `context: { kind: "unknown" }`. **No context utilization percentage is calculated for imported Codex events.** In particular, neither cumulative nor latest total divided by the window is presented as active occupancy. The event does not establish the current context after new tool outputs, interruption, compaction, or reasoning retention. Fresh usage is not proof of fresh occupancy.

The provider-neutral advisory function reuses the configured warning/handoff/safety thresholds. It requires a fresh active-context measurement explicitly verified by a future adapter and a positive known window. Unknown, invalid, stale, or unverified measurements produce `unknown`. A future adapter must also establish measurement provenance before setting that verification marker; a type annotation is not evidence. The current persistent adapter rejects any attempt to inject such a measurement.

For an eligible measurement only, theoretical utilization is `100 * usedTokens / windowTokens`. The evaluator compares integer cross-products `100n * usedTokens >= threshold * windowTokens`, using `BigInt` and inclusive boundaries without rounding. The highest reached threshold wins (`safety`, then `handoff`, then `warning`); otherwise `none`. Values above the window reach safety. Defaults are 60/75/90; exact boundaries, small denominators, large counts, invalid inputs, and staleness are tested. This function only returns an advisory label. It sends no notification, interrupts nothing, and performs no compaction, switching, or rollover.

## Storage, privacy, and recovery

The separate store is `.contextbridge/telemetry/observations.json`. It has its own schema version and SHA-256 digest, never enters memory, snapshots, handoffs, or launch prompts, and is covered by the existing `.contextbridge/` ignore rule. No prompts, transcript paths, source code, assistant text, tool outputs, authentication data, or raw notifications are retained. Hashing correlation IDs reduces arbitrary-text retention; deterministic hashes are linkable and are not encryption or guaranteed anonymization. This is strict field selection, not a general-purpose secret scanner or protection from maliciously encoded numeric data.

Published storage is capped at 64 independent streams and 262,144 bytes; one fixed staging copy can temporarily add another 262,144 bytes, plus the empty lock file. Reads allocate a bounded buffer and reject oversized/invalid UTF-8 files. Capacity fails rather than silently evicting a session. To start a fresh capture set after reaching capacity, stop writers and manually archive the telemetry directory. No automatic retention deletion or destructive operation is performed.

Readers validate the store digest, every observation schema, consistency, uniqueness, and provenance. A forged measured occupancy is rejected even with a recomputed digest. Checksums detect accidental corruption, not an attacker who can rewrite valid records and their digest.

Writers take `writer.lock` exclusively, rescan the current store, write and sync a fixed `pending.json` using exclusive creation, and rename it over the store. Readers see the previous or new complete document under ordinary local filesystem rename semantics. Lock cleanup checks ownership and still attempts unlink if close fails. Concurrent writers fail safely rather than waiting/retrying. A reported error can occur after publication; inspect status before retrying. Replaying the same report is safe.

After a crash, readers ignore an incomplete staging file and continue to use the last published store. Confirm no writer is active before backing up and removing only `writer.lock` and/or the unpublished `pending.json`; a leftover staging file blocks the next publishing write and is never overwritten or promoted automatically. With no previous published store, status is unavailable. Corrupt published data fails closed and is never silently reset. Back it up before investigation. One fixed staging file bounds interruption leftovers. File sync plus rename is process-interruption recovery, not a full power-loss transaction or directory-sync guarantee.

Storage components reject symbolic links, hard-linked files, and unusual file types. IDs never select filesystem paths. Owner-only directory/file modes are requested on POSIX; Windows follows host ACLs. Checks protect normal local use, not an attacker racing path replacements in a writable project. The selected project root may itself be an intentional filesystem alias, as in existing commands. No shell or platform-specific external command is used by telemetry operations.

## CLI hooks, VS Code, and remaining integration work

The [official hook inputs](https://learn.chatgpt.com/docs/hooks) for M1.2's `SessionStart` and `Stop` do not supply usage counters or context-window occupancy. Assistant prose, hook model names, `transcript_path`, and lifecycle events are not substitutes. No transcripts or rollout logs are read to extract metrics.

The [IDE documentation](https://learn.chatgpt.com/docs/ide) describes extension usage but does not establish a public telemetry subscription API for another tool to monitor an already running VS Code conversation. No supported extension-session telemetry export was identified in the reviewed documentation. This is an explicit unsupported capability, not proof that no future API can exist. ContextBridge does not inspect private extension internals, intercept its App Server connection, or attach to a daemon/session.

M1.2 CLI and VS Code memory-capture smoke tests are completed according to the project owner; this is distinct owner-reported evidence, not a token-telemetry smoke test. Continuous monitoring still needs a managed client using documented App Server initialization/subscriptions, bounded content-free event routing, reliable source-time/order and lifecycle handling, opt-in process ownership, authenticated delivery tests, and a documented active-occupancy measurement. Existing interactive CLI and VS Code sessions need their own supported integration contracts. No live integration is claimed in M2.1.


## M2.2a schema-2 mock-managed observations

The [managed foundation](MANAGED_APP_SERVER.md) adds explicit internal mock acquisition snapshots to the same bounded store. Schema-1 imported observations stay unchanged and readable. Schema-2 records use `managed-stdio-mock`, client-receipt timestamp/local-receive ordering and unverified origin, plus connection, turn, completeness and lifecycle receipt metadata. Acquisition/thread/turn IDs are hashed with the existing correlation function. The persisted session hash identifies the acquisition UUID, not a provider-authenticated session.

The schema-1 store envelope accepts both observation versions; managed records must pass strict metadata checks plus all existing token/identity/context validation. Lifecycle changes participate in replay comparison. `observedAt` remains the usage timestamp, so stopping a capture cannot refresh token age. Status marks disconnected/stopped streams stale; it never chooses one active thread or derives occupancy. No managed telemetry enters semantic memory, snapshots or handoffs.

M2.2a originally required explicit persistence and had no event-write queue or record before usage. The M2.2b.1 extension below supersedes those limitations. Existing staging/lock recovery and capacity limits still apply. Real capture remains disabled; neither milestone claims authenticated delivery or prevention of all Codex-owned persistence.


## M2.2b.1 durable lifecycle extension

The [durable managed lifecycle foundation](MANAGED_APP_SERVER.md#durable-publication-and-recovery) supersedes M2.2a's explicit-only persistence limitation. Captures persist acquisition, ready, pending, running, terminal and connection transitions independently of usage. A schema-2 store envelope atomically contains bounded lifecycle and observation collections under the existing shared writer lock. Existing schema-1 envelopes, imported observations and legacy schema-2 managed observations remain readable; their provenance and usage values are preserved. New lifecycle-managed observations require joint publication with matching correlation, sequence and lifecycle metadata. Imports cannot overwrite a lifecycle-managed stream.

`context status` reads one committed envelope without mutation or provider launch, adds historical lifecycle records and marks all saved managed observations stale. Past connection values remain available as metadata, with current connectivity and nonterminal outcomes explicitly unconfirmed. Usage availability can remain unavailable while lifecycle evidence exists. No active session or context percentage is inferred. Staging and stale locks never authorize promotion, replay or process operations. Real managed execution remains disabled.
