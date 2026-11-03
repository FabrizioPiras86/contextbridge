# M2.2b.5 — Native process containment feasibility

Date: 2026-11-03. Scope: strictly offline investigation and a bounded macOS native admission experiment. **Real Codex App Server execution remains disabled on every platform.** No production readiness is claimed.

## Baseline and evidence provenance

Started with a clean `main` at the requested `dd4d42f6f426b06388f3ed41d4070bc61b45b5c4`. Work is on `feat/managed-native-containment-feasibility`. The supplied baseline reports 328 tests, 327 passes, one platform skip and passing macOS/Ubuntu/Windows CI for merged M2.2b.4 through PR #9. Those remote results are user-provided evidence; no remote state was queried. No commit, push, publication or pull request was performed.

Reviewed AGENTS.md, SECURITY.md, README.md, BLUEPRINT.md, ROADMAP.md, LANGUAGE_POLICY.md, MANAGED_APP_SERVER.md, M2.2b.2–4 reports, managed process/transport/session/pre-spawn code and existing containment, lifecycle, policy and managed tests. Existing M2.2b.1 persistence guarantees were reviewed through their implementation and regression tests. Snapshot and handoff content remains untrusted data, never instructions or process authority.

This investigation made no network requests. macOS conclusions below use installed Apple manual pages, SDK declarations, repository evidence and local benign experiments. Linux/Windows proposals derive from the earlier report's retained official references and are not freshly verified documentation or runtime results. No Codex executable, authenticated provider, credentials, account state, global configuration or untrusted project command was accessed or launched.

## Threat model and security problems

Assume workloads can fork, exec, change process groups/sessions, hang, exit early or outlive their controller. Controllers and supervisors can be cancelled, fail or die at any transition. Numeric identities can be reused. Successful cleanup, confirmed direct-child exit, empty original group and a completed model turn are different facts. A group ID is never an unforgeable ownership capability.

| Threat / transition | Existing M2.2b.2 behavior | M2.2b.5 evidence or remaining gap |
|---|---|---|
| Direct-child termination | Bounded group signals and observed child exit | Separate native sole-reaper fixture confirms direct-child reaping only; no replacement of existing owner |
| Descendants in original group | Original group cleanup while leader remains anchored | Existing normal-tree tests retained, including branch, sibling and grandchild |
| New session or new group | Escaped processes are outside group checks | Native `setsid()` and `setpgid(0, 0)` fixtures survive direct-child cleanup and answer a fresh emergency request afterward |
| Parent SIGTERM/SIGINT | Application-owned handlers can await stop | Existing application handlers and native supervisor handlers tested; no library-global handler added |
| Parent SIGKILL | Existing negative tests show surviving workload | A control pipe can detect loss of its writer while a separate supervisor survives; EOF is tested, not claimed to contain arbitrary parent death |
| Supervisor hard failure | JavaScript cleanup cannot run | Actual native supervisor SIGKILL and abrupt `_exit` leave a running workload that subsequently answers an emergency request |
| PID/group reuse | Numeric group identity has a residual exit-observation race | Native fixture alone retains an unreaped direct child and sole reaper; it never signals groups. No reuse stress test or stronger group ownership claim |
| Leader exit with remaining group | Existing owner stops signaling and reports sticky uncertainty | Existing early-leader regression retained; no stale-group rescue or process discovery |
| Admission before first workload instruction | Existing Node transport starts the executable before policy reads | macOS suspended spawn documents a pre-user-space stop; stopped status plus absent workload-entry marker are checked before release |
| Repeated/concurrent cleanup | Existing stop promises share a sticky result | Native stop bytes serialize, repeated requests add no signal after reaping; managed concurrent promise tests remain unchanged |
| Cleanup uncertainty | Existing fixed error remains sticky | Injected native ownership loss revokes signaling/release, keeps cleanup unconfirmed after voluntary fixture exit and exits nonzero |
| Pre-containment file/network activity | Post-start RPC checks cannot prevent startup effects | Admission defers workload user-space execution, but installs no file/network restrictions. After release a startup write succeeds. Kernel image loading and trusted helper activity are not prohibited |

