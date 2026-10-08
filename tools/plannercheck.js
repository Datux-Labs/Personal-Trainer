'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./cdp');

const REPO = path.resolve(process.argv[2] || '.');
const OUT = process.argv[3];
if (!OUT) throw new Error('Usage: node --experimental-websocket tools\\plannercheck.js <repoDir> <outDir>');

const checks = [];
const dateScript = (day) => `{
  const NativeDate = Date;
  const fixed = new NativeDate(2026, 9, ${day}, 12).getTime();
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
}`;
const defaults = `{
  window.__datuxResetState();
  const prefs = { equipment: 'full', protecting: 'none', experience: 'regular', timeBudget: '90', target: 'standard' };
  Object.entries(prefs).forEach(([key, value]) => window.__datuxSetPreference(key, value));
}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    if (!['/', '/index.html'].includes(req.url.split('?')[0])) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(REPO, 'index.html')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await launch(9551);
    const { cdp } = browser;
    const errors = [];
    cdp.on((event) => {
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails);
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') errors.push(event.params.entry.text);
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Accessibility.enable');
    let pinnedDate = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: dateScript(7) });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
    await cdp.send('Page.navigate', { url });
    await sleep(1400);

    async function verify(name, expression, expected) {
      const actual = await cdp.evaluate(expression);
      assert.deepEqual(actual, expected, name + '\nActual: ' + JSON.stringify(actual));
      checks.push(name);
    }
    async function act(expression) {
      await cdp.evaluate('(() => { ' + expression + '; return true; })()');
    }
    async function reload() {
      await cdp.send('Page.reload');
      await sleep(700);
    }
    async function screenshot(name) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
    }
    await verify('Exact weekly schedule and doses', `(() => {
      const sessions = Object.values(WEEK_PLAN).flatMap(d => d.sessions);
      return {
        total: sessions.length,
        strengths: sessions.filter(s => s.kind === 'strength').length,
        sports: sessions.filter(s => s.kind === 'skill').length,
        endurance: sessions.filter(s => s.kind === 'endurance').length,
        tuesday: WEEK_PLAN.Tuesday.sessions.length,
        saturday: WEEK_PLAN.Saturday.sessions.map(s => s.activity),
        running: [WEEK_PLAN.Monday.sessions[1].minutes, WEEK_PLAN.Saturday.sessions[0].minutes],
        swimming: WEEK_PLAN.Thursday.sessions[1].minutes,
        unknownSportDurations: sessions.filter(s => ['Bouldering','Volleyball','Pickleball'].includes(s.activity)).every(s => s.minutes === null)
      };
    })()`, { total: 11, strengths: 3, sports: 5, endurance: 3, tuesday: 0, saturday: ['Run', 'Pickleball'], running: [25, 40], swimming: 20, unknownSportDurations: true });
    await verify('All three support-focused strength plans', `(() => ({
      counts: Object.values(STRENGTH_WORKOUTS).map(s => s.length),
      squat: STRENGTH_WORKOUTS.lower[2].dose,
      legCurl: STRENGTH_WORKOUTS.lower[3].dose,
      pullCondition: STRENGTH_WORKOUTS.upper[2].condition,
      startingFullBody: STRENGTH_WORKOUTS.full.slice(3).every(s => /Start with one set/.test(s.cue)),
      illustrations: document.querySelectorAll('.movement').length
    }))()`, { counts: [6, 6, 6], squat: '2 × 5–8', legCurl: '2 × 8–12', pullCondition: 'Only if bouldering is canceled', startingFullBody: true, illustrations: 18 });
    await verify('Daily and full-week views', `(() => {
      const count = () => [...document.querySelectorAll('.day-card')].filter(c => !c.hidden).length;
      const daily = count();
      document.getElementById('all-days').click();
      const all = count();
      const active = [...document.querySelectorAll('.slot')].filter(s => !s.hidden).length;
      document.getElementById('all-days').click();
      return [daily, all, active, count()];
    })()`, [1, 7, 11, 1]);
    await act("document.getElementById('tab-tuesday').click(); document.getElementById('tab-tuesday').focus()");
    await verify('Recovery has no required completion or swap controls', `[
      window.__datuxSurface.facts.slots.length,
      document.querySelectorAll('#today-actions button, #today-actions select').length,
      document.getElementById('today-plan').textContent.includes('Protected recovery')
    ]`, [0, 0, true]);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await verify('Keyboard tabs update both focus and selected-day actions', `[
      document.activeElement.id,
      window.__datuxSurface.facts.ctx.weekday,
      [...document.querySelectorAll('#today-actions [data-focus-action]')].map(b => b.dataset.focusAction)
    ]`, ['tab-wednesday', 'Wednesday', ['wednesday.climb', 'wednesday.upper']]);

    await act(defaults + `window.__datuxSetWeekday('Monday');
      document.getElementById('today-done-lower').click();
      const note = document.getElementById('s-monday-lower-note');
      note.closest('details').open = true;
      note.value = 'Comfortable reps; left three in reserve.';
      note.focus();
    `);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await reload();
    await verify('Completion and keyboard-enter notes survive reload', `[
      document.getElementById('s-monday-lower-done').getAttribute('aria-pressed'),
      document.getElementById('s-monday-lower-note').value,
      document.getElementById('completed-count').textContent
    ]`, ['true', 'Comfortable reps; left three in reserve.', '1']);
    await act("window.__datuxSetWeekday('Monday'); document.getElementById('today-done-lower').click()");
    await verify('Focus and grid reopen the same session', `[
      document.getElementById('s-monday-lower-done').getAttribute('aria-pressed'),
      document.getElementById('completed-count').textContent
    ]`, ['false', '0']);
    await verify('A focus swap emits exactly one correctly attributed attempt', `(() => {
      const before = window.__datuxAttempts.length;
      const swap = document.getElementById('today-swap');
      swap.focus();
      swap.value = 'Easy swim (15–20 min, with rests)';
      swap.dispatchEvent(new Event('change', { bubbles: true }));
      const attempt = window.__datuxAttempts.at(-1);
      const result = [
        window.__datuxAttempts.length - before,
        attempt.capability.id,
        attempt.surface.container.name,
        document.getElementById('s-monday-lower-swap').value,
        window.__datuxSurface.facts.primary.effective.minutes,
        document.activeElement.id
      ];
      const restore = document.getElementById('today-swap');
      restore.value = ''; restore.dispatchEvent(new Event('change', { bubbles: true }));
      return result;
    })()`, [1, 'urn:cap:session.substitute_exercise', 'Sessions Monday', 'Easy swim (15–20 min, with rests)', 20, 'today-swap']);
    await act(defaults + "window.__datuxSetWeekday('Saturday'); document.getElementById('s-saturday-pickleball-done').click()");
    await verify('Saturday riding replaces both sessions, preserving usual progress', `(() => {
      const select = document.getElementById('week-mode');
      const set = value => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
      set('snowboard-day');
      const riding = [window.__datuxSurface.facts.slots.map(s => s.slotId), document.getElementById('week-progress').max, document.getElementById('completed-count').textContent];
      set('standard');
      return [...riding, document.getElementById('s-saturday-pickleball-done').getAttribute('aria-pressed'), document.getElementById('completed-count').textContent];
    })()`, [['ride'], 10, '0', 'true', '1']);
    await verify('A riding weekend also replaces Sunday climbing', `(() => {
      const select = document.getElementById('week-mode');
      select.value = 'snowboard-weekend'; select.dispatchEvent(new Event('change', { bubbles: true }));
      window.__datuxSetWeekday('Sunday');
      return [window.__datuxSurface.facts.slots.map(s => s.session.activity), document.getElementById('week-progress').max];
    })()`, [['Snowboarding'], 10]);
    await reload();
    await verify('Seasonal selection survives reload', "document.getElementById('week-mode').value", 'snowboard-weekend');

    await act(defaults + "window.__datuxSetWeekday('Saturday'); window.__datuxSetPreference('protecting', 'ankle')");
    await verify('Injury reversal discloses its consequence and remains reversible', `(() => {
      const before = document.getElementById('adapt-revert').textContent;
      document.getElementById('adapt-revert').click();
      const reverted = window.__datuxSurface.facts.adaptation.reverted;
      document.getElementById('adapt-revert').click();
      return [before.includes('Run / walk') && before.includes('loads your ankle'), reverted, window.__datuxSurface.facts.adaptation.reverted];
    })()`, [true, true, false]);
    await verify('Logging the adapted focus records the activity actually displayed', `(() => {
      document.getElementById('today-done-run').click();
      const saved = JSON.parse(localStorage.getItem('pt.athletic.state.v2')).weeks[weekKey].slots['saturday.run'];
      return [saved.complete, saved.substitution, window.__datuxAttempts.at(-1).detail.activity];
    })()`, [true, 'Easy swim (15–20 min, with rests)', 'Easy swim (15–20 min, with rests)']);
    await act(defaults + "window.__datuxSetWeekday('Thursday'); document.getElementById('s-thursday-full-done').click(); window.__datuxSetPreference('protecting','shoulder')");
    await verify('Swimming is not presented as avoiding shoulder load', `[
      window.__datuxSurface.facts.adaptation.suggestion,
      window.__datuxSurface.facts.primary.effective.loads.includes('shoulder')
    ]`, ['Rest / full recovery', false]);
    await act(defaults + "window.__datuxSetWeekday('Wednesday'); window.__datuxSetPreference('protecting','shoulder'); document.getElementById('ask-protection-dismiss').focus(); document.getElementById('ask-protection-dismiss').click()");
    await verify('A declined suggestion has a working undo', `(() => {
      const undo = document.getElementById('adapt-undismiss');
      const present = !!undo;
      const undoFocused = document.activeElement === undo;
      undo.click();
      return [present, undoFocused, !!document.getElementById('ask-protection-dismiss'), document.activeElement.id];
    })()`, [true, true, true, 'ask-protection-dismiss']);
    await act(defaults + "window.__datuxSetWeekday('Monday'); window.__datuxSetPreference('equipment','none'); window.__datuxSetPreference('timeBudget','20')");
    await verify('Swap choices respect facilities, duration and joint flags', `(() => {
      const choices = [...document.getElementById('today-swap').options].map(o => o.value);
      return [choices.includes('Shorter planned session (15 min)'), choices.includes('Easy swim (15–20 min, with rests)'), choices.includes('Easy bike (15–20 min)'), choices.includes('Rest / full recovery')];
    })()`, [false, false, false, true]);
    await act(defaults + "window.__datuxSetWeekday('Monday'); window.__datuxSetPreference('target','reader-first'); const shortened = document.getElementById('today-swap'); shortened.value = 'Shorter planned session (15 min)'; shortened.dispatchEvent(new Event('change',{bubbles:true}))");
    await verify('A shortened lift does not prescribe all of the original sets', `[
      window.__datuxSurface.facts.primary.effective.minutes,
      document.getElementById('slot-secondary').textContent.includes('not the full movement prescription'),
      document.querySelector('#day-monday .session-description').textContent.includes('not the full prescription')
    ]`, [15, true, true]);
    await act(defaults + "window.__datuxSetWeekday('Monday'); document.getElementById('s-monday-lower-done').click(); document.getElementById('s-monday-run-done').click(); window.__datuxSetPreference('protecting','knee'); window.__datuxSetPreference('timeBudget','20')");
    await verify('Completed days never carry live unmet-constraint advice', `[
      window.__datuxSurface.facts.primary,
      window.__datuxSurface.plan.some(p => ['detail.time_fit','adapt.protection','adapt.applied'].includes(p.id)),
      document.getElementById('today-plan').textContent.includes('All planned sessions logged')
    ]`, [null, false, true]);

    await act(defaults + "window.__datuxSetWeekday('Monday'); document.getElementById('detail-monday-lower').open = true; document.querySelector('.movement').scrollIntoView({block:'center'})");
    await sleep(350);
    await verify('An on-screen illustration can play and pause independently', `(() => {
      const figure = document.querySelector('.movement');
      const playing = !figure.classList.contains('is-paused');
      figure.querySelector('button').click();
      return [playing, figure.classList.contains('is-paused'), figure.querySelector('button').getAttribute('aria-pressed')];
    })()`, [true, true, 'true']);
    await verify('Global pause and playback speed work', `(() => {
      document.getElementById('pause-motion').click();
      const paused = [...document.querySelectorAll('.movement')].every(f => f.classList.contains('is-paused'));
      document.getElementById('pause-motion').click();
      const speed = document.getElementById('motion-speed');
      speed.value = '1.5'; speed.dispatchEvent(new Event('change', { bubbles: true }));
      return [paused, getComputedStyle(document.querySelector('.motion-part')).animationDuration];
    })()`, [true, '2s']);
    await act("const mode = document.getElementById('motion-mode'); mode.value = 'static'; mode.dispatchEvent(new Event('change',{bubbles:true}))");
    await verify('Static-reference mode is selectable and saved', `[
      [...document.querySelectorAll('.movement')].every(f => f.classList.contains('is-static')),
      JSON.parse(localStorage.getItem('pt.athletic.motion.v1')).mode
    ]`, [true, 'static']);
    await act("const mode = document.getElementById('motion-mode'); mode.value = 'animated'; mode.dispatchEvent(new Event('change',{bubbles:true}))");
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(150);
    await verify('Reduced-motion preference forces static references', `[
      [...document.querySelectorAll('.movement')].every(f => f.classList.contains('is-static')),
      document.getElementById('pause-motion').disabled,
      getComputedStyle(document.querySelector('.motion-part')).animationName
    ]`, [true, true, 'none']);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await sleep(150);
    await act("window.scrollTo(0,0)");
    await sleep(250);
    await verify('Off-screen illustrations pause automatically', "[...document.querySelectorAll('.movement')].filter(f => f.dataset.visible === 'false').every(f => f.classList.contains('is-paused'))", true);

    await act("window.__printOpenStates = [...document.querySelectorAll('details')].map(d => d.open); window.dispatchEvent(new Event('beforeprint'))");
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await verify('Print includes every day and all guidance, with static illustrations', `[
      [...document.querySelectorAll('.day-card')].every(c => getComputedStyle(c).display !== 'none'),
      [...document.querySelectorAll('.guide-grid details')].every(d => d.open),
      [...document.querySelectorAll('.movement')].every(f => f.classList.contains('is-static'))
    ]`, [true, true, true]);
    const pdf = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.join(OUT, 'printed-plan.pdf'), Buffer.from(pdf.data, 'base64'));
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });
    await act("window.dispatchEvent(new Event('afterprint'))");
    await verify('Print restores the prior disclosure state', "[...document.querySelectorAll('details')].map(d => d.open).every((open, i) => open === window.__printOpenStates[i])", true);

    await act(defaults);
    for (const width of [1440, 1024, 768, 390, 360, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await act("showAllDays = false; window.__datuxSetWeekday('Saturday'); window.scrollTo(0,0)");
      await sleep(100);
      await verify('No page overflow at ' + width + 'px', 'document.documentElement.scrollWidth <= window.innerWidth', true);
      for (const target of ['standard', 'large-type', 'reader-first']) {
        await act(`window.__datuxSetPreference('target', ${JSON.stringify(target)}); window.__datuxSetPreference('experience','novice')`);
        await verify('Readable focus at ' + width + 'px / ' + target, "document.getElementById('today-plan').scrollHeight <= document.getElementById('today-plan').clientHeight + 1", true);
      }
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    await act(defaults + "showAllDays = false; window.__datuxSetWeekday('Wednesday'); window.scrollTo(0,0)");
    await sleep(150);
    await screenshot('desktop');
    await act("window.__datuxSetWeekday('Monday'); document.getElementById('detail-monday-lower').open = true; document.getElementById('day-monday').scrollIntoView({block:'start'})");
    await sleep(150);
    await screenshot('strength-detail');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await act("window.__datuxSetWeekday('Saturday'); document.getElementById('weekly-plan').scrollIntoView({block:'start'})");
    await sleep(150);
    await verify('The selected Saturday tab remains visible on mobile', `(() => {
      const tab = document.getElementById('tab-saturday').getBoundingClientRect();
      const strip = document.getElementById('day-tabs').getBoundingClientRect();
      return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
    })()`, true);
    await screenshot('mobile-saturday');

    for (const policy of ['uniform', 'holdout']) {
      await cdp.send('Page.navigate', { url: url + '?policy=' + policy });
      await sleep(700);
      await act(defaults + "window.__datuxSetWeekday('Saturday'); window.__datuxSetPreference('protecting','ankle')");
      await verify(policy + ' respects the schedule without applying preference-based changes', `[
        window.__datuxSurface.plan.length,
        window.__datuxSurface.facts.adaptation,
        document.getElementById('today-plan').textContent.includes('Run / walk')
      ]`, [0, null, true]);
      await act("window.__datuxSetPreference('equipment','none'); window.__datuxSetPreference('timeBudget','20')");
      await verify(policy + ' keeps uniform grid alternatives independent of preferences', "[...document.getElementById('s-saturday-run-swap').options].some(o => o.value === 'Easy swim (15–20 min, with rests)')", true);
      await act("const swap = document.getElementById('s-saturday-run-swap'); swap.value = 'Easy swim (15–20 min, with rests)'; swap.dispatchEvent(new Event('change',{bubbles:true}))");
      await verify(policy + ' still reflects explicit session swaps', "document.getElementById('today-plan').textContent.includes('Easy swim (15–20 min, with rests)')", true);
    }
    await cdp.send('Page.navigate', { url });
    await sleep(700);
    await act(`localStorage.removeItem('pt.athletic.state.v2');
      localStorage.setItem('pt.l2.state.v1', JSON.stringify({version:1, slots:{'monday.morning':{complete:true,substitution:'',note:'Earlier swim note <not HTML>'}}}));
    `);
    await reload();
    await verify('Earlier plan is archived, never mapped onto new workouts', `[
      document.getElementById('legacy-history').hidden,
      document.getElementById('legacy-list').textContent.includes('Earlier swim note <not HTML>'),
      document.getElementById('s-monday-lower-done').getAttribute('aria-pressed'),
      JSON.parse(localStorage.getItem('pt.l2.state.v1')).slots['monday.morning'].complete
    ]`, [false, true, 'false', true]);
    await act(`state.weeks['2000-01-03'] = {mode:'standard',slots:{'monday.lower':{complete:true,substitution:'',note:'Earlier week kept'}}};
      saveState(); window.__datuxSetWeekday('Monday'); document.getElementById('s-monday-lower-done').click();
      window.__storedBeforeCancel = localStorage.getItem('pt.athletic.state.v2');
      window.__nativeConfirm = window.confirm; window.confirm = () => false; document.getElementById('reset-progress').click();
    `);
    await verify('Canceling reset changes no stored progress', "localStorage.getItem('pt.athletic.state.v2') === window.__storedBeforeCancel", true);
    await act("window.confirm = () => true; document.getElementById('reset-progress').click(); window.confirm = window.__nativeConfirm");
    await verify('Reset clears only the current week', `[
      document.getElementById('completed-count').textContent,
      state.weeks['2000-01-03'].slots['monday.lower'].note,
      state.legacySlots['monday.morning'].note
    ]`, ['0', 'Earlier week kept', 'Earlier swim note <not HTML>']);
    await act("document.getElementById('s-monday-lower-done').click()");
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pinnedDate.identifier });
    pinnedDate = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: dateScript(12) });
    await reload();
    await verify('A new Monday starts fresh without discarding the previous week', `[
      weekKey,
      document.getElementById('completed-count').textContent,
      state.weeks['2026-10-05'].slots['monday.lower'].complete
    ]`, ['2026-10-12', '0', true]);
    await verify('Storage failures are surfaced and never reported as saved', `(() => {
      const native = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('Intentional test failure', 'QuotaExceededError'); };
      document.getElementById('s-monday-lower-done').click();
      Storage.prototype.setItem = native;
      return [
        document.getElementById('storage-alert').hidden,
        document.getElementById('app-status').textContent.includes('Could not save'),
        window.__datuxAttempts.at(-1).outcome
      ];
    })()`, [false, true, 'abandoned']);
    await act("localStorage.setItem('pt.athletic.state.v2', JSON.stringify({version:2,weeks:{'2026-10-12':{mode:'standard',slots:{'monday.lower':{complete:false,substitution:'Unknown activity',note:'Keep this note'}}}}}))");
    await reload();
    await verify('Invalid saved swaps recover explicitly without losing valid notes', `[
      document.getElementById('storage-alert').hidden,
      document.getElementById('s-monday-lower-swap').value,
      document.getElementById('s-monday-lower-note').value
    ]`, [false, '', 'Keep this note']);
    await act("localStorage.setItem('pt.athletic.state.v2', '{broken JSON')");
    await reload();
    await verify('Unreadable storage shows an error instead of crashing', `[
      document.getElementById('storage-alert').hidden,
      document.getElementById('completed-count').textContent,
      !!window.__datuxSurface
    ]`, [false, '0', true]);
    assert.equal(errors.length, 0, 'Browser errors: ' + JSON.stringify(errors));
    checks.push('No uncaught browser exceptions or resource errors');
    fs.writeFileSync(path.join(OUT, 'plannercheck.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log('PASS: ' + checks.length + ' planner checks, including responsive layouts, persistence, pickleball, winter replacements and print.');
    console.log('Screenshots and print preview: ' + OUT);
  } finally {
    if (browser) {
      browser.cdp.ws.close();
      browser.proc.kill();
    }
    await new Promise((resolve) => server.close(resolve));
  }
})().then(() => process.exit(0)).catch((err) => { console.error('PLANNER CHECK FAILED:', err); process.exit(1); });
