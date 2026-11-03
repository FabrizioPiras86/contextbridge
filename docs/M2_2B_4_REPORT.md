# M2.2b.4 — Pre-spawn isolation and startup security

Date: 2026-11-03. Scope: offline assessment and security preparation only. **Real Codex App Server execution remains disabled on every platform.**

## Executive technical summary

Started with clean `main` at the expected `bd0f1548e703acf8f3ea871e0aec97f579b091ab`. Work is on `feat/managed-pre-spawn-isolation`. No commit, push, pull request or merge was performed.

Implemented a strictly typed, closed offline pre-spawn model with seventeen mandatory control categories. Missing, conflicting, unknown or unsupported evidence blocks model completion. Only explicitly selected macOS/Linux offline models for the pinned 0.166.0 contract can complete. Windows remains blocked. All results retain `spawnAuthorized: false`, `productionEligible: false`, unverified input provenance and the full list of unverified runtime controls. Complete mock claims establish only model coverage; they are neither observed enforcement nor permission to execute.

The assessment is intentionally independent of `OwnedProcess`, `ManagedTransport` and `ManagedCapture`. Connecting a claim-based API to a launcher would create unjustified trust. This milestone introduces no launcher, executable inspection, config override recipe, environment capture, credential handling, filesystem preparation or persistence schema. Preparation consists of a modeled admission boundary and concrete requirements for future containment work.

## Investigation and evidence classes

Reviewed AGENTS.md, SECURITY.md, README.md, the blueprint, roadmap, language policy, managed/telemetry contracts, M2.2b.1–3 reports, managed process/transport/session/policy/lifecycle code, telemetry storage/CLI and related tests. Inspected retained 0.166.0 configuration, requirements, initialization, thread, request and account schema contracts and their manifest. Existing full-suite schema/checksum tests retain fixture integrity checks. No Codex executable or schema generator was invoked.

| Evidence class | Available evidence | What it establishes |
|---|---|---|
| Prior documented behavior | Official documentation references recorded in M2.2b.2/3 and MANAGED_APP_SERVER.md | Design context about configuration, hooks and OS candidates; not fresh documentation verification or pinned-runtime enforcement |
| Pinned-schema evidence | `tests/fixtures/managed/manifest.json` and retained generated JSON schemas | Representable fields and configuration origins for 0.166.0; no guarantee of startup ordering, delivery, completeness or enforcement |
| Repository implementation | Explicit `env: {}`, shell=false, detached POSIX group, Windows checks, bounded transport and publication drain | Actual ContextBridge test-process controls; not containment of arbitrary native behavior |
| Offline mock evidence | New pure deterministic tests plus existing Node subprocess fixtures | Exercised validation, rejection, privacy, ordering, lifecycle and cleanup behavior only |
| User-provided CI evidence | Supplied milestone request reports merged M2.2b.3 main passed macOS, Ubuntu and Windows | Recorded baseline provenance; no remote CI was queried or rerun here |
| Unverified real-runtime assumptions | Secure startup configuration, credential continuity, complete integration inventory and OS enforcement | Production blockers on every platform |

This investigation used local repository evidence only, with no network access. Previously linked official documents were not fetched again. No current documentation claim is upgraded to a verified 0.166.0 runtime property.

## Threat model and pre-spawn trust boundaries

Assume project files, snapshots, handoffs, configuration, input claims and provider output can be untrusted. They never become privileged instructions or process ownership authority. The parent can be cancelled or fail at any point. A malicious in-process caller already executing JavaScript is outside this model's security boundary; claim validation cannot sandbox its own host.

