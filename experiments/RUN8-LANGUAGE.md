# Run 8 — the language gap

ADR 0012 named it and nothing had tested it: **selection is derived, wording is
authored.** This run built the narrow version — a model writing *strings*,
offline, cached per user-and-context class, with the solver still choosing
components and the cache serving deterministically — and measured whether it
moves how a reader perceives the result.

The measure the run was set was: **do the blind judges' verdicts move, and in
which direction?**

---

## 1. The headline: they did not move. At all.

Four blind judges, two independent conditions, one prompt held constant from
runs 5 and 7. Every one returned the same verdict.

| | run 5 | run 7 | run 8 pre-fix | run 8 post-fix |
|---|---|---|---|---|
| generated language | none | none | 42 strings | 42 strings, register reachable |
| verdict | "the word personalised is not defensible here" | "superficially personalised" | **"superficially personalised"** ×2 | **"superficially personalised"** ×2 |
| distinct prescribed activities | 1 | 3 | **3** | **3** |
| material / cosmetic pairs | — | — | **12 / 3** | **12 / 3** |
| surfaces judged "the same screen" | — | A,D,E | **A,D,E** | **A,D,E** |

Every judge, in both conditions, independently produced 12 MATERIAL and 3
COSMETIC out of 15 pairs, counted 3 distinct activities, and clustered A/D/E as
one screen. The harness's own material/advisory split says 3/15 cosmetic. Three
independent measurements agree.

**Generated language moved nothing.** Not the verdict, not the clustering, not
the material count, not the perceived activity count.

The brief anticipated the uncomfortable case where language moves perception
while material adaptation has not — "a real and slightly uncomfortable finding
about where the perception of personalisation actually comes from." That is not
what happened. The result is the opposite and cleaner: **perception of
personalisation tracked the prescription and was completely indifferent to the
prose.** Judge D, post-fix, on the surface that got the reworked register:

> "D earns a footer label ('advanced level') that changes nothing about what
> the user should do."

and on the register work as a whole:

> "There is no register shift between novice (C, F) and advanced (D) users. All
> six surfaces use the same functional, zero-warmth, clause-structured register.
> ... The variation is filler, not signal."

That is a negative result for the language hypothesis, and it is worth more than
the positive one would have been, because it says the effort belongs elsewhere.

## 2. What the run got right, confirmed from outside

The anti-engagement invariant held, and this is the one place blind reading was
unambiguously favourable. All four judges checked for it unprompted and found
nothing:

> "zero exclamation marks, zero streak references, zero praise phrases, zero
> motivational framing, and zero personalised encouragement across all six
> surfaces." — judge D

A generative model writing fitness copy is about as adversarial a test of the
anti-engagement rule as exists; the default register of that genre is streaks
and encouragement. Constraining it at generation time and policing it
mechanically at bake time held. That part of the approach works.

Determinism held too: 147/147 phrase lookups served from cache, zero misses,
nothing generated on the request path.

## 3. The finding I did not go looking for: a 100% hit rate over a 24% dead cache

`langcheck` reported **100% cache hit rate** and **zero flat-register failures**.
Both were true. Both were worthless.

- The hit rate measures the proportion of *requests* served from cache. It says
  nothing about the proportion of the *cache* that is ever requested. A cache
  can be 100% hit and mostly dead at the same time, and mine was.
- The register check (langcheck.js:128) fails only when strings for different
  experience levels are **byte-identical**. It measures string inequality and
  reports it as register variation. Two strings can differ in every byte and
  read as the same voice — which is exactly what the judges said.

So I added a reachability diagnostic and swept it properly. The numbers, in the
order I got them, because the sequence is the point:

| sweep | strings never served | cause |
|---|---|---|
| langcheck's 12 profile-days | **27 of 42** | my harness under-exercised the app |
| exhaustive, 756 profile-days | **19 of 42** | my revert selector was `[data-capability="adaptation.revert"]`, but the button carries `"adaptation.revert adaptation.reapply"` — `=` never matched, `~=` does |
| exhaustive, selector fixed | **10 of 42** | genuinely unreachable |
| after the one-line fix in §4 | **9 of 42** | genuinely unreachable |

Two of those three numbers were my own instrument. My probe printed
`NO REVERT CONTROL FOUND` while the control was in the DOM three lines away. Had
I reported the first number I would have been wrong by 17 strings and would have
blamed the app for my own selector.

