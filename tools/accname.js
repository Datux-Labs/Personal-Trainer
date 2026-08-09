'use strict';
/* AccName conformance harness.

   Question (Q14): an in-page instrumentation SDK cannot ask the browser for a
   computed accessible name, so it must reimplement AccName. How far off is it,
   in the wild, and does a careful implementation converge?

   Method: for every interactive element on a page, compute the name with six
   different in-page implementations, then diff each against the name Chromium
   actually computed (Accessibility.getFullAXTree). Classify every disagreement.

   The implementations are a deliberate ladder, cheapest first:
     naive  aria-label, else textContent            (approximately what vendor
                                                     autocapture does today)
     v1     + aria-labelledby, native <label>       (run 1's implementation)
     v2     + CSS text-transform                    (the run-1 fix)
     v3     + title / alt / value / placeholder     (AccName native fallbacks)
     v4     + exclude hidden and aria-hidden subtrees
     v5     + CSS ::before / ::after generated content
     v6     + AccName's inter-element spacing rule
     v7     + include hidden content when referenced by aria-labelledby

   Agreement at each rung is the convergence curve. What is left at v7 is the
   answer to whether conformance testing can ever be sufficient.

   Two comparison modes are reported. EXACT is string equality, which is what
   you get if the accessible name is used as a join key. NORMALISED casefolds,
   strips punctuation and collapses whitespace â€” the best case for anyone
   willing to fuzzy-match. The gap between them is the part of the problem that
   is cosmetic rather than semantic.

   Read-only: one navigation per site, no interaction, nothing submitted. */

const fs = require('fs');
const path = require('path');
const { sleep, launch, probeMap } = require('./cdp');

const OUT = process.argv[2];
const CORPUS = [
  ['gov-uk',        'https://www.gov.uk/'],
  ['grafana-play',  'https://play.grafana.org/dashboards'],
  ['openstreetmap', 'https://www.openstreetmap.org/'],
  ['mastodon',      'https://mastodon.social/explore'],
  ['diagrams-net',  'https://app.diagrams.net/'],
  ['wikipedia',     'https://en.wikipedia.org/wiki/Accessibility'],
  ['mdn',           'https://developer.mozilla.org/en-US/'],
  ['hacker-news',   'https://news.ycombinator.com/'],
  ['w3c-wai',       'https://www.w3.org/WAI/'],
  ['bootstrap',     'https://getbootstrap.com/'],
  ['python-org',    'https://www.python.org/'],
  ['archive-org',   'https://archive.org/'],
  ['nodejs',        'https://nodejs.org/en'],
  ['react-dev',     'https://react.dev/'],
  ['tailwind',      'https://tailwindcss.com/'],
  ['caniuse',       'https://caniuse.com/'],
  ['bbc-news',      'https://www.bbc.co.uk/news'],
  ['nasa',          'https://www.nasa.gov/'],
  ['vuejs',         'https://vuejs.org/'],
  ['cdc',           'https://www.cdc.gov/']
];

const ACTIONABLE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch',
  'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab',
  'option', 'treeitem', 'listbox', 'disclosure triangle', 'PopUpButton', 'DisclosureTriangle'
]);

