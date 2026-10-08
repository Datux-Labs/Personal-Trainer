# Personal-Trainer

**Your Athletic Week** — a responsive, dependency-free workout planner for GitHub Pages.

Open `index.html` for a daily dashboard, keyboard-navigable day tabs, a full-week
view, session completion, swaps and notes. Progress is stored in `localStorage`
separately for each Monday-starting week; there is no backend or account.

| Day | Starting plan |
| --- | --- |
| Monday | Lower-body strength, 35–45 min + easy run/walk, 20–25 min |
| Tuesday | Protected recovery; optional gentle mobility, never catch-up |
| Wednesday | Bouldering + upper-body strength, 25–35 min |
| Thursday | Full-body strength/power, 30–40 min + easy swimming, 15–20 elapsed min including rests |
| Friday | Golf range, 30–40 min + beach volleyball |
| Saturday | Longer easy run/walk, initially 30–40 min + pickleball |
| Sunday | Bouldering + recovery check |

The usual week contains eleven sessions: three lifts, five sport sessions, two
runs and one swim. It is a starting template, not a promise of recoverability or
half-marathon readiness. Sport durations are not invented where the plan only
specifies a usual moderate session.

The strength plans include sets, reps, suggested rest and cues with lightweight
SVG movement reminders. Illustrations have individual/global pause, speed and
static-reference controls; off-screen motion pauses, reduced-motion preferences
are respected, and printing opens all guidance and uses static illustrations.

The seasonal week selector **replaces, rather than stacks**: Saturday riding
replaces its run and pickleball; a riding weekend also replaces Sunday bouldering.
Changing variants retains the usual sessions' notes and progress. The guide covers
gradual running/swimming progression, modest lifting, fatigue and pre-trip changes.

The earlier planner's `pt.l2.state.v1` data is left intact and meaningful entries
are shown in an earlier-plan archive. New progress uses `pt.athletic.state.v2`;
old completions cannot accidentally complete different workouts in the new plan.
Reset clears only the current week's tracking and adaptation choices, retaining
the selected seasonal variant, earlier weeks and the earlier plan.
Logging an automatically adapted session from the focus card records the
displayed alternative in that slot, rather than claiming the original exercise
was completed. The grid logs the explicitly displayed planned or swapped session.

One static file, no build step, no app dependencies or external assets.

**This repo is currently an L2 prototype testbed for Datux Labs.** The capability
layer was added to answer open question Q13 in `Datux-Labs/core`. Read
[CAPABILITIES.md](CAPABILITIES.md) first — the write-up in it is the point of the
exercise, and the app is the means.

Later experiments using the same rig are in [experiments/](experiments), and the rig
itself is in [tools/](tools). Neither is part of the app; `index.html` still has no
build step and no dependencies.

The experiment reports describe the historical plan. The current UI keeps the
capability registry, local attempt envelopes, derivation policies and reading
targets; its session keys, weekly doses and seasonal variant are newer.
