'use strict';
/* Run 5 follow-up — is the derived difference MATERIAL or COSMETIC?

   Run 4 item 2 showed a metric can be perfectly correct about the wrong
   quantity: 100% name conformance on names that were icon glyphs. The metric
   could not catch it; reading the actual names could.

   "7 of 8 distinct component sets" is the same shape of claim. It counts
   whether the component SETS differ. It does not ask whether a person would
   notice, or whether the difference changes what they DO rather than what they
   READ. This tool asks both:

     - splits components into MATERIAL (changes the recommended action or tells
       the user they cannot do the planned thing) and ADVISORY (changes what
       they read about it), and recomputes the distinctness metric over the
       material subset only;
     - dumps the actual rendered text of each surface, so the surfaces can be
       judged by reading them rather than by counting them.

   Usage: node --experimental-websocket tools/derivecontrast.js <repoDir> <outDir> */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./cdp');

const REPO = process.argv[2];
const OUT = process.argv[3];
const PORT = 8790;
const WEEKDAY = 'Tuesday';

/* Does the component change what the user should DO, or only what they read? */
/* Run 7 adds adapt.applied — the component that actually replaces the plan —
   and adapt.dismissed. Both change what the user should do, so they belong on
   the material side by the same rule the original split used. */
const MATERIAL = new Set(['adapt.protection', 'adapt.applied', 'adapt.dismissed', 'detail.equipment_gap', 'detail.time_fit', 'notice.substitution']);
const ADVISORY = new Set(['headline', 'action.substitute', 'secondary.checklist', 'secondary.guideline', 'explain.why']);

const PROFILES = [
  { name: 'A-default',        prefs: { protecting: 'none',     equipment: 'full', experience: 'regular',  timeBudget: '90' } },
  { name: 'B-ankle-full',     prefs: { protecting: 'ankle',    equipment: 'full', experience: 'regular',  timeBudget: '90' } },
  { name: 'C-novice-20min',   prefs: { protecting: 'none',     equipment: 'home', experience: 'novice',   timeBudget: '20' } },
  { name: 'D-advanced',       prefs: { protecting: 'none',     equipment: 'full', experience: 'advanced', timeBudget: '90' } },
  { name: 'E-shoulder-home',  prefs: { protecting: 'shoulder', equipment: 'home', experience: 'regular',  timeBudget: '45' } },
  { name: 'F-knee-nothing',   prefs: { protecting: 'knee',     equipment: 'none', experience: 'novice',   timeBudget: '20' } }
];

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(REPO);
  const { proc, cdp } = await launch(9491);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await sleep(2500);

  const rows = [];
  for (const p of PROFILES) {
    const prefs = Object.assign({ target: 'standard' }, p.prefs);
    const r = await cdp.evaluate(`(() => {
      localStorage.removeItem('pt.l2.dismissed.v1');
      window.__datuxSetWeekday(${JSON.stringify(WEEKDAY)});
      const prefs = ${JSON.stringify(prefs)};
      Object.keys(prefs).forEach((k) => window.__datuxSetPreference(k, prefs[k]));
      const s = window.__datuxSurface;
      const panel = document.querySelector('.today');
      return JSON.stringify({
        ids: s.plan.map((x) => x.id),
        text: panel.innerText.replace(/\\u00a0/g, ' ').split('\\n').map((l) => l.trim()).filter(Boolean)
      });
    })()`);
    const parsed = JSON.parse(r);
    const box = await cdp.evaluate(`(() => { const b = document.querySelector('.today').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) }); })()`);
    const clip = JSON.parse(box);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 }
    });
    fs.writeFileSync(path.join(OUT, p.name + '.png'), Buffer.from(shot.data, 'base64'));
    rows.push(Object.assign({ profile: p.name }, parsed));
  }

  const key = (r, set) => r.ids.filter((i) => set.has(i)).sort().join('|');
  const allKey = (r) => r.ids.slice().sort().join('|');

  console.log('=== what each user actually sees (' + WEEKDAY + ', standard target) ===\n');
  rows.forEach((r) => {
    console.log('--- ' + r.profile + ' ---');
    r.text.forEach((l) => console.log('    ' + l));
    console.log('    [material: ' + (key(r, MATERIAL) || 'none') + ']\n');
  });

  const distinctAll = new Set(rows.map(allKey)).size;
  const distinctMaterial = new Set(rows.map((r) => key(r, MATERIAL))).size;
  const distinctAdvisory = new Set(rows.map((r) => key(r, ADVISORY))).size;
  const distinctText = new Set(rows.map((r) => r.text.join(' '))).size;

  console.log('=== distinctness, decomposed ===');
  console.log('  distinct full component sets      : ' + distinctAll + '/' + rows.length + '   <- the number run 5 reported');
  console.log('  distinct MATERIAL component sets  : ' + distinctMaterial + '/' + rows.length + '   <- changes what the user should do');
  console.log('  distinct ADVISORY component sets  : ' + distinctAdvisory + '/' + rows.length + '   <- changes what the user reads');
  console.log('  distinct rendered text            : ' + distinctText + '/' + rows.length);

  const noMaterial = rows.filter((r) => !key(r, MATERIAL));
  console.log('\n  users receiving NO material adaptation at all: ' + noMaterial.length + '/' + rows.length +
    (noMaterial.length ? ' (' + noMaterial.map((r) => r.profile).join(', ') + ')' : ''));

  console.log('\n=== pairs that share every material component ===');
  let cosmeticPairs = 0, totalPairs = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      totalPairs++;
      if (key(rows[i], MATERIAL) === key(rows[j], MATERIAL)) {
        cosmeticPairs++;
        console.log('    ' + rows[i].profile + ' / ' + rows[j].profile + '   differ only in advisory content');
      }
    }
  }
  console.log('\n  pairs differing only cosmetically: ' + cosmeticPairs + '/' + totalPairs);

  fs.writeFileSync(path.join(OUT, 'contrast.json'), JSON.stringify({ weekday: WEEKDAY, rows }, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'surfaces.txt'),
    rows.map((r) => '===== SURFACE ' + r.profile.split('-')[0] + ' =====\n' + r.text.join('\n')).join('\n\n'), 'utf8');
  console.log('\nwrote surfaces.txt and one screenshot per profile to ' + OUT);

  proc.kill(); server.close();
  process.exit(0);
})().catch((e) => { console.error('CONTRAST FAILED', e); process.exit(1); });