| Boundary / risk | Existing evidence | Required protection before real execution / unresolved gap |
|---|---|---|
| Executable identity and search | Internal test transport accepts a command and arguments | Explicit reviewed executable identity/version and launch-time replacement resistance; version strings supplied to the model do not inspect a binary |
| Inherited environment | OwnedProcess supplies an explicit empty map | No implicit merging. Future allowlist must consider loader/runtime injection, proxy/provider endpoints, PATH, shell startup and credential variables without collecting raw values. Empty env is not home, keychain or OS policy isolation |
| CODEX_HOME and home discovery | Pinned user-layer description names `$CODEX_HOME/config.toml`; initialize returns codexHome after startup | Private home/state roots with reviewed fallback/discovery behavior; empty env alone cannot prove default home discovery is disabled. No real home or account data was read |
| Configuration layers | Pinned ConfigLayerSource lists packagedDefaults, mdm, system, enterpriseManaged, user, project, sessionFlags and legacy managed-file/MDM origins | All active origins and administrative policy need version-specific review before execution. Project ancestors/trust, profiles, defaults and managed precedence may introduce behavior. Conflicts block; never overwrite or repair policy |
| Hook execution | Prior hooks documentation describes accumulation; accepted requirements include allowManagedHooksOnly | Exclude user/project/plugin/inherited/managed hooks before any executable code can run. Managed-only is not no-hooks; incomplete post-start responses cannot prove absence |
| MCP and integrations | Existing policy rejects unsupported visible settings | Prevent startup of local servers and remote integration activity before initialization. Missing visible MCP keys is not an exhaustive inventory |
| Plugins, extensions, dynamic tools | Pinned server request union includes tool/elicitation operations; existing transport rejects requests | Prevent loading/execution before startup. Refusing later requests cannot undo a loaded extension's side effects; empty lists do not establish complete inventory |
| Browser, computer use, remote control, web/network | Pinned requirements have partial capability controls; thread reports sandbox/network settings later | Deny before launch with independently enforced boundaries; no inference of total network denial from web-search or thread flags |
| Notification commands and exporters | Unsupported visible settings fail runtime policy; requirements schema includes otel | Prevent command/exporter initialization before first child instruction. No complete effective notification/exporter inventory is established |
| Credentials and authentication continuity | Pinned account/read has refreshToken; transport only admits false | No copying/reading account state. Changed home/store can lose identity; OS stores may remain reachable despite empty env. A non-refreshing RPC does not prove no startup refresh or keychain access. Provider/model/account continuity remains unverified |
| Startup filesystem writes | Read-only sandbox/ephemeral thread are later thread properties; requirements include logDir/sqliteHome | Independently restrict startup state/log/cache/database writes and protect project/raw input. No claim of zero writes from ephemeral/read-only mode |
| Startup network | No pre-execution enforcement exists | Deny egress/DNS/local IPC to brokers as required before execution; observe under benign fixtures separately. Configuration reads cannot undo connections or credential transmissions |
| Descendants | M2.2b.2 owns a creation-local child/group | Strong containment must prevent escape and unauthorized brokers; group absence is not all-descendant absence |
| Parent termination, cancellation, cleanup | Bounded stop, pre-abort transport rejection, scoped cancellation, shared sticky cleanup and durable queue drain | Parent hard failure needs independent OS lifetime enforcement. No JavaScript cleanup after SIGKILL, fatal runtime loss or power failure. Keep cleanup uncertainty and unknown model outcomes |

The internal status names are planning categories, not newly invented Codex keys. No CLI flag or configuration key is added or reviewed into a runnable startup recipe here.

## Startup timing and proposed isolation architecture

The existing sequence is process creation, initialize/initialized, config/read, configRequirements/read, thread/start, effective-thread validation, ready, separately authorized turn. Durable acquisition is committed before initialize, but the transport's process already exists. It is not a pre-spawn write barrier or security policy gate.

Both configuration reads occur after the server has started and must be treated as observations of that running process. They may expose a mismatch and cause cleanup, but cannot retroactively prevent startup hooks, integrations, exporter activity, authentication, writes or network access. A read-only sandbox alone does not prevent all startup filesystem/network activity. Schema definitions reachable transitively are not automatically root response properties: notably NetworkRequirements is not a ConfigRequirements root field in the retained fixture. Null, omitted or partial fields do not prove complete hook/MCP/tool/credential isolation.

Proposed future sequence, **unimplemented**:

1. Obtain separate explicit authorization and bound all input without capturing source or conversation. Reject unsupported OS/version/executable identities.
2. Independently establish reviewed process-local configuration/home behavior and authentication continuity without copying credentials or changing global settings. If these goals cannot coexist, block.
3. Establish OS-owned filesystem/network/capability/descendant and parent-failure boundaries before allowing the executable to run. Creating a child and attaching controls afterward leaves an execution race.
4. Commit required durable lifecycle admission with conservative failure semantics, then release the contained workload. Failed preparation must not fall back to unrestricted startup.
5. Initialize and validate supported reported policy plus requirements/effective thread before ready. Preserve explicit consent, durable pending-turn publication and revalidation before a single submission.
6. On cancellation/failure, close admission, await confirmed owned cleanup and publication drain; retain uncertainty if either cannot be established. Never restore authority from saved assessments, PIDs or connection state.

