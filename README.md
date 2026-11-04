# ContextBridge

**Local-first, portable work-state handoffs for AI coding agents.**

ContextBridge is an open-source project intended to help developers preserve actionable project context when moving between fresh AI coding sessions. Its first assisted integration supports **OpenAI Codex**; a **Claude Code** adapter is planned.

> **Project status: V1 Assisted preview (package version 0.0.1; private, local distribution only).** The CLI supports an append-only structured project memory journal. It can initialize local memory, create manually annotated checkpoints, generate a compact handoff file, and verify snapshot checksums. It can start a fresh interactive Codex CLI session from a verified checkpoint with `next --agent codex`. It supports **opt-in Codex hook capture of explicitly labeled memory blocks** and **explicit local import of version-checked App Server token usage events**. Active context occupancy remains unknown for that event. It **does not capture live token telemetry, extract a full conversation, or perform automatic rollover**. Claude Code handoff and managed integrations remain roadmap items.

## Design principles

1. **Fresh sessions, not a renamed conversation.** The handoff should initialize an independent agent session.
2. **Honest provenance.** Separate user-supplied statements, repository observations, and verified test results.
3. **Safe failure.** Never discard the original session before a new session is confirmed.
4. **Privacy by default.** No remote telemetry or source-content capture in the foundation preview.
5. **Provider-neutral state.** Avoid embedding agent-specific prompts in the canonical snapshot.
6. **English-first project assets, user-language neutral.** See [Language Policy](docs/LANGUAGE_POLICY.md).

## Prerequisites

- Supported preview runtime: Node.js 22.16+ within the 22.x line. Package metadata permits newer majors, but this milestone validates Node 22 only.
- Checkout execution uses experimental built-in TypeScript stripping; installed tarballs contain JavaScript.
- Git is optional for the foundation CLI, but recommended.
- No npm dependencies are required to run this preview.

## Install the local preview

There is no published npm release for this milestone. Do not install an unrelated registry package with the same name. From a trusted checkout, create an artifact directory and pack:

```bash
cd /path/to/contextbridge
npm test
# Create this directory first; choose an absolute path outside the checkout.
npm pack --pack-destination /absolute/path/to/artifacts
```

`npm pack` runs the dependency-free `prepack` build using Node's built-in type stripper. This is necessary because Node refuses TypeScript stripping under `node_modules`. The tarball includes both launchers, generated JavaScript, integration templates, documentation and license. It excludes source TypeScript, tests, native fixtures, build scripts, local state and account configuration. No dependencies are downloaded by the build. `private: true` remains set; packing does not publish anything.

Install the tarball in a disposable tool directory first:

```bash
cd /path/to/disposable-tool-directory
npm install --offline --ignore-scripts --no-save --package-lock=false --no-audit --no-fund /absolute/path/to/artifacts/contextbridge-0.0.1.tgz
npm exec --offline -- contextbridge --help
npm exec --offline -- contextbridge init --agent codex --project /path/to/your/project
```

Run later commands from that tool directory using `npm exec --offline -- contextbridge` in place of `contextbridge`. The installation needs no lifecycle scripts or build tools. Keep the installation at a stable path if you opt into hooks; uninstall hooks before moving or replacing it. Local installation creates `node_modules` in the selected tool directory. Never use a real project for automated smoke tests.

For contributor checks, `npm run test:package` packs twice, checks reproducibility on the same Node version, installs offline into a temporary directory and exercises the installed runtime with a controlled mock Codex executable. It is also included in `npm test` and the macOS/Ubuntu/Windows CI matrix. No authenticated session is used. See [release evidence and blockers](docs/V1_ASSISTED_RELEASE_REPORT.md).

## Use from a checkout