**One hypothesis I formed and had to drop.** I suspected the generator had
*fabricated* cache keys — inventing a `bike` facility that the domain model did
not have. Run 4 recorded exactly that hazard ("a reimplementation doesn't only
miss names, it invents them"), so it was the obvious guess. I checked it
mechanically against `ACTIVITY_MODEL` and `ALTERNATIVE_MODEL`: **zero fabricated
keys, zero missing keys.** `bike` is a real facility on an alternative session.
The keys were complete and correct; it was the *components* that were narrower
than the key space. Recording the wrong guess because a hazard that is real in
general was not the cause here, and the check took five minutes.

## 4. The confound I had to remove before the null result meant anything

`secondary.guideline` is the only component whose three variants carry a real
register difference — the `advanced` string is genuinely terse. It was
unreachable, and the reason was one line:

```js
evaluate: function (f) {
  if (f.user.experience === 'advanced') return { ok: false };   // <-- here
```

**I generated a register-varying string for an audience the component refused to
serve.** The advanced variant could never be shown to anyone, under any of 756
profile-days.

This is run 6's rule turned around. That run established that *a rule with zero
opportunities is not a pass*. The mirror is equally true and I had to apply it to
myself: **a treatment with zero opportunities is not a null result.** Reporting
"generated language does not move perception" while the most register-distinct
string in the dictionary had never rendered would have been reporting a null on
an untested treatment.

So I made the minimal change — advanced now gets the guideline at a lower score,
so density still drops it first under budget — and re-judged with **fresh**
judges, because the first two had already read the pre-fix file and could not be
asked again.

The diff between the two judged artefacts is two lines on one surface:

```
+ Easy sessions easy, so hard sessions stay high quality.
+ Shown this way because: advanced level. Change any of them under Your setup.
- Showing the default plan. Nothing in Your setup is narrowing it.
```

Everything else byte-identical. Clean attribution.

**The post-fix verdict is identical.** One judge now perceives the terseness and
files it as cosmetic anyway ("loosely suggesting advanced versus novice users,
but this is only cosmetic register variation"). The other does not perceive it as
a register shift at all ("truncated, carries no new information"). A–D stayed
COSMETIC for both. The null result survives the removal of its confound, which
is the only reason it is reportable.

## 5. Defects the judges found that no gate here can see

Two are new, two persist from run 7. None of them are caught by `langcheck`,
`invariants` or `derivecheck`.

1. **The headline says "Keep the effort conversational" over "Foam rolling
   (30 min)."** Both pre-fix judges caught it independently. This is a genuine
   nonsense output — conversational pace is meaningless for foam rolling. It is
   *not* generated: it is hardcoded at `index.html:1516`, appended whenever
   experience is novice regardless of what the activity became after adaptation.
   **`langcheck` structurally cannot see it, because it only reads strings inside
   `PHRASES`.** The worst language defect in the app is in the one place the
   language gate does not look. Fifth instance of "a number computed over the
   artefact does not check the artefact", and this time the artefact and the gate
   simply had different scopes.
2. **The swap dropdown is identical on all six surfaces** — judge D: "the
   alternatives offered are not personalised at all." Persists from run 7,
   deliberately not fixed.
3. **Two of six users are shown a surface that admits it is the default**
   ("Nothing in Your setup is narrowing it"), and A and E are byte-identical.
4. **Equipment and time constraints still only warn.** Deliberately not fixed —
   see §7.

## 6. Verification

Everything re-run after the §4 change.

| check | result |
|---|---|
| `langcheck` placeholder / engagement / shape / flat-register | 0 / 0 / 0 / 0 |
| phrase cache | 147 hits, 0 misses, 100% served from cache |
| phrase reachability (756 profile-days) | 9 of 42 unreachable, 79% reachable |
| `selfcheck` accessible-name agreement | **63/63**, 0 unnamed controls |
| `invariants` Q4 gate | **0/108**, 432 derivation-time + 324 render-time checks, no vacuous invariant |
| `derivecheck` frame (ADR 0004) | persistent controls that moved: **NONE** |
| `derivecheck` clipped headlines | 0/96 |
| non-composition (ADR 0008) | no violations |
| distinct prescribed activities | 2–3 per weekday, **unchanged from run 7** |
| encoding audit, all tracked `.md`/`.js`/`.html` | clean, no mojibake, no BOMs |

Distinct prescriptions being unchanged is the expected and correct outcome:
language should not move the plan, and it did not.

## 7. Declarations

**Gate edited in the same pass as the code.** Per the standing requirement:
`langcheck.js` gained a reachability **diagnostic only**. No invariant was
changed, no threshold moved, no requirement weakened, and the pass/fail
condition is byte-for-byte what it was (`placeholderFails === 0 &&
engagementFails === 0 && shapeFails === 0`). The reachability count is reported
and never gates. **A rename alone would not have turned anything green** — the
new number is printed, not asserted on.

**Scope held.** The equipment/time only-warn defect was again not fixed. It was
offered as cheap-if-you're-in-there, and it is not: it changes the material
adaptation count, which is the measurement run 7 established a baseline for.
Changing it inside a language run would have destroyed attribution on both.

**One behaviour change, declared.** The `secondary.guideline` gate in §4. It is
a component-library change inside a language run, which normally I would refuse.
I made it because leaving it would have meant reporting a null result on a
treatment that had never been administered, and I re-judged with fresh judges
rather than reusing the contaminated ones.

**No invariant written for the §5 defects.** Third run in a row declining this,
same reason: a rule written immediately after being caught by it is the exact
condition that produced the previous bad metrics. The "conversational pace on
foam rolling" defect is tempting to close with a coherence check, and a coherence
check would be a metric over the artefact.

## 8. What I would do with this

The honest read of runs 5–8 together: **the perception of personalisation is
carried entirely by the prescription.** Four judges could not be moved by 42
generated strings, and the two runs that *did* move them (5→7) moved the plan.
ADR 0012's split — selection derived, wording authored — is sound as an
architecture and the offline-cache mechanism works exactly as specified, but the
wording half is not where the remaining value is.

The measure that has not moved since run 5 is **material adaptation: three of six
users still receive none.** That is the number to attack, and it is the same
number run 7 failed to move. Language was worth testing precisely because it was
cheap and untested; it is now tested, and it is not the answer.

## 9. Method notes added this run

- **A treatment with zero opportunities is not a null result.** The mirror of
  run 6's rule about passes. Check reachability of the thing you are testing
  *before* reporting that it had no effect.
- **A hit rate is not a coverage rate.** 100% of requests served says nothing
  about what fraction of the cache is reachable. Report both or neither.
- **A gate's scope is its blind spot.** `langcheck` reads `PHRASES`; the worst
  string in the app is not in `PHRASES`. Ask what the gate cannot see, not just
  what it reports.
- **Verify a negative selector result before believing it.** `NO REVERT CONTROL
  FOUND` was my bug, not the app's. `=` vs `~=` on a space-separated attribute.
