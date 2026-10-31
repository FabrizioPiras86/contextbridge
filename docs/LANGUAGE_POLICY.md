# Language Policy

ContextBridge is intended for a global developer community. **All project-owned content must be authored in English.**

## English-only surfaces

- Source code symbols, inline comments, commit messages, and review descriptions.
- CLI commands, flags, output, warnings, and error messages.
- README, design docs, developer guides, examples, changelog, and release notes.
- Skill definitions, hook descriptions, agent-internal prompts, schemas, and test fixtures.
- GitHub issues, pull requests, templates, labels, and contribution discussions associated with the public project.

## User conversations

End users may communicate with Claude Code, Codex, or another supported agent in **any language**. ContextBridge must not require users to write prompts in English. When generating messages intended for end users, the system should respect an explicit language preference when technically supported.

Project-internal handoff fields and invariant labels remain in English. User-supplied content may remain in its original language and must not be silently rewritten or translated. This includes user-authored objectives and notes.

## Contributions

Technical contributions should use English. Translation of optional user-facing resources may be supported later, but the canonical project documentation remains English.
