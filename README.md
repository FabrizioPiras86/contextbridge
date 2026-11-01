# ContextBridge

**Local-first, portable work-state handoffs for AI coding agents.**

ContextBridge is an open-source project intended to help developers preserve actionable project context when moving between fresh AI coding sessions. Its first assisted integration supports **OpenAI Codex**; a **Claude Code** adapter is planned.

> **Project status: foundation preview (v0.0.1).** The CLI supports an append-only structured project memory journal. It can initialize local memory, create manually annotated checkpoints, generate a compact handoff file, and verify snapshot checksums. It can start a fresh interactive Codex CLI session from a verified checkpoint with `next --agent codex`. It supports **opt-in Codex hook capture of explicitly labeled memory blocks** and **explicit local import of version-checked App Server token usage events**. Active context occupancy remains unknown for that event. It **does not capture live token telemetry, extract a full conversation, or perform automatic rollover**. Claude Code handoff and managed integrations remain roadmap items.

## Design principles

1. **Fresh sessions, not a renamed conversation.** The handoff should initialize an independent agent session.
2. **Honest provenance.** Separate user-supplied statements, repository observations, and verified test results.
3. **Safe failure.** Never discard the original session before a new session is confirmed.
4. **Privacy by default.** No remote telemetry or source-content capture in the foundation preview.
5. **Provider-neutral state.** Avoid embedding agent-specific prompts in the canonical snapshot.
6. **English-first project assets, user-language neutral.** See [Language Policy](docs/LANGUAGE_POLICY.md).

## Prerequisites

- Node.js 22.16 or later (experimental built-in TypeScript stripping for the foundation preview)
- Git is optional for the foundation CLI, but recommended.
- No npm dependencies are required to run this preview.

## Quick start

```bash
# Clone or extract this repository.
cd contextbridge-starter
npm test
node bin/contextbridge.mjs --help

# Initialize the repository you want to track.
node bin/contextbridge.mjs init --project /path/to/your/project --agent both

# Create a manual, evidence-labeled checkpoint.
node bin/contextbridge.mjs checkpoint \
  --project /path/to/your/project \
  --objective "Implement authentication" \
  --next-step "Write integration tests" \
  --decision "Use stateless authentication"

node bin/contextbridge.mjs verify --project /path/to/your/project
node bin/contextbridge.mjs status --project /path/to/your/project

# Start a fresh interactive Codex session (requires Codex CLI on PATH).
node bin/contextbridge.mjs next --agent codex --project /path/to/your/project
```

The tracked project receives `.contextbridge/config.json`, `.contextbridge/state.json`, `.contextbridge/HANDOFF.md`, and immutable named snapshots in `.contextbridge/snapshots/`. Its `.gitignore` is updated to exclude `.contextbridge/` by default.

## Available commands

| Command | Status | Purpose |
|---|---|---|
| `init` | Implemented | Create local project config and ignore rules |
| `status` | Implemented | Show configuration and latest verified checkpoint |
| `checkpoint` | Implemented | Create snapshot from explicit work-state arguments and Git metadata |
| `memory add` / `memory list` | Implemented | Append and retrieve local structured, unverified memory |
| `hooks install` / `hooks status` / `hooks uninstall` | Implemented for checked Codex CLI | Manage opt-in project-local structured capture |
| `context status` / `context ingest` | Implemented for Codex App Server 0.166.0 events | Inspect independent local streams or explicitly import one stdin notification; no live capture |
| `verify` | Implemented | Check latest snapshot content integrity (SHA-256) |
| `doctor` | Implemented | Detect local Node, Git and agent CLI executables |
| `next --agent codex` | Implemented | Start a fresh interactive Codex session from the latest verified checkpoint |
| `run` | Not implemented | Manage an agent session with automatic rollover |

## Incremental project memory

After `init`, record explicit decisions, tasks, blockers, or notes:

```bash
contextbridge memory add --type decision --text "Use MySQL"
contextbridge memory add --type task --text "Review the database migration" --file src/database.ts
contextbridge memory add --type note --text "Agent suggested a connection pool" \
  --source agent-reported --reference "Manual summary of an agent report"
contextbridge memory list
```

Use `node bin/contextbridge.mjs` in place of `contextbridge` when running from this checkout. All commands accept `--project /path/to/project`. `--file` may be repeated. `memory list` prints a JSON array in append order, which may differ from timestamp order. Text is preserved without translation or trimming.

