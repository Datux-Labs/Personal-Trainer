# L3 protocol — derived surface vs uniform baseline

**Status: written before any test has been run, and frozen on merge.**

`AGENTS.md` names retrofitting a baseline as the way this project would most easily lie to
itself. So this document exists before recruitment, before any pilot, and before anyone has
seen a number. If it is edited after data collection begins, the edit must be a separate,
dated commit with a stated reason, and the analysis must report both versions.

This protocol could be handed to someone tomorrow. It has not been run. No users have been
recruited, no participants have been simulated, and there are no results in this document.

---

## 1. The claim under test

> A surface derived from the modelled data layer produces better task outcomes than the
> uniform surface, for the same person, on the same task.

Nothing about engagement, retention, or satisfaction. Per `principles.md` §12, an efficiency
claim needs a task and a baseline or it is aesthetics.

## 2. The baseline, concretely and frozen

The baseline is **not** a memory of an older build. It ships in the same file as the
treatment and is selected by policy:

| policy | what renders | role |
|---|---|---|
| `?policy=derived` | the run-5 constraint solver over the component library | treatment |
| `?policy=uniform` | one static sentence per weekday, identical for every user, no derived regions | **baseline** |
| `?policy=holdout` | byte-identical to `uniform`, labelled separately | permanent held-out slice |

`uniform` reproduces exactly what every user saw before derivation existed: the
`scheduleByDay` sentence for the current weekday and nothing else. It is frozen at the commit
that merges this document. If it changes, this protocol is void.

This satisfies `experimentation.md` §1: **the experimental unit is the derivation policy, not
the artifact.** Every user in the `derived` arm may receive a unique surface; that is
within-arm variance, not a barrier.

The policy assignment is written into `context.policy` on every attempt envelope, so the log
is analysable per arm without a join. Verified: all three policies emit their own label.

## 3. Task

One task, performed on the participant's own device, in their own week:

> **"Work out what you are doing for training today, and record what you actually did."**

Deliberately not "use the app for a week". A bounded task with an observable end state is
the only thing §12 will accept.

The task is complete when the participant has either marked the session complete, logged a
note against it, or explicitly recorded that they did not train.

## 4. Metrics

### Primary

| metric | definition | direction |
|---|---|---|
| **completed-as-prescribed** | the session recorded matches what the surface recommended, without substitution | higher is better |
| **override count** | `session.substitute_exercise` + `adaptation.dismiss` + `session.restore_planned` per task | **not** simply lower — see below |
| **time-to-start** | first load of the surface → first capability attempt on today's session | lower is better |

`completed-as-prescribed` is the primary endpoint. The other two are co-primary diagnostics.

**Override count is deliberately two-sided and must be pre-declared as such.** An override is
the highest-signal, lowest-volume event available (`experimentation.md` §4) and it means two
opposite things. A user overriding *the recommendation* is telling us the derivation was
wrong. A user overriding *a uniform plan that does not fit them* is telling us the baseline
was wrong. Interpreting "fewer overrides" as "better" without that split is how this metric
becomes a Goodhart target. Analysis therefore splits overrides by whether the surface had
already flagged the constraint the user overrode.

### Secondary

- Attempts whose derived outcome is `abandoned` or `corrected` (`instrumentation.md` §4),
  reported with their confidence, not as raw counts.
- Task-level self-report of confidence in the plan, single item, collected once at the end.

### Excluded, by name, as success criteria

`principles.md` §11 and ADR 0005 forbid these. Naming them is not ceremony — the fitness
industry optimises exactly these by default, and any analyst arriving from that industry will
reach for them first:

- **session length / time in app** — a regression until proven otherwise, per §11
- **streaks, consecutive-day counts, completion chains**
- **daily or weekly actives, retention, return rate**
- **notification opens, re-engagement**
- **total sessions logged** as a volume measure

If any of these move, it is reported as context and may not be used to argue the treatment
won. A result that says "people spent longer in the app" is evidence of a problem.

## 5. The minimum detectable effect, stated before anyone runs anything

`experimentation.md` §2 gives `n ≈ 16·p(1−p)/d²` per arm for a between-user comparison.

| users per arm | smallest detectable change in task success |
|---|---|
| 100 | 20 points |
| 44 | 30 points |
| **10** | **~60 points** |

**A between-user A/B at our scale detects nothing short of a catastrophe.** At n = 10 per arm
the treatment would have to move task success by 60 points to register. That is not a test.

### What the within-subject design actually buys

Assume **n = 20 participants**, each performing the task under both policies.

