'use strict';
/* Authenticated application interiors â€” the open half of run 4 item 2.

   Run 3's corpus was landing pages. Run 4 measured anonymous app interiors and
   found them better, not worse. This closes the gap: interiors behind a login,
   which is where the brief expected markup to be worst.

   Ethics, deliberately narrow:
     - Only public demo instances whose operator PUBLISHES the credentials on
       the login page itself for open trial. No private accounts, no borrowed
       credentials, no credential guessing.
     - Log in, navigate, measure. Nothing is created, edited or deleted.
     - Credentials appear in this file because they are printed on the target's
       own login screen. They are not secrets and must never be treated as a
       pattern for handling real ones.

   Reuses the same eight AccName rungs as accname.js so the numbers are
   directly comparable to runs 3 and 4.

   Usage: node --experimental-websocket tools/authinteriors.js <outdir> */

const fs = require('fs');
const path = require('path');
const { sleep, launch, probeMap } = require('./cdp');
const { IN_PAGE, classify, ACTIONABLE, nrm, loose } = require('./accname');

const OUT = process.argv[2];

const TARGETS = [
  {
    name: 'orangehrm',
    login: 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login',
    fill: `(() => {
      const u = document.querySelector('input[name="username"]');
      const p = document.querySelector('input[name="password"]');
      if (!u || !p) return 'NO_FORM';
      const set = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(u, 'Admin'); set(p, 'admin123');
      const b = document.querySelector('button[type="submit"]');
      if (!b) return 'NO_BUTTON';
      b.click(); return 'SUBMITTED';
    })()`,
    interiors: [
      ['dashboard', 'https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index'],
      ['employee-list', 'https://opensource-demo.orangehrmlive.com/web/index.php/pim/viewEmployeeList'],
      ['admin-users', 'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewSystemUsers']
    ]
  },
  {
    name: 'saucedemo',
    login: 'https://www.saucedemo.com/',
    fill: `(() => {
      const u = document.querySelector('#user-name');
      const p = document.querySelector('#password');
      if (!u || !p) return 'NO_FORM';
      const set = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(u, 'standard_user'); set(p, 'secret_sauce');
      const b = document.querySelector('#login-button');
      if (!b) return 'NO_BUTTON';
      b.click(); return 'SUBMITTED';
    })()`,
    interiors: [
      ['inventory', 'https://www.saucedemo.com/inventory.html'],
      ['cart', 'https://www.saucedemo.com/cart.html']
    ]
  }
];

