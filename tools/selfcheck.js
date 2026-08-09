'use strict';
/* L2 experiment harness — lives OUTSIDE the repo on purpose. The repo stays
   dependency-free and build-step-free. This drives Edge over CDP with zero
   npm packages so we can (a) verify the page works and (b) capture the REAL
   accessibility tree the browser computes, rather than one we asserted. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const REPO = process.argv[2];
const OUT = process.argv[3];
const PORT = 8731;
const DEBUG_PORT = 9333;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(REPO, rel === '/' ? 'index.html' : rel);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, 30000);
    });
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(new Cdp(ws)));
    ws.addEventListener('error', reject);
  });
}

/* ---- blind serialization: role + accessible name + a11y properties only.
   Deliberately excludes tag names, ids, classes and data-* attributes, so the
   artifact contains nothing a real autocapture bootstrapper could not see. */
/* `pressed` and `checked` are retained even when false: they are genuine ARIA
   states present in the real tree, and dropping them silently hides the fact
   that a control is a toggle. Run 1 of the blind test dropped them by mistake;
   run 2 keeps them. Both results are reported. */
const KEEP_PROPS = new Set(['pressed', 'checked', 'expanded', 'disabled', 'required', 'level', 'multiselectable']);
const ALWAYS_PROPS = new Set(['pressed', 'checked']);
const SKIP_ROLES = new Set(['none', 'presentation', 'InlineTextBox', 'LineBreak']);

function serializeAx(nodes) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) || nodes[0];
  const lines = [];
  const walk = (node, depth) => {
    if (!node || node.ignored) {
      (node && node.childIds || []).forEach((c) => walk(byId.get(c), depth));
      return;
    }
    const role = node.role && node.role.value;
    if (SKIP_ROLES.has(role)) {
      (node.childIds || []).forEach((c) => walk(byId.get(c), depth));
      return;
    }
    const name = node.name && node.name.value ? node.name.value.replace(/\s+/g, ' ').trim() : '';
    const value = node.value && node.value.value !== undefined && node.value.value !== '' ? String(node.value.value) : '';
    const props = (node.properties || [])
      .filter((p) => KEEP_PROPS.has(p.name) && p.value && p.value.value !== undefined && p.value.value !== '' &&
        (ALWAYS_PROPS.has(p.name) || (p.value.value !== false && p.value.value !== 'false')))
      .map((p) => p.name + '=' + (Array.isArray(p.value.value) ? '…' : p.value.value));
    let line = '  '.repeat(depth) + '- ' + role;
    if (name) line += ' "' + name + '"';
    if (value) line += ' [value: "' + value + '"]';
    if (props.length) line += ' {' + props.join(', ') + '}';
    lines.push(line);
    (node.childIds || []).forEach((c) => walk(byId.get(c), depth + 1));
  };
  walk(root, 0);
  return lines.join('\n');
}