- **Binary primary endpoint (completed-as-prescribed).** Paired analysis is McNemar's test,
  whose power depends on the number of *discordant* pairs, not on n. At n = 20 with a
  plausible 30% discordance rate, that is ~6 discordant pairs, and significance requires
  almost all of them to fall the same way. **Realistic MDE: ~25–30 points. Nothing smaller
  is visible.**
- **Continuous endpoint (time-to-start).** Paired t-test MDE ≈ 2.86 · sd_diff / √n. At n = 20
  that is **≈ 0.64 × the standard deviation of the within-person difference** — a large
  effect, Cohen's d ≈ 0.66. CUPED on a pre-period baseline should cut variance 25–64%
  (`experimentation.md` §2), improving this to roughly d ≈ 0.4–0.55. CUPED is mandatory, not
  an optimisation.

### The consequence, pre-registered

**This protocol can only detect a large effect.** If the derived surface is moderately better
— which is the most likely true state of the world — the result will be "no detectable
difference". That outcome is **pre-registered as the expected one** and must not be reported
as a failure of the thesis, nor as a licence to keep testing until something is significant.

A null result here is informative about the *protocol's* power, not about the idea. The only
strongly informative outcomes are: a large positive effect, or a **guardrail breach**, which
is why §7 matters more than §5.

## 6. Design

**Within-subject, counterbalanced, with washout.** The single biggest lever available at this
n (`experimentation.md` §3).

- Each participant completes the task under both policies.
- Order is randomised and balanced: half receive `uniform` first, half `derived` first.
- **Washout: at least 7 days between arms**, and the two arms must fall on the *same weekday*.
  The weekday determines which activity is planned, and run 5 established that the weekday
  decides whether any constraint can bind at all. Comparing a Tuesday to a Sunday compares
  two different problems.
- Session index is modelled explicitly as a covariate.

**Carryover risk, stated rather than assumed.** Moving someone's interface back and forth
teaches them the app and irritates them. Three specific hazards:

1. **Learning.** A participant who sees `derived` first learns that a swap exists, then
   carries that knowledge into `uniform` — inflating the baseline. Direction of bias:
   *against* the treatment. Acceptable, because it is conservative.
2. **Irritation / demand.** A participant who notices the app got simpler may infer they are
   in a control condition. Mitigation: participants are told both arms are "versions of the
   planner", never which is new.
3. **Novelty.** Reaction to change itself. Mitigation: analyse the effect's slope across the
   two exposures, not just the endpoint (`experimentation.md` §5).

If carryover is detected — a significant order × policy interaction — the paired analysis is
abandoned and only first-period data is used, which drops the design to between-user and
therefore to the useless MDE in §5. **That contingency is stated now so it cannot be
discovered as a convenient reason to keep the paired result.**

**Analysis.** Hierarchical Bayesian with partial pooling; population effect with credible
intervals as the primary result; per-user posteriors exploratory and labelled as such.

## 7. Guardrails

Guardrails are the mechanical replacement for a designer's refusal to ship
(`experimentation.md` §4). They can stop a rollout on their own; the primary metric cannot
override them.

### Pre-declared subgroups we most fear harming

Declared now, before any data:

1. **Participants with a stated contraindication** (`protecting` ≠ none). The derivation is
   most active for them and the failure mode is worst: a surface that flags an injury and
   then recommends loading it. Run 5's I1 failure — a problem asserted with no control to
   resolve it — occurred in **54 of 108** derivations, so this subgroup is at known risk.
2. **Participants with the least equipment** (`equipment` = none). They receive the most
   "you cannot do this" content and the least actionable alternative.
3. **Participants using a non-standard render target** (large-type or screen-reader-first).
   Density is reduced for them by construction, so they are the group most likely to lose a
   component that mattered.

At n = 20 we cannot fish across segments. These three are declared; anything else found is
exploratory and labelled as such. Where multiple subgroups are tested, control the false
discovery rate rather than applying Bonferroni across many segments.

### Accessibility regressions are hard blockers

Not dashboard metrics. A regression **blocks**, regardless of the primary endpoint, because
for a user dependent on assistive technology a losing variant does not mean a slightly worse
completion rate — it means the task cannot be completed.

Blocking conditions, all mechanically checkable today:

| condition | check |
|---|---|
| any interactive control without an accessible name | `tools/selfcheck.js` — currently 0 |
| in-page name disagreeing with the browser's | `tools/selfcheck.js` — currently 62/62 agree |
| any persistent control moving between derivations | `tools/derivecheck.js` frame gate — currently NONE |
| any control not reachable by keyboard | `tools/derivecheck.js` — currently 0 unreachable |
| **any Q4 correctness invariant failing** | `tools/invariants.js` — **passing as of run 7, 0/108** |

