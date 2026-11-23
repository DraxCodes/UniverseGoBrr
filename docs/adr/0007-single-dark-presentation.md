# 0007 — One look: dark, and no theme system

**Status:** accepted (2026-11-23)
**Context:** The workflow base's web preset asks for `light` and `dark` and expects both to be
captured and scored. That preset is written for product UIs, where a light surface is a real
user preference. This project is a full-bleed view of space. A universe is dark by nature:
the light in a frame comes from suns, emission nebulae, supernovae and re-entry, and it is
light *against* darkness. A light theme would mean a bright surface with dark space on it,
which is both untrue to the subject and physically wrong — it removes the contrast the
subject depends on.

The cost of carrying a second theme is not the first screenshot. It is every surface after
it: two colour ramps, two contrast checks, twice the capture matrix, and a permanent
invariant that a change must not be "correct in one theme only". That is a tax on the
presentation layer for a variant nobody wants.

## Decision

The app has **one presentation**: a dark one. There is no theme switch, no `prefers-color-scheme`
branch, and no light variant. This is recorded as an invariant, not a preference:

- `index.html` declares `<meta name="color-scheme" content="dark">`.
- `src/styles.css` declares `color-scheme: dark`.
- The seam declares `verify.themes: ["dark"]` — the base requires a non-empty list for a web
  surface, and one entry is the honest description of one look.
- `src/look-and-feel.test.ts` fails if a `prefers-color-scheme` branch appears in `src/`, or if
  the seam gains a second theme.

"Light" remains a property of the *scene*, not of the UI: it is emissive colour in the
shader, which is what the perception rubric should judge.

## Options considered

| Option | Verdict |
| --- | --- |
| A. Ship light and dark, as the preset asks | Rejected — a light surface contradicts the subject, and doubles the invariant surface for no user |
| B. Dark only, unstated | Rejected — the seam asks for two themes, so an unstated choice looks like an omission and gets "fixed" later |
| C. Dark only, stated as an invariant and enforced | **Chosen** |

## Consequences

- The capture matrix is widths only. A new breakpoint is additive; there is never a
  light/dark pair to keep in sync.
- Contrast and legibility still have to be earned — a dark surface makes small text *harder*
  to read, so the `perception` rubric's contrast checks matter more, not less.
- If a light presentation is ever genuinely wanted (a printable star chart, say), it is a new
  decision that supersedes this one and names which surface it applies to. It is not a theme
  added back to the app.
- Does not constrain the actor or universe layers; this is presentation only.
