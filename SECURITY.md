# Security Policy

ContextBridge handles potentially sensitive project state. The foundation preview is not audited and must not be considered a security boundary.

## Private data

Do not supply credentials, authentication tokens, customer data, or sensitive text in checkpoint arguments. Local `.contextbridge/` data is ignored by Git by default, but remains on disk and is accessible to local users with appropriate permissions.

## Supported behavior

The starter records Git metadata, manually supplied work-state text, and snapshot integrity digests. It does not collect raw conversations or source file contents automatically. It performs no network requests.

## Reporting

Until the public repository and security-contact process are established, do not open a public issue containing exploit details or secrets. Agree on a private security reporting channel with the project maintainers before publication.
