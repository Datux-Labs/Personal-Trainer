'use strict';
/* Cross-engine accessible-name divergence â€” run 4.

   ADR 0010 was decided entirely on Chromium. If Gecko computes materially
   different names for the same elements, then the per-deployment conformance
   gate needs a browser dimension, and "observe from outside the page" stops
   being one measurement and becomes several.

   Blink names come from Chromium's own accessibility tree over CDP â€” the same
   source used as ground truth in run 3.
   Gecko names come from WebDriver's spec-defined "Get Computed Label", which
   delegates to Firefox's own accessible-name computation.

   Note on what does NOT work, because it is a trap: Playwright removed
   page.accessibility in 1.62, and its ariaSnapshot()/getByRole() compute names
   in injected JavaScript. Those are identical in every engine and would have
   produced a confident, meaningless "engines agree perfectly" result.

   Elements are joined across engines by DOM path, not by index and not by
   name, so alignment never depends on the thing being measured.

   Both engines are served a FROZEN SNAPSHOT of each page, not the live URL.
   The first attempt compared live loads and produced 6% "disjoint" names that
   turned out to be Hacker News reordering its front page between the two
   passes â€” content drift masquerading as engine divergence. Chromium now
   renders the live page once, the fully-rendered DOM is captured with scripts
   stripped and a <base> added so stylesheets still resolve, and both engines
   read that identical byte stream from localhost. CSS is deliberately kept,
   because text-transform participates in accessible-name computation.

   Requires, all outside this repo:
     - geckodriver.exe
     - a Firefox binary (Playwright's bundled build works)
   Usage:
     node --experimental-websocket tools/crossengine.js <outdir> <geckodriver.exe> <firefox.exe> [runLabel]
   Read-only: one live GET per site, then local replay. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sleep, launch, probeMap } = require('./cdp');

const OUT = process.argv[2];
const GECKODRIVER = process.argv[3];
const FIREFOX = process.argv[4];
const RUN_LABEL = process.argv[5] || 'run1';
const WD_PORT = 4455;
const SNAP_PORT = 8766;
const MAX_PER_SITE = 160;

const CORPUS = [
  ['gov-uk',        'https://www.gov.uk/'],
  ['hacker-news',   'https://news.ycombinator.com/'],
  ['python-org',    'https://www.python.org/'],
  ['wikipedia',     'https://en.wikipedia.org/wiki/Accessibility'],
  ['bootstrap',     'https://getbootstrap.com/'],
  ['nodejs',        'https://nodejs.org/en'],
  ['mdn',           'https://developer.mozilla.org/en-US/'],
  ['cdc',           'https://www.cdc.gov/'],
  ['bbc-news',      'https://www.bbc.co.uk/news'],
  ['tailwind',      'https://tailwindcss.com/']
];

const ACTIONABLE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch',
  'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab',
  'option', 'treeitem', 'listbox'
]);

/* Tags every candidate control and returns a DOM-path signature per element.
   The path is engine-independent and name-independent. */
const PROBE_BODY = `
  const sel = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [role="option"], [role="searchbox"], [role="textbox"]';
  const pathOf = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n.tagName !== 'HTML') {
      let idx = 1, s = n.previousElementSibling;
      while (s) { if (s.tagName === n.tagName) idx++; s = s.previousElementSibling; }
      parts.unshift(n.tagName + '[' + idx + ']');
      n = n.parentElement;
    }
    return parts.join('/');
  };
  let i = 0; const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const key = String(++i);
    el.setAttribute('data-axprobe', key);
    out.push({ key: key, path: pathOf(el) });
  }
  return out;`;

