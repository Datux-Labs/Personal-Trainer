'use strict';
/* Run 8 — police the generated language mechanically, before reading it.

   Fluent prose is exactly the kind of output that flatters a self-assessment,
   so the two constraints that matter are checked by machine rather than by
   whether it reads nicely:

     SPECIFICITY  a generated string must carry every concrete fact its
                  template carried, and must preserve every placeholder. Prose
                  that reads better and says less is a net loss — most of all
                  for the explanation, which is ADR 0003's legibility.

     ANTI-ENGAGEMENT  no encouragement, streaks, praise, exclamation, emoji or
                  motivational second person. The objective is error events
                  driven toward zero; language that makes someone linger is a
                  regression, not a feature.

   Also reports cache hit rate, because a cache that mostly misses is a
   template renderer with extra steps.

   Usage: node --experimental-websocket tools/langcheck.js <repoDir> <outDir> */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./cdp');

const REPO = process.argv[2];
const OUT = process.argv[3];
const PORT = 8793;

/* Words and shapes that mean the prose is trying to keep someone rather than
   inform them. Deliberately blunt: a false positive costs one rewrite. */
const ENGAGEMENT = [
  'great job', 'nice work', 'well done', 'you\'ve got this', 'you can do it', 'keep it up',
  'keep going', 'streak', 'don\'t break', 'consistency is', 'momentum', 'proud', 'crush',
  'smash', 'let\'s go', 'awesome', 'amazing', 'fantastic', 'strong work', 'stay on track',
  'future self', 'every day counts', 'progress is progress', 'you deserve'
];

/* Facts each component's template carries. A generated string must keep the
   placeholders, and must not drop the unit words that make numbers meaningful. */
const REQUIRED = {
  'adapt.applied': { placeholders: { applied: ['{suggestion}', '{planned}', '{reason}'], reverted: ['{planned}', '{reason}'] } },
  'detail.equipment_gap': { placeholders: { any: ['{need}'] } },
  'detail.time_fit': { placeholders: { any: ['{planned}', '{budget}'] } },
  'secondary.guideline': { placeholders: { any: [] } }
};

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
  const { proc, cdp } = await launch(9499);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await sleep(2500);

  const phrases = JSON.parse(await cdp.evaluate('JSON.stringify(PHRASES)'));

  /* ---- 1. placeholder preservation ---- */
  const placeholderFails = [];
  Object.keys(phrases).forEach((comp) => {
    const spec = REQUIRED[comp];
    if (!spec) return;
    Object.keys(phrases[comp]).forEach((key) => {
      const text = phrases[comp][key];
      const shape = key.split('|').pop();
      const need = spec.placeholders[shape] || spec.placeholders.any || [];
      need.forEach((ph) => {
        if (text.indexOf(ph) === -1) placeholderFails.push(comp + ' [' + key + '] missing ' + ph);
      });
      /* a placeholder that was typo'd renders literally to a user */
      const stray = text.match(/\{[a-z_]+\}/g) || [];
      stray.forEach((s) => {
        const allowed = (spec.placeholders[shape] || spec.placeholders.any || []);
        if (allowed.indexOf(s) === -1) placeholderFails.push(comp + ' [' + key + '] unknown placeholder ' + s);
      });
    });
  });

  /* ---- 2. anti-engagement ---- */
  const engagementFails = [];
  Object.keys(phrases).forEach((comp) => {
    Object.keys(phrases[comp]).forEach((key) => {
      const text = phrases[comp][key];
      const low = text.toLowerCase();
      ENGAGEMENT.forEach((w) => { if (low.indexOf(w) >= 0) engagementFails.push(comp + ' [' + key + '] "' + w + '"'); });
      if (/[!]/.test(text)) engagementFails.push(comp + ' [' + key + '] exclamation mark');
      if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(text)) engagementFails.push(comp + ' [' + key + '] emoji');
      if (/\?$/.test(text.trim())) engagementFails.push(comp + ' [' + key + '] rhetorical question');
    });
  });

  /* ---- 3. length and shape ---- */
  const shapeFails = [];
  Object.keys(phrases).forEach((comp) => {
    Object.keys(phrases[comp]).forEach((key) => {
      const text = phrases[comp][key];
      if (text.length > 220) shapeFails.push(comp + ' [' + key + '] ' + text.length + ' chars');
      if (text !== text.trim()) shapeFails.push(comp + ' [' + key + '] untrimmed');
    });
  });

  /* ---- 4. register actually varies by experience ---- */
  const registerFlat = [];
  Object.keys(phrases).forEach((comp) => {
    const byRest = {};
    Object.keys(phrases[comp]).forEach((key) => {
      const parts = key.split('|');
      const rest = parts.slice(1).join('|');
      (byRest[rest] = byRest[rest] || []).push(phrases[comp][key]);
    });
    Object.keys(byRest).forEach((rest) => {
      const set = new Set(byRest[rest]);
      if (byRest[rest].length > 1 && set.size === 1) registerFlat.push(comp + ' [*|' + rest + '] identical across experience levels');
    });
  });

  /* ---- 5. cache hit rate over real derivations ---- */
  const stats = await cdp.evaluate(`(() => {
    const profiles = [
      { protecting: 'ankle', equipment: 'full', experience: 'novice',   timeBudget: '20' },
      { protecting: 'knee',  equipment: 'none', experience: 'regular',  timeBudget: '20' },
      { protecting: 'shoulder', equipment: 'home', experience: 'advanced', timeBudget: '45' },
      { protecting: 'none',  equipment: 'full', experience: 'regular',  timeBudget: '90' }
    ];
    ['Monday','Tuesday','Thursday'].forEach((d) => {
      profiles.forEach((p) => {
        window.__datuxResetState();
        window.__datuxSetWeekday(d);
        Object.keys(p).forEach((k) => window.__datuxSetPreference(k, p[k]));
      });
    });
    return JSON.stringify(window.__datuxPhraseStats());
  })()`);
  const cache = JSON.parse(stats);

  const total = Object.keys(phrases).reduce((n, c) => n + Object.keys(phrases[c]).length, 0);
  console.log('=== GENERATED LANGUAGE, CHECKED BEFORE READING ===');
  console.log('strings baked in            : ' + total);
  console.log('placeholder failures        : ' + placeholderFails.length + (placeholderFails.length ? '   <-- FAILS' : ''));
  placeholderFails.slice(0, 8).forEach((f) => console.log('    ' + f));
  console.log('engagement-language failures: ' + engagementFails.length + (engagementFails.length ? '   <-- FAILS' : ''));
  engagementFails.slice(0, 8).forEach((f) => console.log('    ' + f));
  console.log('length/shape failures       : ' + shapeFails.length + (shapeFails.length ? '   <-- FAILS' : ''));
  shapeFails.slice(0, 5).forEach((f) => console.log('    ' + f));
  console.log('register identical across experience: ' + registerFlat.length + (registerFlat.length ? '   <-- register is not varying' : ''));
  registerFlat.slice(0, 5).forEach((f) => console.log('    ' + f));
  console.log('cache hits / misses         : ' + cache.hits + ' / ' + cache.misses +
    '   (' + (cache.hits + cache.misses ? Math.round(cache.hits / (cache.hits + cache.misses) * 100) : 0) + '% served from cache)');

  /* DIAGNOSTIC ONLY -- reported, never a pass/fail condition. Run 6 taught that a
     rule with zero opportunities is not a pass; the same is true of a phrase
     variant nobody is ever shown. A string that is never served cannot vary the
     register of anything, however different it looks in the dictionary. */
  const never = cache.neverServed || [];
  console.log('\nphrase variants never served: ' + never.length + ' of ' + total +
    '   (' + Math.round((total - never.length) / total * 100) + '% of the dictionary is reachable)');
  never.forEach((f) => console.log('    DEAD  ' + f));

  const ok = placeholderFails.length === 0 && engagementFails.length === 0 && shapeFails.length === 0;
  console.log('\nVERDICT: ' + (ok ? 'the generated strings satisfy the mechanical constraints. Whether they are BETTER is a question for an outside reader.'
                                  : 'constraints violated — do not report on quality until these are fixed.'));

  fs.writeFileSync(path.join(OUT, 'langcheck.json'),
    JSON.stringify({ total, placeholderFails, engagementFails, shapeFails, registerFlat, cache }, null, 2), 'utf8');
  proc.kill(); server.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('LANGCHECK FAILED', e); process.exit(1); });
