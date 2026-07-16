# AI Coding Instructions

These instructions apply to Codex, Cursor, Claude Code, Copilot, Windsurf, and any other coding agent working in PropertyLens.

## Required Before Editing

Before modifying code, the agent must:

1. Read `AGENTS.md`.
2. Read every file under `docs/standards`.
3. Inspect existing shared components.
4. Inspect existing formatter utilities.
5. Inspect current API contracts.
6. Identify whether the request affects frontend, backend, or both.
7. Preserve backend ownership of calculations.
8. Avoid new one-off helpers.
9. Avoid duplicate components.
10. Avoid page-specific formatting.

## Prohibited Agent Behavior

The agent must not:

- Put business logic in React components.
- Add a second formatting utility.
- Add hardcoded colors.
- Add arbitrary font sizes.
- Add local K/M/B formatting.
- Use `toLocaleString` directly in components.
- Use `Intl.NumberFormat` directly in components.
- Use `toFixed` directly for UI display.
- Modify engine formulas during UI tasks.
- Duplicate API calls.
- Create another generic table component.
- Bypass the design system.
- Rewrite unrelated parts of the application.
- Revert unrelated worktree changes.

## Required Completion Report

At completion, the agent must report:

- Files changed
- Standards followed
- Shared components reused
- API contracts affected
- Tests added or updated
- Remaining violations
- Any standards conflicts

## Metric Vault Rule

If a UI needs a calculated value, formula explanation, source, status, severity, tooltip explanation, recommendation, or audit trace that the API does not provide, the agent must extend backend DTOs instead of deriving those semantics in frontend code.

