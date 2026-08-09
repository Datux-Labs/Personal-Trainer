'use strict';
/* Quick probe: load a page, list its most plausible navigation targets, so flow
   URLs are discovered rather than guessed. */
const { sleep, launch } = require('./cdp');

const URL = process.argv[2];

(async () => {
  const { proc, cdp } = await launch(9403);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: URL });
  await sleep(12000);
  const out = await cdp.evaluate(`(() => {
    const links = [...document.querySelectorAll('a[href]')]
      .map(a => [a.getAttribute('href'), (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)])
      .filter(([h, t]) => h && !h.startsWith('#') && t);
    const seen = new Set(); const uniq = [];
    for (const [h, t] of links) { if (!seen.has(h)) { seen.add(h); uniq.push(h + '   ::   ' + t); } }
    return JSON.stringify({ title: document.title, url: location.href, count: uniq.length, links: uniq.slice(0, 45) }, null, 1);
  })()`);
  console.log(out);
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });
