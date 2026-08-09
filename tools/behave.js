'use strict';
/* Behavioural verification. Builds the "sighted" capability model the way an
   analyst with full access to a running product would: operate a control, then
   record what observably happened — URL change, network calls, DOM state.

   Deliberate limits, and they matter for the write-up:
     - Only non-destructive actions are performed. These are other people's
       live services. Destructive affordances (delete, restore, permanently
       remove) are OBSERVED but never OPERATED, so they end up inferred rather
       than verified. That constraint is itself a finding.
     - Nothing is written to any account. No credentials are used anywhere. */

const fs = require('fs');
const path = require('path');
const { sleep, launch } = require('./cdp');

const OUT = process.argv[2];
const ONLY = process.argv[3];

const FIND = `(pattern, wantRole) => {
  const rx = new RegExp(pattern, 'i');
  const nameOf = (e) => {
    const lb = e.getAttribute && e.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\\s+/).map(id => document.getElementById(id)).filter(Boolean)
        .map(n => (n.textContent || '').trim()).join(' ');
      if (t) return t;
    }
    const al = e.getAttribute && e.getAttribute('aria-label');
    if (al) return al.trim();
    if (e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) return (l.textContent||'').trim(); }
    if (e.placeholder) return e.placeholder;
    if (e.title) return e.title;
    return (e.textContent || '').replace(/\\s+/g,' ').trim();
  };
  const cands = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="combobox"], [role="menuitem"]')];
  for (const e of cands) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (wantRole && e.tagName.toLowerCase() !== wantRole && e.getAttribute('role') !== wantRole) continue;
    const n = nameOf(e);
    if (n && rx.test(n)) return { el: e, name: n, tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || null };
  }
  return null;
}`;

