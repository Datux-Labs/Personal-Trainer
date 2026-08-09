# Run 4 — cross-engine accessible-name divergence

ADR 0010 was decided entirely on Chromium. This run measures whether a second engine
computes materially different accessible names for the same elements, because if it does,
the per-deployment conformance gate needs a browser dimension and "observe from outside the
page" stops being one measurement.

**It does not. Engines agree with each other far better than any in-page reimplementation
agrees with either of them.**

---

## 1. The finding

Blink and Gecko, given byte-identical DOM, across 10 sites, two independent runs:

| | run A | run B |
|---|---|---|
| elements compared | 1,177 | 1,204 |
| **exact name agreement** | **98%** | **98%** |
| normalised agreement | 98% | 98% |
| sites at 100% exact | 9 of 10 | 9 of 10 |

Set against run 3's measurement of a careful **in-page reimplementation** versus Chromium:

| comparison | exact | normalised |
|---|---|---|
| in-page reimplementation vs Chromium (run 3) | 91% | 96% |
| **Blink vs Gecko (run 4)** | **98%** | **98%** |

**Engine-to-engine divergence is roughly a quarter of reimplementation divergence.** The
thing ADR 0010 is guarding against — an in-page SDK inventing names that nothing else
agrees with — is a much larger effect than the browser you happen to measure from.

**Consequence for ADR 0010:** the per-deployment gate does not need a browser dimension.
Measuring on one engine is a good approximation of the others, and "observe from outside"
stays a single measurement rather than multiplying by engine count. That is the answer to
the largest untested assumption in the decision.

**With one real gap: WebKit is untested.** Playwright's WebKit bundle ships no WebDriver
binary, Safari does not exist on Windows, and Playwright removed the API that would have
read WebKit's own accessibility tree (see §4). So this is Blink vs Gecko, two of three
engines, and the missing one is the one most likely to differ. The claim above should be
read as "Blink and Gecko agree", not "engines agree".

### Where the 2% is

All of it is concentrated, and both classes replicated across runs:

| class | n | share | what it is |
|---|---|---|---|
| `gecko-only-name` | 22 | 1.8–1.9% | Hacker News upvote arrows. Blink computes `""`; Gecko computes `"upvote"` from a `title` attribute on a descendant of the link. Gecko walks to a descendant `title`, Blink does not. |
| `punctuation-only` | 5 | 0.4% (run B only) | CDC headlines. Blink retains invisible LTR marks (U+200E) in the name, Gecko strips them. Vanishes under normalisation. |

9 of 10 sites agree perfectly. The divergence is not spread thinly across the web — it is
two specific implementation choices, one of which is semantically meaningful (a control
that has a name in one engine and no name in the other) and one of which is invisible
whitespace.

The `gecko-only-name` case is the interesting one for instrumentation: those 22 controls
are *unnamed* in Chromium. An identity scheme keyed on Chromium's name would treat them as
anonymous; keyed on Gecko's, they are `"upvote"`. That is a small number here but it is the
failure mode to watch, because it is silent.

---

## 2. The methodology finding, which nearly cost the result

**The first version of this experiment measured 92% agreement with a 6% `disjoint` class.
All of it was fake.**

Comparing live loads means each engine visits the page at a different moment. Hacker News
reorders its front page between visits, so the DOM path that held one story in the Blink
pass held a different story in the Gecko pass:

```
blink = "Improving Heuristics for A* Pathfinding"
gecko = "Microsoft Word for Windows 1.1a, Native X64 Port"
```

That is not engine divergence. It is the page changing. It also degraded three other sites
— BBC News shared zero comparable elements, Tailwind read 66%.

The fix was to freeze the target: Chromium renders each live page once, the fully-rendered
DOM is captured with scripts stripped and a `<base>` inserted so stylesheets still resolve,
and both engines then read that identical byte stream from localhost. CSS is deliberately
kept, because `text-transform` participates in name computation.

Frozen, the same corpus reads **98%**, and the fabricated `disjoint` class disappears
entirely.

**Generalising §9's two-runs rule:** repetition alone would not have caught this. Two live
runs would both have shown ~6% disjoint and it would have looked like a replicated finding.
What was needed was *control of the target*, not repetition of the measurement. For any
comparison across tools, engines or time, the page must be pinned or the difference between
the arms is confounded with the difference between the moments.

---

## 3. What this cost in confidence elsewhere

The frozen-snapshot method strips JavaScript, so every number in §1 describes a **static
DOM**. Engines that differ in how they re-render dynamic content are excluded by
construction. 98% is therefore an upper bound on agreement for live single-page
applications, and the honest read is "Blink and Gecko compute names from the same DOM
almost identically", not "Blink and Gecko behave identically on a live app".

---

## 4. The trap that would have produced a confident wrong answer

Playwright is the obvious tool for this, and it would have lied.

`page.accessibility.snapshot()` — which reads each engine's own accessibility tree — **was
removed in Playwright 1.62**. The natural replacement, `locator.ariaSnapshot()`, computes
accessible names **in injected JavaScript**. That implementation is Playwright's own and is
identical in every browser, so the experiment would have returned *perfect cross-engine
agreement on every element of every site* and the conclusion would have been "engines are
in complete agreement, ADR 0010 needs no browser dimension" — the right answer, arrived at
by measuring nothing.

