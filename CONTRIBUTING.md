# Contributing

Thank you for helping make agent context portable and safer.

## Language

All repository content and contribution discussions must be in English. End users are free to converse with agents in any language. See [Language Policy](docs/LANGUAGE_POLICY.md).

## Local development

1. Use Node.js 22.16 or later.
2. Run `npm test` (no install required for the preview).
3. Implement a narrowly scoped change and add regression tests.
4. Document the behavior and any provider-version assumptions.
5. Keep security-sensitive operations fail-safe and opt-in.

The prototype does not need credentials, network access, or provider CLI installations to run its foundation tests.

## Pull request checklist

- [ ] Tests pass.
- [ ] Documentation and UI messages are in English.
- [ ] No raw secrets, conversations, or user project data have been committed.
- [ ] Unsupported agent features fail explicitly.
- [ ] New behavior includes evidence and recovery tests where applicable.