The current assessment supplies no trusted OS evidence for step 3 and is not wired into this sequence. Post-start drift remains non-atomic even with repeated configuration reads. Future real admission requires a separate reviewed interface with independently acquired evidence, rather than changing a boolean in this model.

## Platform-by-platform feasibility

These are design candidates inherited from the earlier containment analysis, not installed, enabled or experimentally validated mechanisms in this milestone.

| Platform | Existing guarantees / portable Node controls | Candidate stronger boundary | Unsupported / unverified claims |
|---|---|---|---|
| macOS | Explicit cwd/env/argv, shell=false, pipes, child reference, detached POSIX group, bounded group cleanup while identity remains anchored | Reviewed supported native/OS isolation, or an isolated guest with independently owned termination | No Node-only all-descendant or kill-on-parent-death guarantee. A process group/helper or proposed sandbox profile alone does not solve escape, helper death, credential stores or startup networking. No reliance on an unreviewed sandbox-exec recipe |
| Linux | Same portable controls and limited group ownership | cgroup v2 for membership/lifetime with no migration permission and independent owner; namespace/mount/network restrictions plus syscall policy as separate candidates | cgroup alone is not filesystem/network isolation. Delegation, privileges, kernel support, admission races, broker escape, independent supervisor failure and runtime compatibility require native tests. Parent-death signals alone do not cover arbitrary descendants |
| Windows | Both owner and transport reject before spawn; portable assessment/tests can run without a child | Native suspended creation, non-inheritable Job Object ownership, kill-on-close, assignment before resume, no breakaway; separate restricted filesystem/network/token boundary | Node spawn does not implement this full contract. Job membership/kill policy alone is not file/network/credential isolation. Nesting, handles, brokered children, assignment failure and hard parent death need tests. Real subprocess execution remains disabled |

M2.2b.2 retains its exact limited guarantee: observed direct-child exit and original numeric-group absence within bounded verification. Escaped descendants, numeric reuse races and parent hard failures remain outside it. No signaling after observed leader exit, process-name targeting, historical PID use or weaker cleanup behavior is introduced. Process exit and cleanup never prove a model turn completed.

## Assessment contract, privacy and security decisions

`PreSpawnInput` requires scope=`offline-mock-harness`, sourceVersion=`0.166.0`, an explicit platform and a complete fixed control map. Each control is exactly verified-offline, unverified, conflicting or unsupported. The evaluator takes unknown input at its validation boundary; TypeScript types alone grant no trust. Unknown fields, symbols, inherited fields, accessors, arrays and unsupported values fail closed. Data properties are selected into a fresh fixed map. Errors become a fixed failure diagnostic without retaining exception text. Already-aborted input is not inspected; cancellation is checked again before model completion.

All results are frozen with frozen detached arrays. Complete darwin/linux input returns offline-model-complete; win32/other platforms block. Unresolved controls are listed in fixed canonical order. Even a forged positive scope/status remains labeled unverified-claims and leaves every runtime control unverified. The model cannot bless real execution, and a result passed back as input is rejected. There is no automatic repair, fallback, retry or connection to approval handling.

The accepted shape has four root fields and seventeen enum-valued controls, with fixed nesting and constant-sized selected state/results. No raw JSON parser, external ingress or arbitrary nested data walk exists. Own-key enumeration still depends on the supplied object's size; callers must bound external decoding/allocation separately if an ingress is ever proposed. JavaScript proxies can run arbitrary code during reflection; caught exceptions become safe failures, but this API cannot contain hostile JavaScript execution in its own process.

No raw environment, command arguments, paths, configuration, source, conversation, secrets or credentials appear in assessments or persisted artifacts. The new module imports no I/O or process modules and performs no storage/network/discovery operation. Sensitive input in unknown fields is rejected without stringifying or echoing it. It is not a general secret scanner: privacy follows from selecting only fixed output vocabulary. Existing lifecycle/usage persistence remains unchanged and does not retain assessments or evidence maps.