This milestone addresses overclaiming of group cleanup, startup ordering, direct-child identity lifetime and supervisor failure with reviewable evidence. It does not remediate all-descendant containment in the production code. An in-process malicious caller, hostile replacement of test artifacts, privileged host compromise, kernel stalls and power loss are outside the experimental boundary.

## Reviewed macOS mechanisms

| Mechanism | Local documented evidence | Finding |
|---|---|---|
| `posix_spawn` with `POSIX_SPAWN_START_SUSPENDED` | `posix_spawnattr_setflags(3)` specifies stopping before user-space execution and resuming through SIGCONT | Useful admission-ordering primitive, tested here; not a sandbox or lifetime owner |
| `POSIX_SPAWN_CLOEXEC_DEFAULT` and file actions | Same manual describes closing descriptors except explicit file actions | Fixture explicitly replaces standard descriptors with `/dev/null`; no control/diagnostic descriptors inherited by workload |
| `waitpid`, default SIGCHLD, sole reaper | `wait(2)` stopped/exit status and nonblocking wait contract | Native parent retains child identity until reaping. It checks status before each signal and permanently revokes authority on uncertainty; not transferable to arbitrary numeric PIDs or groups |
| POSIX process groups/sessions | `setpgid(2)`, `setsid(2)`, `kill(2)` and `killpg(2)` | Descendants can change membership. Signals to a numeric group do not provide complete lifetime ownership |
| kqueue `EVFILT_PROC`, NOTE_EXIT/FORK/EXEC | `kqueue(2)` describes process-event observation | Observation does not deny fork, exec or escape and supplies no all-descendant kill-on-owner-death contract. No enumeration or event-driven PID targeting implemented |
| launchd | `launchd.plist(5)` AbandonProcessGroup and ExitTimeOut | Documented death cleanup targets the job's process group; escaped membership remains a gap. KeepAlive would restart jobs, which is outside scope. No job/service installed |
| `sandbox-exec`, `sandbox_init` | Installed manuals label both deprecated and refer developers to App Sandbox | No profile-based prototype or invented supported secure-launch recipe. `sandbox(7)` also warns that existing writable descriptors can remain usable |
| App Sandbox | Recommended by the installed sandbox manuals | Application packaging/entitlements and compatibility have not been validated here; no reviewed all-descendant lifetime or kill-on-controller-death guarantee established |
| Separate helper/supervisor or isolated guest | Helper admission/lifetime experiment below; guest direction inherited from prior reports | Helper can delay workload execution and react to pipe EOF, but its own hard death is still fatal to its cleanup policy. A guest ownership boundary requires a separate investigation |

No macOS equivalent of a complete Job Object/cgroup lifetime boundary has been established through these reviewed mechanisms. This is a bounded feasibility conclusion, not proof that every possible macOS architecture is impossible. Parent-death signals, shell wrappers, name-based enumeration and sandbox profiles are not accepted substitutes. A helper can improve admission and direct-child identity discipline; it does not make an escaped descendant discoverable or guarantee its own crash cleanup.

### Reproducible local documentation evidence

The reviewed host is Darwin 25.6.0 arm64 with Node v22.23.2. The SDK manual root below is `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/share/man/`; other entries are installed `/usr/share/man/` pages. Hashes identify the exact offline documents used, rather than implying a current online documentation review.

| Local manual | SHA-256 |
|---|---|
| SDK `man3/posix_spawnattr_setflags.3` | `d18873270a46b538677a95fc8ad8551da186c34d9e3d75cb4ef29896a7e77933` |
| SDK `man2/wait.2` | `2178648ce5091cba439ca601216ec3f368ed64487f91385f68b65e7b5e5e5409` |
| SDK `man2/kqueue.2` | `48302f5a7c664d9323dca51593253a30e7263161a6ea514fcb89cdcedd03d2a4` |
| Installed `man5/launchd.plist.5` | `1c5f5041c1d3492988bfa6f9dc6d969dfd072d20af2703c28d9a8f6ed6aaadcb` |
| Installed `man1/sandbox-exec.1` | `0d264f72dc6a8e0db5474840f33b512542c469beb109ed146c17055da287336b` |
| SDK `man3/sandbox_init.3` | `5c8a54e8a3054c2be248655ceb723d0a644b702dfa10ef114d3f72adf09bbde5` |
| Installed `man7/sandbox.7` | `9043d9296715714f95b4de6c5f88a5436c5cc3b83b62641327212078c5c69b04` |
| SDK `man2/setsid.2` | `b90521a68f707ec8e88f6e8c4fea9d745eaaa430b28eeddcebfb1db03ba5c722` |

