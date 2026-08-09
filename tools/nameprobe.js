'use strict';
/* Q16 precondition — prove a name source is engine-computed before trusting it.

   Run 4 nearly produced a confident wrong answer. Playwright removed
   page.accessibility in 1.62, and its ariaSnapshot() computes accessible names
   in injected JavaScript. Those names are identical in every browser, so a
   cross-engine comparison built on them returns perfect agreement while
   measuring nothing at all. The failure is silent and it flatters.

   This is the fixture that catches it. It builds a page where a naive
   text-based implementation and a real engine MUST disagree, then reports what
   the engine actually computed. Any tool claiming to report accessible names
   should be run against nameprobe.html and checked against these expectations
   before its numbers are believed.

   The discriminators, and why each one separates a real engine from a
   reimplementation:
     1. text-transform: uppercase feeding aria-labelledby — AccName uses
        RENDERED text, so the engine uppercases and textContent does not.
     2. a title attribute on a descendant of a link — engines differ here, and
        naive implementations miss it entirely.
     3. an unlabelled select — engines give it no name; naive implementations
        tend to invent one from the option text.
     4. CSS ::before generated content — part of the name, invisible to
        textContent.

   Usage: node --experimental-websocket tools/nameprobe.js <outDir> */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./cdp');

const OUT = process.argv[2] || '.';
const PORT = 8799;

const FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AccName discriminator</title>
<style>
  .shout { text-transform: uppercase; }
  .icon::before { content: "Save "; }
</style></head>
<body>
  <span id="lbl" class="shout">Morning</span>
  <button id="c1" aria-labelledby="c1 lbl">Done</button>

  <a id="c2" href="#"><span title="upvote"></span></a>

  <label for="c3" id="lbl3">Sort by<select id="c3"><option>Name</option><option>Price</option></select></label>

  <select id="c4"><option>Alpha</option><option>Beta</option></select>

  <button id="c5" class="icon">now</button>
</body></html>`;

/* What a real engine should produce. A reimplementation that agrees with the
   naive column on any row is computing names itself. */
const EXPECTATIONS = [
  ['c1', 'text-transform in aria-labelledby', 'Done MORNING', 'Done Morning'],
  ['c2', 'title on a descendant of a link',   'engine-specific: Blink "" / Gecko "upvote"', ''],
  ['c3', 'label wrapping its own control',    'Sort by', 'Sort by Name Price'],
  ['c4', 'unlabelled select',                 '', 'Alpha Beta'],
  ['c5', 'CSS generated content',             'Save now', 'now']
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixturePath = path.join(OUT, 'nameprobe.html');
  fs.writeFileSync(fixturePath, FIXTURE, 'utf8');

  const server = await new Promise((r) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FIXTURE);
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
  });

  const { proc, cdp } = await launch(9481);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(1500);

  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const dom = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const byBackend = new Map();
  const walk = (n) => {
    if (n.attributes) {
      const i = n.attributes.indexOf('id');
      if (i >= 0 && i % 2 === 0) byBackend.set(n.backendNodeId, n.attributes[i + 1]);
    }
    (n.children || []).forEach(walk);
    if (n.contentDocument) walk(n.contentDocument);
  };
  walk(dom.root);
  const engine = {};
  nodes.forEach((n) => {
    const id = byBackend.get(n.backendDOMNodeId);
    if (id && !n.ignored) engine[id] = (n.name && n.name.value ? n.name.value : '').replace(/\s+/g, ' ').trim();
  });

  const naive = await cdp.evaluate(`JSON.stringify(Object.fromEntries(
    ['c1','c2','c3','c4','c5'].map((id) => {
      const el = document.getElementById(id);
      const lbl = el.getAttribute('aria-label');
      let n = lbl || (el.textContent || '').trim();
      if (!n && el.id) { const l = document.querySelector('label[for="' + el.id + '"]'); if (l) n = l.textContent.trim(); }
      if (!n && el.tagName === 'SELECT') n = [...el.options].map((o) => o.text).join(' ');
      return [id, n.replace(/\\s+/g, ' ').trim()];
    })))`);
  const naiveNames = JSON.parse(naive);

  console.log('fixture written to ' + fixturePath + '\n');
  console.log('id   discriminator                       engine (this browser)      a naive implementation');
  console.log('---  ----------------------------------  -------------------------  ----------------------');
  let separated = 0;
  EXPECTATIONS.forEach(([id, why]) => {
    const e = engine[id] === undefined ? '(not exposed)' : JSON.stringify(engine[id]);
    const n = JSON.stringify(naiveNames[id]);
    const differs = JSON.stringify(engine[id] || '') !== JSON.stringify(naiveNames[id] || '');
    if (differs) separated++;
    console.log(id.padEnd(5) + why.padEnd(36) + e.padEnd(27) + n + (differs ? '' : '   <-- no separation'));
  });

  console.log('\ndiscriminating rows: ' + separated + '/' + EXPECTATIONS.length);
  console.log(separated >= 3
    ? 'PASS — this fixture separates an engine from a reimplementation. Run any\n' +
      '       candidate name source against it; if the source matches the naive\n' +
      '       column, it is computing names itself and its agreement numbers are\n' +
      '       manufactured.'
    : 'WEAK — the fixture failed to separate. Do not rely on it until it does.');

  proc.kill();
  server.close();
  process.exit(separated >= 3 ? 0 : 1);
})().catch((e) => { console.error('NAMEPROBE FAILED', e); process.exit(1); });
