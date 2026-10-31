# Security Policy

ContextBridge handles potentially sensitive project state. The foundation preview is not audited and must not be considered a security boundary.

## Private data

Do not supply credentials, authentication tokens, customer data, or sensitive text in checkpoint arguments. Local `.contextbridge/` data is ignored by Git by default, but remains on disk and is accessible to local users with appropriate permissions.

## Supported behavior

The starter records Git metadata, manually supplied work-state text, and snapshot integrity digests. It does not collect raw conversations or source file contents automatically. ContextBridge itself performs no network requests. The explicit `next --agent codex` command launches Codex, which may contact its configured provider and read project files under its own permission settings. The verified checkpoint is passed as an initial user prompt, not privileged instructions; its text may be visible in local process arguments. The mutable handoff file is not trusted as launch input.

## Reporting

Until the public repository and security-contact process are established, do not open a public issue containing exploit details or secrets. Agree on a private security reporting channel with the project maintainers before publication.
