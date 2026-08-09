'use strict';
/* Shared zero-dependency CDP plumbing. Node 20 with --experimental-websocket.
   Used by screen.js / capture.js. Nothing here is installed into any repo. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        this.events.push(m);
        this.handlers.forEach((h) => h(m));
      }
    });
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params, timeoutMs) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, timeoutMs || 45000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(new Cdp(ws)));
    ws.addEventListener('error', reject);
  });
}

async function launch(debugPort, extraArgs) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'l2run2-'));
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter', '--window-size=1400,1000',
    '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile
  ].concat(extraArgs || []).concat(['about:blank']), { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await getJson('http://127.0.0.1:' + debugPort + '/json/list');
      if (targets.some((t) => t.type === 'page')) break;
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  if (!targets) throw new Error('browser did not come up');
  const cdp = await connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  return { proc, cdp, profile };
}

/* Map every DOM element carrying data-axprobe to its accessibility node. */
async function probeMap(cdp) {
  const dom = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const byBackend = new Map();
  const walk = (n) => {
    if (n.attributes) {
      const i = n.attributes.indexOf('data-axprobe');
      if (i >= 0 && i % 2 === 0) byBackend.set(n.backendNodeId, n.attributes[i + 1]);
    }
    (n.children || []).forEach(walk);
    if (n.contentDocument) walk(n.contentDocument);
    (n.shadowRoots || []).forEach(walk);
  };
  walk(dom.root);
  return byBackend;
}

const ACTIONABLE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'checkbox',
  'radio', 'switch', 'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'treeitem', 'gridcell', 'columnheader', 'rowheader', 'disclosure triangle',
  'PopUpButton', 'ComboBox', 'DisclosureTriangle', 'menu', 'MenuListPopup'
]);

const SKIP_ROLES = new Set(['none', 'presentation', 'InlineTextBox', 'LineBreak', 'generic', 'GenericContainer']);

function serializeAx(nodes, opts) {
  const options = opts || {};
  const keep = new Set(['pressed', 'checked', 'expanded', 'disabled', 'required', 'level', 'selected', 'multiselectable', 'haspopup']);
  const always = new Set(['pressed', 'checked', 'expanded', 'selected']);
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) || nodes[0];
  const lines = [];
  let emitted = 0;
  const walk = (node, depth) => {
    if (!node) return;
    if (node.ignored || SKIP_ROLES.has(node.role && node.role.value)) {
      (node.childIds || []).forEach((c) => walk(byId.get(c), depth));
      return;
    }
    if (options.maxNodes && emitted >= options.maxNodes) return;
    const role = node.role && node.role.value;
    const name = node.name && node.name.value ? node.name.value.replace(/\s+/g, ' ').trim() : '';
    const rawValue = node.value && node.value.value;
    const value = rawValue !== undefined && rawValue !== '' ? String(rawValue).replace(/\s+/g, ' ').slice(0, 120) : '';
    const props = (node.properties || [])
      .filter((p) => keep.has(p.name) && p.value && p.value.value !== undefined && p.value.value !== '' &&
        (always.has(p.name) || (p.value.value !== false && p.value.value !== 'false')))
      .map((p) => p.name + '=' + (Array.isArray(p.value.value) ? '…' : p.value.value));
    let line = '  '.repeat(Math.min(depth, 24)) + '- ' + role;
    if (name) line += ' "' + (name.length > 160 ? name.slice(0, 160) + '…' : name) + '"';
    if (value) line += ' [value: "' + value + '"]';
    if (props.length) line += ' {' + props.join(', ') + '}';
    lines.push(line);
    emitted++;
    (node.childIds || []).forEach((c) => walk(byId.get(c), depth + 1));
  };
  walk(root, 0);
  return lines.join('\n');
}

module.exports = { EDGE, sleep, getJson, Cdp, connect, launch, probeMap, serializeAx, ACTIONABLE_ROLES, SKIP_ROLES };
