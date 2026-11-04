# V1 Assisted release readiness

Date: 2026-11-04. Scope: private, locally installable assisted preview, package version 0.0.1.

## Starting point and evidence provenance

The checkout was clean on `main` at the requested `b32bb343a65f1226f37f92d37cc73d79711eae2d`. Local history identifies this as M2.2b.5, PR #10. Work is on `feat/v1-assisted-release-readiness`; main is unchanged. The supplied request reports merged main CI passing on macOS, Ubuntu and Windows and a baseline of 342 tests, 341 passes and one expected skip on macOS. These remote CI results are owner-provided evidence, not an independently queried result. At the original audit, this branch had not been pushed or run in remote CI. The subsequent PR #11 Windows CI investigation is recorded below.

The audit covered repository instructions, README, security policy, package metadata, both launchers, source CLI dispatch, snapshot/handoff, memory, Codex adapter and hook installation, integration tests, architecture, roadmap, hook/telemetry contracts, managed milestone reports and the GitHub Actions matrix. Local runtime: macOS, Node 22.23.2, npm 10.9.8. No real Codex executable, authentication or account configuration was used for validation.

## Findings and narrowly scoped fixes

| Finding | Evidence and resolution |
|---|---|
| The original tarball installed but could not run | Installing into a disposable consumer and invoking help failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for `src/cli.ts`. Node deliberately rejects stripping under `node_modules`. This establishes the need for a packaging build. |
| Package exclusions were incomplete | Baseline dry-run contained 37 files, including repository agent instructions and editor settings. `.npmignore` omitted docs linked from README. Replaced the denylist with an explicit runtime/documentation allowlist. |
| Hook worker had the same installation blocker | Its launcher also executed `.ts`. Both launchers now use source TypeScript in checkouts and generated JavaScript when source is absent in installed tarballs. |
| Installation guidance only covered checkout execution | README now documents packing, offline local installation with scripts disabled, installed invocation, memory/checkpoint/handoff usage and capability limits. |
| Integration documentation lagged implemented hooks | Updated the integration overview and hook guide to describe explicit opt-in and installation-path lifetime accurately. |
| Initialization was described as creating checkpoint files | README now distinguishes files created by init, memory writes and checkpointing. |
| M2.2b.5 CI checkbox was stale | Roadmap records the merged baseline and owner-provided CI evidence, separately from pending CI for this branch. |
| Assisted safety contracts already held | No memory, snapshot, handoff, provider adapter, telemetry or managed source behavior needed modification. Existing exit codes, provenance, schema compatibility and safe-failure contracts remain intact. |

