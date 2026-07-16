# PropertyLens Agent Instructions

Before writing or modifying any code in this repository, read every file under `docs/standards`. These standards are mandatory and override local implementation preferences.

Required standards:

- [Architecture Constitution](docs/standards/ARCHITECTURE_CONSTITUTION.md)
- [UI Design Standards](docs/standards/UI_DESIGN_STANDARDS.md)
- [Domain Rules](docs/standards/DOMAIN_RULES.md)
- [AI Coding Instructions](docs/standards/AI_CODING_INSTRUCTIONS.md)
- [Change Control](docs/standards/CHANGE_CONTROL.md)
- [PR Checklist](docs/standards/PR_CHECKLIST.md)
- [Current Violations](docs/standards/CURRENT_VIOLATIONS.md)

Any coding agent must refuse to introduce a known standards violation unless the user explicitly requests a standards change and the change follows `docs/standards/CHANGE_CONTROL.md`.

Implementation rules:

- Change only what is necessary.
- Do not refactor unrelated modules.
- Do not alter business rules without explicit instruction.
- Preserve existing API compatibility.
- Keep backend ownership of calculations.
- Use shared formatter utilities for display formatting.
- Use existing shared components before creating new ones.
- Do not revert unrelated dirty worktree changes.

Before completion, run the relevant checks and report files changed, standards followed, tests run, and remaining violations.

