# ContextBridge

**Local-first, portable work-state handoffs for AI coding agents.**

ContextBridge is an open-source project intended to help developers preserve actionable project context when moving between fresh AI coding sessions. Its first assisted integration supports **OpenAI Codex**; a **Claude Code** adapter is planned.

> **Project status: foundation preview (v0.0.1).** The CLI can initialize local memory, create manually annotated checkpoints, generate a compact handoff file, and verify snapshot checksums. It can start a fresh interactive Codex CLI session from a verified checkpoint with `next --agent codex`. It **does not yet monitor agent token usage, install hooks, extract a full conversation, or perform automatic rollover**. Claude Code handoff and managed integrations remain roadmap items.

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
| `verify` | Implemented | Check latest snapshot content integrity (SHA-256) |
| `doctor` | Implemented | Detect local Node, Git and agent CLI executables |
| `next --agent codex` | Implemented | Start a fresh interactive Codex session from the latest verified checkpoint |
| `run` | Not implemented | Manage an agent session with automatic rollover |

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
- [Language policy](docs/LANGUAGE_POLICY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Licensing

MIT. The package is marked `private` until its publishing name and release process are verified.
