# tools — the L2 experiment rig

**These are not part of the app.** `index.html` still has no build step, no dependencies
and no tooling. It opens by double-clicking it. Nothing in this folder is required to run,
serve, or modify it.

This folder exists because the rig kept getting rebuilt from scratch each run.

## What it is

Zero-dependency Node scripts that drive Edge over the Chrome DevTools Protocol. No npm
install, no `package.json`, no lockfile. Node 20 needs one flag for its WebSocket client:

```
node --experimental-websocket <script> <args>
```

| script | what it does |
|---|---|
| `cdp.js` | shared CDP plumbing: launch, connect, evaluate, DOM to accessibility-node mapping, tree serialization |
| `screen.js` | scores candidate apps for accessibility-semantic quality, so target selection is measured rather than guessed |
| `capture.js` | captures multi-state accessibility trees, and emits the `FULL` / `NAME_ONLY` / `ROLE_ONLY` ablation variants |
| `behave.js` | drives an app and records what observably happened — URL change, network calls, HTTP status |
| `probe.js` | loads one page and lists its navigation targets, for discovering flow URLs |
| `selfcheck.js` | self-check against this repo's own `index.html`: frame stability, keyboard reachability, and the accessible-name conformance diff |
| `accname.js` | the conformance harness: eight in-page AccName implementations diffed against `Accessibility.getFullAXTree` across a corpus, with divergence classification |
| `annotate.js` | `href` mode captures a tree with link destinations joined in; `flip` mode enumerates controls whose ARIA state can flip |
| `crossengine.js` | Blink vs Gecko accessible-name comparison on frozen page snapshots, via CDP and WebDriver Get Computed Label |
| `authinteriors.js` | the same AccName rungs measured behind a login, on public demo systems that publish their own credentials, plus a name-usability metric |
| `nameprobe.js` | **precondition.** Builds a fixture where a real engine and a reimplementation must disagree. Run any new name source against it before believing its numbers. |
| `derivecheck.js` | derivation gate: expressiveness across user profiles, render-target code duplication, the ADR 0004 frame check, and the cost of holding it |
| `derivecontrast.js` | splits derived difference into material and advisory, and dumps the rendered surfaces so they can be judged by reading rather than counting |
| `invariants.js` | the Q4 correctness gate. Every invariant is reported with how many derivations met its precondition — one that never had the chance to fail is not a pass |
| `langcheck.js` | polices generated language before anyone reads it: placeholder and fact preservation, an anti-engagement wordlist, shape, and register variation. Also reports **reachability** — what fraction of the phrase cache can ever be shown to anyone. A treatment with zero opportunities is not a null result |

## The one to steal

`selfcheck.js` contains the **name-agreement check**: it compares the accessible names this
page's own script computes against the names Chromium actually computes, over every control.
That check found a 4/56 agreement rate caused by a single CSS declaration, which nothing else
would have flagged. Some version of it belongs in any product that emits `surface.role` +
`surface.name` telemetry from inside the page.

```
node --experimental-websocket tools/selfcheck.js . ./out
```

---

# Method rules

Every rule below was written *after* the failure it prevents. Each one fixed the last
failure and none of them predicted the next. That is worth knowing before trusting the list
to be complete.

## An outside read before the number

The one intervention with a track record. What has caught every failure below is an
**independent reader with no context** — blind judges, raw sample values, a screenshot.

So: any run reporting a headline number gets an outside read **before** the number is
reported, and a run that cannot arrange one says so rather than skipping it. In run 7 the
judges were read four minutes before the write-up existed, and all three defects the green
gate could not see came from them.

## Run nameprobe.js first

Before any measurement of accessible names, run `nameprobe.js` against the source you intend
to use. It builds a page where a real engine and a naive reimplementation must disagree on
four of five rows. If your source matches the naive column, it is computing names itself and
its agreement numbers are manufactured. A precondition, not a suggestion.

## Never let the test library compute the name

