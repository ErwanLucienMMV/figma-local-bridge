import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createBridge } from '../bridge/server.mjs';
import protocol from '../src/protocol.cjs';
export function command(operations, overrides = {}) {
  return { version: 1, commandId: 'test-command', sessionId: 'test-session', pageId: '1:1', operations, ...overrides };
}
export async function liveBridge(t, options = {}) {
  const bridge = createBridge(options);
  bridge.server.listen(0, '127.0.0.1'); await once(bridge.server, 'listening');
  t.after(() => new Promise(resolve => { bridge.server.close(resolve); bridge.server.closeAllConnections(); }));
  const url = 'http://127.0.0.1:' + bridge.server.address().port;
  async function api(route, data, role = 'agent', headers = {}) {
    const response = await fetch(url + route, { method: data === undefined ? 'GET' : 'POST', headers: {
      Authorization: 'Bearer ' + (role === 'agent' ? bridge.agentToken : bridge.pluginToken),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function register(revision = protocol.REVISION) {
    return (await api('/plugin/register', { pageId: '1:1', pageName: 'Page', documentName: 'Document', ...(revision ? { protocolRevision: revision } : {}) }, 'plugin')).data;
  }
  return { ...bridge, url, api, register };
}
export function fakeFigma() {
  function insertChild(index, node) {
    if (node.parent?.children) { const old = node.parent.children.indexOf(node); if (old >= 0) node.parent.children.splice(old, 1); }
    this.children.splice(index, 0, node); node.parent = this;
  }
  function appendChild(node) { this.insertChild(this.children.length, node); }
  const page = { id: '1:1', name: 'Page', type: 'PAGE', selection: [], children: [], insertChild, appendChild };
  const otherPage = { ...page, id: '2:1', children: [] };
  const nodes = new Map(); const messages = []; const events = {}; const fonts = [];
  const figma = { currentPage: page, root: { name: 'Document' }, mixed: Symbol('mixed'),
    ui: { postMessage: value => messages.push(value) }, showUI() {}, on: (name, fn) => { events[name] = fn; },
    getNodeByIdAsync: async id => id === page.id ? page : id === otherPage.id ? otherPage : nodes.get(id) || null,
    loadFontAsync: async font => { fonts.push(font); },
    getStyleByIdAsync: async id => ({ id, type: 'PAINT' }), variables: { getVariableByIdAsync: async id => ({ id }) },
    createdCount: 0,
    createFrame() { this.createdCount++; return add('FRAME', '1:' + (1000 + this.createdCount)); },
    createText() { this.createdCount++; return add('TEXT', '1:' + (1000 + this.createdCount)); },
    commitUndo() { this.undoCount++; }, undoCount: 0,
    createComponentFromNode(node) { node.removed = true; return add('COMPONENT', '1:200'); }
  };
  function add(type = 'RECTANGLE', id = '1:2', parent = page) {
    const node = { id, type, name: type, x: 0, y: 0, width: 100, height: 50, visible: true, locked: false, removed: false, parent: null, fills: [],
      fillStyleId: '', strokeStyleId: '', effectStyleId: '', strokes: [], effects: [], opacity: 1, boundVariables: {},
      strokeWeight: 1, strokeAlign: 'INSIDE', strokeCap: 'NONE', strokeJoin: 'MITER', dashPattern: [],
      cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0, cornerSmoothing: 0,
      layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', layoutPositioning: 'AUTO', minWidth: null, maxWidth: null, minHeight: null, maxHeight: null,
      resizeWithoutConstraints(width, height) { this.width = width; this.height = height; },
      async setFillStyleIdAsync(value) { this.fillStyleId = value; }, async setStrokeStyleIdAsync(value) { this.strokeStyleId = value; }, async setEffectStyleIdAsync(value) { this.effectStyleId = value; },
      setBoundVariable(field, variable) {
        if (!['fontFamily', 'fontStyle', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent', 'opacity', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'strokeWeight', 'strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight'].includes(field)) throw new Error('Champ de variable Figma invalide : ' + field);
        if (variable) this.boundVariables[field] = { type: 'VARIABLE_ALIAS', id: variable.id }; else delete this.boundVariables[field];
      },
      remove() { if (this.parent?.children) { const index = this.parent.children.indexOf(this); if (index >= 0) this.parent.children.splice(index, 1); } this.parent = null; this.removed = true; }
    };
    if (['FRAME', 'COMPONENT', 'INSTANCE'].includes(type)) Object.assign(node, { children: [], insertChild, appendChild, layoutMode: 'NONE', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN', itemSpacing: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, clipsContent: true });
    if (type === 'TEXT') Object.assign(node, { characters: 'Avant', fontName: { family: 'Inter', style: 'Regular' }, hasMissingFont: false,
      fontSize: 16, lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PIXELS', value: 0 }, paragraphSpacing: 0, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE', textAlignHorizontal: 'LEFT', textAlignVertical: 'TOP', textAutoResize: 'NONE', textStyleId: '',
      async setTextStyleIdAsync(value) { this.textStyleId = value; },
      getRangeAllFontNames(start, end) { if (start === end) throw new Error('empty range'); return [this.fontName]; } });
    if (type === 'COMPONENT') node.createInstance = () => add('INSTANCE', '1:201');
    if (type === 'INSTANCE') Object.assign(node, { componentProperties: { 'Label#1:0': { type: 'TEXT', value: 'Avant' }, Visible: { type: 'BOOLEAN', value: true } },
      findAllWithCriteria: () => [], setProperties(props) { this.propertiesSet = props; } });
    nodes.set(id, node); if (parent?.appendChild) parent.appendChild(node); else node.parent = parent; return node;
  }
  return { figma, page, otherPage, nodes, messages, events, fonts, add };
}
export async function engineFor(figma) {
  const source = await readFile(new URL('../src/engine.js', import.meta.url), 'utf8');
  const context = vm.createContext({ figma, protocol });
  return vm.runInContext(source + '\ncreateEngine(figma, protocol)', context);
}
export async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('État attendu non atteint');
}