This was caught by a validity probe written before any measurement, which required the
result to fail in a specific way if the names were library-computed: this repo's own
`index.html` styles a label `text-transform: uppercase` and pulls it into names via
`aria-labelledby`, and Chromium applies text-transform to names. Identical output across
engines on that page would have been the signature of a fake.

The probe found `page.accessibility` was `undefined` and the experiment moved to WebDriver's
spec-defined **Get Computed Label**, which delegates to each engine's own computation. That
is the load-bearing methodological choice in this run.

**The general lesson is not about Playwright.** Any test tool that computes accessible names
itself, rather than asking the engine, will report agreement it has manufactured. That
includes most of the obvious ways someone would try to check ADR 0010 in future. If a
future run reports cross-engine or cross-tool name agreement, the first question is which
component computed the name.

---

## 5. Partial answer on authenticated interiors

Run 3's corpus was weighted toward landing pages and I flagged that 93% might be optimistic.
Six application interiors reachable **without credentials** (Grafana dashboard, Grafana
Explore, draw.io editor, Excalidraw, OpenStreetMap directions, Photopea), 219 elements:

| rung | landing pages (run 3) | app interiors |
|---|---|---|
| naive | 83% | **82%** |
| v7 (most faithful) | 91% | **98%** |
| median site at v7 | 93% | **100%** |

**Interiors are not worse. For a careful implementation they are better.** The worry was
the wrong way round.

But the *gap* between naive and careful is much larger on interiors — 16 points versus 8 —
and draw.io's editor moves from **20% to 87%**. Interiors are icon-and-toolbar heavy, so
`title` and `alt` fallbacks carry most of the naming load, and an SDK that only reads
`aria-label` and `textContent` fails there far worse than on a content page. That sharpens
the ADR 0010 recommendation: the naive implementation is not uniformly 83%-good, it is
adequate on prose-heavy pages and catastrophic on toolbars.

This is only a partial answer. These are anonymous interiors, not authenticated ones. True
authenticated interiors need credentials, which I should not use on third-party services, so
that remains open and needs either a self-hosted target or an account someone is entitled
to lend.

---

## 6. What surprised me

**The direction of the result.** I expected engines to diverge more than a reimplementation,
because AccName is famously under-specified in its edge cases and the engines have
independent implementations with decades of separate history. The opposite is true by a
factor of four, and the reason is visible in the residuals: engines disagree on a small
number of *specific documented behaviours* (descendant `title`, bidi control characters),
whereas a reimplementation disagrees on a long tail of things it simply does not know about
— which is the `miss:unknown-source` class from run 3 that never went away.

**Freezing the target changed the headline by 6 points and deleted a whole divergence
class.** I have now been caught twice by live-page variance — once in run 3 with a
non-monotonic curve that did not replicate, once here with a divergence class that was pure
content drift. Both times the artefact looked like a finding and had a plausible mechanism
ready to explain it.

**The interiors result contradicted my own stated worry**, and I had flagged that worry
prominently enough that it would have been easy to confirm rather than test.

---

## 7. Corrections to §9

**Add — pin the target for any comparative measurement.** Two runs catches instability; it
does not catch a confound that is stable in both arms. Anything comparing tools, engines or
time must serve both arms identical bytes. This run's headline moved 92% → 98% on that
change alone.

**Add — for any measurement of accessible names, record which component computed them.**
Engine, driver, or test library. A library-computed name will manufacture agreement and the
result will look clean.

**Sharpen — "authenticated interiors" is not the right criterion.** What matters is
*control density*: toolbars and icon buttons, where names come from `title`/`alt` rather
than text. Anonymous app interiors already deliver that and are ethically simpler. Screen
for icon-heavy UI, not for a login wall.

**Retire — the worry that landing-page corpora are optimistic.** Measured, and the effect
runs the other way for a careful implementation.

---

## 8. Limitations

- **Two engines, not three.** WebKit is unmeasured and is the most likely to diverge. This
  is the main thing that would change the conclusion.
- **Gecko was Playwright's patched Firefox build**, driven by geckodriver. It is a real
  Gecko, but not a stock Firefox release; a vendor patch touching accessibility would be
  invisible to me.
- **Static DOM only** — scripts stripped, see §3.
- **10 sites, 160 elements per site per engine cap.** Wikipedia contributes 677 named
  controls to Blink but only 160 were compared.
- **The interiors corpus is 6 sites and 219 elements**, small enough that one unusual
  application moves the number several points.

---

*L2 experiment record. Rig in [`tools/`](../tools) — `crossengine.js` is new in this run and
needs geckodriver plus a Firefox binary, both outside the repo. Previous runs:
[CAPABILITIES.md](../CAPABILITIES.md), [Q13-RUN2-EXTERNAL-APPS.md](Q13-RUN2-EXTERNAL-APPS.md),
[Q13-RUN3-CONFORMANCE.md](Q13-RUN3-CONFORMANCE.md).*
