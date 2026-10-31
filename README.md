# ContextBridge

**Local-first, portable work-state handoffs for AI coding agents.**

ContextBridge is an open-source project intended to help developers preserve actionable project context when moving between fresh AI coding sessions. Its first planned integrations are **Claude Code** and **OpenAI Codex**.

> **Project status: foundation preview (v0.0.1).** The CLI can initialize local memory, create manually annotated checkpoints, generate a compact handoff file, and verify snapshot checksums. It **does not yet monitor agent token usage, install hooks, extract a full conversation, or start new agent sessions**. The assisted and automatic integrations are roadmap items, not shipped features.

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
| `next` | Not implemented | Start a fresh agent session from a verified handoff |
| `run` | Not implemented | Manage an agent session with automatic rollover |

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
