# Run 9 — the injury-reversal path, and an invariant that passed on the bug

The founder review found a blocker in run 7's report that **two of us had
already looked directly at and filed as a design tension**: reverting an injury
adaptation hands back the session that loads the flagged joint.

It is correct under ADR 0003. It is also unsafe the moment a real person with a
real injury is in the loop. This run fixes it, and the fix produced a sharper
finding than the fix itself.

---

## 1. The headline: I wrote an invariant for the defect and it passed on the defect

I6 was written to stop the gate certifying this forever. The first version
checked the revert control's **accessible name** for the restored activity and
the constraint it re-violates. I ran it against the previous commit before
accepting it.

**It passed 108/108 on the defective code.**

The reason is worth stating exactly. The old control was:

```
button text : "Use the planned session instead"
aria-labelledby -> "Changed to Easy swim (20–30 min) because you flagged your
                    ankle, and Run (4 miles): conversational pace loads it."
```

So the accessible name already contained "ankle" and "Run (4 miles)". Both
tokens present, invariant satisfied, defect untouched. The old name described
**what had already happened**; the requirement was about **what pressing it
would do**. Token presence cannot distinguish tense, and no amount of care
inside a token check fixes that.

This is the same shape as every prior measurement failure in this project, one
level further in: the previous instances were metrics blind to the artefact,
this one is *an invariant blind to the defect it was written for*. And it would
have shipped as a green gate — the most unexaminable kind of number, because
green reads as an absence of problems rather than as a claim someone made.

**What caught it was a single discipline: run the new gate against the known-bad
state before trusting it.** Not review, not reasoning, not care. If I had run it
only against the fixed code I would have reported "I6 passes, the defect is
gated" and been wrong in a way nobody downstream could have detected.

### I6 v2

The property that actually separates the two versions is that **the control is
self-describing**. A button read aloud in a screen reader's forms list, or
scanned visually, or truncated, must say what it does without borrowing sense
from the paragraph beside it. So I6 v2 checks the control's own label text, and
requires the accessible name to carry it too.

| | I6 v1 | I6 v2 |
|---|---|---|
| pre-fix code | **108 pass / 0 fail** — useless | **87 pass / 21 fail** |
| fixed code | 108 pass | **108 pass** |
| precondition met | 21 | 21 |

## 2. The defect, precisely

Not "the app failed to warn." The old accessible name did mention the ankle. The
defect had two parts, and the second is the interesting one:

1. **The disclosure was past-tense.** It explained a change already made, not
   the change about to be made.
2. **The label's connotation ran opposite to its consequence.** "Use the
   planned session instead" — *planned* means intended, vetted, official,
   correct. The most authoritative-sounding option was the one that re-injures
   you.

Both blind readers found (2) independently and unprompted:

> "It isn't asking you to override a safety measure; it's asking you to restore
> the *proper* course of action. ... injury creates anxiety about falling behind
> a plan. The word 'planned' exploits that anxiety." — judge B

> "'Planned' sounds intentional, correct, authoritative, and previously
> approved. ... Default bias and authority bias could make an injured person
> trust the 'real plan' and discount the adaptation." — judge A

This is a cousin of run 6's I1 inversion — *the more certain the system is that
you shouldn't do this, the less able you are to act on it* — in a different
costume. Here: **the more harmful the action, the safer its label sounded.**
Both arise the same way. Nobody writes a label thinking about its connotation
relative to its consequence; the wording is chosen to describe the *mechanism*
("go back to the plan"), and the mechanism's neutral vocabulary happens to carry
an endorsement.

## 3. The fix: disclosure, never friction

ADR 0003 is not negotiable and `data-layer.md` is explicit that the answer is
not to weaken the revert. So:

- **No confirmation dialog. No second click. No dulled affordance.** One click
  each way, verified by round-trip.
- The consequence is modelled in the data layer (`revertRestores`,
  `revertReViolates`) rather than assembled inside one component's string, so
  anything offering the revert can read it and the gate can check it.
- The control names what it restores and what that costs, in its own label.
- `adaptation.revert` is **not** marked `destructive`. It is reversible, and
  marking it destructive would make I3 demand a confirmation — friction
  introduced to satisfy a gate rather than to help anyone.

Before and after, from the real Chromium accessibility tree:

```
BEFORE  visible: "Use the planned session instead"
        ax name: "Use the planned session instead Changed to Easy swim (20–30 min)
                  because you flagged your ankle, and Run (4 miles): conversational
                  pace puts load on it."

AFTER   visible: "Switch to Run (4 miles), which loads your ankle"
        ax name: "Switch to Run (4 miles), which loads your ankle"
```

Visible text and accessible name are now identical, which is the strongest form
of the self-describing property: there is no gap between what a sighted user
reads and what a screen-reader user hears.

## 4. The outside read changed the fix

Per the standing rule, two blind readers saw both variants before any number was
reported. Both picked the fix. Both then found the same top defect in it, which
I had not seen:

> "'Loads your ankle' appears in the header, in the button, and in the paragraph
> below the button. By the third occurrence, it's wallpaper." — judge B

> "'Which loads your ankle,' 'the ankle you flagged,' and 'You can change your
> mind at any time' create deliberate friction. ... the final reassurance sounds
> patronizing." — judge A