```bash
# Clone or extract this repository.
cd /path/to/contextbridge
npm test
node bin/contextbridge.mjs --help

# Initialize the repository you want to track.
node bin/contextbridge.mjs init --project /path/to/your/project --agent both

# Record an explicit claim; this remains unverified.
node bin/contextbridge.mjs memory add --project /path/to/your/project \
  --type decision --text "Use stateless authentication"
node bin/contextbridge.mjs memory list --project /path/to/your/project

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

`init` creates `.contextbridge/config.json` and updates the selected project's `.gitignore` to exclude `.contextbridge/`. `checkpoint` later creates `.contextbridge/state.json`, `.contextbridge/HANDOFF.md`, and immutable named snapshots in `.contextbridge/snapshots/`. `memory add` creates the separate local journal. Neither command installs hooks or captures transcripts.

## Supported V1 Assisted scope

- **Assisted handoff:** manually record memory, create and verify a checkpoint, then explicitly run `next --agent codex` to start a fresh interactive CLI session. This does not resume or replace a VS Code conversation.
- **Optional memory hooks:** explicit project-local opt-in for the checked Codex 0.166.0 contract and labeled memory blocks; trust review remains required. Hooks record unverified claims and do not checkpoint or switch sessions.
- **Manual checkpoints:** explicit objectives, next steps, decisions, bounded memory and Git metadata; no source files or transcripts are captured automatically.
- **Local telemetry imports:** explicit stdin imports of supported numeric events; no live collector. Active context occupancy stays unknown, including for existing VS Code sessions.
- **Unavailable:** automatic context switching, rollover, compaction, retries, Claude handoff and real managed App Server execution. Managed experiments remain offline test foundations.

## Available commands

| Command | Status | Purpose |
|---|---|---|
| `init` | Implemented | Create local project config and ignore rules |
| `status` | Implemented | Show configuration and latest verified checkpoint |
| `checkpoint` | Implemented | Create snapshot from explicit work-state arguments and Git metadata |
| `memory add` / `memory list` | Implemented | Append and retrieve local structured, unverified memory |
| `hooks install` / `hooks status` / `hooks uninstall` | Implemented for checked Codex CLI | Manage opt-in project-local structured capture |
| `context status` / `context ingest` | Implemented for Codex App Server 0.166.0 events | Inspect independent local streams or explicitly import one stdin notification; no live capture |
| `context run --agent codex --yes` | Prepared; real execution disabled | Report the M2.2a mock-only boundary without launching a provider |
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

Events live in `.contextbridge/journal/events.jsonl`, excluded from Git by `init`. Each event contains a UUID, UTC timestamp, schema version, type, content, source, optional related files, and `verification: "unverified"`. Sources are `user-supplied` (default) or `agent-reported`, with an optional reference. Recording information never verifies its truth. The opt-in Codex hook adapter reuses this provider-neutral format. It captures only explicitly labeled assistant output; live token monitoring remains unimplemented. Explicit local token-event imports are separate.

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

## Managed App Server foundation (M2.2a / M2.2b.1 / M2.2b.2 / M2.2b.3 / M2.2b.4 / M2.2b.5)

An internal bounded subprocess transport and capture state machine are tested against a local Node mock server. Separate initialization and exactly-one-turn authorization, content-free schema-2 observations, durable lifecycle persistence independent of usage, and compatibility with M2.1 imports are implemented. Acquisition is saved before initialization and turn-pending is saved before submission; a storage failure blocks submission. Lifecycle and usage snapshots publish together through a bounded queue and shared writer lock. Historical status is read-only: saved connectivity and unfinished outcomes remain unconfirmed, without resuming or replaying sessions. `context run --agent codex --project PATH --yes` deliberately exits with an unsupported message: **real execution remains disabled on every platform** pending process containment, process-local policy verification, and the remaining real-execution prerequisites. No real model call is made, and `--yes` does not authorize a turn. The [M2.2b.2 containment report](docs/M2_2B_2_REPORT.md) documents bounded mock POSIX group cleanup, cancellation and parent-signal tests. Escaped descendants, numeric identity races and parent hard failures remain outside that guarantee; Windows execution stays disabled.

The [M2.2b.3 runtime policy report](docs/M2_2B_3_REPORT.md) documents strict configuration/requirements admission before mock thread creation and effective thread checks before ready. Missing evidence fails closed. Positive offline tests require explicit harness assertions for properties the pinned protocol cannot establish; all assessments keep real runtime eligibility disabled. Policy responses are never logged or persisted, and an authorized mock turn revalidates supported policy evidence before submission. These checks do not prove startup isolation or real Codex runtime safety.

The [M2.2b.4 pre-spawn report](docs/M2_2B_4_REPORT.md) adds a separate offline isolation assessment and startup threat model. Complete mock evidence only completes an offline model: it never authorizes spawning, verifies real isolation or enables production eligibility. Environment/home discovery, inherited configuration/integrations, credentials, startup writes/network and parent-failure containment remain production blockers. Post-start configuration reads cannot prevent earlier startup effects.

The [M2.2b.5 feasibility report](docs/M2_2B_5_REPORT.md) reviews local macOS API documentation and tests a separate native suspended-admission experiment. It proves a narrow pre-execution gate and direct-child reaping for benign fixtures, while demonstrating surviving escaped descendants and children after supervisor hard failure. It provides no complete macOS containment guarantee. Linux cgroup v2 and Windows Job Objects remain separate, unimplemented and unvalidated candidates. The macOS-only tests compile a disposable C fixture with Command Line Tools; no native code is connected to the managed launcher. Real execution remains disabled, and both spawn authorization and production eligibility remain false.

See [supported contracts, limits, and M2.2b prerequisites](docs/MANAGED_APP_SERVER.md) and the [durable lifecycle report](docs/M2_2B_1_REPORT.md). Context occupancy, automatic rollover, and attachment to existing CLI/IDE sessions remain unavailable.

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
- [V1 Assisted release readiness](docs/V1_ASSISTED_RELEASE_REPORT.md)
- [Codex capture integration and manual verification](docs/CODEX_HOOKS.md)
- [Local context telemetry](docs/CONTEXT_TELEMETRY.md)
- [Language policy](docs/LANGUAGE_POLICY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Licensing

MIT. The package is marked `private` until its publishing name and release process are verified.