The last row means **this protocol cannot be run today.** That is the point of writing the
gate before the test.

### Reversibility

An always-available path back to the uniform surface must be present in both arms, and taking
it is logged as `adaptation.dismiss`. Per prior art H4 this is both an ethical floor and a
measured-preference finding.

## 8. The held-out slice

Per ADR 0006 and `experimentation.md` §5, a permanent randomised cohort the personalisation
policy never governs, established **on day one**, not retrofitted.

- **20% of participants**, assigned at enrolment, permanently on `?policy=holdout`.
- Their data is never used to fit, tune, or select a policy. It is the unbiased reference for
  detecting algorithmic confounding — the failure where feeding a system its own outputs
  makes offline evaluation look better while utility degrades.
- Losing the slice to "we need every user in the treatment" is the named way this fails. The
  slice is not negotiable against sample size.

At n = 20 a 20% holdout is 4 people, which is too few to analyse and is **not intended to be
analysed at this scale**. It exists so the practice is established before it is needed. Say
that plainly rather than pretending 4 people are a control.

## 9. Preconditions — this cannot be run yet

| precondition | status |
|---|---|
| baseline frozen and selectable by policy | **done** — `?policy=uniform` |
| policy logged on every attempt | **done** — `context.policy` |
| accessibility gates passing | **done** — 63/63 names, frame NONE, 0 unreachable |
| Q4 correctness invariants passing | **passing as of run 7, still 0/108 at run 9** |
| injury-reversal path safe to show a real person | **done — run 9.** See below. |
| recruitment, consent, ethics | **not started — founder call** |

### The injury-reversal blocker, and why it was not a correctness problem

The founder review found what the agent side had twice filed as an acceptable
design tension: **reverting an injury adaptation handed back the session that
loads the flagged joint**, behind a control labelled "Use the planned session
instead."

Every correctness invariant certified that surface. I3 passed because the
revert is reversible. I5 passed because its reversal is reachable. I1 passed
because a resolving control was present. None of them asked what the control
*does to the person pressing it*, and the label's connotation ran the opposite
way to its consequence — "planned" reads as the correct, officially-sanctioned
choice, so the most authoritative-sounding option was the one that re-injures
you.

Run 9 fixed it by disclosure rather than friction: the revert is still one
click in both directions, with no confirmation step, and the control now names
what it restores and what that costs, in its own label. `I6-render` was added
and **verified to fail 21/108 on the pre-fix code** before being accepted.

**Consequence for the study design.** Until this landed, the pilot could only
have used *synthetic* injury profiles, because putting the pre-fix surface in
front of someone with a real injury would have been asking them to act on a
control that hid its own consequence. With run 9 in, a pilot using **real
self-reported injury constraints** is defensible. That is a change in what the
first study is *allowed to be*, not merely a bug fix, and it is the reason this
row is a precondition rather than a nice-to-have.

**This is still not a claim that the disclosure is good.** I6 is a regression
detector for one known defect and is cheaply satisfied by appending the right
tokens. The check that is not cheaply satisfied is a reader who has not been
told what the button is for, and two of them found four further problems that
I6 passes over — listed in `RUN9-INJURY-REVERSAL.md` §5.

**The correctness blockers are cleared; recruitment is not.** When this section
was written in run 6, 54 of 108 derivations asserted a problem and offered no
control to resolve it, and running an L3 on that would have measured a defect
rather than a thesis. Run 7 cleared that and run 9 cleared the injury-reversal
path. **The remaining blocker is recruitment, consent and ethics, which is a
founder call and not an agent one.**

One caveat carried forward deliberately: a green gate says the surface is not
self-contradictory. It does not say the surface is doing anything useful, and
blind readers have twice called the derivation "superficially personalised"
while every invariant passed. That is a reason to keep the pre-registered
expectation modest, not a reason to delay the study.

---

## 10. What this protocol cannot tell us

- **Whether the idea works.** It can detect a large effect or a guardrail breach. Moderate
  improvement is invisible at this n and is pre-registered as the expected outcome.
- **Anything about long-term use.** One bounded task, twice.
- **Anything about the held-out slice**, at this scale.
- **Whether derivation beats a *good* hand-authored interface.** The baseline is this app's
  own uniform surface, not a well-designed competitor. A win here means "better than what we
  had", which is the honest and much smaller claim.

---

*Written before any data collection. Frozen on merge. Companion:
[RUN6-Q4-INVARIANTS.md](RUN6-Q4-INVARIANTS.md).*
