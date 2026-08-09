'use strict';
/* Run 5 â€” does the derivation actually derive?

   Four questions, four measurements:

   1. EXPRESSIVENESS  Do users with genuinely different constraints get
      materially different surfaces, or cosmetically different ones? Measured as
      Jaccard distance over the set of components selected, plus a diff of the
      rendered text.

   2. SECOND TARGET   Did the accessible rendering fall out of the same layer?
      Measured by counting conditionals on the render target inside the
      renderer. Anything above zero means a parallel code path.

   3. FRAME           Do persistent controls stay put across every user model
      and every target? This is the run-1 geometry gate, reused as a gate.

   4. COST OF THE FRAME  How much content had to be clamped to keep the
      controls fixed?

   Read-only against the local file. Usage:
     node --experimental-websocket tools/derivecheck.js <repoDir> <outDir> */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./cdp');

const REPO = process.argv[2];
const OUT = process.argv[3];
const PORT = 8777;

/* Deliberately different people, not different settings. */
const PROFILES = [
  { name: 'default',        prefs: {} },
  { name: 'injured-runner', prefs: { protecting: 'ankle', equipment: 'full', experience: 'regular', timeBudget: '90' } },
  { name: 'time-poor-novice', prefs: { protecting: 'none', equipment: 'home', experience: 'novice', timeBudget: '20' } },
  { name: 'advanced-full',  prefs: { protecting: 'none', equipment: 'full', experience: 'advanced', timeBudget: '90' } },
  { name: 'shoulder-home',  prefs: { protecting: 'shoulder', equipment: 'home', experience: 'regular', timeBudget: '45' } },
  { name: 'nothing-today',  prefs: { protecting: 'knee', equipment: 'none', experience: 'novice', timeBudget: '20' } },
  /* The evening session is strength or skill rather than endurance, and that is
     the only path reaching the middle confidence band. Without these two the
     ask branch is never exercised and would have shipped untested. */
  { name: 'knee-evening',   completeMorning: true, prefs: { protecting: 'knee', equipment: 'full', experience: 'regular', timeBudget: '90' } },
  { name: 'ankle-evening',  completeMorning: true, prefs: { protecting: 'ankle', equipment: 'full', experience: 'regular', timeBudget: '90' } }
];

const TARGETS = ['standard', 'large-type', 'reader-first'];
/* The weekday changes which activity is planned, so it is an uncontrolled
   variable unless pinned. Run 4 taught this the hard way. */
const WEEKDAYS = ['Monday', 'Tuesday', 'Thursday', 'Saturday'];