const nrm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const loose = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function wd(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: WD_PORT, path: urlPath, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b.slice(0, 160))); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function classify(a, b) {
  const x = nrm(a), y = nrm(b);
  if (x === y) return 'agree';
  if (!x && y) return 'gecko-only-name';
  if (x && !y) return 'blink-only-name';
  if (x.toLowerCase() === y.toLowerCase()) return 'case-only';
  if (x.replace(/[\s\u00a0]/g, '') === y.replace(/[\s\u00a0]/g, '')) return 'whitespace-only';
  if (loose(x) === loose(y)) return 'punctuation-only';
  if (y.includes(x) || x.includes(y)) return 'substring';
  return 'disjoint';
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const snapDir = path.join(OUT, 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });

  /* ---- Freeze each page once, from a single Chromium render ---- */
  const { proc, cdp } = await launch(9441);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');

  for (const [site, url] of CORPUS) {
    try {
      await cdp.send('Page.navigate', { url });
      await sleep(7000);
      const html = await cdp.evaluate(`(() => {
        document.querySelectorAll('script').forEach((s) => s.remove());
        const base = document.createElement('base');
        base.href = location.href;
        document.head.insertBefore(base, document.head.firstChild);
        return '<!doctype html>' + document.documentElement.outerHTML;
      })()`);
      fs.writeFileSync(path.join(snapDir, site + '.html'), html, 'utf8');
      console.log('  frozen ' + site.padEnd(14) + Math.round(Buffer.byteLength(html) / 1024) + ' KB');
    } catch (e) {
      console.log('  frozen ' + site.padEnd(14) + 'ERROR ' + String(e.message).slice(0, 60));
    }
  }

  const snapServer = http.createServer((req, res) => {
    const f = path.join(snapDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  });
  await new Promise((r) => snapServer.listen(SNAP_PORT, '127.0.0.1', r));
  const snapUrl = (site) => 'http://127.0.0.1:' + SNAP_PORT + '/' + site + '.html';

  /* ---- Blink pass: names from Chromium's accessibility tree over CDP ---- */
  const blink = {};
  for (const [site] of CORPUS) {
    try {
      await cdp.send('Page.navigate', { url: snapUrl(site) });
      await sleep(3500);
      const probed = await cdp.evaluate('(() => {' + PROBE_BODY + '})()');
      const backendToProbe = await probeMap(cdp);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const byProbe = new Map();
      nodes.forEach((n) => {
        const p = backendToProbe.get(n.backendDOMNodeId);
        if (p && !n.ignored) byProbe.set(p, n);
      });
      const out = {};
      probed.forEach((e) => {
        const ax = byProbe.get(e.key);
        if (!ax || !ax.role || !ACTIONABLE.has(ax.role.value)) return;
        out[e.path] = { name: nrm(ax.name && ax.name.value), role: ax.role.value };
      });
      blink[site] = out;
      console.log('  blink  ' + site.padEnd(14) + Object.keys(out).length + ' named controls');
    } catch (e) {
      console.log('  blink  ' + site.padEnd(14) + 'ERROR ' + String(e.message).slice(0, 70));
      blink[site] = {};
    }
  }
  proc.kill();

  /* ---- Gecko pass: names from WebDriver Get Computed Label ---- */
  const gecko = {};
  const driver = spawn(GECKODRIVER, ['--port', String(WD_PORT)], { stdio: 'ignore' });
  await sleep(2500);
  const sess = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': { binary: FIREFOX, args: ['-headless'] },
        acceptInsecureCerts: true
      }
    }
  });
  if (!sess.value || !sess.value.sessionId) {
    console.error('could not start a Gecko session: ' + JSON.stringify(sess).slice(0, 200));
    driver.kill();
    process.exit(2);
  }
  const sid = sess.value.sessionId;

  for (const [site] of CORPUS) {
    try {
      await wd('POST', '/session/' + sid + '/url', { url: snapUrl(site) });
      await sleep(3500);
      const ex = await wd('POST', '/session/' + sid + '/execute/sync', { script: PROBE_BODY, args: [] });
      const probed = (ex.value || []).slice(0, MAX_PER_SITE);
      const out = {};
      for (const e of probed) {
        const fe = await wd('POST', '/session/' + sid + '/element', { using: 'css selector', value: '[data-axprobe="' + e.key + '"]' });
        if (!fe.value || fe.value.error) continue;
        const id = fe.value[Object.keys(fe.value)[0]];
        const lab = await wd('GET', '/session/' + sid + '/element/' + id + '/computedlabel');
        const rol = await wd('GET', '/session/' + sid + '/element/' + id + '/computedrole');
        if (lab.value && lab.value.error) continue;
        out[e.path] = { name: nrm(lab.value), role: String(rol.value || '') };
      }
      gecko[site] = out;
      console.log('  gecko  ' + site.padEnd(14) + Object.keys(out).length + ' computed labels');
    } catch (e) {
      console.log('  gecko  ' + site.padEnd(14) + 'ERROR ' + String(e.message).slice(0, 70));
      gecko[site] = {};
    }
  }
  await wd('DELETE', '/session/' + sid);
  driver.kill();
  snapServer.close();

  /* ---- Compare on DOM path ---- */
  const classTotals = {};
  const examples = {};
  const perSite = [];
  let totalCompared = 0, totalAgree = 0, totalLoose = 0;

  for (const [site] of CORPUS) {
    const b = blink[site] || {}, g = gecko[site] || {};
    const shared = Object.keys(b).filter((p) => g[p]);
    let agree = 0, looseAgree = 0;
    shared.forEach((p) => {
      const cls = classify(b[p].name, g[p].name);
      if (cls === 'agree') agree++;
      else {
        classTotals[cls] = (classTotals[cls] || 0) + 1;
        if (!examples[cls]) examples[cls] = [];
        if (examples[cls].length < 3) examples[cls].push({ site, blink: b[p].name.slice(0, 62), gecko: g[p].name.slice(0, 62) });
      }
      if (loose(b[p].name) === loose(g[p].name)) looseAgree++;
    });
    totalCompared += shared.length; totalAgree += agree; totalLoose += looseAgree;
    perSite.push({
      site, blinkNamed: Object.keys(b).length, geckoNamed: Object.keys(g).length, shared: shared.length,
      exactPct: shared.length ? Math.round(agree / shared.length * 100) : null,
      loosePct: shared.length ? Math.round(looseAgree / shared.length * 100) : null
    });
  }

  console.log('\n============ CROSS-ENGINE (' + RUN_LABEL + ') ============');
  console.log('site            blink  gecko  shared   exact  normalised');
  perSite.forEach((r) => console.log('  ' + r.site.padEnd(14) +
    String(r.blinkNamed).padStart(5) + String(r.geckoNamed).padStart(7) + String(r.shared).padStart(8) +
    String(r.exactPct === null ? '-' : r.exactPct + '%').padStart(8) + String(r.loosePct === null ? '-' : r.loosePct + '%').padStart(11)));
  console.log('\n  TOTAL compared=' + totalCompared +
    '   exact=' + (totalCompared ? Math.round(totalAgree / totalCompared * 100) : 0) + '%' +
    '   normalised=' + (totalCompared ? Math.round(totalLoose / totalCompared * 100) : 0) + '%');

  console.log('\n---- divergence by class ----');
  Object.entries(classTotals).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log('  ' + String(v).padStart(5) + '  ' + k + '  (' + Math.round(v / totalCompared * 1000) / 10 + '%)');
    (examples[k] || []).slice(0, 2).forEach((e) =>
      console.log('           ' + e.site + '  blink="' + e.blink + '"  gecko="' + e.gecko + '"'));
  });

  fs.writeFileSync(path.join(OUT, 'crossengine-' + RUN_LABEL + '.json'),
    JSON.stringify({ perSite, classTotals, examples, totalCompared, totalAgree, totalLoose }, null, 2), 'utf8');
  process.exit(0);
})().catch((e) => { console.error('CROSS-ENGINE FAILED', e); process.exit(1); });
