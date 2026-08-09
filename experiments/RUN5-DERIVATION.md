# Run 5 — the smallest real derivation

Four runs went into instrumentation. This one builds the thing instrumentation exists for:
one surface produced by `derive(domain state, capabilities, context, user)` rather than
authored. Strategy A from Q2 — a constraint solver over a fixed component library, no model
called at render time.

Everything below was measured across **96 derivations** (8 user profiles × 4 pinned
weekdays × 3 render targets), replicated three times with identical results.

---

## 1. Did strategy A express meaningful per-user difference?

**Yes, but the honest answer is narrower than the headline number, and I nearly reported the
flattering version.**

| measure (standard target, weekday pinned to Tuesday) | result |
|---|---|
| distinct component sets across 8 profiles | **7 of 8** |
| distinct rendered text across 8 profiles | 7 of 8 |
| lowest pairwise component overlap | **0.40** |

Across all four pinned weekdays: **10 distinct component sets from 32 profile-days**, with
the explanation line excluded from the comparison so it could not inflate the count.

Concretely, two people on the same Tuesday get:

- *time-poor novice, home equipment* — the run flagged as 40 minutes against a 20-minute
  budget, an equipment gap on the pool swap, the session structure expanded, the easy-mandate
  guideline in full, and an explanation naming all three constraints.
- *advanced, full facilities* — the prescription, and nothing else. Three components against
  five, and a smaller density budget by construction.

That is material rather than cosmetic: different *components*, not the same components
reworded.

**But two caveats do real damage to the strength of that claim.**

First, **most of the variation comes from a small number of high-signal predicates.** The
protection constraint and the equipment constraint do nearly all the work; experience level
mostly moves the density budget by one, which changes what survives at the margin rather
than what the surface is about. A constraint solver expresses difference well where the
domain has hard constraints and poorly where it has soft preferences.

Second — and this is the part I got wrong first — **the weekday was an uncontrolled
variable.** My first measurement said 3 distinct component sets from 6 profiles and made
strategy A look rigid. The reason was that the run happened on a Sunday, and Sunday's
morning session is golf, which loads no joint, so *every* protection profile collapsed to
the same surface. Pinning the weekday and re-running moved it to 7 of 8. The rigidity I was
about to report was an artefact of the calendar. Run 4's lesson generalised further than I
expected: **pin every input you are not varying, including the ones that arrive from the
environment rather than from your test.**

**Verdict on Q2 strategy A: not too rigid for this task.** The failure mode it was suspected
of did not appear. What did appear is that its expressiveness is proportional to how much of
the user model is *constraints* rather than *taste* — see §3.

---

## 2. Did the accessible variant fall out for free?

**Yes, and this is the cleanest result in the run.**

| measure | result |
|---|---|
| conditionals on the render target inside the renderer | **0** |
| references to the render target inside any component | **0** |
| references to the render target inside the solver | 3 |

The three solver references are `densityBudget` and the disclosure default — exactly the two
dimensions ADR 0004 permits derivation to vary. The renderer walks the plan and emits DOM;
it never asks which target it is in. Components are target-blind by construction: none of
them receives the target at all.

The render target is an **input to `derive()`**, not a switch in the renderer. That is the
whole trick, and it is why there is no second code path:

| target | components rendered across 32 profile-days | expanded |
|---|---|---|
| standard | 126 | 0 |
| large-type | 124 | 0 |
| reader-first | 147 | 147 |

Large-type gets *fewer* components because larger text means a smaller density budget — the
solver drops the lowest-scoring ones rather than overflowing. Screen-reader-first gets more
components and expands every disclosure, because there is no visual density constraint to
respect. Nothing was authored twice.

**The honest limit on this claim.** "Screen-reader-first" here means no density ceiling, all
disclosure expanded, explanation always present. That is a real and useful variant, and it
is genuinely free. It is *not* proof that any accessibility target is free. A target needing
different **ordering** would still be fine — ordering is a permitted dimension — but one
needing different *components* or a different *interaction model* (a voice flow, say) would
require components this library does not have. What run 5 shows is that accessibility as
**density and disclosure** is a derivation output. Accessibility as a different modality is
untested.

---

## 3. Where did the constraint solver stop being expressive enough?

Four places, in increasing order of how much they matter.

**Confidence thresholds are hand-set numbers.** `protectionConfidence` returns 0.9 for an
endurance session loading a flagged joint, 0.65 for a skill session, 0.15 otherwise. Those
came from my judgement, not from data. The three-move rule works — across 96 derivations it
acted, asked 23 times and fell back to the default 32 times — but *where the boundaries sit*
is exactly what a learned policy (Q2 strategy B) would supply and a solver cannot. This is
the clearest hand-off point in the whole prototype.

**Scoring is a fixed integer per component.** Relative priority is authored once and does not
respond to the user. A person who always dismisses the guideline should see it sink; nothing
in strategy A can express that without becoming strategy B.

**The component library bounds the output space, exactly as Q2 predicted.** Every surface is
a subset of eight components. The solver chose well within that set and could not have
produced a ninth thing. For this task that was sufficient; the constraint bites the moment
someone wants a surface the library does not contain.

**Language is where it actually breaks.** Component text is templated, so the *prose* is
authored even when the *selection* is derived. "Your ankle is flagged and run loads it" is a
string I wrote with two slots. A genuinely per-user explanation — the right register for a
novice versus an advanced athlete, or a sentence that references what the user did last week
— is not expressible as a template and is the strongest argument for strategy D (LLM offline,
cached per user-context class) that this prototype produced. Notably that is a content
problem, not a layout problem, which is the opposite of where I expected the solver to fail.

