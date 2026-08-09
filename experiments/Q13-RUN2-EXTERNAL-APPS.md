# Q13 run 2 — capability modelling against software we did not write

Run 1 ([CAPABILITIES.md](../CAPABILITIES.md)) built an app and then named its capabilities,
which voided the measurement Q13 actually asked for. This run fixes that: the rig was
pointed at two real, public applications that nobody at Datux Labs built, wrote, or
influenced.

Everything below is measured. Nothing was written to either service.

---

## 1. The finding, first

**The accessible name is the entire signal. The role is almost worthless for capability
discovery.**

Same model, same application, same prompt, one variable changed:

| condition | what the namer saw | capabilities produced |
|---|---|---|
| FULL | role + accessible name | **19** |
| NAME_ONLY | names kept, roles flattened to `generic` | **22** |
| ROLE_ONLY | roles kept, names removed | **3** |

Removing every semantic role cost nothing — the namer produced *more* capabilities and a
model of comparable quality. Removing the names destroyed 84% of the model, and the namer
said the three survivors were only namable because of URLs that leaked in through the
state headers I wrote. Without that leak the honest answer in ROLE_ONLY is close to zero.

`instrumentation.md` §3 argues for the accessibility tree on the grounds that "a role plus
an accessible name is a vastly better telemetry primitive than a CSS path." The direction
is right and the measurement narrows it: for *discovering capabilities*, it is the name
doing all the work. Roles still matter for typing a `surface` and for knowing what kind of
thing was operated, but they contribute essentially nothing to naming what the user was
trying to do.

**This makes run 1's accessible-name finding considerably more serious than it looked.**
Q14 records that a good-faith in-page SDK reproduced the browser's accessible names on
4 of 56 controls. At the time that read as one dimension of the envelope being corrupted.
If the name is the whole capability signal, a systematically wrong name is not a degraded
`surface` field — it is the loss of the only channel that carries capability meaning. The
conformance-test recommendation in Q14 should be treated as blocking, not advisory.

---

## 2. Method

**Target selection was measured, not guessed.** Ten public applications were screened by
loading them and computing, over all elements a user could plausibly act on, the fraction
exposing an actionable accessibility role, the fraction with a non-empty accessible name,
and the count of `div`/`span` click targets with no role at all.

Four of the ten could not be observed by an automated anonymous visitor at all — two
Cloudflare interstitials, one expired SSL certificate, one navigation error. That is a
practical finding in itself and it is not in §9: **40% of candidate public targets were
unobservable**, and none of them failed for reasons related to their accessibility.

Of the six that loaded, two were chosen at opposite ends of the measured range:

| target | states | interactive elements | actionable role | non-empty name | div-soup click targets |
|---|---|---|---|---|---|
| **GOV.UK** | 5 | 485 | **67%** | 70% | 6–20 per state |
| **Grafana Play** | 6 | 1061 | **32%** | 39% | 47+ per state |

Both meet the §9 criteria: genuine failure modes, a capability reachable two ways, and
reversible actions. Neither was built here.

**What was done to the live services.** Only GET navigations and non-destructive UI
interactions. No account, no credentials, no form submitted to any lookup backend, no
content created, edited, deleted or restored. Open Food Facts was screened and then
**dropped** after it returned a rate-limit page stating that anonymous bulk access is not
available and pointing bots at its data dumps; that request was respected rather than
worked around, which is why the poor-markup slot is Grafana Play — a purpose-built public
demo — rather than a production service.

**Blind naming.** Serialized trees (role, accessible name, value, ARIA state; tag names,
ids, classes and `data-*` stripped) were given to independent agents forbidden from
reading any other file, fetching any URL, or visiting the application. Six runs: two
models on each target's full tree, plus the two ablation conditions. A **grounding check**
was added to the prompt this time, requiring each namer to declare any capability it could
not point to a line for, and any outside knowledge it used.

**Sighted ground truth** was built by driving each application and recording what
observably happened — URL change, network calls, HTTP status — rather than by reading
source. Verified on GOV.UK: search from two separate surfaces, remove-one-filter,
clear-all-filters, pagination. Verified on Grafana Play: dashboard search, starred filter,
open dashboard, change time range, refresh.

---

## 3. The number Q13 asked for

**Measured wall clock to draft a capability model from the accessibility tree alone:
3.4 to 4.9 minutes.** Six runs: 202s, 224s, 226s, 264s, 276s, 292s.

