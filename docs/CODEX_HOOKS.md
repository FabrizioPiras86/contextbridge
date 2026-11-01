# Codex automatic memory capture (M1.2)

This opt-in adapter feeds the existing M1.1 journal. It does not start agents, call a model, read transcripts or source files, monitor tokens, or roll sessions over. It creates no second semantic store and changes no snapshot schemas. Normal ContextBridge usage leaves capture disabled.

## Compatibility research (2026-11-01)

The [official hook reference](https://learn.chatgpt.com/docs/hooks) (also reached through [the requested URL](https://developers.openai.com/codex/hooks)) documents project-local `.codex/hooks.json`, command handlers, review through `/hooks`, and these lifecycle events: `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `Stop`, and `Interrupt`.

Local inspection found `codex-cli 0.166.0`, `hooks stable true`, and a hook-trust option in CLI help. No trust bypass was used. This implementation deliberately accepts only that exact version with hooks enabled; unknown older or newer versions fail installation until their contract is checked. The probe uses the selected project as cwd, so project configuration participates in feature detection. It does not modify settings.

The [official glossary](https://learn.chatgpt.com/docs/glossary) lists hooks for CLI and IDE. This is documented availability, not verification of this adapter in an installed VS Code extension. Extension version, trust workflow, and delivery remain unverified here. No authenticated live CLI or IDE conversation was run. Mock tests establish adapter behavior, not provider delivery. Cloud and remote execution are outside this milestone.

## Install, inspect, and remove

Use an initialized project and a stable ContextBridge checkout/install location:

```bash
contextbridge init --agent codex --project /path/to/project
contextbridge hooks install --agent codex --project /path/to/project --dry-run
contextbridge hooks install --agent codex --project /path/to/project --yes
contextbridge hooks status --agent codex --project /path/to/project
contextbridge hooks uninstall --agent codex --project /path/to/project --dry-run
contextbridge hooks uninstall --agent codex --project /path/to/project
```

From this checkout, replace `contextbridge` with `node /absolute/path/to/contextbridge/bin/contextbridge.mjs`.

`--yes` explicitly opts into local capture; dry-run writes nothing. Installing is separate from provider trust: inspect and trust the definitions using Codex `/hooks`, then start a fresh session. Installation does not bypass hook trust or grant permissions. Status reports local configuration and compatibility; it cannot establish runtime trust or admin policy. Hooks may be disabled by policy even when local configuration is installed.

The installer adds one owned group each for `SessionStart` and `Stop` in project-local `.codex/hooks.json`. It retains other JSON keys and hooks, including later additions. JSON formatting may change; `config.toml`, global settings, permissions, AGENTS.md, and existing journal/snapshot files are untouched. The project-local hook file may be tracked by Git: review it before sharing because its commands contain machine-specific absolute paths. Do not copy hook definitions blindly to another machine.

Commands use the actual absolute ContextBridge hook entry path. POSIX commands pin the current Node executable and quote arguments. Windows commands use `node` from PATH with quoted absolute script/project paths; Node 22.16+ must be available in the hook environment. Windows paths containing shell expansion/control characters are rejected. A directly executable Codex CLI is needed for the compatibility probe; shell-only `.cmd`/`.bat` shims are not supported. Automated tests cover portable behavior; real Windows and Linux delivery still require CI/manual checks.

The ownership receipt is `.contextbridge/integrations/codex-hooks.json`; it contains hashes and owned definitions, never captured conversation text. Removing deletes only matching owned groups and retains other configuration and recorded memory. Edits to owned definitions, missing ownership information, malformed files, links, and oversized configuration fail closed. Move or upgrade the ContextBridge installation by uninstalling first, then reinstalling and reviewing trust again.

## Deterministic extraction contract

`SessionStart` validates input, confirms installation and project identity, and saves no semantic event. `Stop` accepts semantic data only when a session ID, turn ID, and explicit `stop_hook_active: false` are available. Missing/null assistant text, missing turn IDs, missing/null continuation flags, and continued turns save nothing. Other event types and unknown fields are rejected. `PostToolUse` and `PreCompact` are intentionally not installed: their additional data is unnecessary for this extraction policy.

The assistant's final response must include exactly one explicitly labeled block, on its own lines:

````text
```contextbridge-memory
{"schemaVersion":1,"events":[{"kind":"decision","text":"Use SQLite for the local index."},{"kind":"task-pending","text":"Add migration tests."},{"kind":"next-step","text":"Review the migration plan."}]}
```
````

No hook injects extraction instructions or requests another model response. Ask the assistant for this block when appropriate. Ordinary prose and unlabeled code blocks produce no semantic events. Multiple labeled blocks, unknown fields/kinds, malformed JSON, sensitive text, or excessive size reject the entire extraction before any append. This is an explicit data convention, not a supported Codex API extension.

| Labeled kind | Stored event type | Interpretation |
|---|---|---|
| `decision` | `decision` | Explicitly reported architectural decision |
| `task-completed` | `task` | Reported completed task; no test verification inferred |
| `task-pending` | `task` | Reported pending task |
| `blocker` | `blocker` | Reported blocker |
| `next-step` | `note` | Reported next step |
| `project-metadata` | `note` | Explicitly supplied project metadata |

Every entry contains only `kind` and nonempty `text`. Text is preserved without translation or trimming; English prefixes distinguish task states and note purposes. All stored entries have `source.kind: "agent-reported"` and `verification: "unverified"`, even if the assistant claims tests passed. The source reference identifies the adapter and a hashed delivery identity; raw session/turn IDs are not stored. Assistant text cannot establish repository facts, actual task completion, or evidence-backed verification. ContextBridge does not semantically judge whether arbitrary labeled text describes an architectural decision or non-sensitive metadata; users must review claims. Existing heuristic secret rejection applies and is not a complete privacy guarantee.

## Bounds, replay, and failure guarantees

- Hook input is capped at 65,536 UTF-8 bytes; at most eight entries are accepted. Existing event/content limits remain in force. Configuration/receipts are capped at 262,144 bytes. Invalid input diagnostics never echo the payload.
- The configured project is fixed in the command. Input cwd must resolve to that project or a descendant. Input transcript paths are type-checked but never opened. No tool output, prompts, full final response, or transcript is saved; only accepted labeled text fields are journaled.
- Stable IDs derive from a domain-separated SHA-256 hash of session, turn, and entry index, using the existing UUID-shaped event ID format. Replays of matching claims are skipped. A changed claim at the same delivery index fails closed; a new turn is a new delivery. No IDs are deduced from vague prose or wall-clock timestamps.
- Each event uses the original journal append/validation/locking/recovery path. A block is prevalidated, but multiple appends are not one transaction: an interruption or busy lock can leave a committed prefix. Replaying the original block skips that prefix. Complete unterminated events remain recoverable. A duplicate race is accepted only after checking the stored claim matches. A marker-excluded delivery ID remains reserved and cannot be silently reused.
- Hooks return advisory JSON. Successful capture reports counts, duplicates, recovered tails, and marker exclusions. Errors report skipped/incomplete capture without exposing raw error data. They never request continuation or block a provider action, and never invoke Codex, tools, or other hooks. The process environment guard rejects inherited reentrancy; separate process replays use journal deduplication.
- The watchdog runs the worker without a shell, bounds total execution (including stalled stdin) to five seconds, and kills it on timeout; the provider hook timeout is six seconds. OS scheduling and uninterruptible I/O can delay termination. No automatic retries or writer-lock takeovers occur. Killing during append can leave a stale lock or partial journal tail. Confirm no writer is running before manually removing a stale writer lock, then inspect `memory list` before replaying. Capture is best effort, not a lossless conversation log.
- Installation uses a separate `.contextbridge/hooks.lock`. A pending receipt allows retry after interrupted install; an uninstall receipt records the expected removal digest so removal can be resumed. Status exposes pending/conflict states. A management-process crash may leave its lock: confirm no install/uninstall is running before manual removal. Checks protect normal local use, not hostile concurrent file replacement or external editors racing the final write. Back up configurations before resolving conflicts. Atomic renames are not a power-loss transaction protocol.

## Manual CLI smoke test

1. Run `npm test` and `git diff --check` in the ContextBridge checkout. In a disposable project, run the init, dry-run, install, and status commands above. Confirm status reports the checked CLI and installed configuration.
2. Open Codex CLI in the disposable project, use `/hooks` to review and trust the two ContextBridge definitions, then start a fresh session. Do not use a hook-trust bypass or change permissions. No model call is needed merely to inspect definitions.
3. Send this explicit request: “For this smoke test, report this unverified note only. End your response with a contextbridge-memory fenced block containing exactly {\"schemaVersion\":1,\"events\":[{\"kind\":\"next-step\",\"text\":\"Review the disposable smoke test.\"}]}.” This live step uses your normal Codex authentication and model usage; ContextBridge makes no extraction API call.
4. Run `contextbridge memory list --project /path/to/project`. Verify one `note`, the text with its next-step prefix, `agent-reported`, and `unverified`. A response without the requested block should add nothing. Continuing a turn via a Stop continuation should add nothing. Automated fixture tests cover repeated delivery of the same IDs; repeating a user prompt creates a different turn and is not a replay test.
5. Uninstall, verify other hooks/settings and existing memory remain, then start another session. Confirm `/hooks` no longer lists the owned definitions and no automatic capture occurs.
6. If testing VS Code, independently inspect its extension version, hook discovery and trust UI, session-start and stop deliveries, cwd, and final-response payload. Record observed results separately. A successful CLI smoke test does not establish IDE compatibility.

An untrusted or policy-disabled hook may never execute, so the adapter cannot report that absence itself. Read status and inspect the provider's hook UI when memory is missing. Deterministic extraction cannot discover implicit decisions, reconcile contradictions, verify tests, or select relevant evidence from conversations without additional reasoning; these remain future work.
