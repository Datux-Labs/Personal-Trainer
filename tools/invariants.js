'use strict';
/* Q4 correctness invariants, as a mechanical gate.

   Q4 asks how we know a derived surface is good without hand-inspecting every
   variant. The correctness half is now specifiable, because derive() is real.
   Four invariants, each phrased so it can FAIL:

     I1  capability sufficiency
         If the surface asserts a problem with the planned session, it must
         expose a control that can resolve it. Saying "do something else" while
         offering no way to do something else is a correctness bug, not a
         design preference.

     I2  state fidelity
         The surface must not assert anything the domain state contradicts.
         I2a a substituted session must not be presented as the planned one.
         I2b a completed session must not carry live unmet-constraint advice.

     I3  destructive proximity
         No irreversible capability may be reachable in fewer or equal clicks
         than the reversible alternative it sits next to, unless it is
         confirmation-gated. Read from the capability registry's `reversible`
         and `confirmed` fields rather than a hardcoded name list.

     I4  explanation honesty
         If the surface tells the user a constraint is narrowing what they see,
         at least one component must actually be attributable to that
         constraint. Born directly from run 5: a surface that said "shown this
         way because: protecting your shoulder" and adapted nothing.

   WHERE EACH CAN BE CHECKED is the question the register is agnostic on, so
   every invariant here is tagged `derive` or `render`, and the tool reports the
   split. See the write-up.

   Usage: node --experimental-websocket tools/invariants.js <repoDir> <outDir> */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./cdp');

const REPO = process.argv[2];
const OUT = process.argv[3];
const PORT = 8791;

const PROFILES = [
  { name: 'default',          prefs: { protecting: 'none',     equipment: 'full', experience: 'regular',  timeBudget: '90' } },
  { name: 'ankle-full',       prefs: { protecting: 'ankle',    equipment: 'full', experience: 'regular',  timeBudget: '90' } },
  { name: 'novice-20min',     prefs: { protecting: 'none',     equipment: 'home', experience: 'novice',   timeBudget: '20' } },
  { name: 'advanced-full',    prefs: { protecting: 'none',     equipment: 'full', experience: 'advanced', timeBudget: '90' } },
  { name: 'shoulder-home',    prefs: { protecting: 'shoulder', equipment: 'home', experience: 'regular',  timeBudget: '45' } },
  { name: 'knee-nothing',     prefs: { protecting: 'knee',     equipment: 'none', experience: 'novice',   timeBudget: '20' } },
  { name: 'knee-evening',     completeMorning: true, prefs: { protecting: 'knee',  equipment: 'full', experience: 'regular', timeBudget: '90' } },
  { name: 'ankle-evening',    completeMorning: true, prefs: { protecting: 'ankle', equipment: 'full', experience: 'regular', timeBudget: '90' } },
  /* I2a was vacuous on the first run — no derivation in the matrix had an
     active substitution, so the invariant had no opportunity to fail. Added a
     profile that substitutes, rather than reporting a pass it had not earned. */
  { name: 'swapped-session',  substituteMorning: true, prefs: { protecting: 'none', equipment: 'full', experience: 'regular', timeBudget: '90' } }
];
const WEEKDAYS = ['Monday', 'Tuesday', 'Thursday', 'Saturday'];
const TARGETS = ['standard', 'large-type', 'reader-first'];

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

