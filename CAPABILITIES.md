# Capability model — Personal Trainer (L2 prototype)

This document is the output of an experiment run for Datux Labs against open question
**Q13** in `Datux-Labs/core`: *does a capability model survive contact with a real
codebase?*

The code in this repo is the means. This write-up is the deliverable. It records what
went wrong as carefully as what went right, because the negative results are the part
worth having.

**Context.** Q13 was first tested against this repo and returned a negative result: the
app had *zero* capabilities — no button, no input, no form, no handler in the whole
12 KB. Its only script read the day of the week and highlighted a card. There was nothing
to attempt, so nothing to instrument. This change adds the smallest capability set that
makes the app instrumentable, and then uses it as a test rig.

---

## 1. The finding, first

**Three independent namers looking at the same interface produced three capability
models that agreed on every concept and on not one single name.**

| | Model A (run 1) | Model B (run 1) | Model A (run 2) | Model B (run 2) | Authored (this repo) |
|---|---|---|---|---|---|
| Capabilities named | 6 | 6 | 5 | 6 | 7 |
| Exact id matches with any other namer | 0 | 0 | 0 | 0 | 0 |

Zero exact-string agreement, in every pairing, in both conditions. Same concepts every
time: mark done, swap the activity, note/log, pick the Saturday variant, reset. Different
strings every time — `session.mark_done` vs `training_session.mark_complete` vs
`training_session.set_completion` vs `session.complete`.

