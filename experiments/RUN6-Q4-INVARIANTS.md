# Run 6 — the Q4 invariants, run against the derivations we already had

Q4 asks how we know a derived surface is good without hand-inspecting every variant. The
correctness half is now specifiable, because `derive()` is real. Four invariants, written to
be capable of failing, run over **108 derivations** (9 profiles × 4 pinned weekdays × 3 render
targets).

**Three of the four fail. That is the finding, and it is the reason the L3 protocol cannot be
run today.**

---

## 1. Results

| invariant | stage | pass | fail | precondition met |
|---|---|---|---|---|
| **I1a** capability sufficiency — a resolving component was planned | derive | 54 | **54** | 63 |
| **I1b** capability sufficiency — a resolving control is on the surface | render | 54 | **54** | 63 |
| **I2a** a substituted session is not presented as the planned one | derive | 108 | 0 | 9 |
| **I2b** a completed session carries no live unmet-constraint advice | derive | 108 | 0 | 45 |
| **I3** destructive proximity | render | 99 | **9** | 108 |
| **I4** explanation honesty | derive | 62 | **46** | 68 |

### I1 — the surface names a problem and offers no way to fix it

**54 of the 63 derivations that asserted a problem offered no control to resolve it.**

When the derivation is *confident* the planned session conflicts with a flagged joint
(confidence ≥ 0.8, the "act" branch) it renders a paragraph: *"Your knee is flagged and run
loads it. Suggested instead: Foam rolling (30 min)."* — and no control. When it is *less*
confident (0.5–0.8, the "ask" branch) it renders two buttons that actually perform the swap.

**The interaction is inverted.** The more certain the system is that you should not do this,
the less able you are to act on it from that surface. The swap control exists, but it lives
in the weekly grid below, not on the surface making the claim.

This is a straightforward defect and no gate I had before would have caught it. The frame
check passes, the accessibility checks pass, name agreement is 62/62. The surface is correct
in every structural sense and useless in the one that matters.

### I3 — an irreversible action, one click, no confirmation

**9 of 108.** `adaptation.dismiss` — the "Keep as planned" button — permanently suppresses a
safety proposal for that session. There is no UI anywhere to un-dismiss it. It sits directly
beside "Swap it" with identical prominence, and "Swap it" *is* reversible (the swap select
can be set back to "As planned").

So the irreversible option is exactly as easy to reach as the reversible one, and only the
reversible one can be undone. Read straight from the capability registry's `reversible` and
`confirmed` fields, which run 6 added — the invariant is data-driven, not a hardcoded name
list, so it will flag the next irreversible capability without being edited.

### I4 — the explanation names constraints that changed nothing

**46 of the 68 derivations whose explanation named a constraint had at least one constraint
that changed nothing.** This is run 5's finding turned into a gate: a surface that says
*"shown this way because: protecting your shoulder"* above a plan identical to the one shown
to someone with no injury.

The explanation is meant to satisfy ADR 0003's legibility requirement. As implemented it
degrades into a claim of personalisation that the surface does not honour — which is worse
than no explanation, because it is checkable and false.

### I2 — passes, and one half nearly passed for the wrong reason

Both halves pass. But on the first run **I2a's precondition was met zero times**: no profile
in the matrix had an active substitution, so the invariant could not have failed. It was
reported as passing 96/96.

Run 5 taught that a rule which never takes a branch has not been tested on that branch, so
the same standard was applied here: a profile with an active substitution was added rather
than banking the pass. I2a now has 9 opportunities and passes on all of them. **I2b had 45
opportunities from the start and is a genuine pass.**

Every invariant table in this document therefore carries a *precondition met* column. An
invariant with a zero there is not evidence of anything.

---

## 3. Would this gate have caught run 5's defect? Mostly not.

ADR 0013's lesson applies to the gate itself: every structural check passed run 5's surfaces
while the output was one plan with warnings bolted on. So the right question is not "does the
gate fail" — it does, three of four — but **"would it have caught the thing that actually
mattered?"**

Measured rather than reasoned about. Across the six profiles that differ **only** in user
model — excluding profiles that inject domain state by completing or substituting a session,
which would flatter the number by counting variation the derivation did not produce:

| weekday | distinct prescribed activities across 6 different users | distinct headlines including commentary |
|---|---|---|
| Monday | **1** | 3 |
| Tuesday | **1** | 4 |
| Thursday | **1** | 4 |
| Saturday | **1** | 3 |

Every user is told to do the same thing. The variation is entirely in appended sentences:

```
default          Morning: Run (4 miles): conversational pace.
ankle-full       Morning: Run (4 miles): conversational pace. Flagged against your ankle …
novice-20min     Morning: Run (4 miles): conversational pace. Keep the effort conversational.
advanced-full    Morning: Run (4 miles): conversational pace.
shoulder-home    Morning: Run (4 miles): conversational pace.
knee-nothing     Morning: Run (4 miles): conversational pace. Flagged against your knee …
```

**Invariants that examine the prescribed activity: zero.**

So the gate catches run 5's defect only obliquely. **I4** fires on 46 of 68 derivations whose
explanation names a constraint that changed nothing — which is the *symptom*. **I1** fires
when a problem is asserted with no control to resolve it — an adjacent defect. But a surface
that quietly prescribed the identical run to everyone and said nothing about why would pass
all four invariants cleanly.