## Test evidence

New deterministic pure tests cover complete macOS/Linux plans; missing root/control evidence; unsupported versions/platforms/scopes; every control independently unverified/conflicting/unsupported; environment/home uncertainty; configuration-origin conflict; inherited hooks/MCP/tools/exporter/browser uncertainty; credential continuity; startup file/network uncertainty; descendants/parent failure; combined blockers in canonical order; raw environment/flags/config/attestation rejection; secret canary exclusion; accessors, prototypes and symbol rejection; sanitized selection failure; cancellation before/during selection; immutability and non-reusability.

All existing transport, policy, lifecycle, cleanup, canary, telemetry, CLI and interactive-handoff tests remain intact. In particular, they preserve durable acquisition/pending barriers, sticky persistence and combined cleanup errors, drain before stopped, no replay, unknown outcomes, cancellation/parent signals and the disabled real CLI. New tests launch no process and make no authenticated or external network request; existing integration tests use benign local Node fixtures only. No sleeps or dependencies were added.

Validation results are recorded below. The merged M2.2b.3 CI checkbox is corrected using the user-provided main-revision evidence; M2.2b.4 remote CI remains outstanding.

## Remaining blockers and recommended next milestone

No reviewed complete secure-startup recipe is established for Codex 0.166.0. Executable identity, environment/home discovery, every configuration origin, inherited/managed hooks, MCP/plugins/extensions/dynamic tools, notification/exporter capabilities, credential/provider continuity and pre-start file/network isolation remain unverified. Native containment must address escapes and parent hard failure per platform. Production authorization/stdin/deadline plumbing, atomic drift limits, original architecture review and separately authorized runtime enforcement validation remain outstanding. No production readiness is claimed.

Recommend M2.2b.5: implement a narrowly reviewed native containment feasibility prototype using benign offline workloads on a selected OS. Test admission before first workload instruction, escape attempts, startup file/network denial, cancellation and parent/supervisor hard failure. Keep real Codex disabled. Unsupported platforms and any unverified pre-execution requirement must continue to block. Credential continuity investigation and any authenticated runtime test require a separately scoped milestone.

## Exact changed file paths

| Path | Change |
|---|---|
| `src/managed/pre-spawn.ts` | Independent closed offline model, immutable safe results and permanent real-runtime blockers |
| `tests/pre-spawn.test.ts` | Deterministic assessment, failure/cancellation, trust and privacy cases |
| `README.md` | User-facing offline scope and startup limits |
| `SECURITY.md` | Claim trust, pre-spawn and startup security boundaries |
| `docs/BLUEPRINT.md` | Independent assessment architecture and future evidence boundary |
| `docs/CONTEXT_TELEMETRY.md` | No new assessment persistence/telemetry and unchanged compatibility |
| `docs/MANAGED_APP_SERVER.md` | Assessment API, post-start limits and corrected CI provenance |
| `docs/ROADMAP.md` | M2.2b.4 offline scope, corrected M2.2b.3 CI checkbox and remaining work |
| `docs/M2_2B_4_REPORT.md` | This threat model, evidence analysis, feasibility and validation report |

## Validation results

Local host: macOS (Darwin arm64), Node v22.23.2. The initial targeted assessment run passed 93 tests, zero failures/skips. Two further combined-blocker/cancellation tests were then added and validated in the full suite.

`npm test` passed **328 tests: 327 passed, zero failed, one expected Windows-only skip, zero cancelled and zero todo**, in 12.54 seconds. This preserves the 233-test baseline and adds 95 pure assessment cases. The skipped case is `Windows subprocess execution fails closed`, which runs only on Windows. No regression was observed; Linux/Windows were not executed locally and no new remote CI success is claimed.

`git diff --check` and whitespace checks for the three new files passed. `git status --short`, `git diff --stat` and `git ls-files --others --exclude-standard` were inspected. Six existing documentation files are modified and the three paths listed above are new/untracked; changes remain uncommitted. No existing managed runtime, CLI, storage, hook, interactive integration or fixture implementation was modified.

No real App Server, credentials, authentication, global configuration, hook/MCP installation, automatic approval, rollover, compaction or retries were used or enabled. Production eligibility and spawn authorization remain false. Unverified startup isolation and native containment remain unresolved production blockers.
