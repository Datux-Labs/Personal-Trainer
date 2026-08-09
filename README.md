# Personal-Trainer

Static workout planner page for GitHub Pages.

Open `/index.html` to view the full weekly plan and today's workout, mark sessions
complete, substitute an exercise, and log notes. State is kept in `localStorage`;
there is no backend.

Single static file, no build step, no dependencies.

**This repo is currently an L2 prototype testbed for Datux Labs.** The capability
layer was added to answer open question Q13 in `Datux-Labs/core`. Read
[CAPABILITIES.md](CAPABILITIES.md) first — the write-up in it is the point of the
exercise, and the app is the means.

Later experiments using the same rig are in [experiments/](experiments), and the rig
itself is in [tools/](tools). Neither is part of the app; `index.html` still has no
build step and no dependencies.
