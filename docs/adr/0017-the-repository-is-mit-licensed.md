# 0017 — The repository is MIT-licensed

**Status:** accepted (2026-11-25, owner)
**Context:** the repository is public and unlicensed. That makes it all-rights-reserved by default:
nobody may legally copy, fork or reuse it, even though the source is readable. V1 needs a licence.

## Decision

**MIT.** Anyone may use, copy, modify, merge, publish and distribute the code, provided the
copyright notice and permission notice are kept.

The root `LICENSE` is the standard MIT text, copyright 2026 DraxCodes.

## Options considered

| Option | Effect | Verdict |
| --- | --- | --- |
| **MIT** | Permissive; attribution only; simple and familiar | **Chosen** |
| Apache-2.0 | MIT plus an explicit patent grant and more formal terms | Rejected — the extra grant is not worth the boilerplate for a solo browser project |
| AGPL-3.0 | Copyleft: a hosted modified version must publish its source | Rejected — it blocks reuse the owner wants and deters contributors |
| No licence | All rights reserved | Rejected — the default the decision exists to leave |

## Consequences

- A fork may be used commercially and closed; nothing keeps a modified copy open. If that changes,
  the successor is AGPL-3.0, and it applies only to versions published after the change — copies
  already made under MIT stay MIT.
- No warranty and no patent grant. That is normal for a project of this size and is stated in the
  text.
- The `package.json` stays `"private": true`; the licence governs the source, not a registry
  publish.