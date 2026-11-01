# M2.2b.3 managed runtime policy verification

Date: 2026-11-01. Scope: strict offline mock admission foundation. **Real Codex App Server execution remains disabled on every platform.** No real server, authenticated turn, authentication refresh, global configuration change, daemon, commit, push, merge or publication was performed.

## 1. Protocol evidence and version pin

Preparation found a clean working tree on `main`. HEAD, local `main` and local `origin/main` all resolved to `ae1f8f84dd0e41fd2167816b3448e58a725b8e5d`. No remote fetch was performed; this establishes local tracking-reference equality, not a fresh independent remote observation. Work is on `feat/managed-runtime-policy`. The supplied baseline reports green macOS/Linux/Windows CI for M2.2b.2; that is user-provided evidence, separate from this revision's local tests.

Repository instructions, security policy, README, blueprint, roadmap, language policy, managed/telemetry contracts, prior lifecycle/containment reports, implementations, fixtures and tests informed this change. The existing generated schemas were inspected and their original manifest/checksums remain unchanged. No Codex executable was invoked, including schema generation.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) describes initialization and configuration reads. Current examples differ from the pinned schemas: requirements examples use an object for params and camel-cased policy values. The pinned `ClientRequest.json` permits omitted or null params for `configRequirements/read`; ContextBridge sends null. Pinned enums use `never`, `read-only`, and the thread response discriminator `readOnly`. No current-documentation example overrides local schema evidence.

| Implemented contract | Pinned evidence and exact accepted subset |
|---|---|
| Initialization | `v1-InitializeParams.json`, `v1-InitializeResponse.json`, `ClientNotification.json`: clientInfo, capabilities.experimentalApi=false; four required string response fields (userAgent, codexHome, platformFamily, platformOs); initialized notification. Response contains no protocol-version attestation. Strings are discarded. |
| Resolved config request | `v2-ConfigReadParams.json`: cwd optional/nullable, includeLayers optional boolean in schema. Policy admission requires the exact acquisition cwd and includeLayers=true. |
| Resolved config response | `v2-ConfigReadResponse.json`: config and origins required; layers optional/nullable. Config is extensible and its declared properties are optional/nullable. Admission instead requires explicit safe values, complete origins and a non-null layer list. |
| Configuration values | Same schema: approval_policy=never, approvals_reviewer=user, sandbox_mode=read-only, model=mock, model_provider=mock, web_search=disabled, analytics.enabled=false. No omitted/null/default value establishes safety. Only this closed subset is accepted. |
| Origins/layers | Same schema: ConfigLayerMetadata requires name/version; ConfigLayer requires name/version/config, optional nullable disabledReason. Accepted subset has exactly one sessionFlags layer, no disabledReason, matching bounded opaque layer versions, one matching origin per accepted config key and identical restrictive layer values. This deliberately rejects other legitimate configurations. Layer version is an opaque fingerprint, not a schema/CLI version. |
| Requirements request | `ClientRequest.json`: method=configRequirements/read; no object params defined. Transport accepts null only. |
| Requirements response | `v2-ConfigRequirementsReadResponse.json`: requirements optional/nullable; supportsIndependentSpeedModes optional/nullable boolean. Admission requires a non-null requirements object; the speed field, when present, must be boolean. It provides no safety evidence and omission is not treated as safety. |
| Administrative restrictions | Same schema: explicit singleton allowedApprovalPolicies=[never], allowedSandboxModes=[read-only], allowedWebSearchModes=[disabled]; allowBrowserAndComputerUse=false, allowRemoteControl=false, allowLoginShell=false, allowManagedHooksOnly=true, modelProvider=mock, featureRequirements={}. Empty feature requirements do not prove features disabled. |
| Thread request | `v2-ThreadStartParams.json`: cwd, ephemeral=true, approvalPolicy=never, approvalsReviewer=user, sandbox=read-only, model=mock, modelProvider=mock. These are supported optional/nullable fields; admission supplies explicit values. |
| Effective thread | `v2-ThreadStartResponse.json`: required effective model/provider/cwd/approval/reviewer/sandbox/thread. Check exact CLI version 0.166.0, new empty idle ephemeral thread, matching cwd/provider, readOnly and explicit networkAccess=false. Schema permits networkAccess omission with a default; admission rejects omission. The accepted thread object is intentionally narrower than all schema-valid responses. |
| Optional thread fields | Same schema: disabledPluginIds and instructionSources default to empty arrays; if present they must be empty, and optional reasoningEffort/serviceTier must be null. Their absence does not prove plugin absence. The schema explicitly says disabledPluginIds does not yet filter plugin capabilities. |