The runtime limitation and chosen built-in stripping API are documented in the [Node TypeScript reference](https://nodejs.org/api/typescript.html#type-stripping-in-dependencies) and [Node 22 module API](https://nodejs.org/download/release/v22.13.0/docs/api/module.html#modulestriptypescripttypescode-options). The API exists before the supported minimum Node 22.16.0. It remains experimental and performs no type checking.

## Packaging design

`private: true`, version, bin mapping, Node engine requirement and zero external runtime dependencies are preserved. No external build dependencies or lockfile are necessary for this dependency-free preview. A pinned release toolchain remains future release work.

`npm pack` runs `prepack`, which runs `scripts/build.mjs`. The build cleans only generated `dist/`, strips erasable TypeScript using Node's documented `stripTypeScriptTypes` API and rewrites the repository's static, single-line relative `.ts` imports to `.js`. Module layout is unchanged, including hook installer paths relative to the package bin directory. No bundling, runtime loader, network access or install-time compilation is introduced. New import syntax or non-erasable TypeScript would require reviewing this deliberately small build. Checkout launchers prefer source even if an older dist directory exists, so generated output cannot silently replace source during development.

The `files` allowlist includes `bin/*.mjs`, `dist/**/*.js`, `docs/*.md`, `integrations/**/*.md`, `CONTRIBUTING.md` and `SECURITY.md`; npm also includes README, LICENSE and package.json. Source, tests, C fixtures, build scripts, repository instructions, editor settings, Git metadata, caches, local state, credentials and account configuration are excluded. Generated dist remains Git-ignored. Full managed JavaScript modules remain in the package for module-tree fidelity; their presence grants no execution authority, and the CLI's real managed branch still fails before any provider spawn.

With the Windows compatibility follow-up, the package contains **48 files**:

```text
CONTRIBUTING.md
LICENSE
README.md
SECURITY.md
package.json
bin/contextbridge.mjs
bin/contextbridge-hook.mjs
dist/adapters/codex.js
dist/cli.js
dist/config.js
dist/git.js
dist/handoff.js
dist/hooks/codex.js
dist/hooks/install.js
dist/hooks/runner.js
dist/managed/lifecycle.js
dist/managed/policy.js
dist/managed/pre-spawn.js
dist/managed/process.js
dist/managed/session.js
dist/managed/transport.js
dist/memory.js
dist/lock.js
dist/next.js
dist/snapshot.js
dist/storage.js
dist/telemetry/cli.js
dist/telemetry/codex.js
dist/telemetry/model.js
dist/telemetry/store.js
dist/types.js
docs/BLUEPRINT.md
docs/CODEX_HOOKS.md
docs/CONTEXT_TELEMETRY.md
docs/LANGUAGE_POLICY.md
docs/M2_1_REPORT.md
docs/M2_2A_REPORT.md
docs/M2_2B_1_REPORT.md
docs/M2_2B_2_REPORT.md
docs/M2_2B_3_REPORT.md
docs/M2_2B_4_REPORT.md
docs/M2_2B_5_REPORT.md
docs/MANAGED_APP_SERVER.md
docs/ROADMAP.md
docs/V1_ASSISTED_RELEASE_REPORT.md
integrations/README.md
integrations/claude/skills/contextbridge/SKILL.md
integrations/codex/skills/contextbridge/SKILL.md
```

Two consecutive local packs must have identical npm integrity hashes on the same Node version. This is tested automatically. No byte-identical output across different Node versions or platforms is claimed, because the experimental stripper can change. The installed tarball runs with lifecycle scripts disabled and no source tree. The initial default-cache attempt was blocked by sandbox permissions; subsequent packaging uses isolated temporary caches without modifying the user's npm cache.

## Supported workflow and security review

- **Help and initialization:** both installed launcher and npm-created command entrypoint work. Only the selected disposable project receives config and ignore rules. Source capture and telemetry defaults remain false; init installs no hooks.
- **Memory:** user-supplied and agent-reported claims retain distinct provenance and `verification: unverified`. Existing journal validation, recovery and bounded checkpoint selection remain unchanged.
- **Checkpoint and verification:** explicit work fields, Git observations and bounded memory feed the existing schema-1 integrity contract. Legacy compatibility tests remain in the full suite. Checksums establish integrity, not authenticity or the truth of claims. No source contents or conversation history are captured automatically.
- **Status:** reports project objective and verified checkpoint. Configured threshold percentages are settings, not measured occupancy; active context utilization remains unknown. Telemetry status alone creates no telemetry store.
- **Fresh handoff:** a controlled Codex mock receives exactly one initial prompt in the selected project. The prompt contains the verified snapshot and untrusted-data warning. No resume/fork flags or global configuration overrides are passed. Changing mutable HANDOFF.md does not change launch data. Checkpoint files remain unchanged, including after a child exit of 7; the launcher propagates that exit code.
- **Safe failures:** missing checkpoint, invalid checksum and unavailable Codex block or fail handoff recoverably. Existing tests cover malformed pointers, missing files, invalid schemas, oversized prompts, launch errors and terminated children. The installed-package suite also checks missing checkpoint, tampering and useful missing-Codex diagnostics without another mock invocation.
- **Hooks:** no opt-in means no installation; dry-run writes nothing. Explicit installation, status, packaged worker capture and uninstall are tested only in a disposable project using mocked compatibility output. Accepted labeled claims remain agent-reported and unverified. A nonexistent transcript path is never opened. Actual Codex hook delivery and trust are not established by this mock.
- **Telemetry:** explicit local numeric-event imports remain separate from semantic memory and session launching. Existing ingest, bounds, corruption, freshness and unknown-occupancy tests remain in the full suite. No live collector or existing VS Code context monitor exists.
- **Unavailable execution:** installed `context run --agent codex --yes` and `run` fail without another Codex invocation. No managed source changed. `spawnAuthorized` and `productionEligible` remain false; lifecycle, process-containment and policy safeguards are unchanged.

ContextBridge makes no network requests in these workflows. An explicitly requested real `next` session would run Codex under its own authentication, project access and provider network behavior. Prompt data can be visible in process arguments. Secret scanning is heuristic; local state is sensitive, and a digest is not a signature. Stored snapshot and handoff content remains untrusted data. Package scripts, hooks and Codex trust are distinct actions: installing the package does not install hooks or change global Codex configuration.

## Validation

| Check | Result and limits |
|---|---|
| `npm test` | 350 tests: 349 passed, zero failed, one expected platform skip on macOS; includes the existing native/process/policy/lifecycle tests and eight new installed-package checks. |
| `npm run test:package` | Eight checks passed locally: two reproducible packs, offline install with scripts disabled, help, init, memory, checkpoint, verify, status, fresh mock handoff, error paths and packaged optional hook worker. |
| `npm pack --dry-run --json` | Inspected actual contents against the allowlist; 47 files including this report, 23 runtime JavaScript modules, two launchers, 14 documentation files and three integration Markdown files. |
| Local artifact | A real tarball is packed and installed by automated tests in disposable directories. Temporary test installations/caches are cleaned. A final review artifact may be retained outside the repository; no tarball is tracked. |
| Whitespace and working tree | `git diff --check`, `git status --short`, `git diff --stat` and `git ls-files --others --exclude-standard` inspected. Untracked build script, package test and report are included in the exact scope below. |
| CI configuration | Existing macOS/Ubuntu/Windows workflow runs the new tests through `npm test`; its matrix now includes minimum Node 22.16.0 and current Node 22. This branch's remote results are pending, not claimed as passing. |

Automated npm subprocesses run offline with a disposable cache and empty user/global npm configuration. Codex invocations use a controlled executable (on Windows, a copied Node executable with a test-only parent launch adapter that prefixes the mock script); no real authenticated session is used. Local results do not establish current provider delivery, remote CI or Linux/Windows execution. Other Node majors permitted by engine metadata remain unvalidated.

## Exact changed files

| Path | Change |
|---|---|
| `.github/workflows/test.yml` | Minimum and current Node 22 in the existing three-OS matrix. |
| `.npmignore` | Removed in favor of explicit package allowlist. |
| `package.json` | Runtime/doc allowlist, dependency-free build/prepack and package-test scripts; stays private. |
| `bin/contextbridge.mjs` | Source runtime in checkout, generated JavaScript runtime in installed package. |
| `bin/contextbridge-hook.mjs` | Same runtime selection for the bounded hook worker; safeguards unchanged. |
| `scripts/build.mjs` | Clean strip-only JavaScript package emission. |
| `tests/package.test.ts` | Reproducible packing, offline installed-package workflow and controlled Codex/hook checks. |
| `README.md` | Supported V1 Assisted installation, usage, capability distinctions and corrected file creation claims. |
| `SECURITY.md` | Local packaging and test boundaries. |
| `integrations/README.md` | Correct stale hook implementation status. |
| `docs/BLUEPRINT.md` | Evidence-driven packaging build and toolchain limits. |
| `docs/CODEX_HOOKS.md` | Packaged worker invocation and stable installation-path requirements. |
| `docs/ROADMAP.md` | M2.2b.5 merged CI provenance, private preview completion and outstanding gates. |
| `docs/V1_ASSISTED_RELEASE_REPORT.md` | This report. |

## Remaining release blockers and next steps

The preview is locally installable and its supported assisted contract is tested. Before public distribution, review the npm name, publishing identity, security reporting contact and release process; choose a pinned release toolchain; obtain passing branch CI for both configured Node versions on all three hosts; and validate installation on external clean machines. Independently record authenticated interactive handoff and optional hook trust/delivery for each advertised Codex/IDE version before expanding compatibility claims. This milestone deliberately does not authorize those authenticated checks. Hook compatibility remains pinned to Codex 0.166.0; directly executable Codex is required and Windows shell-only shims are unsupported. Unverified higher Node majors and the small build's import syntax assumptions remain compatibility limits.

Automatic context occupancy detection for existing VS Code sessions, automatic switching/rollover/compaction and real managed execution are unavailable. Managed containment, startup isolation, credential continuity and separately authorized real validation remain separate blockers for a future managed product, not capabilities supplied by this assisted package. Further managed prototypes are not the next assisted-release priority.

No npm publishing, GitHub release, version tag, commit, push or pull request was performed. No real managed App Server execution, credential read/copy, global Codex change, unapproved hook installation, automatic rollover/compaction/retry, hidden background process or authenticated model call occurred. Test-only hook installation was explicitly scoped to disposable fixtures. Real execution remains disabled on every platform, with `spawnAuthorized=false` and `productionEligible=false`.


## PR #11 Windows CI compatibility follow-up

The starting checkout for this follow-up was clean on `feat/v1-assisted-release-readiness` at `71d27328e4a561279b162a63040bc47095413d4c`. No branch or PR was created. The [original CI run](https://github.com/FabrizioPiras86/contextbridge/actions/runs/41804104406) was read through GitHub's API: four macOS/Ubuntu jobs passed; Windows Node 22.23.4 and 22.16.0 failed. These are historical failures, not evidence that the follow-up passes Windows.

**Package fixture:** the Windows Node 22.23.4 log fails only in the installed hook compatibility subtest, with the pinned-version error. A local subprocess experiment and a permanent regression establish that Node prints its own version and exits before a `NODE_OPTIONS` require preload runs; the same preload does run for `features list`. [Node's initialization source](https://github.com/nodejs/node/blob/v22.16.0/src/node.cc#L1034-L1039) explicitly returns early for `--version`. Renaming Node to `codex.exe` does not implement the Codex version contract.

The Windows fixture now prefixes a standalone mock script in the parent process's test-only `spawn`/`spawnSync` adapter. It still launches the copied executable with real child arguments, working directory and exit status. It never returns a fabricated compatibility result or modifies production parsing. Only the disposable Codex target is adapted; the missing-PATH case remains unavailable. The POSIX shebang launcher remains in use. Installed-package checks now reject an unsupported mock version and a supported version with hooks disabled before confirming the supported mock workflow. This is mock protocol coverage, not validation of real Codex delivery or trust. No authenticated Codex is run.

**Lock identity:** the Windows 22.16.0 logs show lock conflicts during sequential operations in independent temporary fixtures, including replay, hook install/uninstall and telemetry updates. There is no unlink error in those failures. All three writers previously compared acquired `FileHandle.stat({ bigint: true })` metadata with `lstat({ bigint: true })` metadata and silently retained the lock on inequality. Fixture roots use `mkdtemp`; some failures occur within a single test's awaited sequential calls. Cross-test concurrency is not needed to explain this mechanism.

[Node 22.16.0's bundled libuv](https://github.com/nodejs/node/blob/v22.16.0/deps/uv/src/win/fs.c#L1643-L1655) queries the handle volume serial separately from path statistics and publishes the full `QuadPart` as `st_dev`. It bundles [libuv 1.49.2](https://github.com/nodejs/node/blob/v22.16.0/deps/uv/include/uv/version.h). The [upstream inconsistency fix](https://github.com/libuv/libuv/commit/82cdfb75f) changes assignment and publication to `LowPart`. These sources establish a real path/handle device comparison defect. The old CI logs do not record identity values, so attribution of every historical conflict to that defect is an evidence-backed inference, not a Windows reproduction. The new identity test emits Node/libuv versions and actual handle/path device and inode values for the next CI run.

`src/lock.ts` now compares two descriptor statistics instead: reject symbolic links and non-files with `lstat`, open the current path read-only, compare full bigint device and inode to the acquired identity, close the inspection descriptor, then permit caller unlink only on a match. Unknown identities and zero inodes retain the lock. Memory, telemetry and hook management share this check. No device exception, number conversion, unconditional deletion, stale-lock removal or retry is introduced. Exclusive `wx` acquisition and existing cleanup error handling remain in place. Memory still attempts cleanup after close failure and retains operation/cleanup errors. Inspection failures propagate through the existing cleanup paths.

Replacement files with a different device or inode are preserved. Tests exercise real replacement after closing the acquired descriptor for all three writers, pre-existing lock exclusion, sequential cleanup with injected path-device disagreement, device/inode mismatches, unknown identity, non-files, symbolic-link rejection and inspection failure. Additional subprocess tests reproduce the old version failure and exercise the Windows argument adapter on every host, including flags, spaces, quotes, cwd and nonzero child exits.

This is still a local cooperative-filesystem lock, not an atomic compare-and-delete primitive. Path replacement between inspection and unlink, inode reuse after close, hostile filesystem actors and filesystems without dependable identities are outside its guarantee. Opening for inspection adds a possible permission/I/O failure; it leaves the lock intact and reports the error. Windows ACLs, reopening and close-before-unlink behavior require verification in the actual runner matrix. No Windows success is claimed from macOS results. Passing Windows GitHub Actions on both minimum 22.16.0 and current Node 22 remains a merge gate. Managed App Server execution stays disabled, with `spawnAuthorized: false` and `productionEligible: false`; privacy and lifecycle boundaries are unchanged.

Follow-up validation on macOS, Node 22.23.2 / npm 10.9.8:

- `npm test`: 363 tests, 362 passed, zero failed, one existing platform skip.
- `npm run test`: the same 363 tests, 362 passed, zero failed, one existing platform skip.
- Targeted package run: nine tests passed; targeted lock and subprocess regressions passed after fixture adjustments. The memory fault-injection helper now targets only `wx` acquisition, so acquired-handle close failure remains separate from inspection-handle failure. An initial regression fixture copied macOS's dynamically linked Node executable and failed to locate its library; the portable regression uses a POSIX symlink and retains the copied executable on Windows.
- `npm pack --dry-run --json`: the initial default-cache attempt failed with `EPERM` under the user's npm cache. Repeating with a fresh temporary `npm_config_cache` succeeded: 48 allowed files, including 24 runtime modules and `dist/lock.js`; no source or test fixtures were packaged. No user cache permissions were changed.
- `git diff --check`, `git status --short`, `git diff --stat`, and `git ls-files --others --exclude-standard`: inspected; no whitespace errors. New source/test files remain untracked for review. Generated `dist/` is ignored.

The follow-up changes exactly `src/lock.ts`, `src/memory.ts`, `src/telemetry/store.ts`, `src/hooks/install.ts`, `tests/lock.test.ts`, `tests/codex-fixture.test.ts`, `tests/fixtures/codex-launch.cjs`, `tests/memory.test.ts`, `tests/package.test.ts`, `docs/BLUEPRINT.md`, and this report. The original validation table above describes the earlier audit and is not the follow-up test count.

No commit, push, PR merge, npm publication, release, branch creation or modification of main occurred during this follow-up. Local packing and disposable test installations are the only package operations. Both Windows CI jobs must pass before merge; the changes remain available only in the working tree for review.

## PR #11 final Windows 22.16 directory assertion regression

This correction starts from clean branch `feat/v1-assisted-release-readiness` at `d8e61c895ad9dc6f48dcadc858e597227171c9a4`. The user-provided [CI run](https://github.com/FabrizioPiras86/contextbridge/actions/runs/41807856713) reports five passing jobs and one Windows Node 22.16.0 failure in the test-only `assertSameDirectory()` regression: target and junction path statistics have the same inode (`18295873486507833n`) but devices `1422631540n` and `0n`. Those values are supplied CI evidence, not a local Windows reproduction.

`tests/next.test.ts` retains directory-type checks on both paths. On Windows only, it now compares case-folded `fsPromises.realpath()` results; POSIX retains the full bigint device-plus-inode comparison. There is no inode-only fallback. The existing same-directory, junction/symlink alias and different-directory rejection checks remain. Windows also exercises mixed casing, forward slashes and extended-length target/junction inputs in the same regression, without skipping it or launching an external command.

The [Node 22.16 promise implementation](https://github.com/nodejs/node/blob/v22.16.0/lib/internal/fs/promises.js#L1091-L1098) calls native realpath. Its [bundled Windows libuv implementation](https://github.com/nodejs/node/blob/v22.16.0/deps/uv/src/win/fs.c#L2563-L2632) opens the directory without `FILE_FLAG_OPEN_REPARSE_POINT`, resolves the target with `GetFinalPathNameByHandleW`, and normalizes extended drive/UNC prefixes. This supports junction equivalence without consulting path-stat device values. [Node's documentation](https://nodejs.org/download/release/v22.16.0/docs/api/fs.html#fspromisesrealpathpath-options) does not promise case conversion or a unique pathname for every filesystem alias, so case folding is explicit and scoped to these ordinary case-insensitive Windows fixtures. This helper is not a general identity/security primitive for case-sensitive Windows directories, arbitrary Unicode names, concurrent replacements, bind mounts or alternate volume/share mappings. UNC shares and 8.3 short-name inputs are not runtime-tested locally; no universal cross-version alias guarantee is claimed. The method is available at the minimum supported Node version; Windows behavior on both configured Node versions still requires CI.

Only this report and `tests/next.test.ts` change. Production lock ownership, directory confinement, memory, telemetry and hooks remain unchanged. Windows Node 22.16.0 GitHub Actions must pass before PR #11 can merge; local macOS results do not satisfy that gate.

Validation on macOS arm64, Node 22.23.2: targeted `tests/next.test.ts` passed all 21 tests; `npm test` and `npm run test` each completed with 363 tests, 362 passed, zero failures and one existing platform skip (14.85 and 19.64 seconds respectively). No Windows runtime result is claimed. No commit, push, merge, publication or release was performed.