Output at that cost: 18–19 capabilities for GOV.UK, 37–41 for Grafana Play, each with
cited evidence, granularity reasoning, and an explicit unknowns list.

**Did the drafter need to be an engineer? No.** All six runs, asked independently, said a
non-engineer could produce the same thing, and the reasoning was consistent across models
and targets: the tree is plain English, and the hard parts are taxonomy judgement and
restraint, not engineering. One run made the sharper point that a non-engineer's model
would be *more* accurate, because it would mark as unknown the things an expert fills in
from memory. Against `prior-art.md` H5, for the drafting step, this now holds on software
the drafter did not write.

**Self-reported time was wrong again, in the same direction.** Reports were "~20 minutes",
"~25 minutes", "~25–35 minutes", "~30-minute-equivalent", "~45 minutes" against measured
times of 3.4–4.9 minutes: inflation of roughly **5× to 9×**. Run 1 measured ~10×. Two
independent runs, two different sets of targets, same result. Do not collect this by survey.

---

## 4. Does the zero-agreement result replicate?

**Partially — and where it doesn't, the reason is useful.**

| comparison | model 1 | model 2 | exact id matches | agreement |
|---|---|---|---|---|
| Run 1 — Personal Trainer | 6 | 6 | 0 | **0%** |
| Run 2 — GOV.UK | 19 | 18 | 0 | **0%** |
| Run 2 — Grafana Play | 41 | 37 | 9 | **13%** |

So the extreme result does replicate on one target and softens on the other. Measured
inter-namer agreement across three applications is **0% to 13%**, which sits right on top
of the Furnas et al. figure for spontaneous term agreement. The vocabulary problem
reproduces at the capability-naming layer at the same order of magnitude, on real software,
with the naming convention supplied to every namer.

**What drives the difference is worth having.** Grafana names its own domain objects in its
interface — "Dashboards", "Panels", "Explore", "Query history" — so both namers reused
those nouns and converged on `dashboard.browse`, `dashboard.search`, `dashboard.filter`,
`dashboard.sort`, `dashboard.view`, `dashboard.share`, `dashboard.edit`, `panel.view`,
`assistant.open`. GOV.UK names no software objects anywhere in its UI, so both namers
invented, and invented differently.

That gives a cheap, checkable predictor: **a registry can be partly seeded from a product's
own UI nouns wherever the product has them, and not at all where it doesn't.**

**But there is a worse disagreement underneath the naming one, and it is new.** On GOV.UK
the two namers did not merely choose different strings for the same concepts — they
modelled *different products*.

- Model A produced `passport.renew`, `passport.replace`, `vehicle.tax`,
  `national_insurance_record.check`, `job.search_and_apply` — a model of the **government
  services the site describes**.
- Model B produced `search.execute`, `search.paginate`, `nav.toggle_menu`,
  `guide.toggle_step`, `page.rate` — a model of the **web application**.

Both are defensible readings of the same tree. Their union is not a capability model, it is
two capability models of two different things. Agreement was 0% because they were not
answering the same question, and nothing in the accessibility tree told either one which
question was correct.

**The mechanism is concrete and fixable-ish: the accessibility tree does not carry link
destinations.** A `link "Tax your vehicle"` is indistinguishable from a button that taxes
your vehicle. Model A said so itself, listing "whether linked services are implemented by
this application, merely described by it, or hosted elsewhere" as its first unknown. On a
content-heavy site this is not an edge case — it is most of the interface, and it turns a
capability model into a domain taxonomy. Any real bootstrapper must join the accessibility
tree to `href` targets and same-origin checks. That information is in the DOM and is
trivially available; it is simply not in the accessibility tree.

---

## 5. Does the reversal blind spot replicate?

**No — and run 1's framing was wrong. I need to correct it.**

Run 1 reported that all four blind runs missed `session.reopen` and
`session.restore_planned`, and I generalised that to "a bootstrapped registry will be short
exactly those capabilities whose absence hides correction and undo signals."

GOV.UK has two reversals that are not toggles: `link "× Remove filter Topic: Government"`
and `link "Clear all filters"`. Both were behaviourally verified — clicking each drops the
`level_one_taxon` parameter from the URL and re-runs the search.