This is Furnas et al. (1987) landing exactly where
[ADR 0008](https://github.com/Datux-Labs/core/blob/main/docs/decisions/0008-user-controls-relevance-system-controls-structure.md)
says it lands, except it is not users choosing terms for a capability — it is the people
*defining* the vocabulary. The vocabulary problem is not only on the demand side.

The practical consequence for `instrumentation.md`: **bootstrapping from the accessibility
tree works, and it does not reduce the governance cost at all.** It gives you a correct
draft concept set in under two minutes. It cannot give you the registry. Reconciliation —
"reuse before coining", one stable id per concept, deprecate-never-delete — is where the
whole cost lives, and it is untouched by autocapture. Anyone selling capability
bootstrapping as a way to skip the registry is selling the easy half.

Two more findings that surprised us are in §7. The most load-bearing one:
**an in-page instrumentation SDK cannot reproduce the accessibility tree's names.** Ours
agreed with the browser on 4 of 56 controls until we hand-patched it, and the cause was a
single presentational CSS declaration.

---

## 2. The capability model

Namespaced, low cardinality, stable id separated from display label, per
`instrumentation.md` §2. Variable data (which day, which slot, which substitution) travels
in event attributes and never in the name.

| id | display label | operated via | surfaces | outcomes reachable |
|---|---|---|---|---|
| `session.complete` | Mark session complete | `button` "Done …", `aria-pressed` false → true | weekly grid, today panel | `completed` |
| `session.reopen` | Reopen a completed session | same button, true → false | weekly grid, today panel | `completed` |
| `session.substitute_exercise` | Substitute the planned exercise | `combobox` "Swap …", non-empty option | weekly grid | `completed` |
| `session.restore_planned` | Restore the planned exercise | same combobox, "As planned" | weekly grid | `completed` |
| `session.log_note` | Log a note against a session | `textbox` "Note …" + `button` "Log …" | weekly grid | `completed`, `abandoned` |
| `plan.select_long_day_variant` | Select the long-day variant | `radio` Week A / Week B | weekly grid | `completed` |
| `plan.reset_progress` | Reset all logged progress | `button` "Reset progress" + confirm | hero | `completed`, `abandoned` |

Full URNs are `urn:cap:<id>`. The registry is `CAPABILITIES` at the top of the script in
`index.html`; `window.__datuxCapabilities` exposes it at runtime and
`window.__datuxAttempts` holds the emitted envelopes.

**Scale.** 7 capability names cover 56 interactive controls across 13 session slots. A
click stream would carry 56 distinct surface identifiers with no way to group them. That
is a statement about *vocabulary* cardinality, not event volume — we are not claiming a
compression ratio, per `instrumentation.md` §5.

---

## 3. How long naming took, and who could have done it

**We contaminated this measurement and it should be treated as void.**

Q13 asks how long it takes to name the capabilities of a product, *ideally one we didn't
write*. We wrote it. Naming capabilities you are simultaneously designing takes about ten
minutes and is entangled with the design itself — the names came out of the same thought
that decided what buttons to add. That number tells you nothing about the question asked,
and quoting it would be dishonest. The task as briefed destroyed the test it was meant to
run: you cannot survey an app you have to build first.

What survived is the blind test in §6, where namers who had never seen the source worked
from the accessibility tree alone. That is the only uncontaminated measurement here.

**Did it need someone who had read the code?** No — and this is the one solid positive
result. All four blind runs produced a usable draft without any source access, and all
four, asked independently, said a non-engineer could have done the same from the same
input. The reasoning was consistent: the tree is plain English, every control has a
readable label, and the hard part ("is Done the same thing as Log?") is product judgement,
not engineering. This is real evidence against `prior-art.md` H5 for the *drafting* step.

It is not evidence for the *deciding* step. Every blind run flagged the same unresolved
question, and every one said the single thing it most needed was behavioural: what does
this control actually do when operated. The tree names the controls; it cannot tell you
what happens.

**One methodological warning.** All four namers self-reported their elapsed time as
"~15 minutes", "~15 minutes", "~20 minutes" and "~8–10 minutes". Actual wall clock was
95s, 115s, 116s and 119s. Self-reported effort was wrong by an order of magnitude in
every case. If Q13 is ever answered with survey data, the survey will lie.

---

## 4. What was ambiguous

These are the real coin-flips, including the ones we probably got wrong.

**Is marking a session complete one capability or two (morning/night)?** One. The slot is
an attribute — `{day: "Monday", slot: "morning"}` — not part of the name. This one was
easy and both blind namers agreed independently. `session.complete.morning` would put
7×2 near-duplicates in the registry to encode something a filter can do.

**Is completing and un-completing one capability or two?** We said two
(`session.complete` / `session.reopen`). **All four blind runs said one**, and the two that
could see `aria-pressed` on the button said so explicitly and with reasons — model A2:
*"the `pressed` state suggests a toggle, so `completed=true/false` should be an attribute
rather than separate complete/uncomplete capabilities."* We are the minority position, 1
against 4.

Our reasoning: `instrumentation.md` §6 wants to know *which capabilities are most often
corrected or undone shortly after*. If un-completing is an attribute value of
`session.complete`, that query becomes "count events where the attribute flipped", which
requires the analysis layer to know that this particular attribute encodes a reversal.
With a named `session.reopen`, the correction-pairing falls out of the capability
sequence directly. But this is contested and we would not defend it hard. Note what it
implies: **the accessibility tree actively pushes namers toward the merged form**, because
a toggle presents as one control. Any bootstrapped registry will systematically
under-count reversals.

**Is substitution one capability or one per exercise?** One. `session.substitute_exercise`
with `{substituted_with: "Easy swim (20–30 min)"}`. One-per-exercise is the xAPI failure
mode named in Q13 verbatim: the substitution list is content and will change, and every
change would mint a permanent registry entry that can never be deleted.

**Is restoring "As planned" a capability or the null case of substitution?** We said
capability (`session.restore_planned`). Both blind namers said null case. Same disagreement
as complete/reopen, same shape, same reasoning on both sides. Consistency argues we are
either right about both or wrong about both.

**Is picking the Saturday Week A / Week B variant a substitution?** It looks exactly like
one — same domain, same slot, adjacent controls — but it is not. Substituting is
*deviating* from the plan; selecting the long-day variant is *following* a plan that has
two legs. We named it `plan.select_long_day_variant`, in a different namespace, because
the plan owns the alternation and the session does not. This was the single hardest call
in the model and it split the blind namers: A merged it with substitution into
`training_session.select_activity`; B kept it separate. An arbitrary call, defensible
either way, and it changes what "swap rate" means.

**Is the note textbox separate from the Log button?** We said one capability. Blind namer
B split them (`session.add_note` + `session.log`) on the grounds that they are separately
addressable controls. B is describing the UI; we are describing the intent. Typing into a
box that has not been submitted is not an attempt at anything. We are more confident here
than on complete/reopen, but B's split is the natural read from the tree, which is a
recurring hazard of bootstrapping: **the tree is a control inventory, and control
inventories over-split.**

**Is clearing a note a capability?** We folded it into `session.log_note` with
`{cleared: true}`. Arbitrary, chosen for registry economy. Nobody would guess it.

---

## 5. Granularity chosen, and why

The rule we settled on: **name the smallest thing that can independently fail.**

That resolves most cases mechanically. Slot, day and activity go in attributes because a
morning completion cannot fail in a way a night completion cannot. Substitution choice
goes in attributes for the same reason. Reversals get their own names because "I couldn't
undo it" is a different failure from "I couldn't do it", and merging them makes the
failure invisible.

We deliberately did **not** encode the surface in the name. `session.complete` is reachable
from two places — the weekly grid and the today panel — and both emit the same capability
with a different `surface`. Folding the surface into the name
(`session.complete.from_today`) is exactly the `invoice.void.from_list_with_confirmation`
explosion Q13 warns about, and it also destroys the question the envelope exists to
answer: *which surface produces the most abandoned attempts at this capability?* That
question is only askable if the name is surface-independent.

That symmetry is worth stating as a rule: **anything the envelope already has a field for
must not appear in the capability name.** Surface, device, modality, actor, outcome, and
every high-cardinality domain value are all fields. What is left over is the capability.
Applied here it produced 7 names and no arguments about cardinality.

We also did not name any "view" capability. Blind namer A coined `training_plan.view` in
both runs. Reading the plan is no-goal usage — `instrumentation.md` §7 says treat it as a
different event class rather than forcing an outcome onto it. A view has no failure mode,
so under our rule it cannot be a capability. Worth flagging: the accessibility tree
invited that mistake in 2 of 2 runs by that namer, because a tree full of named regions
looks like a list of things you can do.

---

## 6. Would the accessibility tree alone have been enough?

**Method.** We captured the real accessibility tree from Chromium over the DevTools
Protocol (`Accessibility.getFullAXTree`) — not a hand-written approximation. It was
serialized to role + accessible name + value + ARIA state, with tag names, element ids,
classes and `data-*` attributes stripped, so it contained nothing a real autocapture
bootstrapper could not see. That file was handed to independent agents that were forbidden
from reading any source, any repo, or the web, and were asked to draft a capability model.
Four runs: two different models × two conditions.

The conditions differed only in the artifact. Condition 1 accidentally dropped ARIA states
whose value was `false`, which hid `pressed=false` on every toggle. Condition 2 restored
them. We are reporting both because the accident turned out to be informative.

**Result: yes for the concept set, no for the vocabulary, no for the semantics.**

*Concept set.* All four runs recovered 5 of our 7 capabilities from the tree alone, in
under two minutes of wall clock. No source, no docs, no product owner.

*The same 2 were missed every time.* `session.reopen` and `session.restore_planned` — in
all four runs, in both conditions. They are both "the reverse direction of a control that
also does the forward direction." Exposing `aria-pressed` did **not** fix this: both
condition-2 namers saw the toggle state, correctly identified the control as a toggle, and
explicitly chose to model the reverse direction as an attribute rather than a capability.
So this is not a perception failure that better markup can fix — it is a modelling
disagreement that the accessibility tree systematically biases in one direction. **A
bootstrapped registry will be short exactly those capabilities whose absence hides
correction and undo signals**, which are the Tier 1 repair signals the whole scheme exists
to collect.

*More information made one model worse.* Condition 2 gave namer A strictly more data.
Namer A returned *fewer* capabilities (5, down from 6), merging substitution and long-day
variant into one. Recall against our model was unchanged at 5/7. Richer ARIA did not
monotonically improve the draft.

*Vocabulary.* Zero exact-id agreement in every pairing, in both conditions, with the naming
convention supplied to every namer in the prompt. See §1.

*Semantics.* All four runs independently named the same blocker and it was never
structural. Namer B: *"the behaviour of the Log button — what it sends, to where, and
whether Done state is required."* Namer A: *"a control-to-state-transition specification
showing the persisted result and success/failure outcome of each unique control."* The
tree told them a button called "Log" exists. It could not tell them that Done and Log are
completely independent, and three of four runs guessed they might be sequential — a false
structure inferred from adjacency. It also could not reveal the confirm dialog on
`plan.reset_progress`, which is the only path in the app that produces a genuine
`abandoned` outcome.

**Verdict.** Bootstrap the draft from the accessibility tree — it is cheap, it is fast, it
does not need an engineer, and it is roughly 70% right. Then spend the real money on the
two things it cannot do: pinning one name per concept in a governed registry, and
confirming what each control actually does. `instrumentation.md` §3 is right that the
accessibility tree is a backbone for `surface`. It is also a usable bootstrap for
`capability`, with a known and *directional* blind spot at reversals.

---

## 7. Things that broke that the thesis docs did not predict

**An in-page SDK cannot reproduce the accessibility tree's names.** This is the big one.
`instrumentation.md` §3 makes role + accessible name the identity of a `surface`. The
platform does not expose the computed accessible name to page script — there is no
stable web API for it — so any in-page instrumentation library must reimplement AccName.
We wrote a careful one. It agreed with Chromium on **4 of 56 controls**.

The cause was one line of CSS: `.item-title { text-transform: uppercase }`. AccName uses
*rendered* text, so the browser computes `"Done MORNING Monday"` while `textContent`
yields `"Done Morning Monday"`. Every telemetry event would have carried a `surface.name`
that no accessibility tool, screen-reader recording, or Playwright role locator would ever
match. Nothing would have flagged it. We only caught it by diffing our own output against
`Accessibility.getFullAXTree`.

We patched `text-transform` handling into the name computation and got 56/56. That fix is
a patch, not a solution — the same class of divergence remains for CSS generated content,
`aria-owns` reordering, hidden-text contributions, `:lang` variants, and shadow DOM. The
general lesson: **either observe names from outside the page (DevTools protocol, extension,
or the AT itself), or ship a conformance test that diffs your SDK's names against the real
tree on every build.** A silent 93% mismatch is the failure mode, and it is invisible from
inside the page. There is a `nameAgreement` check in the session harness that does exactly
this diff; something like it belongs in the product.

**The fixed outcome enum has a hole.** Pressing "Log" when the note is unchanged is a
no-op. It is not `completed`, `abandoned`, `corrected`, `retried`, `misdirected` or
`escalated`. We forced it onto `abandoned` at confidence 0.4, which is a lie we can see.
The enum is closed for good reasons and we are not proposing to open it, but "the user
attempted something that turned out to be nothing" is a real and common case, and it will
be silently miscoded as abandonment across every product that adopts this. That inflates
the abandonment rate on exactly the low-stakes idempotent actions people repeat most.

**ADR 0004 compliance is machine-checkable, and eyeballing it fails.** We reserved
`min-height` on every state line specifically to hold the frame, believed it was correct,
and it was not: a longer state string wrapped to two lines and pushed **8 controls** in the
adjacent slot down the page. An automated check that records the geometry of every control,
writes state, and re-measures caught it immediately. Fixed by using a fixed `height` with
clipping — the full text stays in the DOM for assistive technology, only the visual is
clipped. Recommendation: ADR 0004 should ship with this check, not with a description. The
check is about fifteen lines and it found a real violation on the first run against code
written by someone actively trying to comply.

---

## 8. What this testbed still cannot test

Stated plainly so nobody mistakes a green light here for a validated model.

**Outcome is observable here, which makes it too easy.** `instrumentation.md` §4 is
emphatic that outcome must be *derived*, because intent is not in the event stream. Every
capability in this app is a local state write, so the transition is directly observable and
we label at emit time with high confidence. That is a property of a toy with no network,
no latency, no failure modes and no multi-step flows. **This app cannot exercise the
pairing machinery**, which is the genuinely hard and genuinely novel part of the scheme.
A testbed that can produce a real unpaired failure needs something that can actually fail.

**`surface` is nearly degenerate.** Five of seven capabilities are reachable from exactly
one place, so "which surface produces the most abandoned attempts" is unanswerable for
them. We added the today-panel buttons *specifically* to give `session.complete` and
`session.reopen` a second surface, which is the only reason that dimension is testable at
all. This is worth noting for future L2 targets: **a candidate app needs at least one
capability reachable two ways, or the envelope's `surface` field is untestable.**

**No misdirection signal.** There is no dead-click detection here, so `misdirected` — the
signal `instrumentation.md` §3 argues most strongly for — is never emitted. That is the
obvious next increment on this rig.

**One page, one state, one user.** No navigation, no search, no escalation, no cross-session
task. Several of the questions in §6 of `instrumentation.md` are simply out of scope.

---

## 9. Using the rig

Open `index.html`. No build, no server, no dependencies.

```js
window.__datuxCapabilities   // the registry
window.__datuxAttempts       // emitted attempt envelopes, bounded ring of 500
```

Every attempt carries the `instrumentation.md` §2 envelope: `attempt_id`, `actor`,
`capability` (urn + label), `surface` (role, accessible name, containing group),
`context` (device, modality, ms into session), `detail`, `outcome`,
`outcome_confidence`, `schema_ref`. Attempts also go to `console.debug`. Nothing leaves
the page; there is no network call anywhere in this app.

Controls carry `data-capability` listing the capability ids they can attempt — space
separated where one control serves two, which is the honest encoding of the toggle problem
in §4 and the exact place a DOM-harvesting bootstrapper under-counts.

State lives in `localStorage` under `pt.l2.state.v1`. "Reset progress" clears it. The
pseudonymous actor id is `pt.l2.actor`.

---

*L2 prototype. Disposable. Delete it when it has stopped teaching us anything.*
