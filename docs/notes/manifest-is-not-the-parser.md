---
date: 2026-11-23
verified_against: 74ec750 + uncommitted Layer 1
files: [tools/capture.mjs, src/frame/address.ts, src/state/url-state.ts]
status: active
---

# A capture manifest must not hold its own copy of a parser

**Cause.** `tools/capture.mjs` validates `capture/shots.json` before it launches a browser, and
it used to validate `address` with its own regex (`/^v\d+\/[-.\d]+$/`). That is a second copy of
a grammar whose authority is `src/frame/address.ts`. When the app learned to accept the root
(`v1/`, zero levels), the harness still rejected the manifest — and the reverse case is worse:
any value the *harness* accepts but the *page* rejects used to be captured anyway, producing a
screenshot of the **default** coordinate wearing the name of the requested one. That is the same
failure shape as the retracted "3,140 px" figure: evidence that does not prove what it claims.

**What to do instead.**

1. Keep the manifest regex deliberately **loose** — a typo guard, not a grammar. It exists to
   catch `"address": 12` and stray characters, nothing more. Where it is loose, say so in a
   comment.
2. Let the **page be the authority**. The app already reports every rejected parameter in
   `#hud-issues`; the harness reads that element after load and fails the shot if it is
   non-empty (`assertAcceptedQuery`). This closes the whole class, not the instance.
3. When you change a URL parameter's grammar, check three places for a copy:
   `src/state/url-state.ts` (authority), `tools/capture.mjs` (manifest guard), and any
   `?raw`-style default in a script. Grep for the parameter name rather than the regex.

**Evidence.** `node tools/capture.mjs --manifest <bad>.json --shot tmp-root-address` with an
address of `v1/01` now fails before writing a PNG:

```
The app rejected part of shot "tmp-root-address"'s URL, so the image would show a default
instead of the requested coordinate:
```

`src/frame/sharing.test.ts` is the test that found the original gap: `formatAddress` emitted
`v1/` and `parseAddress` rejected it, so a link the app could produce could not be reopened.