Events live in `.contextbridge/journal/events.jsonl`, excluded from Git by `init`. Each event contains a UUID, UTC timestamp, schema version, type, content, source, optional related files, and `verification: "unverified"`. Sources are `user-supplied` (default) or `agent-reported`, with an optional reference. Recording information never verifies its truth. The opt-in Codex hook adapter reuses this provider-neutral format. It captures only explicitly labeled assistant output; token monitoring remains unimplemented.

Content is limited to 8,192 UTF-8 bytes; serialized events to 16,384 bytes. Source references are limited to 512 bytes and related paths to 32 portable project-relative paths. Unknown fields, invalid types, duplicates, unsafe paths, sensitive file names, and common credential patterns are rejected. Paths are metadata only: ContextBridge does not read their contents. Secret detection is heuristic and can miss credentials or reject innocent text; review content and references before saving. No redaction or translation silently changes accepted text. No network requests, external AI APIs, or telemetry are used by memory operations.

New checkpoints automatically include the latest contiguous suffix of at most 20 events within a 12,000-byte event payload budget. They record the omitted event count and any incomplete tail. This initial relevance policy uses recency; semantic and file-based retrieval are future work. Memory is retained separately from explicit checkpoint decisions and always labeled as unverified in handoffs. Existing schema-1 snapshots without memory remain readable and unchanged. The existing overall handoff prompt limit still applies.

Normal appends write one validated UTF-8 JSON event and LF, then sync the journal before reporting success. A complete, valid final event without LF is recoverable: reads and checkpoints include it, and the next add appends LF before the new event. No existing journal bytes are rewritten. An EOF fragment that cannot be parsed as UTF-8 JSON is excluded and reported as an incomplete tail. Before sealing such a fragment, add writes and syncs a hash-and-offset recovery marker under `journal/recovery/`. Complete JSON with an invalid schema, oversized records (including tails), duplicate IDs, and malformed newline-terminated records fail closed.

