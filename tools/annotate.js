'use strict';
/* Run-3 experiments 2 and 3.

   MODE href   Capture an app's accessibility tree with link destinations joined
               in — internal vs external, and the target path. Run 2 found that
               two namers modelled *different products* from GOV.UK because the
               accessibility tree cannot distinguish "this app does X" from
               "this app links to something that does X". This tests whether
               the join collapses that divergence.

   MODE flip   Enumerate controls whose ARIA state can flip (pressed, checked,
               expanded, selected). Run 2's corrected finding is that the blind
               spot is control-sharing: a control that also performs the reverse
               action gets modelled as an attribute rather than a second
               capability. This emits the candidate list a detector would
               produce, for feeding back to a namer.

   Read-only. GET navigations only. */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch, probeMap } = require('./cdp');

const MODE = process.argv[2];
const OUT = process.argv[3];
const ARG = process.argv[4];

const SKIP_ROLES = new Set(['none', 'presentation', 'InlineTextBox', 'LineBreak']);
const FLIPPABLE = ['pressed', 'checked', 'expanded', 'selected'];

const GOVUK_STATES = [
  ['home', 'https://www.gov.uk/'],
  ['search-results', 'https://www.gov.uk/search/all?keywords=passport'],
  ['search-filtered', 'https://www.gov.uk/search/all?keywords=passport&level_one_taxon=e48ab80a-de80-4e83-bf59-26316856a5f9'],
  ['search-zero-results', 'https://www.gov.uk/search/all?keywords=qzzxwvrandomnothinghere'],
  ['guide-multistep', 'https://www.gov.uk/state-pension-age']
];

const PROBE = `(() => {
  let i = 0; const meta = {};
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary, [role], [onclick]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const key = String(++i);
    el.setAttribute('data-axprobe', key);
    const entry = { tag: el.tagName.toLowerCase() };
    if (el.tagName.toLowerCase() === 'a' && el.getAttribute('href')) {
      const raw = el.getAttribute('href');
      let dest = null, kind = 'other';
      try {
        const u = new URL(el.href, location.href);
        dest = u.pathname + (u.search ? u.search.slice(0, 40) : '');
        if (u.origin === location.origin) kind = 'same-app';
        else kind = 'external:' + u.hostname;
      } catch (e) { dest = raw; }
      entry.linkKind = kind; entry.linkDest = dest;
    }
    meta[key] = entry;
  }
  return JSON.stringify({ meta, url: location.href, origin: location.origin });
})()`;

function render(nodes, probeByBackend, meta, opts) {
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
    const role = node.role && node.role.value;
    const name = node.name && node.name.value ? node.name.value.replace(/\s+/g, ' ').trim() : '';
    const rawValue = node.value && node.value.value;
    const value = rawValue !== undefined && rawValue !== '' ? String(rawValue).replace(/\s+/g, ' ').slice(0, 100) : '';
    const props = (node.properties || [])
      .filter((p) => keep.has(p.name) && p.value && p.value.value !== undefined && p.value.value !== '' &&
        (always.has(p.name) || (p.value.value !== false && p.value.value !== 'false')))
      .map((p) => p.name + '=' + (Array.isArray(p.value.value) ? '…' : p.value.value));
    let line = '  '.repeat(Math.min(depth, 20)) + '- ' + role;
    if (name) line += ' "' + (name.length > 140 ? name.slice(0, 140) + '…' : name) + '"';
    if (value) line += ' [value: "' + value + '"]';
    if (props.length) line += ' {' + props.join(', ') + '}';
    if (opts.href) {
      const p = probeByBackend.get(node.backendDOMNodeId);
      const m = p && meta[p];
      if (m && m.linkKind) line += '  -> ' + (m.linkKind === 'same-app' ? 'SAME-APP ' + m.linkDest : m.linkKind);
    }
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
      if (run - i > 6) {
        for (let k = i; k < i + 3; k++) walk(kids[k], depth + 1);
        lines.push('  '.repeat(Math.min(depth + 1, 20)) + '- … ' + (run - i - 3) + ' more sibling ' + roleHere + ' nodes of the same shape, omitted');
        i = run;
      } else { walk(kids[i], depth + 1); i++; }
    }
  };
  walk(root, 0);
  return lines.join('\n');
}

