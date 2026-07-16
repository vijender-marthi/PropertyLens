# Contributing to PropertyLens

## Mandatory Engineering Standards

All contributions must follow the version-controlled standards in this repository:

- [AGENTS.md](AGENTS.md)
- [Architecture Constitution](docs/standards/ARCHITECTURE_CONSTITUTION.md)
- [UI Design Standards](docs/standards/UI_DESIGN_STANDARDS.md)
- [Domain Rules](docs/standards/DOMAIN_RULES.md)
- [AI Coding Instructions](docs/standards/AI_CODING_INSTRUCTIONS.md)
- [PR Checklist](docs/standards/PR_CHECKLIST.md)

Pull requests violating these standards should not be merged.

## Local Validation

Run:

```bash
npm run standards:check
```

When frontend code changes, also run:

```bash
npm --prefix frontend run build
```

When backend logic changes, run the relevant backend tests.

## Change Scope

Keep changes narrow. Do not combine formula changes, API contract changes, UI redesign, and cleanup refactors in one PR unless explicitly approved.

