# PropertyLens PR Checklist

Use this checklist for every change.

## Architecture

- [ ] No business calculations were added to the frontend.
- [ ] Existing APIs were reused where possible.
- [ ] API contracts remain compatible or changes are documented.
- [ ] No engine logic was modified during UI-only work.
- [ ] Metric Vault remains the source of authoritative metrics.

## UI

- [ ] Existing shared components were reused.
- [ ] No arbitrary fonts or sizes were introduced.
- [ ] No hardcoded colors were introduced.
- [ ] No page-specific number formatting was added.
- [ ] Tables use the shared DataTable when available.
- [ ] Forms use shared input components when available.
- [ ] Accessibility was checked.

## Formatting

- [ ] Cards use compact values at or above `100,000`.
- [ ] Tables use full values.
- [ ] Loan rates show exactly three decimals.
- [ ] Tooltips use full precision or backend-provided display strings.
- [ ] Exports use raw or full values.
- [ ] Year tables default to ascending order.

## Quality

- [ ] Tests were updated.
- [ ] `npm run standards:check` was run.
- [ ] Frontend build was run when frontend code changed.
- [ ] Backend tests were run when backend code changed.
- [ ] No unrelated code was changed.
- [ ] Documentation was updated.