**My first pass disclosed the consequence three times.** Saying it three times
is a way of discouraging the action — which is precisely the pressure ADR 0003
forbids, arrived at while trying to satisfy a safety requirement. The invariant
was satisfied at the first occurrence; the other two were mine.

So the second pass removed the dedicated paragraph, dropped the `aria-labelledby`
indirection, and removed "planned" from the label. What remains states it twice,
doing two different jobs: the explanation says *why the app changed the plan*
(ADR 0003 legibility), the control says *what pressing it costs*. One reader
wanted it down to a single mention; I kept the explanation, because dropping it
trades a legibility requirement for a redundancy complaint.

Reversibility is now demonstrated rather than asserted: after pressing, the same
control reads "Switch to Easy swim (20–30 min), which avoids your ankle". Showing
the undo in place is better than a sentence promising one exists.

## 5. What two readers found that the green gate does not see

I6 passes on all 108 derivations. These are all live:

1. **"Loads your ankle" is vague as a severity signal.** "It says there is load;
   it doesn't say how much. A user might reason 'conversational pace sounds
   light, maybe it's fine.'" The system has a confidence number it does not
   surface.
2. **No middle option.** The panel is binary — swim or run. "A user recovering
   from an ankle injury might want to modify the run (shorter, slower) rather
   than abandon it entirely." Same root as run 7's finding that swap options are
   identical for every user.
3. **The button label is long and wraps on a narrow screen**, which breaks its
   affordance as a single action.
4. **The explanation sentence is malformed.** "your ankle is flagged and Run (4
   miles): conversational pace loads it" — the embedded colon "reads like a
   concatenation of two UI strings, not prose." That string comes from run 8's
   generated cache, and run 8's `langcheck` passed it.

None of these are gated, and I am not writing invariants for them. Four runs of
evidence now say that a rule written immediately after being caught by it is the
condition that produces a bad rule — and this run adds the sharper version: a
rule written immediately after being caught *can pass on the very defect that
prompted it*, which is worse than not writing it, because it converts an open
problem into a green check.

## 6. Verification

| check | before | after |
|---|---|---|
| I6 consequence disclosure | **21 fail / 108** | **0 fail / 108** |
| I6 precondition met | 21 | 21 (not vacuous) |
| full Q4 gate | 21/108 failing | **0/108**, 432 derive + 432 render |
| clicks to revert | 1 | **1** (unchanged) |
| clicks to undo the revert | 1 | **1** (unchanged) |
| confirmation dialogs added | — | **0** |
| accessible-name agreement | 63/63 | **63/63**, 0 unnamed |
| visible text == accessible name on the revert control | no | **yes** |
| frame (ADR 0004) | NONE moved | **NONE moved** |
| clipped headlines | 0/96 | **0/96** |
| non-composition (ADR 0008) | clean | **clean** |
| run 8 language gate | 0 failures | **0 failures**, 147/147 cached |

## 7. Declarations

**Gate edited in the same pass as the code.** One invariant added (`I6-render`),
none changed, none weakened, no threshold moved. **Would a rename alone have
turned it green?** No — I6 reads the adaptation's own facts, not component ids
or label strings, and its precondition uses fields that predate this run's fix
specifically so it could fail on the old code. It does: 21/108.

**One instrument bug found and fixed mid-run.** The opportunity counter reported
I6's precondition as met 0 times — "NEVER TESTED, invariant is vacuous here" —
while I6 was plainly running. The row assembly at `invariants.js:263` never
copied the flag out of the in-page result. Reported here because a *vacuity
warning that is itself broken* is the worst failure mode this harness has: it
would have made a live invariant look dead, and the fix for a dead invariant is
to delete it.

**Also a stale probe.** My accessible-name probe found the control by matching
"planned" in its name. Removing "planned" from the label made the probe report
"no revert button found" — my second false negative from a selector this week.
Neither reached a reported number, both because the result was implausible
enough to check.

**Scope.** The equipment/time only-warn defect is still unfixed, for the third
run. It moves the material-adaptation count, which is run 7's baseline.

## 8. What this does and does not unblock

The L3 precondition table now shows the injury-reversal path clear, and this
changes **what the first study is allowed to be**: before this fix a pilot could
only have used synthetic injury profiles, because putting the old surface in
front of someone with a real injury meant asking them to act on a control that
hid its own consequence. Real self-reported injury constraints are now
defensible.

It does not make the derivation good. Blind readers have twice called it
"superficially personalised" while every invariant passed, and this run adds a
third demonstration that green and good are different claims. The remaining L3
blocker is recruitment, consent and ethics, which is a founder call.

## 9. Method notes added this run

- **Run a new gate against the known-bad state before trusting it.** Not against
  the fix. An invariant that has never failed on the defect it was written for
  has not been tested, and it is indistinguishable from one that works.
- **Check a label's connotation against its consequence.** Vocabulary chosen to
  describe a mechanism ("go back to the plan") can carry an endorsement the
  mechanism does not deserve. Nobody writes a label thinking about this.
- **Satisfying a safety requirement three times is a way of discouraging the
  action.** The invariant was satisfied at the first occurrence; the other two
  were pressure I added while trying to be thorough.
- **A broken vacuity warning is worse than no vacuity warning**, because the
  remedy it invites is deletion of a working check.
