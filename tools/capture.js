'use strict';
/* Capture multi-state accessibility trees from a public app, read-only.

   Only GET navigations are performed. No form is submitted, no account is used,
   no data is written to any of these services. Everything here is what an
   anonymous visitor's browser already computes.

   Produces, per target:
     <target>-FULL.txt        role + accessible name  (control)
     <target>-NAME_ONLY.txt   names kept, roles flattened to generic
     <target>-ROLE_ONLY.txt   roles kept, names removed
     <target>-metrics.json    measured markup quality for the exact states used

   NAME_ONLY is not arbitrary: it reproduces the degradation profile actually
   measured on Open Food Facts, where names largely survive and roles collapse. */

const fs = require('fs');
const path = require('path');
const { sleep, launch, probeMap, ACTIONABLE_ROLES } = require('./cdp');

const OUT = process.argv[2];
const ONLY = process.argv[3];

const FLOWS = {
  'gov-uk': [
    ['home', 'https://www.gov.uk/'],
    ['search-results', 'https://www.gov.uk/search/all?keywords=passport'],
    ['search-filtered', 'https://www.gov.uk/search/all?keywords=passport&level_one_taxon=e48ab80a-de80-4e83-bf59-26316856a5f9'],
    ['search-zero-results', 'https://www.gov.uk/search/all?keywords=qzzxwvrandomnothinghere'],
    ['guide-multistep', 'https://www.gov.uk/state-pension-age']
  ],
  /* Grafana Play is a purpose-built public demo. All navigations are GETs an
     anonymous visitor would make. Nothing is saved, deleted or restored. */
  'grafana-play': [
    ['dashboard-list', 'https://play.grafana.org/dashboards'],
    ['folder', 'https://play.grafana.org/dashboards/f/demo-grafana-features/?orgId=1'],
    ['dashboard', 'https://play.grafana.org/d/000000167/threshold-example?orgId=1'],
    ['dashboard-panel-view', 'https://play.grafana.org/d/000000167/threshold-example?orgId=1&viewPanel=1&from=now-6h&to=now'],
    ['recently-deleted', 'https://play.grafana.org/dashboard/recently-deleted'],
    ['explore', 'https://play.grafana.org/explore']
  ]
};

const SKIP_ROLES = new Set(['none', 'presentation', 'InlineTextBox', 'LineBreak']);
const STRUCTURAL = new Set(['generic', 'GenericContainer']);

const PROBE = `(() => {
  const sel = 'a[href], button, input, select, textarea, summary, [role], [onclick], [tabindex]';
  const set = new Set(document.querySelectorAll(sel));
  document.querySelectorAll('div, span, li, td, i, svg, img').forEach((e) => {
    if (set.has(e)) return;
    const cs = getComputedStyle(e);
    if (cs.cursor === 'pointer' && cs.display !== 'none' && cs.visibility !== 'hidden') set.add(e);
  });
  let i = 0; const meta = {};
  for (const e of set) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const key = String(++i);
    e.setAttribute('data-axprobe', key);
    meta[key] = { tag: e.tagName.toLowerCase(), roleAttr: e.getAttribute('role') || null, pointer: cs.cursor === 'pointer' };
  }
  return JSON.stringify({ meta, title: document.title, url: location.href });
})()`;

/* Collapse long runs of same-role siblings. Product listings and result pages
   are mostly repetition; keeping every item would blow the artifact up without
   adding a single new capability. The collapse is announced in the output so
   the reader knows what was withheld. */