`crossengine.js` uses CDP and WebDriver Get Computed Label because both delegate to the
browser engine. Playwright removed `page.accessibility` in 1.62, and its `ariaSnapshot()`
computes names in injected JavaScript — identical in every engine, which would have returned
perfect cross-engine agreement while measuring nothing. If a future run reports name
agreement, first ask which component computed the name.

## Pin every input you are not varying

Two runs catches instability. Pinning catches confounds that are stable in both arms.

- Run 4 measured 92% cross-engine agreement with a 6% divergence class that was entirely
  Hacker News reordering its front page between passes — an artefact that would have
  replicated across any number of live runs. Frozen, the same corpus reads 98%.
- Run 5's first expressiveness measure ran on a Sunday, whose session loads no joint, so
  every protection profile collapsed and the solver looked rigid.

Date, locale, viewport and time of day are experimental inputs.

## Reset state between measurements

Run 6 found run 5's harness leaking state between profiles: two profiles completed a session
and nothing reset it, so every later profile derived against a partly-completed week. Two of
run 5's numbers were wrong as a result. Anything that persists between measurements is an
experimental input, **including the state your own harness leaves behind**. Use
`window.__datuxResetState()`.

## Two runs minimum against a live target

Anything measured against a live third-party page needs at least two runs before it counts
as a finding. Run 3 nearly reported a non-monotonic convergence curve that turned out to be
page variance between loads.

## Check every branch is reachable before reporting a rule works

Run 5's act/ask/default rule read as "0 asks in 96 derivations" until the ask band turned out
to be unreachable. Run 6's I2a reported 96/96 with its precondition met zero times. A rule
that has never taken a branch has not been tested on that branch, so report precondition
counts alongside pass counts.

## Verify a file changed by reading it

Added in run 7, after discovering that section additions to *this file* across three runs had
silently failed — string replacements that did not match, confirmed by echoing "README
updated" rather than reading the result. The file was also double-encoded by the same
writes. Read the file, or diff it. An echo is not a verification.

## Rules of use against software you do not own

The rig can drive live third-party applications. When it does:

- GET navigations and non-destructive interactions only.
- No credentials, no accounts, no form submissions to real lookup backends. The one exception
  is public demo systems that publish their own credentials on their login page for open
  trial, and even then: navigate and read, create nothing.
- Never operate delete, restore, or permanently-delete on someone else's service — observe
  the affordance and record it as inferred.
- If a service says it does not want automated anonymous traffic, stop and pick a different
  target. Open Food Facts was dropped from run 2 for exactly this reason.

## Results

- Run 1 — [`../CAPABILITIES.md`](../CAPABILITIES.md) — this repo's own app
- Run 2 — [`../experiments/Q13-RUN2-EXTERNAL-APPS.md`](../experiments/Q13-RUN2-EXTERNAL-APPS.md) — GOV.UK and Grafana Play
- Run 3 — [`../experiments/Q13-RUN3-CONFORMANCE.md`](../experiments/Q13-RUN3-CONFORMANCE.md) — AccName conformance across a 20-site corpus
- Run 4 — [`../experiments/RUN4-CROSS-ENGINE-ACCNAME.md`](../experiments/RUN4-CROSS-ENGINE-ACCNAME.md) — Blink vs Gecko, and conformance on unusable names
- Run 5 — [`../experiments/RUN5-DERIVATION.md`](../experiments/RUN5-DERIVATION.md) — the smallest real derivation
- Run 6 — [`../experiments/RUN6-Q4-INVARIANTS.md`](../experiments/RUN6-Q4-INVARIANTS.md) — the Q4 gate, and [`../experiments/L3-PROTOCOL.md`](../experiments/L3-PROTOCOL.md)
- Run 7 — [`../experiments/RUN7-FIX-THE-GATE.md`](../experiments/RUN7-FIX-THE-GATE.md) — clearing the gate, and what green still hides
- Run 8 — [`../experiments/RUN8-LANGUAGE.md`](../experiments/RUN8-LANGUAGE.md) — generated wording, and why it moved nothing
