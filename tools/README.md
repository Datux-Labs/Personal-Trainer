# tools â€” the L2 experiment rig

**These are not part of the app.** `index.html` still has no build step, no dependencies
and no tooling. It opens by double-clicking it. Nothing in this folder is required to run,
serve, or modify it.

This folder exists because the rig kept getting rebuilt from scratch each run.

## What it is

Zero-dependency Node scripts that drive Edge over the Chrome DevTools Protocol. No npm
install, no `package.json`, no lockfile. Node 20 needs one flag for its WebSocket client:

```
node --experimental-websocket <script> <args>
```

| script | what it does |
|---|---|
| `cdp.js` | shared CDP plumbing: launch, connect, evaluate, DOMâ†”accessibility-node mapping, tree serialization |
| `screen.js` | scores candidate apps for accessibility-semantic quality, so target selection is measured rather than guessed |
| `capture.js` | captures multi-state accessibility trees, and emits the `FULL` / `NAME_ONLY` / `ROLE_ONLY` ablation variants |
| `behave.js` | drives an app and records what observably happened â€” URL change, network calls, HTTP status |
| `probe.js` | loads one page and lists its navigation targets, for discovering flow URLs |
| `selfcheck.js` | run-1 self-check against this repo's own `index.html`: frame stability, keyboard reachability, and the accessible-name conformance diff |
| `accname.js` | the conformance harness: eight in-page AccName implementations diffed against `Accessibility.getFullAXTree` across a corpus, with divergence classification |
| `annotate.js` | `href` mode captures a tree with link destinations joined in; `flip` mode enumerates controls whose ARIA state can flip |
| `crossengine.js` | Blink vs Gecko accessible-name comparison on frozen page snapshots, via CDP and WebDriver Get Computed Label |

## The one to steal

`selfcheck.js` contains the **name-agreement check**: it compares the accessible names this
page's own script computes against the names Chromium actually computes, over every
control. That check found a 4/56 agreement rate caused by a single CSS declaration, which
nothing else would have flagged. Some version of it belongs in any product that emits
`surface.role` + `surface.name` telemetry from inside the page.

```
node --experimental-websocket tools/selfcheck.js . ./out
```

## Rules of use against software you do not own

The rig can drive live third-party applications. When it does:

- GET navigations and non-destructive interactions only.
- No credentials, no accounts, no form submissions to real lookup backends.
- Never operate delete, restore, or permanently-delete on someone else's service â€”
  observe the affordance and record it as inferred.
- If a service says it does not want automated anonymous traffic, stop and pick a
  different target. Open Food Facts was dropped from run 2 for exactly this reason.

## Results

- Run 1 â€” [`../CAPABILITIES.md`](../CAPABILITIES.md) â€” this repo's own app
- Run 2 â€” [`../experiments/Q13-RUN2-EXTERNAL-APPS.md`](../experiments/Q13-RUN2-EXTERNAL-APPS.md) â€” GOV.UK and Grafana Play