Model B named both, separately, at high confidence, with explicit reasoning: *"Surgical
single-filter removal vs mass clear represent different user actions with different
semantic weight. A user who clears all has abandoned a filter strategy; a user who removes
one is refining it."* That is a better argument for splitting than the one I made in run 1.

Model A and the NAME_ONLY run both folded them into a broader capability — but they folded
*everything* search-related in, including sorting, pagination and spelling suggestions.
That is a coarse-granularity choice applied uniformly, not a blind spot at reversals.

**The corrected finding: it is a control-sharing blind spot, not a reversal blind spot.**

The four run-1 misses were both cases where the reverse action shares a control with the
forward action — the second press of a toggle button, the "As planned" option of the same
select. When a reversal has its **own named control**, namers find it and name it. When it
is the second state of a shared control, they model it as an attribute, and in run 1 they
did so even when `aria-pressed` was visible and they had correctly identified the control
as a toggle.

That is a sharper claim, it is more actionable, and it comes with a mechanical detector:
**any control whose ARIA state can flip — `aria-pressed`, `aria-checked`, `aria-expanded`,
`aria-selected` — is a candidate site of a second, unnamed capability.** That set is
enumerable from the tree, so the gap can be flagged automatically for a human to resolve
rather than discovered later by its absence from the data.

**A second, unrelated coverage failure did show up, and it is worse.** Grafana Play has a
`Recently deleted` view with restore and permanent-delete. Both namers found and named the
*view* (`dashboard.view_recently_deleted`, `dashboard.recently_deleted.view`). Neither
named restore or permanent-delete, and neither was wrong to omit them: the page was in its
empty state, so those controls were not rendered, so they were not in the tree.

**Capability coverage from an accessibility tree is a function of which states you happen
to capture, and empty states hide capabilities.** This is a structural limit on
autocapture-style bootstrapping that no amount of good markup fixes, and it lands hardest
on exactly the destructive and recovery capabilities that matter most.

I also could not verify restore or permanent-delete behaviourally, because operating them
on a shared public demo is not mine to do. Which is its own finding — see §7.

---

## 6. How badly does poor markup degrade it?

Two answers, and they disagree with the assumption in `instrumentation.md`.

**Real-world comparison.** GOV.UK (67% actionable roles) yielded 18–19 capabilities from
5 states. Grafana Play (32%) yielded **37–41** from 6 states. The application with half the
role coverage produced roughly twice the capability model. Markup quality did not predict
model richness at all here — application complexity did, and Grafana is simply a much
denser product. Any claim that poor accessibility semantics degrades capability discovery
is not supported by this comparison.

**Controlled ablation**, which isolates the variable properly, is in §1: roles removed cost
nothing; names removed cost 84%. Combined with the real-world comparison, the conclusion is
consistent — role coverage is not the thing that matters. Name coverage is.

Note that this is exactly the degradation profile of a real poor-markup application. Open
Food Facts, before it was dropped, measured 21% actionable roles but 60% non-empty names:
divs pretending to be buttons still carry their text, so they still get names. The common
real-world failure mode is the one that costs least.

**On the co-occurrence claim.** `instrumentation.md` §3 asserts that a missing role is
itself a signal, "since bad accessibility semantics and bad UX tend to co-occur." This rig
cannot test that, and I want to be explicit rather than let it pass. I measured markup
quality and capability-model quality. I did not measure UX quality, and nothing here speaks
to whether Grafana Play's 32% role coverage corresponds to worse user outcomes. Testing it
needs an outcome measure — task success, abandonment, repair rate — on the same surfaces,
which is a different experiment. The claim should stay flagged as unevidenced.

---

## 7. What surprised me

**I contaminated my own experiment, and the grounding check caught it.** My capture format
wrote `(reached at: https://play.grafana.org/...)` into each state header. One namer used
it to identify the application and said so, listing exactly where prior product knowledge
shaded its model. The ROLE_ONLY namer went further and said the URLs were its *only*
semantic grounding once names were gone.

Removing the URLs would not fix it. Real applications cannot be de-identified from their
accessibility trees — "Grafana Assistant", "GOV.UK", "Universal Credit" are in the names,
and the names are the signal. **Any LLM-based capability bootstrapper is permanently
contaminated by prior knowledge of popular products.** That inverts something I assumed
last run: the bespoke app in run 1, which I dismissed as a voided measurement, is actually
the *cleaner* one for internal validity. Bespoke targets give uncontaminated measurement;
real targets give external validity; the two cannot be averaged and both are needed.