/* Everything below runs inside the page. */
const IN_PAGE = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();

  const isHidden = (el) => {
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  };

  const applyTransform = (el, text) => {
    if (!text) return text;
    const t = getComputedStyle(el).textTransform;
    if (t === 'uppercase') return text.toUpperCase();
    if (t === 'lowercase') return text.toLowerCase();
    if (t === 'capitalize') return text.replace(/\\b\\p{L}/gu, (c) => c.toUpperCase());
    return text;
  };

  const generated = (el, pseudo) => {
    const c = getComputedStyle(el, pseudo).content;
    if (!c || c === 'none' || c === 'normal') return '';
    const m = c.match(/^"(.*)"$/);
    return m ? m[1] : '';
  };

  /* Text content of a subtree, with options mirroring the AccName rungs. */
  const subtreeText = (el, opts) => {
    let out = '';
    if (opts.generated) out += generated(el, '::before');
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        out += opts.transform ? applyTransform(el, node.nodeValue) : node.nodeValue;
      } else if (node.nodeType === 1) {
        if (opts.excludeHidden && isHidden(node)) continue;
        if (opts.natives) {
          const tag = node.tagName.toLowerCase();
          if (tag === 'img' && node.getAttribute('alt')) { out += ' ' + node.getAttribute('alt') + ' '; continue; }
          if (tag === 'svg') { const t = node.querySelector('title'); if (t) { out += ' ' + t.textContent + ' '; continue; } }
        }
        out += opts.spacing ? (' ' + subtreeText(node, opts) + ' ') : subtreeText(node, opts);
      }
    }
    if (opts.generated) out += generated(el, '::after');
    return out;
  };

  const labelledByText = (el, opts) => {
    const ref = el.getAttribute('aria-labelledby');
    if (!ref) return '';
    /* AccName uses referenced content even when it is hidden. */
    const refOpts = opts.refIncludesHidden ? Object.assign({}, opts, { excludeHidden: false }) : opts;
    const parts = ref.split(/\\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((n) => norm(subtreeText(n, refOpts)))
      .filter(Boolean);
    return parts.join(' ');
  };

  const nativeLabel = (el, opts) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return norm(subtreeText(l, opts));
    }
    const w = el.closest && el.closest('label');
    if (w) return norm(subtreeText(w, opts));
    return '';
  };

  const nativeFallback = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit') return norm(el.value) || 'Submit';
      if (type === 'reset') return norm(el.value) || 'Reset';
      if (type === 'button') return norm(el.value);
      if (type === 'image') return norm(el.getAttribute('alt'));
      return norm(el.getAttribute('placeholder'));
    }
    if (tag === 'img' || tag === 'area') return norm(el.getAttribute('alt'));
    if (tag === 'optgroup') return norm(el.getAttribute('label'));
    return '';
  };

  /* level: 0 naive, 1..5 as documented at the top of this file */
  const nameAt = (el, level) => {
    if (level === 0) return norm(el.getAttribute('aria-label') || el.textContent);
    const opts = {
      transform: level >= 2,
      natives: level >= 3,
      excludeHidden: level >= 4,
      generated: level >= 5
    };
    const lb = labelledByText(el, opts);
    if (lb) return norm(lb);
    const al = el.getAttribute('aria-label');
    if (al && norm(al)) return norm(al);
    const nl = nativeLabel(el, opts);
    if (nl) return nl;
    if (level >= 3) {
      const nf = nativeFallback(el);
      if (nf) return nf;
    }
    const own = norm(subtreeText(el, opts));
    if (own) return own;
    if (level >= 3) {
      const t = el.getAttribute('title');
      if (t && norm(t)) return norm(t);
    }
    return '';
  };

  const sel = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="combobox"], [role="option"], [role="searchbox"], [role="textbox"], [role="slider"], [role="spinbutton"]';
  const out = {};
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (isHidden(el)) continue;
    const key = String(++i);
    el.setAttribute('data-axprobe', key);
    out[key] = {
      tag: el.tagName.toLowerCase(),
      names: [0, 1, 2, 3, 4, 5, 6, 7].map((lv) => { try { return nameAt(el, lv); } catch (e) { return '__ERR__'; } }),
      hasTitle: !!el.getAttribute('title'),
      hasAlt: !!el.getAttribute('alt'),
      hasPlaceholder: !!el.getAttribute('placeholder'),
      hasValue: !!(el.value && String(el.value).trim()),
      inShadow: !!(el.getRootNode() instanceof ShadowRoot),
      genBefore: generated(el, '::before'),
      genAfter: generated(el, '::after')
    };
  }
  return JSON.stringify({ probes: out, title: document.title, url: location.href });
})()`;

const nrm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const loose = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function classify(mine, browser, meta) {
  const a = nrm(mine), b = nrm(browser);
  if (a === b) return 'agree';
  if (!a && !b) return 'agree';
  if (!a && b) {
    if (meta.hasTitle && nrm(meta.titleVal) === b) return 'miss:title';
    if (meta.hasAlt) return 'miss:alt';
    if (meta.hasPlaceholder) return 'miss:placeholder';
    if (meta.hasValue) return 'miss:value';
    if (meta.inShadow) return 'miss:shadow-dom';
    return 'miss:unknown-source';
  }
  if (a && !b) return 'extra:browser-has-none';
  if (a.toLowerCase() === b.toLowerCase()) return 'case-only';
  if (a.replace(/[\s\u00a0]/g, '') === b.replace(/[\s\u00a0]/g, '')) return 'whitespace-only';
  if (a.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === b.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()) return 'punctuation-only';
  if (b.includes(a)) return 'ours-is-subset';
  if (a.includes(b)) return 'ours-is-superset';
  const ta = a.toLowerCase().split(' ').sort().join(' ');
  const tb = b.toLowerCase().split(' ').sort().join(' ');
  if (ta === tb) return 'reordered';
  return 'disjoint';
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, cdp } = await launch(9411);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable');

  const perSite = [];
  const classTotals = {};
  const examples = {};

  for (const [name, url] of CORPUS) {
    const row = { site: name, url };
    try {
      await cdp.send('Page.navigate', { url });
      await sleep(7000);
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

      const agree = [0,0,0,0,0,0,0,0]; const agreeN = [0,0,0,0,0,0,0,0];
      keys.forEach((k) => {
        const ax = axByProbe.get(k);
        const browser = ax.name && ax.name.value ? ax.name.value : '';
        const meta = probed.probes[k];
        meta.names.forEach((mine, lv) => {
          if (nrm(mine) === nrm(browser)) agree[lv]++;
          if (loose(mine) === loose(browser)) agreeN[lv]++;
        });
        const cls = classify(meta.names[7], browser, meta);
        if (cls !== 'agree') {
          classTotals[cls] = (classTotals[cls] || 0) + 1;
          if (!examples[cls]) examples[cls] = [];
          if (examples[cls].length < 3) {
            examples[cls].push({ site: name, tag: meta.tag, ours: nrm(meta.names[5]).slice(0, 70), browser: nrm(browser).slice(0, 70) });
          }
        }
      });

      Object.assign(row, {
        title: probed.title.slice(0, 50),
        compared: keys.length,
        pct: agree.map((a) => (keys.length ? Math.round((a / keys.length) * 100) : null)),
        pctN: agreeN.map((a) => (keys.length ? Math.round((a / keys.length) * 100) : null))
      });
    } catch (e) {
      row.error = String(e.message || e).slice(0, 90);
    }
    perSite.push(row);
    console.log(
      (row.site + '              ').slice(0, 15) +
      (row.error ? 'ERROR ' + row.error
        : 'n=' + String(row.compared).padStart(4) +
          '   naive=' + String(row.pct[0]).padStart(3) + '%' +
          '  v5=' + String(row.pct[5]).padStart(3) + '%' +
          '  v7=' + String(row.pct[7]).padStart(3) + '%' +
          '  v7norm=' + String(row.pctN[7]).padStart(3) + '%' +
          '  gain(naive->v7)=' + String(row.pct[7] - row.pct[0]).padStart(3))
    );
  }

  const ok = perSite.filter((r) => !r.error && r.compared > 0);
  const totalN = ok.reduce((s, r) => s + r.compared, 0);
  const weighted = [0, 1, 2, 3, 4, 5, 6, 7].map((lv) =>
    Math.round(ok.reduce((s, r) => s + (r.pct[lv] / 100) * r.compared, 0) / totalN * 100));
  const weightedN = [0, 1, 2, 3, 4, 5, 6, 7].map((lv) =>
    Math.round(ok.reduce((s, r) => s + (r.pctN[lv] / 100) * r.compared, 0) / totalN * 100));
  const median = (lv) => {
    const v = ok.map((r) => r.pct[lv]).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };

  console.log('\n================ AGGREGATE ================');
  console.log('sites usable: ' + ok.length + '/' + CORPUS.length + '   elements compared: ' + totalN);
  ['naive','v1','v2','v3','v4','v5','v6','v7'].forEach((lbl, lv) => {
    const vals = ok.map((r) => r.pct[lv]);
    console.log('  ' + lbl.padEnd(6) + ' weighted=' + String(weighted[lv]).padStart(3) + '%   median=' +
      String(median(lv)).padStart(3) + '%   worst site=' + String(Math.min(...vals)).padStart(3) +
      '%   best=' + String(Math.max(...vals)).padStart(3) + '%   sites at 100%: ' + vals.filter((v) => v === 100).length);
  });

  const nonMono = ok.filter((r) => [1,2,3,4,5,6,7].some((lv) => r.pct[lv] < r.pct[lv-1]))
    .map((r) => r.site + ' [' + r.pct.join(',') + ']');
  console.log('\n---- sites where a MORE faithful rung scored WORSE (' + nonMono.length + '/' + ok.length + ') ----');
  nonMono.forEach((s) => console.log('  ' + s));
  console.log('\n---- residual divergence at v7, by class ----');
  Object.entries(classTotals).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log('  ' + String(v).padStart(5) + '  ' + k + '   (' + Math.round(v / totalN * 1000) / 10 + '% of all compared)');
    (examples[k] || []).slice(0, 2).forEach((e) => {
      console.log('           ' + e.site + ' <' + e.tag + '>  ours="' + e.ours + '"  browser="' + e.browser + '"');
    });
  });

  fs.writeFileSync(path.join(OUT, 'accname-conformance.json'),
    JSON.stringify({ perSite, weighted, weightedN, classTotals, examples, totalN, nonMono }, null, 2), 'utf8');
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('ACCNAME HARNESS FAILED', e); process.exit(1); });
