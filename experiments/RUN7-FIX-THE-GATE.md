# Run 7 — fixing what the gate found, and what the green gate still cannot see

Run 6's gate blocked L3 with counts. This run clears it. The measurements below are
before-and-after over the same 108 derivations, plus the blind-judge test from run 5 re-run
on the new surfaces.

**The gate is green. The blind judges still say "superficially personalised". Both of those
are true, and the gap between them is the finding.**

---

## 1. The number that matters: distinct prescribed activities

Not distinct component sets, not material component sets. The prescription itself — the one
line every user reads first, which run 5 found identical for everyone and which no invariant
in the gate examines.

| measure | before | after |
|---|---|---|
| distinct prescribed activities across 6 user-model-differing profiles, per weekday | **1** | **2–3** |
| distinct recommended activities, counted independently by two outside judges | **1** | **3** |

Both judges, given only rendered text and no context, counted three: Run, Easy swim, Foam
rolling. In run 5 they counted one and said so in almost identical words — *"Every single
surface — all six — prescribes the identical workout."*

**ADR 0013's prediction held on this measure.** Adding a plan-replacing component moved the
prescription, which is what it was predicted to do. Had it stayed at one, that would be the
headline instead.

**The outside read came before the number was reported.** The judges were run on the new
surfaces and their verdicts read *before* this document existed — judge input written 01:05,
this write-up created 01:09. That ordering is the point of the requirement, not a formality:
had I written the report first, §5's three defects would not be in it, because I did not find
them and would not have gone looking.

Where I fell short of the rule as now written: I originally led with the gate table and put
this number in §4. The read happened first; the *reporting order* did not follow it. Fixed
here.

## 2. The gate: before and after

| invariant | before | after | precondition met (before → after) |
|---|---|---|---|
| **I1a** resolving component planned | **54 fail** | **0 fail** | 63 → 48 |
| **I1b** resolving control on surface | **54 fail** | **0 fail** | 63 → 48 |
| **I2a** substitution not misrepresented | 0 | 0 | 9 → 9 |
| **I2b** completed session carries no live advice | 0 | 0 | 45 → 39 |
| **I3** destructive proximity | **9 fail** | **0 fail** | 108 → 108 |
| **I4** explanation honesty | **46 fail** | **0 fail** | 68 → 49 |
| **I5** reverse reachability *(new)* | — | **0 fail** | — → 108 |
| **derivations failing at least one** | **79 / 108** | **0 / 108** | |

No invariant is vacuous: every one has a non-zero precondition count.

**Two precondition counts moved and that needs explaining, because a shrinking precondition
is how a gate quietly stops testing.** I1's fell from 63 to 48 because 15 derivations no
longer *assert* a problem — they resolved it, replacing the plan instead of warning about it.
That is the fix working, not the gate narrowing. I4's fell from 68 to 49 for the same reason:
fewer surfaces name a constraint at all, because the explanation now names only constraints
that changed something.

## 3. What was changed

**A plan-replacing component (ADR 0013).** `adapt.applied` replaces the prescription when
protection confidence is high, and carries the visible reason plus a one-click revert. The
revert is itself reversible — the control is a toggle between "Use the planned session
instead" and "Use the adapted session" — so ADR 0003's legibility and reversibility are met
without falling back to propose-only, which is what hollowed run 5 out.

**The I1 inversion, fixed.** Previously the high-confidence branch rendered a paragraph with
no control and the low-confidence branch rendered working buttons. Now the high-confidence
branch *acts* and offers a revert, the medium branch proposes with accept/decline, and a
persistent swap control sits in the actions row on every surface, so any asserted problem has
a resolving control regardless of which branch produced it.

**I3, fixed by adding the missing undo rather than by adding a confirm dialog.**
`adaptation.dismiss` now has `adaptation.undismiss`, surfaced whenever a dismissal is
suppressing a suggestion.

**I4, fixed by making the explanation true.** It now names only constraints that produced a
component on this surface. There were two available fixes — make the constraint change
something, or stop claiming it did — and both were applied where each was appropriate.

### On changing the gate at the same time as the code

Two invariants had their *vocabulary* extended: I1 now reads `assertsProblem` and `provides`
declarations from the component library instead of a hardcoded id list, and I4's attribution
map learned the new component ids. **Neither change weakens the logic**, and the I1 change
makes it stricter — a component can no longer escape the invariant by being renamed, which
was possible before.

I did not touch any invariant's *requirement*. A gate edited to pass is not a gate, and the
temptation was real: renaming `adapt.protection` to `adapt.applied` would by itself have
turned I1 green under the old id-matching check. That is exactly why I1 is now declaration-driven.