---

## 4. Did holding the frame cost anything real?

**Less than expected, and the reason is uncomfortable.**

| measure | result |
|---|---|
| persistent controls that moved across 96 derivations | **NONE** |
| derivations whose headline was clipped by its fixed height | **0 of 96** |

The frame held, verified by the same geometry gate that caught a real violation in run 1.
Two design concessions bought it:

1. **The action row sits above every derived region.** Controls come immediately after the
   headline; all derived content is below them. Nothing the solver does can push a control.
2. **The derived headline has a fixed clamped height**, two lines, rather than a minimum.

Concession 1 is the real cost and it is a genuine one: **the interface now leads with
controls and explains itself afterwards.** A person meets "Done / Morning done / Night done"
before they have read why the session was flagged. That is worse reading order in exchange
for stable motor memory, and ADR 0004 makes that trade deliberately — but it is a trade, and
on a small surface it is visible.

Concession 2 cost nothing measurable: **zero clipped headlines in 96 derivations**. I would
have reported that as "the frame is free" if I had not looked at why. It is free because my
headline template is short, not because clamping is harmless. A longer template, a longer
language, or a user model that produces more caveats would start truncating immediately, and
the clamp would silently eat content rather than reflow. **The cost is deferred, not
absent**, and a fixed-height region is a content bug waiting for a translator.

So: ADR 0004's concession is cheap on this surface and I do not think that generalises. What
would test it is a surface where the derived content genuinely varies in length — which this
one does not, because I wrote the templates to fit.

---

## 5. The non-composition invariant

ADR 0008 forbids user preferences that compose. Rather than describe the rule, it is checked:
`assertNonComposing` requires every preference to be a plain string drawn from its own fixed
enum, and requires that no undeclared key exists. A rule, a conditional, or a reference to
another preference cannot survive that check because none of them is a string from the enum.

**Violations across 96 derivations: none.** That is a weak result — the invariant holds
because there is no syntax with which to break it, which is the point of enforcing it
structurally. The check earns its place the first time someone adds a preference that takes
an object.

---

## 6. What surprised me

**The solver's weakness was in language, not layout.** Q2 frames the risk as "too rigid to
express real personalization", and I expected to hit that on structure. Structure was fine.
What a fixed component library cannot do is *say things differently to different people*,
and that is a content problem that a layout solver was never going to solve.

**The accessible target being free felt like cheating until I checked why.** Zero renderer
branches is a real result, but it holds because I put the target into the solver's density
and disclosure decisions — which is precisely what ADR 0004 already said derivation may
vary. The architecture did not make accessibility free; ADR 0004 did, by scoping the problem
to the two dimensions where it is free. That is a real win and a smaller claim than "the
layer produces any rendering target".

**My first expressiveness number was wrong in the direction that would have hurt the
thesis**, not helped it, and I still nearly shipped it. The uncontrolled weekday made
strategy A look rigid. I have now been caught by an uncontrolled environmental variable in
runs 3, 4 and 5, each time in a different disguise.

**Adding a derived surface broke my own accessible-name implementation.** The new preference
selects use a `<label>` that wraps its own control, and the SDK pulled the control's value
into the name — computing "Equipment available Full facilities" where Chromium computes
"Equipment available". Name agreement dropped from 62/62 to 57/62 and the run-1 self-check
caught it. That is the same defect class as run 4's invented select name: **a
reimplementation over-collects exactly as readily as it under-collects**, and both directions
produce a plausible-looking wrong name.

---

## 7. What this does not show

- **One surface.** Everything here derives the Today panel. The weekly grid is still
  hand-authored, and the interesting question — whether a whole application can be derived —
  is untouched.
- **Eight components.** A library that small cannot fail in the ways a real one would.
- **No learned policy, no propensity logging.** ADR 0006 requires `derive()` to log action
  propensities and be swappable as a policy. This one is swappable in principle — it is a
  pure function of four inputs — but it logs decisions, not propensities.
- **The user model is five scalars.** Real relevance signals arrive from behaviour, and this
  prototype has none of that plumbed in even though the attempt stream exists next to it.
- **Reader-first is a density-and-disclosure variant**, not a genuinely different modality.
- **Templated prose**, per §3.

---

## 8. Corrections to §9

**Add — pin environmental inputs, not just the target.** Run 4 established pinning the page.
Run 5 shows the same failure through the calendar: the weekday selected which activity was
planned, which decided whether any protection constraint could fire. Anything reaching the
system from the environment — date, locale, viewport, time of day — is an experimental input
and must be fixed explicitly.

**Add — check that every branch of a decision rule is reachable before reporting it works.**
The act/ask/default trichotomy read as "0 asks in 96 derivations" until I noticed the ask
band was unreachable, because the primary session is always the first incomplete one and
every morning session is endurance. Two profiles that complete the morning first exercise it.
A rule that has never taken a branch has not been tested on that branch.

---

*L2 experiment record. Rig in [`tools/`](../tools) — `derivecheck.js` and `nameprobe.js` are
new in this run. Previous runs: [CAPABILITIES.md](../CAPABILITIES.md),
[Q13-RUN2-EXTERNAL-APPS.md](Q13-RUN2-EXTERNAL-APPS.md),
[Q13-RUN3-CONFORMANCE.md](Q13-RUN3-CONFORMANCE.md),
[RUN4-CROSS-ENGINE-ACCNAME.md](RUN4-CROSS-ENGINE-ACCNAME.md).*
