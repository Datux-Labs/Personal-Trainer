# Q13 run 3 — measuring the three things run 2 recommended

Run 2 ended with three recommendations. Run 3 measured all three. **Two of them were
wrong, and the third — the one I escalated to blocking — rested on an unrepresentative
number that I supplied.**

This report leads with that because it is the most useful thing in it.

---

## 1. The finding, first: I over-escalated Q14

Run 1 measured a careful in-page AccName implementation agreeing with Chromium on
**4 of 56 controls** on this repo's own app, and I argued from that number that the
conformance test should be blocking. Run 3 measured the same thing across 2,234
interactive elements on 19 real public sites.

| implementation | exact match | normalised match |
|---|---|---|
| naive (`aria-label` else `textContent`) — approximately what vendor autocapture does | **83%** | 91% |
| v7 (most faithful, seven rungs of AccName fidelity) | **91%** | 96% |

The median site scores 93% exact. **Run 1's 7% was an outlier by a factor of thirteen**,
caused by one unusual pattern — `text-transform: uppercase` applied to a label that was
then pulled in by `aria-labelledby`, which corrupts every name derived from it at once.
That pattern is real and it is catastrophic when it occurs, but it is not typical, and I
generalised from a single app I had written myself to "total loss of the only channel
carrying capability meaning." That was too strong.

**What the corpus actually supports is a different and better argument.** The problem is
not the average error, it is the *distribution*:

- 7 of 19 sites reach 100%. **12 of 19 never do**, no matter how faithful the
  implementation.
- The tail runs to 59% (Tailwind CSS), 62% (BBC News), 65% (MDN).
- Nothing about a site predicts which group it lands in from the inside.

A vendor testing its SDK against its own marketing site would measure 100% and ship. Its
customer's app sits at 59% and nothing anywhere reports that. **The case for observing
names from outside the page is not that in-page computation is usually wrong — it is that
being wrong is per-site, invisible from inside, and unbounded in the tail.**

So Q14 stays high priority, and the framing changes: a conformance test is a necessary
regression guard, not a solution. Two concrete additions fall out of the data below.

---

## 2. Experiment 1 — the AccName conformance harness

**Method.** For every interactive element on each site, compute the accessible name with
eight in-page implementations of increasing fidelity, then diff each against the name
Chromium actually computed via `Accessibility.getFullAXTree`. One GET per site, no
interaction. Rungs:

