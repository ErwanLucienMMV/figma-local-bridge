/* Figma-only adapter. No operation executes agent-provided code. */
function createEngine(figma, protocol) {
  'use strict';
  const LAYOUT = protocol.LAYOUT_KEYS;
  const TYPO = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent', 'textCase', 'textDecoration', 'textAlignHorizontal', 'textAlignVertical'];
  const CORNERS = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius', 'cornerSmoothing'];
  const unsupported = reason => ({ $unsupported: true, reason });
  function pageOf(node) { let p = node; while (p && p.type !== 'PAGE') p = p.parent; return p; }
  function current(pageId) { if (figma.currentPage.id !== pageId) throw new Error('Page changée : reconnecter le plugin.'); }
  function check(node, pageId, write = false, ordinary = false) {
    if (!node || node.removed || node.type === 'DOCUMENT' || pageOf(node)?.id !== pageId) throw new Error('Calque absent, supprimé ou hors de la page autorisée');
    for (let p = node; p && p.type !== 'PAGE'; p = p.parent) {
      if (write && p.locked) throw new Error('Calque ou ancêtre verrouillé : ' + p.id);
      if (ordinary && ['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(p.type)) throw new Error('Cette opération exige des calques ordinaires, hors composant ou instance');
    }
  }
  async function resolve(id, pageId, write = false, allowPage = false, ordinary = false) {
    const node = await figma.getNodeByIdAsync(id); check(node, pageId, write, ordinary);
    if (!allowPage && node.type === 'PAGE') throw new Error('Un calque, et non une page, est requis');
    return node;
  }
  function serial(value, depth = 0) {
    if (value === figma.mixed) return { $mixed: true };
    if (value === undefined || typeof value === 'symbol' || typeof value === 'function') return unsupported('Valeur non disponible ou non sérialisable');
    if (typeof value === 'number' && !Number.isFinite(value)) return unsupported('Nombre non fini');
    if (value === null || typeof value !== 'object') return value;
    if (depth > 7) return { $truncated: true, reason: 'Profondeur maximale' };
    if (Array.isArray(value)) return value.length > 32 ? { $truncated: true, total: value.length, items: value.slice(0, 32).map(v => serial(v, depth + 1)) } : value.map(v => serial(v, depth + 1));
    const entries = Object.entries(value), out = {};
    for (const [k, v] of entries.slice(0, 64)) if (!['__proto__', 'prototype', 'constructor'].includes(k)) out[k] = serial(v, depth + 1);
    if (entries.length > 64) out.$truncated = true;
    return out;
  }
  function property(node, key) {
    try { return key in node ? serial(node[key]) : unsupported('Non pris en charge pour ' + node.type); }
    catch (e) { return unsupported(String(e.message || e).slice(0, 150)); }
  }
  function fields(node, names) { const out = {}; for (const k of names) out[k] = property(node, k); return out; }
  function indexOf(node) { return node.parent && 'children' in node.parent ? node.parent.children.indexOf(node) : -1; }
  function describe(node, details) {
    const out = { id: node.id, type: node.type, name: String(node.name).slice(0, 200), parentId: node.parent?.id || null, index: indexOf(node),
      x: node.x, y: node.y, width: node.width, height: node.height, visible: node.visible, locked: node.locked,
      hasChildren: 'children' in node && node.children.length > 0, childCount: 'children' in node ? node.children.length : 0 };
    if (details !== false) {
      if (node.type === 'TEXT' && !(Array.isArray(details) && details.includes('text'))) { out.text = node.characters.slice(0, 10000); out.textLength = node.characters.length; out.textTruncated = node.characters.length > 10000; }
      if (node.type === 'INSTANCE') out.componentProperties = serial(node.componentProperties);
    }
    if (!Array.isArray(details)) return out;
    out.details = {};
    for (const group of details) {
      if (group === 'structure') {
        const ancestors = []; let p = node.parent;
        while (p && p.type !== 'PAGE' && ancestors.length < 64) { ancestors.push({ id: p.id, type: p.type }); p = p.parent; }
        out.details.structure = { parentId: out.parentId, index: out.index, parentType: node.parent?.type || null, childCount: out.childCount,
          instanceAncestors: ancestors.filter(a => a.type === 'INSTANCE'), componentAncestors: ancestors.filter(a => ['COMPONENT', 'COMPONENT_SET'].includes(a.type)), ancestorsTruncated: !!p && p.type !== 'PAGE' };
      } else if (group === 'geometry') out.details.geometry = fields(node, ['x', 'y', 'width', 'height', 'rotation', 'relativeTransform', 'absoluteBoundingBox']);
      else if (group === 'layout') out.details.layout = fields(node, LAYOUT.concat(['layoutPositioning', 'layoutAlign', 'layoutGrow', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutWrap', 'counterAxisSpacing', 'clipsContent', 'constraints']));
      else if (group === 'appearance') out.details.appearance = fields(node, ['fills', 'fillStyleId', 'strokes', 'strokeStyleId', 'strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeAlign', 'strokeJoin', 'strokeCap', 'dashPattern', 'cornerRadius', ...CORNERS, 'effects', 'effectStyleId', 'opacity', 'blendMode', 'boundVariables', 'explicitVariableModes']);
      else if (group === 'text') out.details.text = node.type !== 'TEXT' ? unsupported('TEXT requis') : { characters: node.characters.slice(0, 10000), charactersTruncated: node.characters.length > 10000, ...fields(node, TYPO.concat(['textAutoResize', 'textStyleId', 'hasMissingFont', 'maxLines', 'textTruncation'])) };
    }
    return out;
  }
  function clone(value, label) {
    if (value === figma.mixed || value === undefined) throw new Error(label + ' mixte ou non pris en charge ; copie refusée');
    const json = JSON.stringify(value);
    if (!json || json.length > 20000) throw new Error(label + ' non sérialisable ou trop volumineux');
    return JSON.parse(json);
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  async function loadTextFonts(node) {
    if (node.characters.length > 100000) throw new Error('Texte existant trop long pour cette opération');
    if (node.hasMissingFont) throw new Error('Police manquante : ' + node.id);
    const fonts = node.characters.length ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
    if (fonts.some(f => !f || f === figma.mixed)) throw new Error('Police indéterminée : ' + node.id);
    for (const font of fonts) await figma.loadFontAsync(font);
  }
  function parentOK(parent, pageId, op) {
    check(parent, pageId, true, true);
    if (!['FRAME', 'PAGE'].includes(parent.type) || typeof parent.insertChild !== 'function') throw new Error('Parent PAGE ou FRAME ordinaire requis');
    if (op.index !== undefined && op.index > parent.children.length) throw new Error('Index supérieur au nombre d’enfants du parent');
    if (op.x !== undefined && parent.type === 'FRAME' && parent.layoutMode !== 'NONE') throw new Error('x/y exigent un parent sans Auto Layout');
  }
  function layoutState(node, plans) {
    const state = { type: node.type, parent: node.parent, textAutoResize: node.textAutoResize };
    for (const k of LAYOUT) if (k in node) state[k] = node[k];
    return Object.assign(state, plans?.get(node.id));
  }
  function validateLayout(node, changes, plans) {
    const state = Object.assign(layoutState(node, plans), changes), parent = node.parent && layoutState(node.parent, plans);
    for (const k of Object.keys(changes)) {
      if (!(k in node)) throw new Error('Réglage ' + k + ' non pris en charge pour ' + node.type);
      if (node.boundVariables?.[k]) throw new Error('Réglage lié à une variable : ' + k + '. Modification numérique refusée.');
      if (!k.startsWith('layoutSizing') && !/^(min|max)/.test(k) && node.type !== 'FRAME') throw new Error('Réglages de conteneur réservés aux FRAME ordinaires');
    }
    const auto = ['HORIZONTAL', 'VERTICAL'].includes(state.layoutMode);
    if (Object.keys(changes).some(k => ['primaryAxisAlignItems', 'counterAxisAlignItems', 'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].includes(k)) && !auto) throw new Error('Ces réglages exigent un Auto Layout horizontal ou vertical');
    if (state.counterAxisAlignItems === 'BASELINE' && state.layoutMode !== 'HORIZONTAL') throw new Error('BASELINE exige un conteneur horizontal');
    for (const axis of ['Horizontal', 'Vertical']) {
      const sizing = state['layoutSizing' + axis];
      if (sizing === 'HUG' && !(node.type === 'FRAME' && auto) && node.type !== 'TEXT') throw new Error('HUG exige un texte ou un frame Auto Layout');
      if (sizing === 'FILL' && (!parent || !['HORIZONTAL', 'VERTICAL'].includes(parent.layoutMode) || node.layoutPositioning === 'ABSOLUTE')) throw new Error('FILL exige un enfant non absolu d’un parent Auto Layout');
      if (changes['layoutSizing' + axis] === 'FILL' && parent['layoutSizing' + axis] === 'HUG') throw new Error('FILL avec un parent HUG sur le même axe est refusé pour éviter un changement implicite du parent');
      if (changes['layoutSizing' + axis] === 'HUG' && 'children' in node && node.children.some(child => layoutState(child, plans)['layoutSizing' + axis] === 'FILL')) throw new Error('HUG avec un enfant FILL sur le même axe est refusé');
    }
    for (const axis of ['Width', 'Height']) if (state['min' + axis] != null && state['max' + axis] != null && state['min' + axis] > state['max' + axis]) throw new Error('Dimensions min/max incohérentes');
    if (Object.keys(changes).some(k => /^(min|max)/.test(k)) && !auto && !['HORIZONTAL', 'VERTICAL'].includes(parent?.layoutMode)) throw new Error('Les limites min/max exigent un frame Auto Layout ou son enfant direct');
    return state;
  }
  function applyLayout(node, changes) {
    if (changes.layoutMode === 'NONE') for (const k of ['layoutSizingHorizontal', 'layoutSizingVertical']) if (changes[k] === 'FIXED') node[k] = 'FIXED';
    if (changes.layoutMode !== undefined) node.layoutMode = changes.layoutMode;
    for (const k of LAYOUT) if (k !== 'layoutMode' && !/^(min|max)/.test(k) && changes[k] !== undefined) node[k] = changes[k];
    // Widen a bound first when the old min/max would reject an otherwise valid pair.
    for (const axis of ['Width', 'Height']) {
      const min = 'min' + axis, max = 'max' + axis;
      const maxFirst = changes[max] !== undefined && (changes[max] === null || node[min] == null || changes[max] >= node[min]);
      if (maxFirst) node[max] = changes[max];
      if (changes[min] !== undefined) node[min] = changes[min];
      if (!maxFirst && changes[max] !== undefined) node[max] = changes[max];
    }
  }
  function validateResize(node, op, plans) {
    if (!['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT'].includes(node.type) || typeof node.resizeWithoutConstraints !== 'function') throw new Error('resizeNode accepte FRAME, RECTANGLE, ELLIPSE ou TEXT ordinaires');
    const state = layoutState(node, plans);
    for (const [axis, sizing] of [['width', 'Horizontal'], ['height', 'Vertical']]) if (op[axis] !== undefined) {
      if (node.boundVariables?.[axis]) throw new Error(axis + ' liée à une variable : redimensionnement numérique refusé');
      if (state['layoutSizing' + sizing] && state['layoutSizing' + sizing] !== 'FIXED') throw new Error(axis + ' est pilotée par HUG/FILL ; passer à FIXED avec setLayout');
      if (node.type === 'TEXT' && (state.textAutoResize === 'WIDTH_AND_HEIGHT' || (axis === 'height' && state.textAutoResize !== 'NONE'))) throw new Error(axis + ' est pilotée par le contenu du texte');
      const suffix = axis === 'width' ? 'Width' : 'Height';
      if ((state['min' + suffix] != null && op[axis] < state['min' + suffix]) || (state['max' + suffix] != null && op[axis] > state['max' + suffix])) throw new Error(axis + ' incompatible avec les limites min/max');
    }
  }
  async function appearance(source, target, groups, pageId, guard, isNew = false) {
    check(source, pageId); const steps = [], bindings = [];
    async function binding(field) {
      let alias = source.boundVariables?.[field];
      if (Array.isArray(alias)) {
        if (!alias.length) alias = null;
        else if (alias.every(v => v.type === 'VARIABLE_ALIAS' && v.id === alias[0].id)) alias = alias[0];
        else throw new Error('Liaisons variables mixtes : ' + field);
      }
      if (alias) {
        if (Array.isArray(alias) || alias.type !== 'VARIABLE_ALIAS' || !figma.variables?.getVariableByIdAsync || typeof target.setBoundVariable !== 'function') throw new Error('Liaison variable non prise en charge : ' + field);
        const variable = await figma.variables.getVariableByIdAsync(alias.id);
        if (!variable) throw new Error('Variable absente : ' + field);
        bindings.push(t => t.setBoundVariable(field, variable));
      } else if (typeof target.setBoundVariable === 'function') bindings.push(t => t.setBoundVariable(field, null));
    }
    async function style(key, method, expectedType) {
      const id = clone(source[key], key);
      if (id !== '') {
        if (typeof id !== 'string' || typeof target[method] !== 'function' || !figma.getStyleByIdAsync) throw new Error('Référence de style non prise en charge : ' + key);
        const value = await figma.getStyleByIdAsync(id);
        if (!value || value.type !== expectedType) throw new Error('Style local absent ou incompatible : ' + key);
        // A style reference plus overrides cannot be reproduced by assigning the
        // style alone. Refuse that case instead of silently losing overrides.
        const comparisons = expectedType === 'PAINT' ? [[key === 'fillStyleId' ? 'fills' : 'strokes', 'paints']] : expectedType === 'EFFECT' ? [['effects', 'effects']] : ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent', 'textCase', 'textDecoration'].map(k => [k, k]);
        for (const [nodeKey, styleKey] of comparisons) {
          if (!(styleKey in value) || canonical(source[nodeKey]) !== canonical(value[styleKey])) throw new Error('Style avec surcharge ou propriété non prise en charge : ' + nodeKey + '. Copie refusée pour conserver la fidélité.');
        }
      } else if (typeof target[method] !== 'function') {
        if (target[key]) throw new Error('Impossible de détacher le style cible : ' + key);
        return;
      }
      steps.push(async t => { guard(); await t[method](id); guard(); });
    }
    for (const group of groups) {
      if (group === 'fills' || group === 'strokes') {
        if (!(group in source) || !(group in target)) throw new Error(group + ' non pris en charge');
        const paints = clone(source[group], group);
        if (!Array.isArray(paints) || paints.length > 32 || paints.some(p => p.type === 'PATTERN')) throw new Error('Remplissages mixtes, patterns ou liste trop longue : copie refusée');
        const key = group === 'fills' ? 'fillStyleId' : 'strokeStyleId', method = group === 'fills' ? 'setFillStyleIdAsync' : 'setStrokeStyleIdAsync';
        const id = clone(source[key], key);
        if (!id) await style(key, method, 'PAINT');
        steps.push(t => { t[group] = clone(paints, group); });
        if (id) await style(key, method, 'PAINT');
        if (group === 'strokes') {
          for (const k of ['strokeAlign', 'strokeJoin', 'strokeCap', 'dashPattern']) if (k in source) {
            if (!(k in target)) throw new Error('Contour incompatible : ' + k);
            const v = clone(source[k], k); steps.push(t => { t[k] = v; });
          }
          for (const k of source.strokeWeight === figma.mixed ? ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'] : ['strokeWeight']) {
            if (!(k in target)) throw new Error('Épaisseur de contour incompatible');
            const v = clone(source[k], k); steps.push(t => { t[k] = v; }); await binding(k);
          }
        }
      } else if (group === 'corners') {
        if (!CORNERS.every(k => k in source && k in target)) throw new Error('Rayons individuels non pris en charge');
        for (const k of CORNERS) { const v = clone(source[k], k); steps.push(t => { t[k] = v; }); if (k !== 'cornerSmoothing') await binding(k); }
      } else if (group === 'effects') {
        if (!('effects' in target)) throw new Error('Effets non pris en charge');
        const values = clone(source.effects, 'effects'), id = clone(source.effectStyleId, 'effectStyleId');
        if (!Array.isArray(values) || values.length > 32) throw new Error('Effets non pris en charge ou trop nombreux');
        if (!id) await style('effectStyleId', 'setEffectStyleIdAsync', 'EFFECT');
        steps.push(t => { t.effects = clone(values, 'effects'); });
        if (id) await style('effectStyleId', 'setEffectStyleIdAsync', 'EFFECT');
      } else if (group === 'opacity') {
        if (!('opacity' in target)) throw new Error('Opacité non prise en charge');
        const v = clone(source.opacity, 'opacity'); steps.push(t => { t.opacity = v; }); await binding('opacity');
      } else if (group === 'typography') {
        if (source.type !== 'TEXT' || target.type !== 'TEXT') throw new Error('Typographie : deux TEXT requis');
        const values = {};
        for (const k of TYPO) { if (!(k in target)) throw new Error('Typographie incompatible : ' + k); values[k] = clone(source[k], k); }
        await loadTextFonts(source); if (!isNew) await loadTextFonts(target);
        for (const field of ['fontFamily', 'fontStyle', 'fontWeight']) {
          const aliases = source.boundVariables?.[field];
          if (aliases && (!Array.isArray(aliases) || aliases.length)) throw new Error('Liaison typographique de famille/style/poids non prise en charge : ' + field);
          if (typeof target.setBoundVariable === 'function') bindings.push(t => t.setBoundVariable(field, null));
        }
        const id = clone(source.textStyleId, 'textStyleId');
        if (!id) await style('textStyleId', 'setTextStyleIdAsync', 'TEXT');
        steps.push(t => { for (const k of TYPO) t[k] = clone(values[k], k); });
        if (id) await style('textStyleId', 'setTextStyleIdAsync', 'TEXT');
        for (const k of ['fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent']) await binding(k);
      }
    }
    guard(); check(source, pageId);
    return async t => {
      for (const step of steps.concat(bindings)) { guard(); check(source, pageId); check(t, pageId, true, true); await step(t); }
      guard(); check(t, pageId, true, true);
    };
  }
  function virtual(type, parent) {
    const node = { type, parent, layoutMode: 'NONE', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', layoutPositioning: 'AUTO', minWidth: null, maxWidth: null, minHeight: null, maxHeight: null, primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN', itemSpacing: 0, paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 };
    if (type === 'TEXT') { for (const k of TYPO) node[k] = null; node.textStyleId = ''; node.setTextStyleIdAsync = function () {}; node.setBoundVariable = function () {}; }
    return node;
  }
  async function createSafely(factory, parent, op, pageId, guard, configure) {
    guard(); parentOK(parent, pageId, op); let node;
    try {
      node = factory(); parent.insertChild(op.index === undefined ? parent.children.length : op.index, node);
      await configure(node); guard(); check(node, pageId, true, true);
      return { nodeId: node.id, parentId: parent.id, index: indexOf(node), width: node.width, height: node.height };
    } catch (e) {
      if (node && !node.removed) { try { node.remove(); } catch (_) { e.createdNodeId = node.id; e.cleanupFailed = true; } }
      throw e;
    }
  }
  async function prepare(command, isAuthorized = () => true) {
    protocol.command(command); const pageId = command.pageId;
    const guard = () => { current(pageId); if (!isAuthorized()) throw new Error('Session fermée ou commande expirée'); };
    guard(); const actions = [], plans = new Map();
    for (const op of command.operations) {
      if (op.type === 'getSelection') { actions.push(() => ({ nodes: figma.currentPage.selection.slice(0, 50).map(n => describe(n)), truncated: figma.currentPage.selection.length > 50 })); continue; }
      if (op.type === 'getNodes') {
        const nodes = []; for (const id of op.nodeIds) nodes.push(await resolve(id, pageId));
        actions.push(() => { for (const n of nodes) check(n, pageId); return { nodes: nodes.map(n => describe(n, op.details)) }; }); continue;
      }
      if (op.type === 'getChildren') {
        const parent = await resolve(op.nodeId, pageId, false, true); if (!('children' in parent)) throw new Error('getChildren exige un conteneur');
        actions.push(() => {
          check(parent, pageId); let offset = 0;
          if (op.cursor) {
            const [count, start, previous] = op.cursor.split('.'); offset = Number(start);
            if (Number(count) !== parent.children.length || offset < 1 || offset > parent.children.length || parent.children[offset - 1].id !== previous) throw new Error('Curseur périmé : recommencer la pagination');
          }
          const children = parent.children.slice(offset, offset + (op.limit || 10)); for (const n of children) check(n, pageId);
          const next = offset + children.length;
          return { parentId: parent.id, total: parent.children.length, children: children.map(n => describe(n, false)), nextCursor: next < parent.children.length ? parent.children.length + '.' + next + '.' + children[children.length - 1].id : null };
        }); continue;
      }
      if (op.type === 'createFrame' || op.type === 'createText') {
        const parent = await resolve(op.parentId, pageId, true, true, true); parentOK(parent, pageId, op); let configure;
        if (op.type === 'createFrame') {
          if (op.layout) validateLayout(virtual('FRAME', parent), op.layout, plans);
          configure = node => { node.name = op.name; node.fills = []; node.clipsContent = false; node.resizeWithoutConstraints(op.width, op.height); if (op.layout) { validateLayout(node, op.layout); applyLayout(node, op.layout); } if (op.x !== undefined) { node.x = op.x; node.y = op.y; } };
        } else {
          let copyType, sourceFont;
          if (op.typographySourceId) {
            const source = await resolve(op.typographySourceId, pageId);
            copyType = await appearance(source, virtual('TEXT', parent), ['typography'], pageId, guard, true);
            sourceFont = clone(source.fontName, 'fontName');
          }
          else await figma.loadFontAsync(op.font);
          guard(); configure = async node => {
            if (copyType) { node.fontName = sourceFont; await copyType(node); }
            else { node.fontName = clone(op.font, 'font'); node.fontSize = op.fontSize; if (op.lineHeight) node.lineHeight = clone(op.lineHeight, 'lineHeight'); if (op.letterSpacing) node.letterSpacing = clone(op.letterSpacing, 'letterSpacing'); }
            guard(); node.resizeWithoutConstraints(op.width, op.height || 20); node.textAutoResize = op.textAutoResize || 'HEIGHT'; node.characters = op.text; node.name = op.name;
            if (op.textAlignHorizontal) node.textAlignHorizontal = op.textAlignHorizontal;
            if (op.x !== undefined) { node.x = op.x; node.y = op.y; }
          };
        }
        actions.push(async () => { const result = await createSafely(() => op.type === 'createFrame' ? figma.createFrame() : figma.createText(), parent, op, pageId, guard, configure); return { ...result, ...(op.type === 'createText' ? { textId: result.nodeId } : { frameId: result.nodeId }) }; }); continue;
      }
      if (op.type === 'copyAppearance') {
        const source = await resolve(op.sourceId, pageId), target = await resolve(op.targetId, pageId, true, false, true);
        const copyTo = await appearance(source, target, op.properties, pageId, guard);
        actions.push(async () => { check(target, pageId, true, true); await copyTo(target); return { nodeId: target.id, sourceId: source.id, properties: op.properties }; }); continue;
      }
      const structural = ['resizeNode', 'setLayout'].includes(op.type);
      const node = await resolve(op.nodeId || op.componentId, pageId, true, false, structural); let action;
      switch (op.type) {
        case 'resizeNode':
          validateResize(node, op, plans); if (node.type === 'TEXT') await loadTextFonts(node);
          action = () => { validateResize(node, op); node.resizeWithoutConstraints(op.width === undefined ? node.width : op.width, op.height === undefined ? node.height : op.height); return { nodeId: node.id, width: node.width, height: node.height }; }; break;
        case 'setLayout': {
          const state = validateLayout(node, op.layout, plans); plans.set(node.id, state);
          action = () => { validateLayout(node, op.layout); applyLayout(node, op.layout); return { nodeId: node.id, layout: fields(node, Object.keys(op.layout)) }; }; break;
        }
        case 'setText':
          if (node.type !== 'TEXT') throw new Error('setText exige un TEXT'); await loadTextFonts(node);
          action = () => { node.characters = op.text; return { nodeId: node.id }; }; break;
        case 'setFill':
          if (!('fills' in node)) throw new Error('Ce calque ne possède pas de remplissage');
          action = () => { const n = parseInt(op.color.slice(1), 16); node.fills = [{ type: 'SOLID', color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }, opacity: op.opacity === undefined ? 1 : op.opacity }]; return { nodeId: node.id }; }; break;
        case 'setPosition': {
          const valid = () => { if (node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE' && node.layoutPositioning !== 'ABSOLUTE') throw new Error('Position pilotée par Auto Layout : utiliser un calque libre ou absolu'); };
          valid(); action = () => { valid(); node.x = op.x; node.y = op.y; return { nodeId: node.id }; }; break;
        }
        case 'createComponent':
          if (['COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(node.type)) throw new Error('Conversion de ce type interdite');
          for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) if (['COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(p.type)) throw new Error('Conversion dans un composant ou une instance interdite');
          action = () => { const component = figma.createComponentFromNode(node); if (op.name) component.name = op.name; return { componentId: component.id }; }; break;
        case 'createInstance':
          if (node.type !== 'COMPONENT') throw new Error('componentId doit désigner un COMPONENT local sur cette page');
          action = () => { const instance = node.createInstance(); figma.currentPage.appendChild(instance); instance.x = op.x; instance.y = op.y; if (op.name) instance.name = op.name; return { instanceId: instance.id }; }; break;
        case 'setInstanceProperties':
          if (node.type !== 'INSTANCE') throw new Error('INSTANCE attendu');
          for (const [key, value] of Object.entries(op.properties)) {
            const prop = node.componentProperties[key]; if (!prop || !['TEXT', 'BOOLEAN', 'VARIANT'].includes(prop.type)) throw new Error('Propriété inconnue ou type non autorisé : ' + key);
            if ((prop.type === 'BOOLEAN') !== (typeof value === 'boolean')) throw new Error('Type incorrect pour ' + key);
          }
          if (Object.keys(op.properties).some(k => node.componentProperties[k].type === 'TEXT')) {
            const texts = node.findAllWithCriteria({ types: ['TEXT'] }); if (texts.length > 200) throw new Error('Instance trop complexe : plus de 200 textes');
            for (const text of texts) await loadTextFonts(text);
          }
          action = () => { node.setProperties(op.properties); return { nodeId: node.id }; }; break;
        default: throw new Error('Opération non implémentée');
      }
      actions.push(() => { check(node, pageId, true, structural); return action(); });
    }
    guard();
    return async function apply() {
      guard(); const results = []; let completed = 0; const write = !protocol.readOnly(command); if (write) figma.commitUndo();
      try {
        for (let i = 0; i < actions.length; i++) {
          try { guard(); const value = await actions[i](); results.push({ index: i, type: command.operations[i].type, ...value }); completed++; }
          catch (error) {
            if (error.createdNodeId) results.push({ index: i, type: command.operations[i].type, createdNodeId: error.createdNodeId, cleanupFailed: true, applied: false });
            return { status: 'failed', appliedCount: write ? completed : 0, results, error: String(error.message || error).slice(0, 500), failedIndex: i, partialPossible: write };
          }
        }
        return { status: 'succeeded', appliedCount: write ? completed : 0, results };
      } finally { if (write) figma.commitUndo(); }
    };
  }
  return { prepare, describe };
}
