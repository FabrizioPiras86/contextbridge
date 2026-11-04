# Security Policy

ContextBridge handles potentially sensitive project state. The foundation preview is not audited and must not be considered a security boundary.

## Private data

Do not supply credentials, authentication tokens, customer data, or sensitive text in checkpoint arguments. Local `.contextbridge/` data is ignored by Git by default, but remains on disk and is accessible to local users with appropriate permissions.

## Supported behavior

The starter records Git metadata, manually supplied work-state text, and snapshot integrity digests. It does not collect raw conversations or source file contents automatically. ContextBridge itself performs no network requests. The explicit `next --agent codex` command launches Codex, which may contact its configured provider and read project files under its own permission settings. The verified checkpoint is passed as an initial user prompt, not privileged instructions; its text may be visible in local process arguments. The mutable handoff file is not trusted as launch input.

## Local package preview

Local tarballs are built from a trusted checkout using Node's built-in type stripper, without external dependencies. An explicit package allowlist includes generated runtime JavaScript, launchers and Markdown documentation/templates; tests, native fixtures, account configuration and project state are excluded. Installed-package tests use disposable projects, an offline npm cache, empty npm user/global configuration and a controlled Codex mock. No real authentication or hook trust is exercised. Review `npm pack --dry-run --json` before distributing an artifact; checksums establish integrity, not publisher authenticity. See [release readiness](docs/V1_ASSISTED_RELEASE_REPORT.md).

## Reporting

Until a private security-contact process is established, do not open a public issue containing exploit details or secrets. Agree on a private security reporting channel with the project maintainers before publication.

## Mock managed process boundary

Real managed App Server execution remains disabled. The POSIX test transport owns only its newly created child/group, with bounded cleanup and no persisted PID authority. It cannot contain descendants that leave the group or guarantee cleanup after parent hard failure. Numeric PID/group reuse remains a residual race; no signaling is authorized after observed leader exit. Windows fails before spawn pending tested native containment. See [the containment report](docs/M2_2B_2_REPORT.md). No raw process output is persisted and no process-name targeting is used.


## Mock runtime policy boundary

Managed mock admission validates pinned config/requirements responses before thread creation and explicit effective thread sandbox/network/approval settings before ready. Independent test-harness isolation assertions are required for unsupported properties and never establish real-runtime safety. Missing or inconsistent evidence blocks admission; sensitive configuration is discarded without logging or persistence. Post-handshake checks cannot prevent startup side effects. Every policy assessment retains production eligibility disabled. See [M2.2b.3](docs/M2_2B_3_REPORT.md).

## Offline pre-spawn assessment

The separate M2.2b.4 model accepts only fixed offline evidence categories and returns immutable privacy-safe diagnostics. Input claims remain unverified, every real-runtime control remains unverified, and both spawn authorization and production eligibility are always false. It performs no discovery, environment capture, credential access, configuration repair, persistence or process creation. Empty environment, isolated home proposals, read-only thread sandbox and post-start policy reads do not establish complete startup filesystem/network or credential isolation. See [the startup threat model and platform limitations](docs/M2_2B_4_REPORT.md). Existing mock transport remains internal test infrastructure, not an approved real launcher.

## Native feasibility experiment

M2.2b.5 adds test-only macOS suspended creation of a fixed benign executable. An unreaped direct child anchors numeric identity only while its single native parent remains the sole reaper; no group identity becomes an ownership capability. The prototype revokes signaling on uncertainty or reaping, and reports direct-child reaping separately from descendant containment. Its release gate applies no filesystem/network sandbox. Escaped descendants and children after supervisor SIGKILL/hard exit survive in negative tests. A helper/control pipe cannot protect against the helper's own hard failure; death while a child is suspended could leave that child suspended indefinitely. This is not production containment and does not change existing process cleanup. Unsupported platforms have no native execution fallback. See [the evidence, threat matrix and remaining blockers](docs/M2_2B_5_REPORT.md). Real managed execution and Windows subprocess execution remain disabled.