Adding the grounding-check question cost one paragraph of prompt and was the highest-value
change in this run. It should be standard.

**Naming is not stable within a single namer.** Same model, same application, same prompt,
input perturbed only by flattening roles: **28% agreement with itself** (9 identical ids
out of 19 and 22). The instability that produces 0–13% between namers is not mostly about
different namers having different taste. A single namer re-run on a trivially different
view of the same product keeps under a third of its own vocabulary. Governance cannot be
"have one good person name things once."

**A real permission failure fell out for free.** Clicking Grafana Play's "Starred" filter
anonymously returned **HTTP 403**. That is a genuine, ethically triggerable failure on
someone else's live system — no fabricated input, no destructive action, no account. It is
the single most useful property a third-party testbed can have, and I did not anticipate it.

**The click stream is already there and already useless.** Every action on Grafana Play
fired third-party analytics — `POST /v1/track`, `POST /transform`, `POST /g/collect`. The
product is thoroughly instrumented. None of those events carry which capability was
attempted or whether it succeeded. The contrast the thesis describes is not hypothetical
and can be demonstrated on a live production application in about ninety seconds.

---

## 8. Corrections to `instrumentation.md` §9

§9 is one run old and was written from a bespoke testbed. Against real software:

**Holds.** "A capability reachable two ways" is a good criterion — GOV.UK search from the
home hero and from the results-page header was verified, and it is what makes `surface`
non-degenerate.

**Add — observability gate.** The target must be reachable by an automated anonymous
visitor. 4 of 10 candidates failed on Cloudflare interstitials, an expired certificate, or
navigation errors. Screen for this first; it is the cheapest disqualifier and it dominates.

**Add — permission failure beats validation failure.** For third-party targets, prefer an
app with a capability that fails on *authorization* under anonymous access. It is the only
genuine failure you can trigger without fabricating input or damaging someone's data.
Grafana Play's 403 is the model case.

**Add — destructive and recovery capabilities can be observed but not verified.** You may
not operate delete, restore, or permanent-delete on someone else's live service. Any
external study will therefore carry an inferred tail exactly where the highest-value repair
signals live. Plan for it; do not pretend it away.

**Add — coverage is a function of captured states, and empty states hide capabilities.**
Grafana's restore and permanent-delete were invisible because the recently-deleted list was
empty. Capture states with content in them, and treat an empty collection as a known blind
spot rather than evidence of absence.

**Add — content-heavy sites are poor targets.** Where most of the interface is links to
other systems, the accessibility tree cannot distinguish "this product does X" from "this
product links to X", and the resulting model is a domain taxonomy. Either avoid such
targets or join the tree to `href` and same-origin data before naming.

**Add — an anti-criterion on contamination.** "Prefer software the namer has not memorised"
is unachievable for real popular products when the namer is an LLM. State which validity
you are buying with a given target and do not mix the two.

**Sharpen — markup quality is the wrong screening metric.** §9's implicit assumption that
accessibility quality gates capability discovery is not supported. Screen on **accessible
name coverage**, not role coverage. Role coverage is close to free.

---

## 9. Limitations

- **Two applications.** Enough to show the zero-agreement result is not universal; not
  enough to characterise when it holds. The GOV.UK/Grafana split suggests the predictor is
  whether the product names its own domain objects, which is a hypothesis, not a result.
- **The namers are LLMs, not people.** The claim "a non-engineer could do this" is
  self-reported by all six runs and is not a human study. It is consistent, and it is still
  self-report from the same class of system whose time estimates are wrong by 5–9×.
- **Contamination is real and unfixable here** — see §7.
- **The ablation ran on one target with one model.** The 19 → 3 collapse is a single clean
  measurement, not a distribution.
- **The sighted ground truth is partly mine.** I designed the interactions and I read the
  results, on applications I do not own, without the ability to operate their destructive
  paths. It is behavioural evidence, not a specification.
- **Sibling runs were collapsed** in the serialization to keep artifacts readable. The
  collapse is announced inline, and several namers correctly listed the omitted nodes as a
  known gap in their coverage.

---

*L2 experiment record. The rig that produced this is in [`tools/`](../tools). Run 1 is in
[CAPABILITIES.md](../CAPABILITIES.md).*