function render(nodes, mode) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) || nodes[0];
  const lines = [];
  const keep = new Set(['pressed', 'checked', 'expanded', 'disabled', 'required', 'level', 'selected', 'haspopup']);
  const always = new Set(['pressed', 'checked', 'expanded', 'selected']);

  const visibleChildren = (node) => {
    const out = [];
    const collect = (n) => {
      if (!n) return;
      if (n.ignored || SKIP_ROLES.has(n.role && n.role.value)) {
        (n.childIds || []).forEach((c) => collect(byId.get(c)));
        return;
      }
      out.push(n);
    };
    (node.childIds || []).forEach((c) => collect(byId.get(c)));
    return out;
  };

  const emit = (node, depth) => {
    const trueRole = node.role && node.role.value;
    const trueName = node.name && node.name.value ? node.name.value.replace(/\s+/g, ' ').trim() : '';
    const role = mode === 'NAME_ONLY' && !STRUCTURAL.has(trueRole) ? 'generic' : trueRole;
    const name = mode === 'ROLE_ONLY' ? '' : trueName;
    const rawValue = node.value && node.value.value;
    const value = mode !== 'ROLE_ONLY' && rawValue !== undefined && rawValue !== ''
      ? String(rawValue).replace(/\s+/g, ' ').slice(0, 100) : '';
    const props = (node.properties || [])
      .filter((p) => keep.has(p.name) && p.value && p.value.value !== undefined && p.value.value !== '' &&
        (always.has(p.name) || (p.value.value !== false && p.value.value !== 'false')))
      .map((p) => p.name + '=' + (Array.isArray(p.value.value) ? '…' : p.value.value));
    let line = '  '.repeat(Math.min(depth, 20)) + '- ' + role;
    if (name) line += ' "' + (name.length > 140 ? name.slice(0, 140) + '…' : name) + '"';
    if (value) line += ' [value: "' + value + '"]';
    if (props.length) line += ' {' + props.join(', ') + '}';
    lines.push(line);
  };

  const walk = (node, depth) => {
    if (!node) return;
    if (node.ignored || SKIP_ROLES.has(node.role && node.role.value)) {
      (node.childIds || []).forEach((c) => walk(byId.get(c), depth));
      return;
    }
    emit(node, depth);
    const kids = visibleChildren(node);
    let i = 0;
    while (i < kids.length) {
      const roleHere = kids[i].role && kids[i].role.value;
      let run = i;
      while (run < kids.length && (kids[run].role && kids[run].role.value) === roleHere) run++;
      const runLength = run - i;
      if (runLength > 6) {
        for (let k = i; k < i + 3; k++) walk(kids[k], depth + 1);
        lines.push('  '.repeat(Math.min(depth + 1, 20)) + '- … ' + (runLength - 3) + ' more sibling ' + roleHere + ' nodes of the same shape, omitted');
        i = run;
      } else {
        walk(kids[i], depth + 1);
        i++;
      }
    }
  };

  walk(root, 0);
  return lines.join('\n');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, cdp } = await launch(9402);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');

  for (const target of Object.keys(FLOWS)) {
    if (ONLY && ONLY !== target) continue;
    const buckets = { FULL: [], NAME_ONLY: [], ROLE_ONLY: [] };
    const metrics = [];

    for (const [stateName, url] of FLOWS[target]) {
      await cdp.send('Page.navigate', { url });
      await sleep(8000);
      const probed = JSON.parse(await cdp.evaluate(PROBE));
      const backendToProbe = await probeMap(cdp);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');

      const axByProbe = new Map();
      nodes.forEach((n) => { const p = backendToProbe.get(n.backendDOMNodeId); if (p) axByProbe.set(p, n); });
      const keys = Object.keys(probed.meta);
      let roleOk = 0, nameOk = 0;
      keys.forEach((k) => {
        const ax = axByProbe.get(k);
        const role = ax && ax.role ? ax.role.value : null;
        if (role && ACTIONABLE_ROLES.has(role)) roleOk++;
        if (ax && ax.name && ax.name.value && ax.name.value.trim()) nameOk++;
      });
      metrics.push({
        state: stateName, url, finalUrl: probed.url, title: probed.title,
        interactive: keys.length,
        roleOkPct: keys.length ? Math.round((roleOk / keys.length) * 100) : 0,
        nameOkPct: keys.length ? Math.round((nameOk / keys.length) * 100) : 0,
        axNodes: nodes.length
      });

      Object.keys(buckets).forEach((mode) => {
        const header = '\n\n===== STATE: ' + stateName + ' =====\n(reached at: ' + probed.url + ')\n';
        buckets[mode].push(header + render(nodes, mode));
      });
      console.log('  ' + target + '/' + stateName + '  interactive=' + keys.length + ' roleOk=' + metrics[metrics.length - 1].roleOkPct + '% nameOk=' + metrics[metrics.length - 1].nameOkPct + '% axNodes=' + nodes.length);
    }

    const preamble = 'Accessibility tree captured from a live web application over the Chrome DevTools Protocol.\n' +
      'Several states of the same application are included below, in the order a visitor would reach them.\n' +
      'Indentation shows nesting. Long runs of identical sibling nodes have been collapsed and announced.\n';
    Object.keys(buckets).forEach((mode) => {
      const file = path.join(OUT, target + '-' + mode + '.txt');
      fs.writeFileSync(file, preamble + buckets[mode].join('\n'), 'utf8');
      console.log('  wrote ' + file + '  (' + (fs.statSync(file).size / 1024).toFixed(0) + ' KB)');
    });
    fs.writeFileSync(path.join(OUT, target + '-metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');
  }

  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('CAPTURE FAILED', e); process.exit(1); });