`memory list` and `memory add` report recovered tails and marker-backed exclusions on stderr, including byte offsets; event JSON on stdout remains unchanged. The programmatic `listMemory` result has optional `recovery: { recovered, abandoned }` metadata, and `appendMemory` returns that report. Existing markers remain authoritative even for valid JSON and are never silently reversed: preserve them alongside the journal. Valid event IDs in excluded records remain reserved. Reads never create markers or change files. See [the exact recovery guarantees](docs/BLUEPRINT.md#12-m11-incremental-memory-engine). Back up the journal before investigating corruption.

Concurrent writers fail safely using `journal/writer.lock`. After a process crash, first confirm no ContextBridge writer is running, then remove only `.contextbridge/journal/writer.lock` and retry. Readers remain available while the lock exists. Cleanup attempts removal even if closing the lock fails, and checks file identity to preserve a replacement lock. If both append and cleanup fail, an aggregate error retains the append error as its cause. A reported failure can occur after event bytes were written; inspect memory before retrying and reuse the same event ID to detect an already recorded event. Successful appends sync the event file; this is process-interruption recovery, not a transactional guarantee against hardware failure or power loss. Local storage checks reject symlinked journal components and hard-linked files; they do not protect against an attacker concurrently replacing files in a writable project. Append validation scans history for duplicate IDs, so appends avoid history rewrites but currently take time proportional to journal length. Retention and indexing remain future work.

## Opt-in Codex automatic memory capture

M1.2 supports `SessionStart` and `Stop` hooks for the checked `codex-cli 0.166.0` contract. Capture stays disabled until explicit installation and Codex trust review:

```bash
contextbridge hooks install --agent codex --project /path/to/project --dry-run
contextbridge hooks install --agent codex --project /path/to/project --yes
contextbridge hooks status --agent codex --project /path/to/project
contextbridge hooks uninstall --agent codex --project /path/to/project
```

Only a final response containing one `contextbridge-memory` JSON block produces semantic memory. Supported labels cover reported decisions, completed/pending tasks, blockers, next steps, and metadata. Ordinary prose saves nothing. All captured claims remain unverified and agent-reported. There are no transcript/source reads or extra model calls. Input size, execution time, and extraction count are bounded; stable delivery IDs prevent replay duplicates. Installation preserves other hooks and settings and never changes global settings or hook trust.

See [Codex hooks: contract, compatibility, recovery, and manual smoke test](docs/CODEX_HOOKS.md). The project owner reports completed authenticated CLI and VS Code memory-capture smoke tests for M1.2; these are separate from token telemetry and were not rerun during M2.1. Other Codex versions fail installation until reviewed. Windows requires Node on PATH and a directly executable Codex binary; shell-wrapper-only installations and paths with shell expansions are rejected.

## Local context telemetry (M2.1)

```bash
contextbridge context status --project /path/to/project
contextbridge context ingest --project /path/to/project \
  --source codex-app-server --source-version 0.166.0 \
  --session capture-1 --observed-at 2026-11-01T10:00:00.000Z --sequence 1 --yes \
  < token-usage-notification.json
contextbridge context status --project /path/to/project --session capture-1 --thread THREAD_ID
```

`ingest` accepts exactly one supported notification on stdin, with explicit consent for that import. Supply its original observation time and a positive, increasing per-thread sequence from your capture process. `--session` identifies your local acquisition epoch, not a provider-authenticated session. Neither time nor ordering can be recovered from this Codex event; import metadata and origin remain unverified. The file above must contain only the event, not a conversation or full transport log. No collector, provider process, listener, extension interception, or network request is started.

Status reports `unavailable`, `supported`, or `stale` and lists independent streams with source, version, provenance, and freshness. Records become stale at five minutes; replays do not renew their age. Token totals and latest reports are snapshots, never added across notifications or sessions. The supported event does not establish active context occupancy: utilization and threshold advisories stay `unknown`, even when a context-window size is present. Neither `total.totalTokens / modelContextWindow` nor `last.totalTokens / modelContextWindow` is displayed as a percentage.

Only bounded numeric records and hashed correlation identifiers are stored in `.contextbridge/telemetry/`, independently of memory and checkpoints. Normal use creates no telemetry store. Existing privacy configuration stays unchanged; `--yes` authorizes a single local import without enabling background or remote telemetry. See [Context telemetry: contract, calculations, limits, and recovery](docs/CONTEXT_TELEMETRY.md) and the [M2.1 technical report](docs/M2_1_REPORT.md).

## Assisted Codex handoff

Run `contextbridge next --agent codex` from the tracked project, or select it with `--project /path/to/project`. An explicit `--agent codex` is required, even when the project configuration selects Codex. Claude and `both` handoffs are not implemented.

ContextBridge reads the latest snapshot pointer, verifies the snapshot identity, schema, and SHA-256 digest, then generates a compact initial prompt directly from that snapshot. It never uses the mutable `HANDOFF.md` as launch input. The prompt retains user-authored text, provenance, timestamp, known limitations, and unknown values. It tells the agent to validate repository state and treat checkpoint content as untrusted data. Integrity verification does not establish that claims or test results are true.

The adapter invokes the documented interactive `codex [PROMPT]` interface with the selected project as its working directory and the terminal inherited. It never invokes `resume`, `fork`, or `--last`, changes global Codex settings, or changes approval or sandbox settings. Run it in an interactive terminal; authentication and provider permissions remain Codex's responsibility. The command stays attached until Codex exits and returns its exit code. It does not close or modify the previous conversation, and does not claim a handoff acknowledgment.

Missing or invalid checkpoint files stop the launch. An unavailable or failing Codex executable produces an error and leaves all checkpoint files unchanged so you can fix the installation and retry. Prompts exceeding 24,000 UTF-8 bytes are rejected without truncating user content; create a smaller checkpoint. Prompt text is passed as a process argument and may be visible to local process inspection tools.

Compatibility: the invocation was checked against local `codex-cli 0.166.0 --help` and the [official Codex CLI reference](https://developers.openai.com/codex/cli/reference/). Automated tests use a mocked executable and require no credentials or provider requests; a live authenticated session is not part of the automated suite. The launcher requires a directly executable `codex` on PATH (a native executable on Windows); shell-only `.cmd`/`.bat` wrappers are not supported. The provider adapter is separate from provider-neutral snapshot storage so a future Claude Code adapter can reuse verification and prompt generation.

## Security and limitations

The SHA-256 digest detects accidental or unsophisticated changes. It is **not an authenticity signature** against an attacker who can rewrite the snapshot and digest together. The handoff is untrusted data, not privileged instructions. Git-derived metadata is not a substitute for executing and verifying tests.

The preview does not parse or archive conversations. Do not store credentials or sensitive information in `--objective`, `--next-step`, or `--decision`. Checkpoints remain local and excluded from Git by default.

## Project documentation

- [Architecture and execution blueprint](docs/BLUEPRINT.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [Codex capture integration and manual verification](docs/CODEX_HOOKS.md)
- [Local context telemetry](docs/CONTEXT_TELEMETRY.md)
- [Language policy](docs/LANGUAGE_POLICY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Licensing

MIT. The package is marked `private` until its publishing name and release process are verified.