(async () => {
  const server = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'l2edge-'));
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + DEBUG_PORT, '--user-data-dir=' + profile,
    '--window-size=1280,2400', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await getJson('http://127.0.0.1:' + DEBUG_PORT + '/json/list'); if (targets.some((t) => t.type === 'page')) break; } catch (e) { /* retry */ }
    await sleep(300);
  }
  const page = targets.find((t) => t.type === 'page');
  const cdp = await connect(page.webSocketDebuggerUrl);

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Accessibility.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await sleep(2500);

  const problems = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level)))
    .map((e) => e.method === 'Runtime.exceptionThrown'
      ? 'EXCEPTION: ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || e.params.exceptionDetails.text)
      : e.params.entry.level.toUpperCase() + ': ' + e.params.entry.text);

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(expr + ' -> ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  /* Exercise every capability the way a user would, then read the state back. */
  const behaviour = await evaluate(`(() => {
    const out = {};
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    document.getElementById('s-monday-morning-done').click();
    const swap = document.getElementById('s-tuesday-morning-swap');
    swap.value = 'Easy swim (20–30 min)'; fire(swap, 'change');
    const note = document.getElementById('s-tuesday-morning-note');
    note.value = 'ankle sore, swam instead'; document.getElementById('s-tuesday-morning-log').click();
    const radioB = document.getElementById('s-saturday-variant-b');
    radioB.checked = true; fire(radioB, 'change');
    document.getElementById('s-monday-morning-done').click();   // reopen
    const restore = document.getElementById('s-tuesday-morning-swap');
    restore.value = ''; fire(restore, 'change');
    document.getElementById('s-tuesday-morning-log').click();   // no-op save
    out.attempts = window.__datuxAttempts.map(a => a.capability.id + ' | ' + a.outcome + ' @ ' + a.surface.role + ' "' + a.surface.name + '" in "' + (a.surface.container ? a.surface.container.name : '-') + '"');
    out.stored = localStorage.getItem('pt.l2.state.v1');
    out.saturdayText = document.getElementById('s-saturday-long-text').textContent;
    out.status = document.getElementById('app-status').textContent;
    out.capabilityAttrs = [...new Set([...document.querySelectorAll('[data-capability]')].flatMap(el => el.dataset.capability.split(' ')))].sort();
    out.controlCount = document.querySelectorAll('button, select, input').length;
    out.unnamed = [...document.querySelectorAll('button, select, input')].filter(el => {
      const lb = el.getAttribute('aria-labelledby');
      if (lb) return !lb.split(/\\s+/).every(id => document.getElementById(id));
      return !(el.getAttribute('aria-label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label') || el.textContent.trim());
    }).map(el => el.id || el.outerHTML.slice(0, 60));
    return out;
  })()`);

  /* Reload clean so the AX dump shows the untouched initial state. */
  await evaluate("localStorage.clear()");
  await cdp.send('Page.reload');
  await sleep(2000);

  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const outline = serializeAx(nodes);

  /* Does the page's own accessible-name computation agree with the browser's?
     instrumentation.md §3 makes role+name the identity of a `surface`, so any
     disagreement means the in-page SDK and the accessibility tree disagree
     about WHERE an attempt happened. */
  const inPageNames = await evaluate(`JSON.stringify([...document.querySelectorAll('button, select, input')].map(e => [e.id, accessibleName(e)]))`);
  const domNodes = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const byBackend = new Map();
  const walkDom = (n) => {
    if (n.attributes) {
      const idIdx = n.attributes.indexOf('id');
      if (idIdx >= 0 && idIdx % 2 === 0) byBackend.set(n.backendNodeId, n.attributes[idIdx + 1]);
    }
    (n.children || []).forEach(walkDom);
    (n.contentDocument ? [n.contentDocument] : []).forEach(walkDom);
  };
  walkDom(domNodes.root);
  const axNameById = new Map();
  nodes.forEach((n) => {
    const domId = byBackend.get(n.backendDOMNodeId);
    if (domId && n.name && n.name.value) axNameById.set(domId, n.name.value.replace(/\s+/g, ' ').trim());
  });
  const mismatches = JSON.parse(inPageNames)
    .filter(([id, name]) => id && axNameById.has(id) && axNameById.get(id) !== name)
    .map(([id, name]) => ({ id: id, in_page: name, browser: axNameById.get(id) }));
  const compared = JSON.parse(inPageNames).filter(([id]) => id && axNameById.has(id)).length;
  console.log('--- NAME AGREEMENT: ' + (compared - mismatches.length) + '/' + compared + ' controls agree between in-page SDK and browser accessibility tree ---');
  mismatches.slice(0, 3).forEach((m) => console.log('    ' + m.id + '\n      in-page: "' + m.in_page + '"\n      browser: "' + m.browser + '"'));
  if (mismatches.length > 3) console.log('    … and ' + (mismatches.length - 3) + ' more');

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ax-tree.txt'), outline, 'utf8');
  fs.writeFileSync(path.join(OUT, 'behaviour.json'), JSON.stringify({ problems, behaviour, nameAgreement: { compared: compared, mismatched: mismatches.length, examples: mismatches.slice(0, 5) } }, null, 2), 'utf8');

  console.log('--- console problems (' + problems.length + ') ---');
  problems.forEach((p) => console.log('  ' + p));
  console.log('--- controls: ' + behaviour.controlCount + ', unnamed: ' + JSON.stringify(behaviour.unnamed) + ' ---');
  console.log('--- attempts emitted ---');
  behaviour.attempts.forEach((a) => console.log('  ' + a));
  console.log('--- saturday text: ' + behaviour.saturdayText);
  console.log('--- status: ' + behaviour.status);
  console.log('--- stored: ' + behaviour.stored);
  console.log('--- ax tree lines: ' + outline.split('\n').length + ' -> ' + path.join(OUT, 'ax-tree.txt'));

  edge.kill();
  server.close();
  process.exit(0);
})().catch((e) => { console.error('HARNESS FAILED', e); process.exit(1); });