Tests validate positive config/requirements fixtures and RPC shapes against the pinned generated JSON schemas using a fixture-only structural checker. This checker is not a production JSON Schema implementation. Managed adapter parsing uses closed field selection; unsupported keys and structures fail instead of being retained. Existing checksum tests cover all original generated fixtures.

Version eligibility is pinned internally to 0.166.0. Other source contract versions fail the evaluator; incompatible response fields fail structural checks. Thread CLI version is checked only after thread creation because initialization/config reads expose no reliable CLI-version field. A real launcher would need independently verified executable identity/version before startup. The generated schemas alone also do not establish which optional fields a nonexperimental real server actually delivers; missing/gated fields would fail admission. This is a production blocker, not permission to enable experimental APIs.

## 2. Security policy model

`src/managed/policy.ts` defines internal policy schema 1 with separate requested, provider-reported resolved, administrative, effective-thread and isolation evidence. It is confined to the Codex managed adapter; provider-neutral lifecycle and telemetry schemas remain unchanged.

The request model pins a synthetic offline model/provider named `mock`. There is no model discovery, default-provider fallback or general production policy. Only approved constant labels appear in `policyAssessment()`, which returns a defensive copy. The assessment includes a SHA-256 revision digest of the validated closed config subset for conservative drift detection. No raw config values, paths, origins, responses or credentials are retained in it or persisted. Reordered equivalent responses can conservatively reject admission; no repair or retry follows.

A separate `MockIsolationEvidence` argument is required from the offline test harness. It lists explicit verified-offline assertions about the reviewed Node fixture: startup effects, executable/inherited hooks, MCP, extensions, dynamic tools, browser/computer use, notification commands, exporters, environment isolation and authentication continuity. Missing assertions block mock thread creation. These are **internal harness assertions, not invented Codex response fields, cryptographic attestations, or evidence about a real executable**. Existing tests now opt in explicitly. The internal low-level transport still accepts executable arguments for test infrastructure and is not an approved real launcher.

The returned assessment always has productionEligible=false and lists every unresolved real-runtime isolation property. Even a fully compliant mock cannot clear a production gate. No code path turns a mock assertion into real-runtime verification. Removing the harness evidence fails closed; preserving it only permits the reviewed offline continuation tests. This keeps lifecycle/turn regression coverage without pretending the protocol can prove every required property.

## 3. Configuration precedence and isolation analysis

The [configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic) describe flags, trusted project layers, profiles, user defaults, cloud/system defaults and built-ins. Project distrust skips project layers while user/system configuration still loads. This is current documentation, not a verified 0.166.0 startup behavior test.

Pinned ConfigLayerSource enumerates packagedDefaults, mdm, system, enterpriseManaged, user, project, sessionFlags and legacy managed-file/MDM sources. It documents sessionFlags as `-c`/`--config` overrides and user config under CODEX_HOME. Legacy managed-layer descriptions explicitly call their precedence best effort. Unknown/extra layers fail this milestone's narrow admission subset; ContextBridge does not attempt to reproduce a complex merge locally.

