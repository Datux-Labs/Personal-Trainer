'use strict';
/* Screen candidate public apps for accessibility-semantic quality, so target
   selection is measured rather than guessed.

   Metric, per page:
     interactive   elements a user can plausibly act on (real tags, ARIA roles,
                   click handlers, or cursor:pointer)
     roleOk        fraction of those exposing an actionable accessibility role
     nameOk        fraction of those with a non-empty accessible name
     divSoup       click targets that are div/span with no role at all
   roleOk is the headline: it is the fraction of the interface that
   instrumentation.md §3 can actually address. */

const fs = require('fs');
const path = require('path');
const { sleep, launch, probeMap, ACTIONABLE_ROLES } = require('./cdp');

const OUT = process.argv[2];
const TARGETS = [
  ['opencart',      'https://demo.opencart.com/'],
  ['magento-demo',  'https://magento.softwaretestingboard.com/'],
  ['grafana-play',  'https://play.grafana.org/'],
  ['openfoodfacts', 'https://world.openfoodfacts.org/'],
  ['openstreetmap', 'https://www.openstreetmap.org/'],
  ['discourse-meta','https://meta.discourse.org/'],
  ['gov-uk',        'https://www.gov.uk/'],
  ['mastodon',      'https://mastodon.social/explore'],
  ['drawio',        'https://app.diagrams.net/'],
  ['gitea-try',     'https://try.gitea.io/']
];

const PROBE = `(() => {
  const sel = 'a[href], button, input, select, textarea, summary, [role], [onclick], [tabindex]';
  const set = new Set(document.querySelectorAll(sel));
  document.querySelectorAll('div, span, li, td, i, svg, img').forEach((e) => {
    if (set.has(e)) return;
    const cs = getComputedStyle(e);
    if (cs.cursor === 'pointer' && cs.display !== 'none' && cs.visibility !== 'hidden') set.add(e);
  });
  let i = 0;
  const meta = {};
  for (const e of set) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const key = String(++i);
    e.setAttribute('data-axprobe', key);
    meta[key] = {
      tag: e.tagName.toLowerCase(),
      roleAttr: e.getAttribute('role') || null,
      pointer: cs.cursor === 'pointer',
      text: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
    };
  }
  return JSON.stringify({ meta: meta, title: document.title, url: location.href });
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, cdp } = await launch(9401);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');

  const results = [];
  for (const [name, url] of TARGETS) {
    const row = { name, url };
    try {
      await cdp.send('Page.navigate', { url });
      await sleep(7000);
      const probed = JSON.parse(await cdp.evaluate(PROBE));
      const backendToProbe = await probeMap(cdp);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');

      const axByProbe = new Map();
      nodes.forEach((n) => {
        const p = backendToProbe.get(n.backendDOMNodeId);
        if (p) axByProbe.set(p, n);
      });

      const keys = Object.keys(probed.meta);
      let roleOk = 0, nameOk = 0, divSoup = 0, missing = 0;
      const soupExamples = [];
      keys.forEach((k) => {
        const ax = axByProbe.get(k);
        const meta = probed.meta[k];
        const role = ax && ax.role ? ax.role.value : null;
        const nm = ax && ax.name && ax.name.value ? ax.name.value.trim() : '';
        if (!ax) missing++;
        if (role && ACTIONABLE_ROLES.has(role)) roleOk++;
        if (nm) nameOk++;
        const structural = ['div', 'span', 'li', 'td', 'i', 'svg', 'img'].includes(meta.tag);
        if (meta.pointer && structural && !meta.roleAttr && (!role || !ACTIONABLE_ROLES.has(role))) {
          divSoup++;
          if (soupExamples.length < 4) soupExamples.push(meta.tag + ' "' + meta.text + '"');
        }
      });

      Object.assign(row, {
        title: probed.title,
        finalUrl: probed.url,
        interactive: keys.length,
        roleOkPct: keys.length ? Math.round((roleOk / keys.length) * 100) : 0,
        nameOkPct: keys.length ? Math.round((nameOk / keys.length) * 100) : 0,
        divSoup, missingFromAx: missing, axNodes: nodes.length, soupExamples
      });
    } catch (e) {
      row.error = String(e.message || e).slice(0, 160);
    }
    results.push(row);
    console.log(
      (row.name + '            ').slice(0, 15) +
      (row.error ? 'ERROR ' + row.error
        : 'interactive=' + String(row.interactive).padStart(4) +
          '  roleOk=' + String(row.roleOkPct).padStart(3) + '%' +
          '  nameOk=' + String(row.nameOkPct).padStart(3) + '%' +
          '  divSoup=' + String(row.divSoup).padStart(4) +
          '  axNodes=' + String(row.axNodes).padStart(5))
    );
    if (row.soupExamples && row.soupExamples.length) console.log('                 soup: ' + row.soupExamples.join(' | '));
  }

  fs.writeFileSync(path.join(OUT, 'screening.json'), JSON.stringify(results, null, 2), 'utf8');
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('SCREEN FAILED', e); process.exit(1); });
