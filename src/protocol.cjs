/* Shared by Node and the Figma sandbox. No code supplied by a command is executed. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BridgeProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_OPS = 20;
  const REVISION = '1.1.0';
  const LEGACY_OPERATIONS = ['getSelection', 'getNodes', 'setText', 'setFill', 'setPosition', 'createComponent', 'createInstance', 'setInstanceProperties'];
  const OPERATIONS = LEGACY_OPERATIONS.concat(['getChildren', 'resizeNode', 'setLayout', 'createFrame', 'createText', 'copyAppearance']);
  const DETAIL_GROUPS = ['structure', 'geometry', 'layout', 'appearance', 'text'];
  const APPEARANCE_GROUPS = ['fills', 'strokes', 'corners', 'effects', 'opacity', 'typography'];
  const LAYOUT_KEYS = ['layoutMode', 'layoutSizingHorizontal', 'layoutSizingVertical', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'];
  const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
  const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);
  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ': objet attendu');
    if (Object.keys(value).some(k => DANGEROUS.has(k))) fail(label + ': clé interdite');
  }
  function keys(value, required, optional, label) {
    object(value, label);
    for (const k of required) if (!Object.hasOwn(value, k)) fail(label + ': champ manquant ' + k);
    for (const k of Object.keys(value)) if (!required.includes(k) && !optional.includes(k)) fail(label + ': champ inconnu ' + k);
  }
  function string(value, max, label, min = 0) {
    if (typeof value !== 'string' || value.length < min || value.length > max) fail(label + ': texte invalide');
  }
  function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(label + ': identifiant invalide'); }
  function coordinate(value, label) { if (!Number.isFinite(value) || Math.abs(value) > 1000000) fail(label + ': nombre hors limites'); }
  function dimension(value, label) { if (!Number.isFinite(value) || value < 0.01 || value > 100000) fail(label + ': dimension entre 0.01 et 100000 attendue'); }
  function choice(value, values, label) { if (!values.includes(value)) fail(label + ': valeur non autorisée'); }
  function list(value, values, label) {
    if (!Array.isArray(value) || !value.length || value.length > values.length || new Set(value).size !== value.length) fail(label + ': liste bornée sans doublon attendue');
    value.forEach(v => choice(v, values, label));
  }
  function layout(value) {
    keys(value, [], LAYOUT_KEYS, 'layout');
    if (!Object.keys(value).length) fail('layout vide');
    for (const [k, v] of Object.entries(value)) {
      if (k === 'layoutMode') choice(v, ['NONE', 'HORIZONTAL', 'VERTICAL'], k);
      else if (k.startsWith('layoutSizing')) choice(v, ['FIXED', 'HUG', 'FILL'], k);
      else if (k === 'primaryAxisAlignItems') choice(v, ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'], k);
      else if (k === 'counterAxisAlignItems') choice(v, ['MIN', 'CENTER', 'MAX', 'BASELINE'], k);
      else if (/^(min|max)/.test(k)) { if (v !== null) dimension(v, k); }
      else if (!Number.isFinite(v) || v < 0 || v > 10000) fail(k + ': valeur entre 0 et 10000 attendue');
    }
  }
  function insertion(op) {
    if (op.index !== undefined && (!Number.isInteger(op.index) || op.index < 0 || op.index > 100000)) fail('index invalide');
    if ((op.x === undefined) !== (op.y === undefined)) fail('x et y doivent être fournis ensemble');
    if (op.x !== undefined) { coordinate(op.x, 'x'); coordinate(op.y, 'y'); }
  }
  function operation(op) {
    object(op, 'opération');
    switch (op.type) {
      case 'getSelection': keys(op, ['type'], [], op.type); break;
      case 'getNodes':
        keys(op, ['type', 'nodeIds'], ['details'], op.type);
        if (!Array.isArray(op.nodeIds) || op.nodeIds.length < 1 || op.nodeIds.length > 50) fail('nodeIds: 1 à 50 identifiants');
        op.nodeIds.forEach(v => id(v, 'nodeIds'));
        if (op.details !== undefined) { list(op.details, DETAIL_GROUPS, 'details'); if (op.nodeIds.length > 5) fail('Inspection détaillée : 5 nœuds maximum'); } break;
      case 'getChildren':
        keys(op, ['type', 'nodeId'], ['limit', 'cursor'], op.type); id(op.nodeId, 'nodeId');
        if (op.limit !== undefined && (!Number.isInteger(op.limit) || op.limit < 1 || op.limit > 10)) fail('limit: entier de 1 à 10');
        if (op.cursor !== undefined && (typeof op.cursor !== 'string' || !/^\d{1,6}\.\d{1,6}\.[A-Za-z0-9:_-]{1,128}$/.test(op.cursor))) fail('cursor invalide'); break;
      case 'resizeNode':
        keys(op, ['type', 'nodeId'], ['width', 'height'], op.type); id(op.nodeId, 'nodeId');
        if (op.width === undefined && op.height === undefined) fail('width ou height requis');
        if (op.width !== undefined) dimension(op.width, 'width'); if (op.height !== undefined) dimension(op.height, 'height'); break;
      case 'setLayout':
        keys(op, ['type', 'nodeId', 'layout'], [], op.type); id(op.nodeId, 'nodeId'); layout(op.layout); break;
      case 'createFrame':
        keys(op, ['type', 'parentId', 'name', 'width', 'height'], ['index', 'x', 'y', 'layout'], op.type);
        id(op.parentId, 'parentId'); string(op.name, 200, 'name', 1); dimension(op.width, 'width'); dimension(op.height, 'height'); insertion(op);
        if (op.layout !== undefined) layout(op.layout); break;
      case 'createText':
        keys(op, ['type', 'parentId', 'name', 'text', 'width'], ['index', 'x', 'y', 'height', 'font', 'fontSize', 'typographySourceId', 'textAutoResize', 'textAlignHorizontal', 'lineHeight', 'letterSpacing'], op.type);
        id(op.parentId, 'parentId'); string(op.name, 200, 'name', 1); string(op.text, 10000, 'text'); dimension(op.width, 'width'); insertion(op);
        if (op.height !== undefined) dimension(op.height, 'height');
        if ((op.font === undefined) === (op.typographySourceId === undefined)) fail('Choisir font ou typographySourceId');
        if (op.typographySourceId !== undefined) { id(op.typographySourceId, 'typographySourceId'); if (op.fontSize !== undefined || op.lineHeight !== undefined || op.letterSpacing !== undefined) fail('Ne pas surcharger la typographie d’une source'); }
        else { keys(op.font, ['family', 'style'], [], 'font'); string(op.font.family, 100, 'family', 1); string(op.font.style, 100, 'style', 1); if (op.fontSize === undefined) fail('fontSize requis avec font'); }
        if (op.fontSize !== undefined && (!Number.isFinite(op.fontSize) || op.fontSize < 1 || op.fontSize > 1000)) fail('fontSize: 1 à 1000');
        if (op.textAutoResize !== undefined) choice(op.textAutoResize, ['HEIGHT', 'NONE'], 'textAutoResize');
        if (op.textAutoResize === 'NONE' && op.height === undefined) fail('height requis avec textAutoResize NONE');
        if (op.textAutoResize !== 'NONE' && op.height !== undefined) fail('height est pilotée par le contenu en mode HEIGHT');
        if (op.textAlignHorizontal !== undefined) choice(op.textAlignHorizontal, ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'], 'textAlignHorizontal');
        if (op.lineHeight !== undefined) {
          keys(op.lineHeight, ['unit'], ['value'], 'lineHeight'); choice(op.lineHeight.unit, ['AUTO', 'PIXELS', 'PERCENT'], 'lineHeight.unit');
          if (op.lineHeight.unit === 'AUTO') { if (op.lineHeight.value !== undefined) fail('AUTO ne prend pas de value'); }
          else if (!Number.isFinite(op.lineHeight.value) || op.lineHeight.value <= 0 || op.lineHeight.value > 1000) fail('lineHeight.value invalide');
        }
        if (op.letterSpacing !== undefined) {
          keys(op.letterSpacing, ['unit', 'value'], [], 'letterSpacing'); choice(op.letterSpacing.unit, ['PIXELS', 'PERCENT'], 'letterSpacing.unit');
          if (!Number.isFinite(op.letterSpacing.value) || Math.abs(op.letterSpacing.value) > 100) fail('letterSpacing.value invalide');
        } break;
      case 'copyAppearance':
        keys(op, ['type', 'sourceId', 'targetId', 'properties'], [], op.type); id(op.sourceId, 'sourceId'); id(op.targetId, 'targetId'); list(op.properties, APPEARANCE_GROUPS, 'properties');
        if (op.sourceId === op.targetId) fail('Source et cible doivent être distinctes'); break;
      case 'setText':
        keys(op, ['type', 'nodeId', 'text'], [], op.type); id(op.nodeId, 'nodeId'); string(op.text, 10000, 'text'); break;
      case 'setFill':
        keys(op, ['type', 'nodeId', 'color'], ['opacity'], op.type); id(op.nodeId, 'nodeId');
        if (typeof op.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(op.color)) fail('color: #RRGGBB attendu');
        if (op.opacity !== undefined && (!Number.isFinite(op.opacity) || op.opacity < 0 || op.opacity > 1)) fail('opacity: 0 à 1'); break;
      case 'setPosition':
        keys(op, ['type', 'nodeId', 'x', 'y'], [], op.type); id(op.nodeId, 'nodeId'); coordinate(op.x, 'x'); coordinate(op.y, 'y'); break;
      case 'createComponent':
        keys(op, ['type', 'nodeId'], ['name'], op.type); id(op.nodeId, 'nodeId');
        if (op.name !== undefined) string(op.name, 200, 'name', 1); break;
      case 'createInstance':
        keys(op, ['type', 'componentId', 'x', 'y'], ['name'], op.type); id(op.componentId, 'componentId');
        coordinate(op.x, 'x'); coordinate(op.y, 'y'); if (op.name !== undefined) string(op.name, 200, 'name', 1); break;
      case 'setInstanceProperties':
        keys(op, ['type', 'nodeId', 'properties'], [], op.type); id(op.nodeId, 'nodeId'); object(op.properties, 'properties');
        if (!Object.keys(op.properties).length || Object.keys(op.properties).length > 20) fail('properties: 1 à 20 propriétés');
        for (const [k, v] of Object.entries(op.properties)) {
          string(k, 200, 'nom propriété', 1);
          if (typeof v !== 'boolean') string(v, 1000, 'valeur propriété');
        } break;
      default: fail('Type d’opération non autorisé');
    }
    return op;
  }
  function command(value) {
    keys(value, ['version', 'commandId', 'sessionId', 'pageId', 'operations'], [], 'commande');
    if (value.version !== 1) fail('Version de protocole non supportée');
    id(value.commandId, 'commandId'); id(value.sessionId, 'sessionId'); id(value.pageId, 'pageId');
    if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > MAX_OPS) fail('operations: 1 à 20 opérations');
    value.operations.forEach(operation);
    // Conversion changes node identity; use a separate request for follow-up work.
    if (value.operations.some(op => op.type === 'createComponent') && value.operations.length !== 1) fail('createComponent doit être envoyé seul');
    return value;
  }
  function readOnly(value) { return value.operations.every(op => ['getSelection', 'getNodes', 'getChildren'].includes(op.type)); }
  return { command, operation, readOnly, keys, string, id, layout, MAX_OPS, REVISION, OPERATIONS, LEGACY_OPERATIONS, DETAIL_GROUPS, LAYOUT_KEYS };
});