That is worth stating precisely because it is the failure mode ADR 0013 was written about:
**a structural correctness gate certifies that a surface is not self-contradictory. It cannot
certify that the surface is doing anything.** Those are different claims and the second one
is the one the thesis rests on.

I have not added a fifth invariant for it, for two reasons. It is a **quality** question, not
a correctness one, and Q4 separates those deliberately. And the obvious formulation — "the
derived plan must differ across sufficiently different users" — is a metric over the artefact
of exactly the kind that has now been wrong twice. Writing it would feel like closing the gap
and would mostly move the blind spot somewhere I cannot see it. The honest position is that
this half of Q4 currently has no mechanical check and I do not have a trustworthy one to
propose.

Note also: **79 of 108 derivations fail at least one invariant.** A gate this red is not yet
a regression detector — it is a defect list. It becomes a gate once the defects are fixed and
the expected state is green.

---

## 4. The judgment you asked for: derivation time, render time, or both

**Both, and the split is principled rather than pragmatic.**

| what the invariant asks | when it can be answered |
|---|---|
| Did the solver *decide* something self-contradictory? | derivation time |
| Can the user actually *reach* what the decision implies? | render time |

Concretely:

- **I2 (state fidelity) and I4 (explanation honesty) are pure derivation-time.** They compare
  the plan against the facts. Both are functions of `(facts, plan)` and need no DOM. They
  could run in CI on a matrix of synthetic contexts with no browser at all — which is the
  cheap, fast, exhaustive tier.
- **I3 (destructive proximity) is irreducibly render-time.** It asks how many clicks separate
  an irreversible action from its reversible alternative, and whether either is confirmation
  gated. Those are facts about the rendered document, not about the plan.
- **I1 (capability sufficiency) needs both, and this is the interesting case.** I wrote it
  twice deliberately. `I1a` asks whether the solver planned a resolving component. `I1b` asks
  whether a resolving control is present on the rendered surface. In this prototype they
  agree — both fail 54 times — but **they can diverge in either direction**, and each
  direction is a real bug:
  - plan includes a resolver, render does not → the component failed to build, or was
    dropped by a density budget the derivation-time check does not model.
  - render includes a resolver, plan does not → a control leaked in from static markup that
    the derivation does not know about, so the derivation's model of its own surface is
    wrong.

**The recommendation for the register:** run the derivation-time invariants as the primary
gate, because they are cheap, browser-free, and can be run exhaustively over a synthetic
context matrix rather than a sample. Run the render-time invariants as a smaller confirming
sweep over real renders. **Do not collapse to derivation-time only.** A derivation-time-only
gate would have passed I1 in this prototype — the solver's plan is internally coherent — while
the user had no control to act on, and would never have expressed I3 at all.

There is a third stage worth naming even though nothing here uses it: **post-interaction**.
Whether an adaptation was *accepted* is only observable after the user acts, and that is the
half of Q4 this run does not touch.

---

## 5. What this run does not establish

- **Only the correctness half of Q4.** Q4 separates correctness from quality. Nothing here
  says a surface is *good*, only that it is not self-contradictory. Run 5's blind-judge result
  is the closest thing to a quality check and it is manual.
- **Four invariants is not a complete set.** They were written from Q4's own wording — omitted
  capability, misrepresented state, destructive proximity — plus one (I4) that exists only
  because run 5 stumbled into it. There is no argument that these four are sufficient, and the
  honest expectation is that the next real defect will need a fifth.
- **The invariants encode my judgement about what is material.** I decided that
  `session.substitute_exercise` is the resolving capability for a flagged session, and that
  `adaptation.dismiss` is irreversible. Both are defensible and neither is derived from
  anything.
- **Sampling, not exhaustion.** 108 derivations from 9 profiles × 4 weekdays × 3 targets. The
  real context space is larger. Derivation-time invariants could be run exhaustively; these
  were not.

---

## 6. A correction to run 5

Building the isolation this run needed exposed a defect in run 5's own harness: **profiles
leaked state into each other.** Two profiles mark the morning session complete, and nothing
reset that before the next profile ran, so every subsequent profile in the same weekday — and
every profile in the following render target — derived against a partly-completed week.

Corrected figures, with a `__datuxResetState` hook isolating each profile:

| figure | run 5 reported | corrected |
|---|---|---|
| derivations that asked rather than acted | 23 / 96 | **9 / 96** |
| components rendered, reader-first | 147 | **126** |
| components rendered, large-type | 124 | **120** |
| frame: controls that moved | NONE | NONE |
| headlines clipped | 0 / 96 | 0 / 96 |
| non-composition violations | NONE | NONE |

**Run 5's conclusions are unaffected** — the accessible variant still costs zero renderer
branches, the frame still holds, the non-composition invariant still holds — but two of its
numbers were wrong and are corrected here rather than left in place.

This is the fourth consecutive run in which an uncontrolled variable produced a wrong number.
Live page content (run 4), the calendar (run 5), and now harness state carried between
iterations. The pattern is consistent enough to state as a rule rather than an anecdote:
**anything that persists between measurements is an experimental input, including the state
your own harness leaves behind.**

---

*Companion to [L3-PROTOCOL.md](L3-PROTOCOL.md). Gate: `tools/invariants.js`.*