**I5 exists to police this run's own fix.** I3 passes if a capability declares itself
reversible, and nothing stopped that being a flag flip. I5 requires that when a capability's
effect is *currently active*, the control reversing it is actually on the surface. It passes
108/108, which means the reversibility is real rather than declared.

## 4. Did material adaptation move? No.

The measurement invented in run 5, run again unchanged:

| measure | before | after |
|---|---|---|
| distinct material component sets | 4 / 6 | **4 / 6** |
| users receiving **no** material adaptation | 3 / 6 | **3 / 6** |
| pairs differing only cosmetically | 3 / 15 | **3 / 15** |

**Stated plainly, as asked: the number did not move.**

I do not think this means the plan-replacing component failed, and here is the argument
along with its weakness. The three users receiving no material adaptation on that Tuesday —
default, advanced-with-full-facilities, and shoulder-protecting-at-home — have **no binding
constraint**. Tuesday's session is a run, which loads ankle and knee but not shoulder, needs
no facility, and fits a 45-minute budget. For those three, no adaptation is the correct
output, and ADR 0013 never predicted otherwise.

The weakness in that argument: it is exactly the shape of reasoning that would also excuse a
system that never adapts. It is only credible because something else moved.

## 5. The metric that could not see it

§4 shows the material-adaptation count unchanged: 3 of 6 users receive none, before and
after. §1 shows the prescription count moving from one to three — same surfaces, same day,
same users.

**So the material-count metric could not see the change, and the prescription count could.**
That is the third time a metric has been blind to the thing that actually changed. The
material/advisory split answers "how many users got an adaptation"; it does not answer
"was the adaptation a plan or a warning", which is the question ADR 0013 was about.

## 6. Is it green because it's fixed, or because the invariants can't see the rest?

**Both, and the second half is larger than I expected.**

The blind judges' verdict moved from *"the word personalised is not defensible here"* to
*"superficially personalised"*. Real progress, not a win. And with the gate fully green at
0/108, both judges independently found **three defects it cannot see**:

**The time constraint still only warns.** Surface C knows the user has 20 minutes and
recommends a 40-minute run anyway. Judge A: *"C exposes the weakness most clearly."* Judge B:
*"worse than either personalising or staying silent."* I made the *protection* constraint
plan-replacing and left equipment and time as warnings. I1 passes because a resolving control
is present — it does not ask whether the derivation *used* it.

**The swap options are identical for every user.** Judge B: *"the swap options presented are
identical across all six users, meaning the dropdown itself is not personalised at all."* A
user with 20 minutes is offered the same five choices as a user with 90. My fix for I1 added
a generic resolving control, and a generic control is precisely what satisfies the invariant
while doing nothing for the person.

**Reverting the injury adaptation restores the session that loads the flagged joint.** Judge
B: *"the reversal option actively undoes the injury protection."* That is correct under
ADR 0003 — reversibility is not conditional on the system approving of the choice — but it is
worth recording that the safest reading of reversibility and the safest advice point in
opposite directions here.

**The general shape:** every one of these passes the gate because the invariants check that a
surface is *not self-contradictory* and that an action is *available*. None checks that the
derivation did the most useful thing available to it. That is the correctness/quality split
Q4 draws, and this run is more evidence that the correctness half certifies much less than it
looks like it does.

I have not added invariants for these three. Two of them are quality judgements, and the
third — "the derivation should use the control it offers" — is a rule I would be writing
immediately after being caught by it, which is the condition under which I have twice written
a metric that measured the wrong thing.

## 7. Preconditions for L3, restated

| precondition | run 6 | run 7 |
|---|---|---|
| baseline frozen and selectable by policy | done | done |
| policy logged on every attempt | done | done |
| accessibility gates passing | done | **63/63 names, frame NONE, 0 unreachable** |
| Q4 correctness invariants passing | **FAILING** | **passing, 0/108** |
| recruitment, consent, ethics | not started | not started — founder call |

**The gate no longer blocks.** Whether the surface is *worth* testing on a person is a
different question, and §5 is the honest answer to it: two independent judges would still
describe it as superficially personalised.

---

## 8. What this run does not establish

- **Nothing about whether users prefer it.** No L3 was run.
- **One constraint was made plan-replacing.** Equipment and time were not, and the judges
  found that immediately.
- **The blind judges are two LLMs**, consistent with each other and with their run-5 verdicts,
  but not a human study.
- **The material-adaptation metric is unchanged and I argued it should be.** That argument is
  the weakest thing in this document and is flagged as such in §3.

---

*Gate: `tools/invariants.js`. Contrast: `tools/derivecontrast.js`. Previous:
[RUN6-Q4-INVARIANTS.md](RUN6-Q4-INVARIANTS.md), [L3-PROTOCOL.md](L3-PROTOCOL.md).*