function serve(dir) {
  const server = http.createServer((req, res) => {
    const file = path.join(dir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 1;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(REPO);
  const { proc, cdp } = await launch(9461);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await sleep(2500);

  const results = [];
  for (const target of TARGETS) {
   for (const weekday of WEEKDAYS) {
    for (const profile of PROFILES) {
      const prefs = Object.assign({ target: target }, profile.prefs);
      const r = await cdp.evaluate(`(() => {
        window.__datuxResetState();
        window.__datuxSetWeekday(${JSON.stringify(weekday)});
        if (${profile.completeMorning ? "true" : "false"}) {
          const done = document.getElementById('s-' + ${JSON.stringify(weekday)}.toLowerCase() + '-morning-done');
          if (done && done.getAttribute('aria-pressed') !== 'true') done.click();
        }
        const prefs = ${JSON.stringify(prefs)};
        Object.keys(prefs).forEach((k) => window.__datuxSetPreference(k, prefs[k]));
        const s = window.__datuxSurface;
        const geo = [...document.querySelectorAll('#today-actions button, #today-plan')].map((e) => {
          const r = e.getBoundingClientRect();
          return [e.id || e.tagName, Math.round(r.x), Math.round(r.y + scrollY)];
        });
        const headline = document.getElementById('today-plan');
        const clamped = headline.scrollHeight > headline.clientHeight + 1;
        return JSON.stringify({
          components: s.plan.map((p) => p.id + ':' + p.disclosure),
          modes: s.plan.map((p) => p.id + '=' + p.mode),
          budget: s.budget, spent: s.spent,
          dropped: s.decisions.filter((d) => /dropped/.test(d.action)).map((d) => d.id),
          belowConfidence: s.decisions.filter((d) => /below confidence/.test(d.action)).map((d) => d.id),
          text: document.querySelector('.today').innerText.replace(/\\s+/g, ' ').trim(),
          geo: geo, headlineClamped: clamped,
          nonComposing: window.__datuxAssertNonComposing()
        });
      })()`);
      results.push(Object.assign({ target, weekday, profile: profile.name }, JSON.parse(r)));
    }
   }
  }

  /* ---- 1. expressiveness ---- */
  const std = results.filter((r) => r.target === 'standard' && r.weekday === 'Tuesday');
  console.log('=== 1. EXPRESSIVENESS (standard target) ===');
  std.forEach((r) => console.log('  ' + r.profile.padEnd(18) + r.components.length + ' components, budget ' +
    r.spent + '/' + r.budget + (r.dropped.length ? ', dropped ' + r.dropped.join(',') : '')));
  console.log('\n  pairwise component-set overlap (1.00 = identical surfaces):');
  let minOverlap = 1, maxTextDiff = 0;
  for (let i = 0; i < std.length; i++) {
    for (let j = i + 1; j < std.length; j++) {
      const ov = jaccard(std[i].components, std[j].components);
      const same = std[i].text === std[j].text;
      minOverlap = Math.min(minOverlap, ov);
      if (!same) maxTextDiff++;
      console.log('    ' + (std[i].profile + ' vs ' + std[j].profile).padEnd(42) + ov.toFixed(2) + (same ? '   IDENTICAL TEXT' : ''));
    }
  }
  const core = (r) => r.components.filter((c) => !/^explain\./.test(c)).join('|');
  const allStd = results.filter((r) => r.target === 'standard');
  console.log('\n  across ' + WEEKDAYS.length + ' pinned weekdays x ' + PROFILES.length + ' profiles:');
  WEEKDAYS.forEach((w) => {
    const rows = allStd.filter((r) => r.weekday === w);
    console.log('    ' + w.padEnd(10) + 'distinct component sets ' + new Set(rows.map(core)).size + '/' + rows.length +
      '   distinct text ' + new Set(rows.map((r) => r.text)).size + '/' + rows.length);
  });
  console.log('    OVERALL   distinct component sets ' + new Set(allStd.map(core)).size + '/' + allStd.length +
    '   (explanation line excluded)');
  const distinctSurfaces = new Set(std.map((r) => r.components.join('|'))).size;
  const distinctText = new Set(std.map((r) => r.text)).size;
  console.log('\n  distinct component sets: ' + distinctSurfaces + '/' + std.length +
    '    distinct rendered text: ' + distinctText + '/' + std.length +
    '    lowest overlap: ' + minOverlap.toFixed(2));

  /* ---- 2. second render target ---- */
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const renderer = src.slice(src.indexOf('function renderSurface'), src.indexOf('function rerender'));
  const targetBranches = (renderer.match(/target\s*===|target\s*!==|switch\s*\(\s*[\w.]*target/g) || []).length;
  const solverSection = src.slice(src.indexOf('function densityBudget'), src.indexOf('function renderSurface'));
  const solverTargetRefs = (solverSection.match(/target\s*===/g) || []).length;
  const componentSection = src.slice(src.indexOf('const COMPONENTS = ['), src.indexOf('const COMPONENT_BY_ID'));
  const componentTargetRefs = (componentSection.match(/\btarget\b/g) || []).length;
  console.log('\n=== 2. SECOND RENDER TARGET ===');
  console.log('  conditionals on target inside the renderer   : ' + targetBranches + (targetBranches === 0 ? '   (no parallel path)' : '   <-- PARALLEL PATH'));
  console.log('  references to target inside components       : ' + componentTargetRefs + (componentTargetRefs === 0 ? '   (components are target-blind)' : ''));
  console.log('  references to target inside the solver       : ' + solverTargetRefs + '   (density and disclosure only)');
  TARGETS.forEach((t) => {
    const rows = results.filter((r) => r.target === t);
    const comps = rows.reduce((s, r) => s + r.components.length, 0);
    console.log('  ' + t.padEnd(14) + 'components rendered across profiles: ' + comps +
      '   expanded: ' + rows.reduce((s, r) => s + r.components.filter((c) => /expanded/.test(c)).length, 0));
  });

  /* ---- 3. frame ---- */
  console.log('\n=== 3. FRAME (ADR 0004 gate) ===');
  let moved = [];
  TARGETS.forEach((t) => {
    const rows = results.filter((r) => r.target === t);
    const base = JSON.stringify(rows.filter((x) => x.weekday === rows[0].weekday)[0].geo);
    rows.forEach((r) => { if (JSON.stringify(r.geo) !== base) moved.push(t + '/' + r.profile); });
  });
  console.log('  persistent controls that moved across user models: ' + (moved.length ? moved.join(', ') : 'NONE'));

  /* ---- 4. cost of the frame ---- */
  const clamped = results.filter((r) => r.headlineClamped);
  console.log('\n=== 4. COST OF HOLDING THE FRAME ===');
  console.log('  derivations whose headline was clipped by the fixed height: ' + clamped.length + '/' + results.length);
  clamped.slice(0, 4).forEach((r) => console.log('     ' + r.target + '/' + r.profile));

  const bad = results.filter((r) => r.nonComposing && r.nonComposing.length);
  console.log('\n  non-composition invariant violations: ' + (bad.length ? JSON.stringify(bad[0].nonComposing) : 'NONE'));

  const asks = results.filter((r) => r.modes.some((m) => /=ask$/.test(m)));
  console.log('  derivations that ASKED rather than acted: ' + asks.length + '/' + results.length);
  const defaults = results.filter((r) => r.belowConfidence.length);
  console.log('  derivations that fell back to the default: ' + defaults.length + '/' + results.length);

  fs.writeFileSync(path.join(OUT, 'derivecheck.json'), JSON.stringify(results, null, 2), 'utf8');
  proc.kill(); server.close();
  process.exit(0);
})().catch((e) => { console.error('DERIVECHECK FAILED', e); process.exit(1); });