function serveDir(dir, port) {
  const server = http.createServer((req, res) => {
    const file = path.join(dir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, cdp } = await launch(9431);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');

  if (MODE === 'href') {
    const chunks = [];
    for (const [state, url] of GOVUK_STATES) {
      await cdp.send('Page.navigate', { url });
      await sleep(8000);
      const probed = JSON.parse(await cdp.evaluate(PROBE));
      const backendToProbe = await probeMap(cdp);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      chunks.push('\n\n===== STATE: ' + state + ' =====\n' + render(nodes, backendToProbe, probed.meta, { href: true }));
      const linky = Object.values(probed.meta).filter((m) => m.linkKind);
      console.log('  ' + state + ': ' + nodes.length + ' ax nodes, ' + linky.length + ' links annotated (' +
        linky.filter((m) => m.linkKind === 'same-app').length + ' same-app, ' +
        linky.filter((m) => m.linkKind !== 'same-app').length + ' external)');
    }
    const preamble = 'Accessibility tree captured from a live web application over the Chrome DevTools Protocol.\n' +
      'Several states of the same application are included, in the order a visitor would reach them.\n' +
      'Indentation shows nesting. Long runs of identical sibling nodes have been collapsed and announced.\n' +
      'Links carry their destination: "-> SAME-APP <path>" means the link stays inside this application;\n' +
      '"-> external:<host>" means it leaves for a different system.\n';
    fs.writeFileSync(path.join(OUT, 'govuk-HREF.txt'), preamble + chunks.join('\n'), 'utf8');
    console.log('wrote ' + path.join(OUT, 'govuk-HREF.txt'));
  }

  if (MODE === 'flip') {
    const server = await serveDir(ARG, 8744);
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8744/index.html' });
    await sleep(2500);
    const probed = JSON.parse(await cdp.evaluate(PROBE));
    const backendToProbe = await probeMap(cdp);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');

    /* The detector: any exposed control carrying a flippable ARIA state. */
    const candidates = [];
    nodes.forEach((n) => {
      if (n.ignored) return;
      const role = n.role && n.role.value;
      const name = n.name && n.name.value ? n.name.value.replace(/\s+/g, ' ').trim() : '';
      (n.properties || []).forEach((p) => {
        if (FLIPPABLE.includes(p.name) && p.value && p.value.value !== undefined && p.value.value !== '') {
          candidates.push({ role, name, state: p.name, current: String(p.value.value) });
        }
      });
    });

    const seen = new Set();
    const unique = candidates.filter((c) => {
      const k = c.role + '|' + c.name + '|' + c.state;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    const tree = render(nodes, backendToProbe, probed.meta, { href: false });
    const list = unique.map((c, i) =>
      (i + 1) + '. ' + c.role + ' "' + c.name + '" — carries ARIA state `' + c.state + '` (currently ' + c.current + ')').join('\n');

    fs.writeFileSync(path.join(OUT, 'flip-tree.txt'), tree, 'utf8');
    fs.writeFileSync(path.join(OUT, 'flip-candidates.txt'),
      'Controls whose ARIA state can flip. Each is a control that may perform a\n' +
      'second, different action when operated again from its other state.\n\n' + list, 'utf8');
    console.log('flippable candidates found: ' + unique.length + ' (from ' + candidates.length + ' state-carrying nodes)');
    unique.slice(0, 8).forEach((c) => console.log('   ' + c.role + ' "' + c.name + '"  ' + c.state + '=' + c.current));
    server.close();
  }

  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