const SCRIPTS = {
  'gov-uk-reversal': {
    start: 'https://www.gov.uk/search/all?keywords=passport&level_one_taxon=e48ab80a-de80-4e83-bf59-26316856a5f9',
    steps: [
      { label: 'remove one active filter', wait: 6000, act: `(() => {
          const f = (${FIND})('remove filter', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name.replace(/\\s+/g,' '); })()` },
      { label: 'reapply a filter, then clear all filters', wait: 7000, act: `(() => {
          location.href = 'https://www.gov.uk/search/all?keywords=passport&level_one_taxon=e48ab80a-de80-4e83-bf59-26316856a5f9';
          return 'RENAVIGATED_TO_FILTERED'; })()` },
      { label: 'clear all filters', wait: 7000, act: `(() => {
          const f = (${FIND})('clear all filters', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` },
      { label: 'search again from the results page header', wait: 7000, act: `(() => {
          const box = document.querySelector('input[name=keywords], input[type=search]');
          if (!box) return 'NO_SEARCH_BOX';
          box.value = 'driving licence'; box.dispatchEvent(new Event('input',{bubbles:true}));
          const form = box.closest('form'); if (form) { form.submit(); return 'SUBMITTED_SECOND_SURFACE'; }
          return 'NO_FORM'; })()` }
    ]
  },
  'gov-uk': {
    start: 'https://www.gov.uk/',
    steps: [
      { label: 'search from the site header', act: `(() => { const f = (${FIND})('search', null); if(!f) return 'NOT_FOUND';
          const box = document.querySelector('input[type=search], input[name=q], input[name=keywords]');
          if (!box) return 'NO_SEARCH_BOX';
          box.focus(); box.value = 'passport';
          box.dispatchEvent(new Event('input', {bubbles:true}));
          const form = box.closest('form'); if (form) { form.submit(); return 'SUBMITTED_FORM'; }
          return 'NO_FORM'; })()` },
      { label: 'narrow results by a filter', wait: 6000, act: `(() => {
          const cb = [...document.querySelectorAll('input[type=checkbox]')].find(e => e.getBoundingClientRect().height > 0);
          if (!cb) return 'NO_CHECKBOX';
          const lbl = cb.id ? (document.querySelector('label[for="'+CSS.escape(cb.id)+'"]')||{}).textContent : '';
          cb.click(); return 'CLICKED_FILTER: ' + (lbl||'').replace(/\\s+/g,' ').trim(); })()` },
      { label: 'undo the narrowing (clear filters)', wait: 6000, act: `(() => {
          const f = (${FIND})('clear all|clear filters|remove filter|clear selection', null);
          if (!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` },
      { label: 'change result ordering', wait: 6000, act: `(() => {
          const sel = document.querySelector('select');
          if (!sel) return 'NO_SELECT';
          const opts=[...sel.options].map(o=>o.value); if(opts.length<2) return 'NO_OPTIONS';
          sel.value = opts[1]; sel.dispatchEvent(new Event('change',{bubbles:true}));
          return 'CHANGED_SORT_TO: ' + opts[1]; })()` },
      { label: 'go to the next page of results', wait: 6000, act: `(() => {
          const f = (${FIND})('^next|next page', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` }
    ]
  },
  'grafana-play': {
    start: 'https://play.grafana.org/dashboards',
    steps: [
      { label: 'search for a dashboard by name', wait: 8000, act: `(() => {
          const box = document.querySelector('input[type=text][placeholder], input[type=search]');
          if (!box) return 'NO_SEARCH_BOX';
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
          setter.call(box, 'threshold');
          box.dispatchEvent(new Event('input', {bubbles:true}));
          return 'TYPED_INTO: ' + (box.placeholder || box.getAttribute('aria-label') || 'search box'); })()` },
      { label: 'filter to starred dashboards', wait: 5000, act: `(() => {
          const f = (${FIND})('starred', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` },
      { label: 'open a dashboard', wait: 6000, act: `(() => {
          const a = [...document.querySelectorAll('a[href*="/d/"]')].find(e=>e.getBoundingClientRect().height>0);
          if (!a) return 'NO_DASHBOARD_LINK';
          const href = a.getAttribute('href'); a.click(); return 'OPENED: ' + href; })()` },
      { label: 'change the dashboard time range', wait: 8000, act: `(() => {
          const f = (${FIND})('time range|last 6 hours|last 24 hours|zoom', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` },
      { label: 'pick a preset from the opened time range menu', wait: 3000, act: `(() => {
          const f = (${FIND})('Last 2 days|Last 7 days|Last 30 days', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` },
      { label: 'star the dashboard (expected to require an account)', wait: 5000, act: `(() => {
          const f = (${FIND})('^mark as favorite|^star |add to favorites|unmark', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` },
      { label: 'refresh dashboard data', wait: 5000, act: `(() => {
          const f = (${FIND})('^refresh', null); if(!f) return 'NOT_FOUND';
          f.el.click(); return 'CLICKED: ' + f.name; })()` }
    ]
  }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, cdp } = await launch(9404);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  const net = [];
  cdp.on((m) => {
    if (m.method === 'Network.requestWillBeSent') {
      net.push({ t: Date.now(), kind: 'req', method: m.params.request.method, url: m.params.request.url, type: m.params.type });
    } else if (m.method === 'Network.responseReceived') {
      net.push({ t: Date.now(), kind: 'res', status: m.params.response.status, url: m.params.response.url, type: m.params.type });
    }
  });

  const report = {};
  for (const target of Object.keys(SCRIPTS)) {
    if (ONLY && ONLY !== target) continue;
    const script = SCRIPTS[target];
    console.log('\n=== ' + target + ' ===');
    await cdp.send('Page.navigate', { url: script.start });
    await sleep(9000);
    const steps = [];

    for (const step of script.steps) {
      const urlBefore = await cdp.evaluate('location.href');
      const mark = Date.now();
      let outcome;
      try { outcome = await cdp.evaluate(step.act); } catch (e) { outcome = 'EVAL_ERROR: ' + String(e.message).slice(0, 120); }
      await sleep(step.wait || 5000);
      const urlAfter = await cdp.evaluate('location.href');

      const window_ = net.filter((n) => n.t >= mark);
      const calls = window_.filter((n) => n.kind === 'req' && (n.type === 'XHR' || n.type === 'Fetch' || n.type === 'Document'))
        .map((n) => n.method + ' ' + n.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 110));
      const statuses = window_.filter((n) => n.kind === 'res' && (n.type === 'XHR' || n.type === 'Fetch' || n.type === 'Document')).map((n) => n.status);
      const failed = statuses.filter((s) => s >= 400);

      const row = {
        step: step.label,
        outcome,
        urlChanged: urlBefore !== urlAfter,
        urlBefore: urlBefore.slice(0, 130),
        urlAfter: urlAfter.slice(0, 130),
        requests: [...new Set(calls)].slice(0, 6),
        failedStatuses: failed
      };
      steps.push(row);
      console.log('  ' + (row.urlChanged ? 'URL✔ ' : 'URL· ') + (row.requests.length ? 'NET✔ ' : 'NET· ') +
        step.label + '  ->  ' + String(outcome).slice(0, 70));
      if (row.requests.length) console.log('       ' + row.requests.slice(0, 3).join('\n       '));
      if (failed.length) console.log('       FAILED STATUSES: ' + failed.join(','));
    }
    report[target] = steps;
  }

  fs.writeFileSync(path.join(OUT, 'behaviour.json'), JSON.stringify(report, null, 2), 'utf8');
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('BEHAVE FAILED', e); process.exit(1); });