The [advanced configuration documentation](https://learn.chatgpt.com/docs/config-file/config-advanced) describes per-invocation TOML overrides and CODEX_HOME state. They are candidates for a future owned process, not an implemented startup recipe. Changing CODEX_HOME can affect account state and credential-store selection; preserving authentication continuity without copying secrets requires separate validation. Empty env does not disable default home discovery, system policy, keychain access or project trust. No inherited configuration is edited or trusted automatically.

The [hooks documentation](https://learn.chatgpt.com/docs/hooks) describes accumulated hooks across active config sources and plugins. Overriding a config table is insufficient evidence that all inherited hooks disappeared. No global hooks or trust settings were changed.

The [managed configuration documentation](https://learn.chatgpt.com/docs/enterprise/managed-configuration) describes enforced requirements and legacy managed defaults overriding ordinary local flags. `allow_managed_hooks_only=true` still permits managed hooks. Neither that flag nor an empty featureRequirements map proves no executable hooks. The pinned requirements root exposes neither complete hook inventory, MCP inventory, effective tool inventory nor network enforcement details. A NetworkRequirements definition exists transitively but is not a ConfigRequirements root property in the pinned fixture; no network field was invented for a positive response.

A private home, cwd, process-local flags and disabled feature settings might be components of future isolation, but schemas and current docs do not establish complete pre-execution safety. Managed requirements can themselves introduce enforced behavior. Post-handshake reads cannot undo startup effects. No reviewed 0.166.0 secure-startup recipe is established; production execution stays disabled.

## 4. Verified and unverified settings / eligibility

| Capability | Evidence classification | Eligibility consequence |
|---|---|---|
| Closed config/requirements validation and correlation | Implemented and verified offline; fields verified against pinned schemas | Required for mock admission |
| Explicit user reviewer, never approval, read-only sandbox and networkAccess=false | Pinned fields; positive and negative mock thread tests | Required effective thread evidence; never grants escalation |
| Exact requested/resolved/effective model/provider | Mock-only fixed identifiers; pinned request/response fields | Mismatch blocks; real auth/provider continuity unverified |
| Browser/computer and web restrictions | Supported requirement/config fields; mock verified | Partial evidence only; complete capability inventory remains unverified |
| Hooks, inherited hooks and managed hooks | Partial fields documented; no complete effective inventory in accepted protocol | Unsupported complete verification via these pinned reads; harness assertions only |
| MCP, extensions, dynamic tools, notifications, exporters | Unknown/additional config keys rejected where visible; no exhaustive runtime inventory | Unsupported complete verification via these pinned reads; absence is not safety |
| Startup local writes/network/auth activity | Not established by configuration responses or ephemeral thread | Blocked pending process isolation and version-specific startup validation |
| Strong descendant/parent-failure containment | Prior limited POSIX group tests only | Blocked pending OS containment; Windows spawn disabled |
| Runtime field delivery, authentication and actual enforcement | Documented/schema-described, not runtime verified | Blocked pending separately authorized authenticated validation |

No claim is made that Codex 0.166.0 lacks every related API; these two config reads and the accepted thread contract do not establish the complete mandatory guarantees. Future evidence needs separate review rather than broadening acceptance automatically.

## 5. Admission ordering

The sequence is explicit: initialization authorization; durable acquisition flush; initialize; initialized; config/read with exact cwd/layers; strict resolved-config validation; configRequirements/read with null params; strict requirements validation; evaluate mock-only policy including independent harness assertions; thread/start; effective thread/version validation; durable ready publication. No mandatory mock evidence may be missing before thread creation. Unsupported real properties always block production eligibility.

A separate one-turn authorization is still mandatory. After consuming it and committing turn-pending, the capture rereads and reevaluates config/requirements and compares the validated config revision digest before submitting turn/start. Changed or missing evidence stops submission, retains conservative unknown-outcome lifecycle evidence and cannot retry. This reduces detectable drift but does not provide an atomic config/thread/turn transaction or detect hidden changes after a read. There is no supported effective-thread reread in this milestone. Real execution remains blocked for these gaps.

A rejected thread response never produces ready. Thread identity is persisted only after validation. A failed acquisition retains initializing/disconnected evidence without invented completion. A cleanup failure is surfaced to the authorized caller. No server request, process exit, policy check or interrupt acknowledgment creates terminal model evidence.

## 6. Mock integration architecture

`tests/fixtures/managed/policy.mjs` supplies positive responses composed only of pinned fields. `server.mjs` enforces read ordering before thread creation and accepts an optional test-only method trace. Existing disk-based acquisition and turn-pending checks remain intact. Trace files live in disposable test directories and contain method names only.

Scenarios cover configuration/requirements mismatch, missing/null/ambiguous fields, unsupported fields/contracts, inconsistent origins/layers, inherited user/project hooks, visible MCP/plugins/features/tools/browser/computer configuration, notification/exporter configuration, model/provider drift, automatic reviewer, missing/unsafe network settings, writable/full-access sandbox, timeout, malformed/duplicate/foreign-ID/invalid-version envelopes, privileged requests, disconnection, policy changes before a turn, and secret canaries. Invalid scenarios are deliberately invalid or unsupported data, never new official positive protocol fields.

## 7. Privacy and failure handling

The existing 65,536-byte frames, depth/UTF-8/duplicate-key validation, eight-pending limit, deadlines and 30-second transport lifetime bound policy reads too. Results require exact outstanding numeric correlation and valid result/error envelopes; duplicates and privileged server requests close transport without a response. No configuration write RPC is admitted. Requirements params other than null and config reads without explicit cwd/includeLayers=true are rejected locally.

Policy diagnostics are fixed. Full configuration, requirement objects, server errors, paths, secrets, environment, credential data and raw frames are never logged or persisted. Only constant assessment metadata is retained in memory; the existing content-free lifecycle store records failures conservatively. A canary-bearing config is rejected and lifecycle storage is checked for its exclusion. Existing canary tests additionally cover telemetry, memory, snapshots and handoffs. Policy assessment is never a saved permission or restart authority.

## 8. Test matrix and results

Local regression validation on November 1, 2026: macOS (Darwin), Node v22.23.2. The initial `node --experimental-strip-types --test tests/policy.test.ts` reproduced the reported cleanup failure: 56 tests, 54 passed and two `ENOTEMPTY` teardown failures (the reported cleanup-error test and the admission-ordering test). The earlier successful 226-test observation did not establish teardown stability.

After correction, the policy command passed all 59 tests (6.50 seconds). Three consecutive `npm test` runs each completed with **229 tests, 228 passed, zero failed, one expected Windows-only skip, zero cancelled and zero todo**. Durations were 10.24, 12.55 and 9.92 seconds. This preserves the original 170 tests and adds 59 policy tests. No remote CI execution is claimed for this revision. Original behavior remains covered with explicit mock isolation evidence rather than silently trusting absent runtime properties. Policy tests cover negative subprocess cases, missing evidence, pinned schemas, method ordering, separate authorization, drift, privacy and visible cleanup failure, plus deterministic persistence gates for initialization/turn cleanup failure and combined cleanup/publication failure.

### Cleanup regression mechanism and correction

`ManagedTransport.stop()` closes admission and invokes `onDisconnect` synchronously, then awaits owned-process cleanup. The capture callback enqueues asynchronous `ingestTelemetry` work: directory admission, exclusive lock acquisition, staging-file publication, rename, sync and lock cleanup. Transport completion therefore does not imply capture publication completion. The policy fixture stopped only the transport before recursive directory removal. In addition, initialization and turn failure handlers awaited transport stop before awaiting the publication queue; a rejected stop bypassed the queue wait. The reported test deliberately throws after actual process cleanup, reliably exercising that missing drain. Removing the directory while publication is creating or renaming entries explains `ENOTEMPTY`. This affected internal runtime failure handling as well as test teardown; the telemetry writer itself already awaits its filesystem work.

Capture failure paths now share the existing stop error-handling behavior: await transport closure, drain accepted publications even on cleanup rejection, preserve the original cleanup error, and aggregate concurrent persistence failure. Successful explicit capture stop still publishes stopped only after confirmed process cleanup. Policy and containment fixture teardown await capture stop before directory removal. No deletion retry, ignored `ENOTEMPTY`, arbitrary sleep, weakened assertion or new execution permission was added. Durable admission, sticky persistence/cleanup failures, process ownership and conservative terminal evidence remain intact; `productionEligible` remains false and real App Server execution remains disabled.

An intermediate policy run exposed a separate fixture-only race: 58 of 59 tests passed, while `config-duplicate` read an empty method trace. Forced protocol termination could kill the mock between truncating and rewriting `trace.json`, even with synchronous filesystem calls. The mock now writes a staging file and renames it before processing each traced request. A kill leaves the previous complete trace or the new complete trace; unprocessed methods cannot become falsely admitted operations. This adjustment preceded all three successful full-suite runs.

Remaining uncertainty: repeated local runs and deterministic gates establish the exercised ordering, not universal scheduling or filesystem guarantees. Linux/Windows were not run locally; all existing production containment and runtime-policy blockers remain. The final whitespace checks and working-tree status are recorded in the task response. Existing staged work was preserved, and the regression changes were left unstaged.

No authenticated model request, real App Server or Codex CLI invocation forms part of these tests.

### Final persistence-drain review correction

Independent review identified that the successful transport-cleanup branch still awaited only `#writes`. Publication catches filesystem errors internally and sets `#writeFailure`, so the queue can resolve despite failed persistence. `#stopTransport()` now ends with `await this.flush()`, which drains the latest queue and rejects sticky publication failure. The existing cleanup-error branch and its combined `AggregateError` remain unchanged. Initialization, turn submission and failed interruption now expose the persistence diagnostic even when process cleanup succeeds. Explicit stop cannot advance to stopped after a failed disconnect-publication drain.

Four targeted policy regressions obstruct the disconnect publication with a writer lock after admission barriers, while actual owned-process cleanup succeeds. They cover initialization, pre-turn policy rejection, rejected interruption and explicit stop. Each checks the exact persistence diagnostic, confirmed process cleanup, sticky failures from flush/persist/stop, byte-for-byte preservation of committed storage, no stopped connection or terminal evidence, and expected turn admission. All four failed against the previous implementation. Existing lifecycle assertions now require the exact persistence diagnostic instead of generic initialization/turn errors; no coverage was removed or weakened. The existing simultaneous cleanup/publication failure regression still checks both errors in the aggregate.

Review-correction validation on macOS (Darwin), Node v22.23.2: `node --experimental-strip-types --test tests/policy.test.ts tests/lifecycle.test.ts` passed all 89 tests with no failures or skips (7.21 seconds). Three subsequent consecutive `npm test` runs each passed **233 tests: 232 passed, zero failed, one expected Windows-only skip, zero cancelled and zero todo**, in 11.02, 10.64 and 10.59 seconds respectively. Both Git whitespace checks passed and working-tree status was inspected. No commit or push was performed. These results supersede the preceding counts for the final reviewed working tree. Production eligibility remains false, real App Server execution remains disabled, and no additional OS validation is claimed.

## 9. Cross-platform compatibility

Portable pure policy/schema tests run on every host. Actual mock subprocess cases run on POSIX; Windows keeps its pre-spawn failure at both ownership and transport layers. No new platform dependency or package was added. Existing M2.2b.2 baseline CI is green according to the supplied request; the roadmap now records that evidence. This revision needs its own future CI run and makes no new Linux/Windows execution claim from a macOS-only local run.

## 10. Remaining production blockers

Complete runtime inventory and pre-start hook/side-effect prevention remain unverified. Process-local configuration precedence, effective requirement delivery, experimental-field availability, executable identity, provider/auth continuity and startup persistence need pinned-runtime investigation under separate authorization. Strong native/OS containment must address escaped descendants and parent hard failure; Windows remains disabled. Production prompt/deadline/consent plumbing and authenticated enforcement tests remain outstanding. Configuration drift lacks an atomic protocol guarantee. The original architecture assessment is still unavailable.

The prepared `context run` command remains disabled, and no real launcher was enabled. No automatic turn, approval response, compaction, rollover, retry or attachment to existing CLI/IDE sessions was added.


## Changed file paths

| Path | Change |
|---|---|
| `src/managed/policy.ts` | Versioned mock policy model, strict validators, safe evidence selection and revision digest |
| `src/managed/session.ts` | Policy ordering, explicit harness evidence, effective thread check, pre-turn revalidation |
| `src/managed/transport.ts` | Admit only pinned read-only configuration RPC parameter shapes |
| `tests/policy.test.ts` | 56 new policy, admission, privacy, protocol and schema tests |
| `tests/fixtures/managed/policy.mjs` | Positive pinned response fixtures |
| `tests/fixtures/managed/evidence.ts` | Explicit offline harness assertions |
| `tests/fixtures/managed/server.mjs` | Policy scenarios and method-order checks |
| `tests/managed.test.ts` | Explicit harness evidence for existing regression cases |
| `tests/lifecycle.test.ts` | Explicit harness evidence for existing durability cases |
| `tests/containment.test.ts` | Explicit harness evidence for existing capture cleanup cases |
| `README.md` | Describe current offline policy behavior |
| `SECURITY.md` | Record policy and startup isolation boundary |
| `docs/BLUEPRINT.md` | Document adapter-specific policy architecture |
| `docs/CONTEXT_TELEMETRY.md` | Clarify admission without retaining configuration |
| `docs/MANAGED_APP_SERVER.md` | Updated protocol, CI provenance and admission contract |
| `docs/ROADMAP.md` | Completed offline scope and baseline CI evidence; remaining production gates |
| `docs/M2_2B_3_REPORT.md` | Protocol evidence, isolation analysis, validation and blockers |