| rung | adds |
|---|---|
| naive | `aria-label`, else `textContent` |
| v1 | `aria-labelledby`, native `<label>` (this is run 1's implementation) |
| v2 | CSS `text-transform` (the run-1 fix) |
| v3 | `title` / `alt` / `value` / `placeholder` native fallbacks |
| v4 | exclude hidden and `aria-hidden` subtrees |
| v5 | CSS `::before` / `::after` generated content |
| v6 | AccName's inter-element spacing rule |
| v7 | include hidden content when referenced by `aria-labelledby` |

**The convergence curve, weighted by element count over 2,234 elements:**

```
          naive   v1    v2    v3    v4    v5    v6    v7
exact       83    83    83    85    87    91    91    91
normalised  91    91    91    93    95    96    96    96
```

**It plateaus at v5.** The last two rungs — both of them straight out of the AccName spec —
buy exactly nothing. Seven rungs of increasing fidelity buy 8 points over a naive
implementation, and the last three buy 4 of those.

**Per site, worst to best (exact / normalised at v7):**

| site | n | naive | v7 | v7 normalised |
|---|---|---|---|---|
| tailwindcss.com | 90 | 41% | **59%** | 63% |
| bbc.co.uk/news | 116 | 62% | **62%** | 85% |
| developer.mozilla.org | 83 | 63% | **65%** | 100% |
| nasa.gov | 75 | 80% | 83% | 100% |
| nodejs.org | 71 | 85% | 85% | 90% |
| app.diagrams.net | 15 | 20% | 87% | 93% |
| getbootstrap.com | 100 | 84% | 88% | 88% |
| cdc.gov | 87 | 63% | 89% | 90% |
| react.dev | 50 | 90% | 90% | 100% |
| mastodon.social | 43 | 88% | 93% | 95% |
| w3.org/WAI | 78 | 94% | 94% | 96% |
| en.wikipedia.org | 773 | 83% | 96% | 100% |
| play.grafana.org | 38 | 84% | 100% | 100% |
| vuejs.org | 57 | 100% | 100% | 100% |
| gov.uk | 88 | 99% | 100% | 100% |
| openstreetmap.org | 39 | 85% | 100% | 100% |
| python.org | 147 | 95% | 100% | 100% |
| news.ycombinator.com | 231 | 100% | 100% | 100% |
| caniuse.com | 53 | 94% | 100% | 100% |

archive.org yielded zero comparable elements and is excluded — 1 of 20 unusable, better
than run 2's 40%, because this corpus was chosen partly for reachability.

Two sites are worth noting individually. **w3.org/WAI — the W3C's own accessibility
initiative — sits at 94%,** which is a useful calibration: even the people who write the
specification produce markup an in-page reimplementation cannot fully reproduce.
**diagrams.net moves from 20% to 87%,** the largest single gain, entirely from the v3
native fallbacks; a naive implementation is catastrophically wrong on icon-button-heavy
applications specifically.

**Residual divergence at v7, classified** (199 of 2,234 elements):

| class | n | share | what it is |
|---|---|---|---|
| punctuation-only | 59 | 2.6% | e.g. Wikipedia's `[edit]` — we keep the brackets, the browser doesn't |
| whitespace-only | 56 | 2.5% | e.g. `+More Shapes` vs `+ More Shapes` — inter-node spacing we still get wrong |
| miss:unknown-source | 54 | 2.4% | the browser found a name from a source we could not identify at all |
| disjoint | 26 | 1.2% | e.g. BBC prepends `image unavailable` to link names |
| ours-is-subset / superset | 4 | 0.2% | truncation and over-inclusion |

Roughly half the residual is cosmetic (punctuation and whitespace), which is why the
normalised column recovers 5 points. The other half is not: `miss:unknown-source` means we
produced nothing and the browser produced a name, and after adding every documented
fallback we still cannot say where 54 of those names came from.

### What this means for Q14

**Two recommendations, both measurable rather than asserted:**

1. **Never use the accessible name as an exact join key.** Normalising — casefold, strip
   punctuation, collapse whitespace — moves the weighted rate from 91% to 96% and takes 8
   sites to parity that exact matching leaves short. That is free and it should be the
   default for any name-based identity.
2. **Ship the conformance diff, but as a per-deployment gate, not a library test.** The
   error is a property of the target application, not of the SDK. Run it against the
   customer's app on their build, and treat a low score as "names are not reliable
   identity here, fall back to something else" — not as a bug to fix in the SDK, because
   at v7 there is no more fidelity available to add.

Observing from outside the page remains the only way to get the true name. The corpus says
that matters most for the 12 sites in 19 that never reach parity, and that you cannot
identify them without measuring.

---

## 3. Experiment 2 — the href join. Negative.

Run 2 found that two namers modelled *different products* from GOV.UK: one produced
`passport.renew` and `vehicle.tax` (the government services the site describes), the other
`search.execute` and `nav.toggle_menu` (the web application). I attributed this to the
accessibility tree not carrying link destinations, called the fix "cheap and concrete",
and said any real bootstrapper must join the tree to `href` and same-origin.

**Measured: it does not work.**

Every link in the GOV.UK capture was annotated `-> SAME-APP /path` or
`-> external:<host>`, and the same two models re-ran on the annotated tree.

| | run 2 (no href) | run 3 (with href) |
|---|---|---|
| Model A | 19 capabilities, services model | **25 capabilities, still a services model** |
| Model B | 18 capabilities, application model | **19 capabilities, still an application model** |
| Exact id agreement | 0 | **0** |

The divergence did not narrow. It widened — model A grew from 19 to 25 service-shaped
capabilities.

**Both models said the annotations changed their decisions, and they used the same
annotation to justify opposite conclusions.**

- Model A: *"destination annotations changed decisions. They justified treating passport,
  pension and category routes as in-application entry capabilities."*
- Model B: *"SAME-APP paths like /log-in-register-hmrc-online-services are GOV.UK guidance
  pages; the actual sign-in services they describe live elsewhere. Within this
  application's scope, the capability is `content.view`."*

Same annotation, opposite readings. The join did not resolve the ambiguity; it got absorbed
into whichever frame each namer already held.

**Why it fails is obvious in hindsight and I should have checked it first:** 77 of 79 links
on the GOV.UK home page are same-origin. Same-origin is a terrible proxy for same-product
on a large estate, because one origin hosts hundreds of independently-operated services.
The annotation carries almost no information on precisely the kind of site where the
ambiguity arises.

The underlying problem is real — the scope boundary of "this application" is genuinely
undetermined by the accessibility tree. My proposed fix was not.

---

## 4. Experiment 3 — the flippable-state detector. Weak at best.

Run 2's corrected finding was that the blind spot is control-sharing: a control that also
performs the reverse action gets modelled as an attribute rather than a second capability.
I said the candidate set was enumerable from the tree and "cheap enough to just build".

Built it. On this repo's own app — where the ground truth is known, because we wrote it —
it produced **34 candidates** carrying `pressed`, `checked`, `expanded` or `selected`. Both
run-1 models re-ran with the tree *plus* the candidate list.

**Target: recover `session.reopen` and `session.restore_planned`, which 4 of 4 run-1 runs
missed.**

| | recovered `reopen`? | recovered `restore_planned`? | false positives it declared |
|---|---|---|---|
| Model A | **yes** — `training_session.mark_incomplete`, at **low** confidence, explicitly crediting the candidate list | no | 13 of 34 |
| Model B | **no** — explicitly merged | no | 5 of 34 |

Model B saw the candidate, correctly identified the control as a toggle, and chose to merge
anyway: *"These have different domain meanings but I merged them into one capability… the
completion direction belongs as an event attribute. Coin-flip: merged."*

**That is the result.** The detector is not solving a discovery problem, because there was
never a discovery problem — run 2 already established that namers *see* the toggle. Pointing
at it more loudly changed one of two namers, at low confidence. Neither namer recovered
`restore_planned`, because "restore to default" is a select option, not a flippable state,
so the detector never proposed it.

**Precision is poor.** Of 34 candidates, at most one pointed at a genuinely unnamed second
capability — about **3%**. The two namers disagreed about which ones were noise: A called
the 13 `combobox expanded` candidates false positives (dropdown chrome, not a domain
reversal), B called the 5 `option selected` candidates false positives and folded the
comboboxes into a real capability. Both are right about something: on a real application,
every dropdown, disclosure and menu carries `expanded`, so this detector would emit
candidates roughly in proportion to UI chrome.

**The honest conclusion is that this is not a tooling question at all.** Whether the reverse
of a toggle is its own capability is a governance decision. If the registry needs
`x.undo` to exist, the naming instruction has to say so; no amount of pointing at the
control will produce it, because competent namers are deciding against it on purpose and
with reasons. That is a one-line addition to the naming rules, not a detector.

One accidental benefit worth keeping: the candidate list restored coverage of four day
cards that my own sibling-collapsing had truncated out of the tree, and model B says it
would otherwise have missed the Saturday variant capability entirely. **The list was more
useful as a coverage backstop for my lossy serializer than as a reversal detector.**

---

## 5. What surprised me

**Both of my run-2 recommendations failed.** Two for two. Both were reasoned from a real
finding, both sounded cheap and obvious, and neither survived measurement. The pattern is
the same in both cases: I identified a genuine gap correctly, then proposed the first
mechanism that came to mind and described it as cheap without testing whether it worked.
The gaps are still real. The fixes were not fixes.

**The escalation I asked for was built on an outlier.** 4/56 on one app I wrote, against a
corpus median of 93%. I should have measured the distribution before recommending a
priority change, and the fact that the recommendation was *accepted* makes that worse, not
better.

**A vendor cannot detect this problem from where they stand.** 7 of 19 sites at 100% means
a plausible test suite reports success. That asymmetry — the measurement looks fine from
the SDK's side and is broken on the customer's — is a more interesting reason to observe
from outside than "the numbers are bad", and it only showed up because the corpus was
heterogeneous.

**Self-report inflation is not a constant.** Run 1 measured ~10×, run 2 ~5–9×. Run 3 had
one namer self-report "4–5 minutes" against 194s measured, which is accurate. So the
finding is that self-reports are *unreliable*, not that they are reliably inflated. The
weaker claim is the correct one.

---

## 6. What did not replicate, and why I nearly reported it

On the first pass of the conformance harness, Wikipedia scored 100% at v4 and 96% at v5 —
a more faithful implementation scoring worse. I had a paragraph drafted about the ladder
being non-monotonic.

It did not replicate. On the next run Wikipedia went 94/95/95/97/100/96, and on the run
after that it was monotonic with 0 of 19 sites showing a regression. The cause is that
Wikipedia's comparable element count moved between loads — 677, then 773, then 773 — because
live pages differ between visits. Grafana Play moved 38 to 61 the same way.

The difference was the target, not the finding. Recording it because the near-miss is the
point: a single run against live software produces differences that look like results.
**Anything measured against a live third-party page needs at least two runs before it is
allowed to be a finding**, and that belongs in §9.

---

## 7. Corrections to `instrumentation.md` §9

**Add — two runs minimum against live targets.** See §6. One run cannot distinguish a
finding from page variance, and the variance is large enough to invent effects.

**Add — measure the distribution before setting a priority.** The Q14 escalation came from
n=1. A single application's divergence rate says nothing about the population, and the
population is what a recommendation applies to.

**Sharpen — reachability is better than run 2 suggested.** Run 2 measured 40% of candidate
targets unobservable. This corpus, chosen with reachability in mind, lost 1 of 20. The
criterion should be "screen for reachability", not "expect to lose half".

**Add — a corpus, not a target.** Runs 1 and 2 each generalised from one or two
applications and both over-generalised. Anything claimed about how a technique behaves in
the wild needs a heterogeneous corpus; single-target runs can only produce existence
proofs and counterexamples.

**Retract — the href join and the flippable-state detector.** Both were added to the
recommendations in run 2 on reasoning alone. Both are measured here and neither works as
described. The underlying gaps — undetermined application scope, unnamed reverse
capabilities — remain open, without proposed fixes.

---

## 8. Limitations

- **One browser.** Everything is Chromium's AccName implementation. Firefox and WebKit
  compute names differently in places, so the true divergence facing a cross-browser SDK
  is at least this large and probably larger. Untested.
- **Home pages and a handful of states.** The corpus is mostly landing pages, which are
  link-heavy and control-light. An application's authenticated interior may diverge
  differently.
- **My in-page implementation is not a real SDK.** It is a good-faith reimplementation
  written by someone who had already seen run 1's failure. A vendor SDK optimised for size
  would plausibly do worse than my naive rung, not better.
- **Two namers per condition**, same two models throughout for comparability. The href and
  flip results are n=2, which is enough to show a mechanism fails and not enough to
  characterise how often.
- **The flip detector was tested only on our own app.** That was deliberate — it is the
  only target with known ground truth — but it is also the smallest and simplest possible
  test case.

---

*L2 experiment record. Rig in [`tools/`](../tools) — `accname.js` and `annotate.js` are new
in this run. Run 1: [CAPABILITIES.md](../CAPABILITIES.md). Run 2:
[Q13-RUN2-EXTERNAL-APPS.md](Q13-RUN2-EXTERNAL-APPS.md).*