async function measure(cdp, label) {
  const probed = JSON.parse(await cdp.evaluate(IN_PAGE));
  const backendToProbe = await probeMap(cdp);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const axByProbe = new Map();
  nodes.forEach((n) => {
    const p = backendToProbe.get(n.backendDOMNodeId);
    if (p && !n.ignored) axByProbe.set(p, n);
  });
  const keys = Object.keys(probed.probes).filter((k) => {
    const ax = axByProbe.get(k);
    return ax && ax.role && ACTIONABLE.has(ax.role.value);
  });
  const agree = [0, 0, 0, 0, 0, 0, 0, 0];
  const agreeN = [0, 0, 0, 0, 0, 0, 0, 0];
  const classes = {};
  const samples = [];
  /* Conformance says the SDK matched the browser. It says nothing about
     whether the browser's name is usable as identity. Icon-font UIs produce
     names made of Private Use Area glyphs, which are perfectly conformant and
     completely meaningless. */
  let junkNames = 0, puaNames = 0, namedTotal = 0;
  const hasPua = (s) => [...s].some((c) => {
    const p = c.codePointAt(0);
    return (p >= 0xE000 && p <= 0xF8FF) || (p >= 0xF0000 && p <= 0xFFFFD);
  });
  keys.forEach((k) => {
    const ax = axByProbe.get(k);
    const browser = ax.name && ax.name.value ? ax.name.value : '';
    const meta = probed.probes[k];
    meta.names.forEach((mine, lv) => {
      if (nrm(mine) === nrm(browser)) agree[lv]++;
      if (loose(mine) === loose(browser)) agreeN[lv]++;
    });
    const cls = classify(meta.names[7], browser, meta);
    if (cls !== 'agree') classes[cls] = (classes[cls] || 0) + 1;
    const bn = nrm(browser);
    if (bn) {
      namedTotal++;
      if (!/[\p{L}\p{N}]/u.test(bn)) junkNames++;
      if (hasPua(bn)) puaNames++;
    }
    /* Where naive and v7 disagree, the browser name is worth eyeballing: a high
       conformance score says the SDK matched the browser, not that the name is
       meaningful to a human. */
    if (samples.length < 6 && nrm(meta.names[0]) !== nrm(browser)) {
      samples.push({
        tag: meta.tag,
        naive: nrm(meta.names[0]).slice(0, 40),
        v7: nrm(meta.names[7]).slice(0, 40),
        browser: nrm(browser).slice(0, 40),
        browserCodes: [...nrm(browser).slice(0, 12)].map((c) => c.codePointAt(0)).join(',')
      });
    }
  });
  return {
    state: label,
    n: keys.length,
    pct: agree.map((a) => (keys.length ? Math.round(a / keys.length * 100) : null)),
    pctN: agreeN.map((a) => (keys.length ? Math.round(a / keys.length * 100) : null)),
    classes,
    samples,
    namedTotal: namedTotal,
    junkNames: junkNames,
    puaNames: puaNames
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, cdp } = await launch(9451);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');

  const rows = [];
  for (const t of TARGETS) {
    await cdp.send('Page.navigate', { url: t.login });
    await sleep(6000);
    const res = await cdp.evaluate(t.fill);
    await sleep(6000);
    const landed = await cdp.evaluate('location.href');
    const authed = !/login|^\s*$/i.test(landed) || landed !== t.login;
    console.log('\n' + t.name + ': login ' + res + ' -> ' + landed.slice(0, 70) + (authed ? '' : '   <-- STILL ON LOGIN'));
    if (!authed) continue;

    for (const [label, url] of t.interiors) {
      try {
        await cdp.send('Page.navigate', { url });
        await sleep(5000);
        const here = await cdp.evaluate('location.href');
        if (/auth\/login|\/login/i.test(here)) { console.log('  ' + label + ': bounced back to login, skipped'); continue; }
        const r = await measure(cdp, t.name + '/' + label);
        rows.push(r);
        console.log('  ' + (t.name + '/' + label).padEnd(26) + 'n=' + String(r.n).padStart(4) +
          '   naive=' + String(r.pct[0]).padStart(3) + '%   v7=' + String(r.pct[7]).padStart(3) +
          '%   v7norm=' + String(r.pctN[7]).padStart(3) + '%');
      } catch (e) {
        console.log('  ' + label + ': ERROR ' + String(e.message).slice(0, 60));
      }
    }
  }

  const total = rows.reduce((s, r) => s + r.n, 0);
  const w = (lv, key) => (total ? Math.round(rows.reduce((s, r) => s + (r[key][lv] / 100) * r.n, 0) / total * 100) : 0);
  console.log('\n================ AUTHENTICATED INTERIORS ================');
  console.log('states measured: ' + rows.length + '   elements compared: ' + total);
  ['naive', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'].forEach((lbl, lv) =>
    console.log('  ' + lbl.padEnd(6) + ' exact=' + String(w(lv, 'pct')).padStart(3) + '%   normalised=' + String(w(lv, 'pctN')).padStart(3) + '%'));

  const allClasses = {};
  rows.forEach((r) => Object.entries(r.classes).forEach(([k, v]) => { allClasses[k] = (allClasses[k] || 0) + v; }));
  console.log('\n---- residual divergence at v7 ----');
  Object.entries(allClasses).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log('  ' + String(v).padStart(4) + '  ' + k + '  (' + Math.round(v / total * 1000) / 10 + '%)'));

  const nt = rows.reduce((s, r) => s + r.namedTotal, 0);
  const jn = rows.reduce((s, r) => s + r.junkNames, 0);
  const pn = rows.reduce((s, r) => s + r.puaNames, 0);
  console.log('\n---- are the names usable as identity? ----');
  console.log('  controls with a non-empty browser name : ' + nt);
  console.log('  names containing NO letter or digit     : ' + jn + '  (' + (nt ? Math.round(jn / nt * 1000) / 10 : 0) + '%)');
  console.log('  names containing a private-use glyph    : ' + pn + '  (' + (nt ? Math.round(pn / nt * 1000) / 10 : 0) + '%)');

  console.log('\n---- what the agreed names actually are (naive != browser) ----');
  rows.forEach((r) => {
    (r.samples || []).slice(0, 3).forEach((s) =>
      console.log('  ' + r.state.padEnd(24) + '<' + s.tag + '> naive="' + s.naive + '"  v7="' + s.v7 + '"  browser="' + s.browser + '"  [' + s.browserCodes + ']'));
  });

  fs.writeFileSync(path.join(OUT, 'auth-interiors.json'), JSON.stringify({ rows, total }, null, 2), 'utf8');
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('AUTH INTERIORS FAILED', e); process.exit(1); });