## Linux feasibility — unimplemented and unvalidated

The [cgroup v2 kernel reference](https://docs.kernel.org/admin-guide/cgroup-v2.html), retained as a source in M2.2b.2, motivates a dedicated delegated subtree, recursive `cgroup.kill` and `cgroup.events` population observation. That page was not fetched in this offline milestone. No cgroup was created, delegated, populated, killed or inspected on this macOS host.

A future design must place a trusted launcher in the owned subtree before it execs the first untrusted workload instruction, or use a separately reviewed atomic native admission mechanism. Spawning an untrusted workload and moving its PID afterward leaves a startup race. Ordinary session/group changes do not themselves supply cgroup migration authority; the design must prevent workload writes to migration/delegation interfaces and prevent escape through outside brokers. Same-user directory permissions alone must not be assumed to isolate a malicious workload from its controller. Delegation owner, credentials, mount exposure, nesting, threaded membership, kernel support and concurrent population need Linux-native review.

A cgroup descriptor is not a kill-on-last-close lifetime policy. An independent trusted owner must close admission, kill the owned subtree and confirm emptiness without reopening population races; the owner's own hard failure requires a separately enforced service/lifetime boundary. Numeric PIDs reconstructed from storage are never a fallback. A cgroup alone supplies no filesystem, network or credential isolation. This is a promising platform-specific proposal, not an implemented or validated backend.

## Windows feasibility — unimplemented, unvalidated, execution disabled

Prior retained Microsoft references describe [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) and [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject). They were not fetched in this milestone. The proposed native sequence is a restrictive Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, non-inheritable controlling handles, suspended process creation, successful assignment before resume, and no allowed breakaway. Any creation, policy, nesting or assignment error must block release and clean up through owned native handles.

The last controlling job handle must actually close on owner death: inherited/duplicated/leaked handles could keep it alive. Future tests must cover restrictive handle lists and access control, existing/nested jobs, breakaway, assignment failure, actual parent hard death and processes created through outside brokers. Job membership alone does not constrain files, network or credentials. Handle-based identity is a distinct Windows mechanism, not an equivalent implementation of the POSIX group owner. Node spawn does not implement this entire contract. Neither a Windows job nor a Windows workload is launched here; both existing Windows pre-spawn rejection layers remain unchanged.

## Prototype architecture and capability/failure states

Only two test-owned implementation files are added: `tests/fixtures/managed/native-admission.c` and `tests/native-containment.test.ts`. No source module, launcher, lifecycle schema, policy or pre-spawn assessment is modified. The test suite builds a disposable binary with `/usr/bin/clang -std=c11 -Wall -Wextra -Werror`; macOS Command Line Tools are required. The compiler gets only an explicit temporary directory variable, and native processes receive an empty environment. Missing compiler/compilation failure fails the macOS suite instead of silently pretending coverage. Other hosts skip this macOS experiment; the non-Apple C branch returns unsupported (78) without creating a process. That branch is not a native Linux/Windows implementation.

The supervisor accepts only a fresh fixture directory and fixed benign modes. It can spawn only its own executable in a fixed workload role, never a caller-provided command, provider or project task. It resets SIGCHLD to its default disposition without automatic reaping and is single-threaded with no competing reaper. `posix_spawn` creates its direct child suspended in a new group with closed inherited descriptors. A bounded `waitpid(WUNTRACED | WNOHANG)` handshake verifies stopped status and absence of the workload-entry marker. The native child PID is never emitted or persisted.

The private stdin controller accepts fixed test actions: release (`R`), stop (`S`), await exit (`O`), explicitly inject revoked ownership (`U`), or hard-exit the supervisor (`X`). Release sends SIGCONT only while unreaped and ownership-confirmed; cancelled, reaped, already-released or uncertain states cannot authorize another release. Cleanup sends only direct-child SIGTERM/SIGKILL under sole-reaper ownership; no group is ever signaled. It checks wait status first, waits up to 150 ms gracefully and a further 500 ms after escalation, and revokes authority if exit cannot be confirmed. A stopped child is killed before release instead of resumed to run cleanup. Reaping or any wait/signal uncertainty permanently prevents further signaling. Uncertainty is sticky even if a later fixture marker indicates voluntary exit.

The supervisor's admission wait is bounded at 1,000 ms, controller lifetime at 5,000 ms and cleanup at the budgets above. Signal handlers only set a flag, so normal code performs cleanup on SIGTERM/SIGINT. EOF from the controller requests cleanup only while the supervisor runs. Repeated stop bytes are processed serially and report the same result; they do not represent a new asynchronous managed stop API. Existing managed concurrent-stop semantics are tested unchanged.

Reports contain only a fixed event name, signal-attempt count and `spawnAuthorized: false`, `productionEligible: false`. These flags describe real managed execution eligibility; the benign test fixture still executes. `direct-child-reaped` deliberately avoids the broader word containment. Reports contain no raw errors, PIDs, groups, environment, credentials or paths. Test marker files contain only a fixed word, never process identities; they are synchronization data, not instructions. Path-canary exclusion, exact report keys, fixed event vocabulary, bounded integer signal counts and empty stderr are asserted in every experiment after supervisor pipes close. Nothing is added to project state, telemetry, memory, snapshots or handoffs.

Workload fixtures arm a six-second alarm as soon as user-space workload code starts and honor a private emergency-stop file. Tests only kill or hard-exit a supervisor after receiving workload readiness, so a disposable released workload always has independent expiry and emergency cleanup. Descendants deliberately escaping through setsid/setpgid use the same private channel and their own expiry. Teardown never signals marker-derived identities or enumerates processes. Readiness uses stopped status, events and explicit marker predicates with deadlines; polling intervals are not used to infer success from elapsed time.

**Important untested failure:** supervisor SIGKILL before release could leave a suspended child indefinitely, because its user-space alarm has not run. This unsafe case is explicitly not injected: there is no independent kernel lifetime owner available in this prototype to guarantee cleanup. The five-second supervisor controller deadline does not survive supervisor death. No all-transition hard-failure safety claim follows from the running-child tests.

## Measured guarantees and limits

Fourteen native cases cover: stopped admission and successful startup write after release; pre-release cancellation and rejected later release; graceful direct-child termination; hung-child escalation; repeated stops without extra signals after reaping; new-session escape; new-group escape; SIGTERM/SIGINT before and after release; controller EOF; actual supervisor SIGKILL; supervisor abrupt exit; injected ownership loss with sticky uncertainty, nonzero supervisor exit and blocked release/signals. Fault injection tests conservative bookkeeping, not kernel-enforced revocation. Fresh emergency responses after supervisor death and descendant escape establish actual fixture survival, not just the presence of a historical ready marker.

The documented suspended-spawn contract supplies the pre-user-space ordering basis. Tests measure a stopped child and absent entry marker before release; they do not trace every machine instruction or prove filesystem/network sandbox enforcement. Direct-child reaping is observed through native wait status. No evidence is promoted to all-descendant absence. Startup file writes are intentionally demonstrated after release; no network operation or network-denial experiment is performed.

The existing process-tree suite continues to exercise original-group descendants, early leader exit, independent-process survival, cancellation, application SIGTERM/SIGINT, unexpected parent exit/exception/SIGKILL, concurrent stop and diagnostic safety. Existing policy/lifecycle tests retain durable acquisition and pending barriers, strict admission, unknown outcomes, atomic publication, sticky cleanup/persistence errors, no replay and no privileged request responses. Production process cleanup is unchanged byte for byte. No automatic recovery, discovery, retry, rollover, native fallback or new cross-platform abstraction exists.

## Validation

Initial native run exposed a compiler temporary-directory sandbox restriction with an empty compiler environment. The fixture build now supplies only its own explicit temporary directory. A normal-exit assertion was also tightened to await actual native reaping instead of inferring exit from a marker. These issues were corrected without weakening containment expectations.

| Check | Local result |
|---|---|
| Final `npm test` | **342 tests: 341 passed, zero failed, one expected Windows-only skip on macOS, zero cancelled/todo**, 12.48 seconds; includes all 14 native cases |
| Earlier full `npm test` before tightening diagnostic assertions/pipe-drain synchronization | Same 342/341/0/1 counts, 13.24 seconds |
| Targeted native + containment + policy + lifecycle + pre-spawn | 217 passed, zero failed/skipped/cancelled, 7.36 seconds |
| Native + containment timing repetitions | Two additional runs, each 33 passed and zero failed/skipped/cancelled, 5.69 and 5.61 seconds |
| Native static analysis | `/usr/bin/clang --analyze -std=c11 -Wall -Wextra -Werror` completed without diagnostics |
| `git diff --check` | Passed; separate no-index whitespace checks for all three untracked files produced no diagnostics |
| Required working-tree inspection | `git status --short`, `git diff --stat`, `git ls-files --others --exclude-standard` inspected; five modified documentation files and three new files, listed below |
| Existing implementation/regressions | `git diff --exit-code -- src bin tests/containment.test.ts tests/managed.test.ts tests/policy.test.ts tests/lifecycle.test.ts tests/pre-spawn.test.ts` passed; existing implementation/tests unchanged |

All execution evidence is local macOS evidence, not Linux/Windows native validation or a new remote CI result. The final full suite reran native, process, policy, lifecycle and pre-spawn checks after the last test change. Standard diff statistics omit untracked files; the separate untracked listing supplies the complete eight-file scope. HEAD remains the expected baseline commit, with no commit or staging required.

## Exact changed file paths

| Path | Change |
|---|---|
| `tests/fixtures/managed/native-admission.c` | Test-only native macOS suspended admission, sole-reaper direct-child ownership, fixed reports and disposable escape/failure workloads |
| `tests/native-containment.test.ts` | Native compilation, bounded handshakes, positive/negative experiments, cleanup and privacy checks |
| `README.md` | User-facing feasibility scope, native test prerequisite and missing containment guarantees |
| `SECURITY.md` | Direct-child ownership, supervisor death and startup isolation limitations |
| `docs/BLUEPRINT.md` | Independent prototype boundary and separate OS proposals |
| `docs/MANAGED_APP_SERVER.md` | Native experiment contract, unchanged disabled launcher and baseline CI provenance |
| `docs/ROADMAP.md` | Offline milestone evidence, remaining containment gates and recommended next work |
| `docs/M2_2B_5_REPORT.md` | This evidence, threat, feasibility, prototype and validation report |

## Remaining blockers and recommended next milestone

macOS still needs a reviewed ownership/lifetime boundary covering escaped descendants, admission-time supervisor death and host/broker escape, plus filesystem/network restrictions established before release. Linux needs an actual restricted delegation/admission/lifetime implementation and native failure tests. Windows needs native suspended assignment, restrictive handle/job lifetime controls and native tests; execution stays disabled. None of these candidates solves provider-specific startup hooks/integrations, configuration discovery, executable identity, credential continuity or authenticated runtime enforcement by itself. Existing original architecture review, production bounded input/deadline/consent plumbing and separately authorized real validation remain outstanding.

Recommend M2.2b.6: investigate a macOS isolated-guest ownership boundary using benign offline fixtures, including startup restrictions, controlled guest lifetime, controller/supervisor death and host/broker interactions. Treat guest teardown identity and failure confirmation as explicit obligations; do not assume virtualization solves them automatically. If no available supported boundary meets the requirements, keep macOS unsupported for real managed execution. Separate Linux/Windows prototypes should be scoped and validated on those hosts, rather than expanding this fixture into a purported portable security backend. No provider or credential work is authorized by this recommendation.

Real Codex App Server execution remains disabled, spawnAuthorized remains false and productionEligible remains false on every platform.