/* Runs inside the page against one derived surface. */
const CHECK = `(() => {
  const s = window.__datuxSurface;
  const caps = window.__datuxCapabilities;
  const f = s.facts;
  const ids = s.plan.map((p) => p.id);
  const panel = document.querySelector('.today');
  const text = panel.innerText.replace(/\\s+/g, ' ');
  const controls = [...panel.querySelectorAll('[data-capability]')];
  const capsOnSurface = new Set();
  controls.forEach((c) => c.dataset.capability.split(/\\s+/).forEach((x) => capsOnSurface.add(x)));

  const results = [];
  const add = (id, stage, ok, detail) => results.push({ id, stage, ok, detail });

  /* ---- I1 capability sufficiency ---- */
  const assertsProblem = ids.includes('adapt.protection') || ids.includes('detail.equipment_gap') || ids.includes('detail.time_fit');
  const RESOLVERS = ['session.substitute_exercise'];
  const plannedResolver = s.plan.some((p) => p.id === 'adapt.protection' && p.mode === 'ask');
  add('I1a-derive', 'derive', !assertsProblem || plannedResolver,
      assertsProblem ? (plannedResolver ? 'problem asserted, resolving component planned'
                                        : 'problem asserted, NO resolving component planned') : 'no problem asserted');
  const resolverPresent = RESOLVERS.some((c) => capsOnSurface.has(c));
  add('I1b-render', 'render', !assertsProblem || resolverPresent,
      assertsProblem ? (resolverPresent ? 'resolving control present on surface'
                                        : 'resolving control ABSENT from surface') : 'no problem asserted');

  /* ---- I2 state fidelity ---- */
  const prim = f.primary;
  const substituted = prim && prim.substitution;
  add('I2a-derive', 'derive', !substituted || text.includes(prim.substitution),
      substituted ? 'substitution present in surface text' : 'no substitution active');
  const completeWithLiveAdvice = prim && prim.complete && ids.includes('detail.time_fit');
  add('I2b-derive', 'derive', !completeWithLiveAdvice,
      completeWithLiveAdvice ? 'completed session still carries unmet-constraint advice' : 'ok');

  /* ---- I3 destructive proximity ---- */
  const irreversibleOneClick = controls.filter((c) => {
    return c.dataset.capability.split(/\\s+/).some((id) => {
      const meta = caps[id];
      return meta && meta.reversible === false && meta.confirmed === false;
    });
  }).map((c) => c.dataset.capability);
  add('I3-render', 'render', irreversibleOneClick.length === 0,
      irreversibleOneClick.length ? 'irreversible and unconfirmed in one click: ' + irreversibleOneClick.join(', ') : 'none');

  /* ---- I4 explanation honesty ---- */
  const named = [];
  if (/protecting your (ankle|shoulder|knee)/.test(text)) named.push('protecting');
  if (/equipment set to/.test(text)) named.push('equipment');
  if (/minutes available/.test(text)) named.push('time');
  const attributable = {
    protecting: ids.includes('adapt.protection'),
    equipment: ids.includes('detail.equipment_gap'),
    time: ids.includes('detail.time_fit')
  };
  const unbacked = named.filter((n) => !attributable[n]);
  add('I4-derive', 'derive', unbacked.length === 0,
      unbacked.length ? 'explanation names constraints that changed nothing: ' + unbacked.join(', ') : 'all named constraints backed');

  return JSON.stringify({ results, ids: ids, named: named, substituted: !!substituted });
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(REPO);
  const { proc, cdp } = await launch(9495);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await sleep(2500);

  const rows = [];
  for (const target of TARGETS) {
    for (const weekday of WEEKDAYS) {
      for (const p of PROFILES) {
        const prefs = Object.assign({ target }, p.prefs);
        await cdp.evaluate(`(() => {
          window.__datuxResetState();
          window.__datuxSetWeekday(${JSON.stringify(weekday)});
          if (${p.substituteMorning ? 'true' : 'false'}) {
            const sw = document.getElementById('s-' + ${JSON.stringify(weekday)}.toLowerCase() + '-morning-swap');
            if (sw) { sw.value = 'Easy swim (20–30 min)'; sw.dispatchEvent(new Event('change', { bubbles: true })); }
          }
          if (${p.completeMorning ? 'true' : 'false'}) {
            const d = document.getElementById('s-' + ${JSON.stringify(weekday)}.toLowerCase() + '-morning-done');
            if (d && d.getAttribute('aria-pressed') !== 'true') d.click();
          }
          const prefs = ${JSON.stringify(prefs)};
          Object.keys(prefs).forEach((k) => window.__datuxSetPreference(k, prefs[k]));
        })()`);
        const r = JSON.parse(await cdp.evaluate(CHECK));
        rows.push({ target, weekday, profile: p.name, results: r.results, ids: r.ids, named: r.named, substituted: r.substituted });
      }
    }
  }

  const byId = {};
  rows.forEach((row) => row.results.forEach((r) => {
    if (!byId[r.id]) byId[r.id] = { stage: r.stage, pass: 0, fail: 0, examples: [] };
    byId[r.id][r.ok ? 'pass' : 'fail']++;
    if (!r.ok && byId[r.id].examples.length < 3) {
      byId[r.id].examples.push(row.target + '/' + row.weekday + '/' + row.profile + ' — ' + r.detail);
    }
  }));

  console.log('=== Q4 CORRECTNESS INVARIANTS over ' + rows.length + ' derivations ===\n');
  console.log('invariant      stage   pass  fail');
  Object.entries(byId).forEach(([id, v]) => {
    console.log('  ' + id.padEnd(13) + v.stage.padEnd(8) + String(v.pass).padStart(4) + String(v.fail).padStart(6) +
      (v.fail ? '   <-- FAILS' : ''));
  });

  console.log('\n---- failures ----');
  let anyFail = false;
  Object.entries(byId).forEach(([id, v]) => {
    if (!v.fail) return;
    anyFail = true;
    console.log('\n' + id + '  (' + v.fail + '/' + (v.fail + v.pass) + ' derivations)');
    v.examples.forEach((e) => console.log('    ' + e));
  });
  if (!anyFail) console.log('  none');

  /* An invariant that never fails may be satisfied or may be unfalsifiable.
     Report which invariants had any opportunity to fail at all. */
  console.log('\n---- could each invariant have fired? ----');
  const opportunity = {
    'I1a-derive': rows.filter((r) => r.ids.some((i) => ['adapt.protection', 'detail.equipment_gap', 'detail.time_fit'].includes(i))).length,
    'I1b-render': rows.filter((r) => r.ids.some((i) => ['adapt.protection', 'detail.equipment_gap', 'detail.time_fit'].includes(i))).length,
    'I2a-derive': rows.filter((r) => r.substituted).length,
    'I2b-derive': rows.filter((r) => r.ids.includes('detail.time_fit')).length,
    'I3-render': rows.length,
    'I4-derive': rows.filter((r) => r.named && r.named.length > 0).length
  };
  Object.entries(opportunity).forEach(([id, n]) => {
    console.log('  ' + id.padEnd(13) + 'derivations meeting its precondition: ' + String(n).padStart(4) +
      (n === 0 ? '   <-- NEVER TESTED, invariant is vacuous here' : ''));
  });

  const stages = { derive: { pass: 0, fail: 0 }, render: { pass: 0, fail: 0 } };
  Object.values(byId).forEach((v) => { stages[v.stage].pass += v.pass; stages[v.stage].fail += v.fail; });
  console.log('\n---- where the failures live ----');
  console.log('  derivation-time checks: ' + stages.derive.fail + ' failures of ' + (stages.derive.pass + stages.derive.fail));
  console.log('  render-time checks    : ' + stages.render.fail + ' failures of ' + (stages.render.pass + stages.render.fail));

  fs.writeFileSync(path.join(OUT, 'invariants.json'), JSON.stringify({ rows, byId, opportunity }, null, 2), 'utf8');
  proc.kill(); server.close();
  process.exit(0);
})().catch((e) => { console.error('INVARIANTS FAILED', e); process.exit(1); });
