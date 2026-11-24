import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../src/protocol.cjs';
import { fakeFigma, engineFor, command, liveBridge } from './helpers.mjs';
const execute = async (engine, operations, authorized) => (await engine.prepare(command(operations), authorized))();
const frameOp = parentId => ({ type: 'createFrame', parentId, name: 'Emplacement UML', width: 400, height: 240 });
const textOp = parentId => ({ type: 'createText', parentId, name: 'Placeholder', text: '[Texte temporaire — à remplacer]', width: 300, font: { family: 'Inter', style: 'Regular' }, fontSize: 16 });

test('schémas fermés des six nouvelles opérations et de l’inspection détaillée', () => {
  const good = [frameOp('1:1'), textOp('1:1'), { type: 'getChildren', nodeId: '1:1', limit: 10 },
    { type: 'getNodes', nodeIds: ['1:2'], details: ['layout', 'text'] }, { type: 'resizeNode', nodeId: '1:2', height: 320 },
    { type: 'setLayout', nodeId: '1:2', layout: { layoutMode: 'VERTICAL', layoutSizingVertical: 'HUG', minHeight: null } },
    { type: 'copyAppearance', sourceId: '1:2', targetId: '1:3', properties: ['fills', 'corners'] }];
  for (const op of good) assert.doesNotThrow(() => protocol.command(command([op])));
  const invalid = [
    { ...frameOp('1:1'), width: 0 }, { ...frameOp('1:1'), index: -1 }, { ...frameOp('1:1'), parentId: 'http://evil.test' },
    { ...textOp('1:1'), font: { family: 'Inter', style: 'Regular', url: 'https://evil.test/font' } },
    { ...textOp('1:1'), typographySourceId: '1:2' }, { ...textOp('1:1'), fontSize: Infinity },
    { ...textOp('1:1'), textAutoResize: 'NONE' }, { ...textOp('1:1'), height: 50 },
    { type: 'getChildren', nodeId: '1:1', limit: 11 }, { type: 'getChildren', nodeId: '1:1', cursor: '../x' },
    { type: 'resizeNode', nodeId: '1:2' }, { type: 'resizeNode', nodeId: '1:2', height: NaN },
    { type: 'setLayout', nodeId: '1:2', layout: { clipsContent: true } }, { type: 'setLayout', nodeId: '1:2', layout: { layoutMode: 'GRID' } },
    { type: 'copyAppearance', sourceId: '1:2', targetId: '1:3', properties: ['characters'] },
    { type: 'getNodes', nodeIds: ['1:2'], details: ['all'] }
  ];
  for (const op of invalid) assert.throws(() => protocol.command(command([op])), op.type);
  assert.equal(protocol.readOnly(command([{ type: 'getChildren', nodeId: '1:1' }])), true);
});

test('getChildren pagine seulement les enfants directs et invalide un curseur après changement', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME');
  for (let i = 0; i < 12; i++) f.add('TEXT', '1:' + (20 + i), parent);
  const engine = await engineFor(f.figma);
  const first = await execute(engine, [{ type: 'getChildren', nodeId: parent.id, limit: 5 }]);
  assert.equal(first.results[0].children.length, 5); assert.equal(first.results[0].children[0].parentId, parent.id);
  assert.equal(first.results[0].children[0].text, undefined); assert.equal(f.figma.undoCount, 0);
  const cursor = first.results[0].nextCursor;
  const second = await execute(engine, [{ type: 'getChildren', nodeId: parent.id, limit: 5, cursor }]);
  assert.equal(second.results[0].children[0].index, 5);
  f.add('RECTANGLE', '1:100', parent);
  assert.equal((await execute(engine, [{ type: 'getChildren', nodeId: parent.id, cursor }])).status, 'failed');
  await assert.rejects(engine.prepare(command([{ type: 'getChildren', nodeId: f.otherPage.id }])), /hors de la page/);
});

test('inspection signale les valeurs mixtes et absentes et conserve les variables/dégradés', async () => {
  const f = fakeFigma(); const text = f.add('TEXT'); text.fontSize = f.figma.mixed;
  text.fills = [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { r: 0, g: 1, b: 1, a: 1 } }] }];
  text.boundVariables = { fontSize: [{ type: 'VARIABLE_ALIAS', id: 'variable:1' }] };
  const result = await execute(await engineFor(f.figma), [{ type: 'getNodes', nodeIds: [text.id], details: ['structure', 'layout', 'appearance', 'text'] }]);
  const node = result.results[0].nodes[0];
  assert.equal(node.details.text.fontSize.$mixed, true); assert.equal(node.details.layout.layoutMode.$unsupported, true);
  assert.equal(node.details.appearance.fills[0].type, 'GRADIENT_LINEAR'); assert.equal(node.details.appearance.boundVariables.fontSize[0].id, 'variable:1');
  assert.equal(f.figma.undoCount, 0);
});

test('redimensionner un encart ne change ni le texte ni la taille des enfants', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME'); const text = f.add('TEXT', '1:3', parent);
  const before = { text: text.characters, width: text.width, height: text.height };
  const result = await execute(await engineFor(f.figma), [{ type: 'resizeNode', nodeId: parent.id, height: 320 }]);
  assert.equal(result.status, 'succeeded'); assert.equal(parent.height, 320);
  assert.deepEqual({ text: text.characters, width: text.width, height: text.height }, before);
});

test('HUG/FILL bloque la taille, puis FIXED + resize fonctionne dans le même lot', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME'); parent.layoutMode = 'HORIZONTAL';
  const node = f.add('FRAME', '1:3', parent); node.layoutMode = 'VERTICAL'; node.layoutSizingVertical = 'HUG';
  const engine = await engineFor(f.figma);
  await assert.rejects(engine.prepare(command([{ type: 'resizeNode', nodeId: node.id, height: 320 }])), /HUG\/FILL/);
  const result = await execute(engine, [{ type: 'setLayout', nodeId: node.id, layout: { layoutSizingVertical: 'FIXED' } }, { type: 'resizeNode', nodeId: node.id, height: 320 }]);
  assert.equal(result.status, 'succeeded'); assert.equal(node.height, 320);
  const free = f.add('FRAME', '1:4');
  await assert.rejects(engine.prepare(command([{ type: 'setLayout', nodeId: free.id, layout: { layoutSizingHorizontal: 'FILL' } }])), /parent Auto Layout/);
  await assert.rejects(engine.prepare(command([{ type: 'setLayout', nodeId: free.id, layout: { minWidth: 500, maxWidth: 100 } }])), /min\/max/);
});

test('création : bon parent et index, paramètres visibles avant création, IDs retournés', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME'); const existing = f.add('RECTANGLE', '1:3', parent);
  const engine = await engineFor(f.figma);
  const apply = await engine.prepare(command([{ ...frameOp(parent.id), index: 0, layout: { layoutMode: 'VERTICAL', itemSpacing: 12, paddingTop: 16 } }]));
  assert.equal(f.figma.createdCount, 0); assert.equal(parent.children.length, 1);
  const result = await apply(); const created = f.nodes.get(result.results[0].frameId);
  assert.equal(created.parent, parent); assert.equal(parent.children[0], created); assert.equal(parent.children[1], existing);
  assert.equal(created.layoutMode, 'VERTICAL'); assert.equal(created.paddingTop, 16); assert.equal(created.clipsContent, false);
});

test('création refusée avant application : parent verrouillé/hors page/instance/index invalide', async () => {
  for (const mode of ['locked', 'otherPage', 'instance', 'index']) {
    const f = fakeFigma(); const parent = f.add(mode === 'instance' ? 'INSTANCE' : 'FRAME'); const op = frameOp(parent.id);
    if (mode === 'locked') parent.locked = true;
    if (mode === 'otherPage') parent.parent = f.otherPage;
    if (mode === 'index') op.index = 4;
    await assert.rejects((await engineFor(f.figma)).prepare(command([op])));
    assert.equal(f.figma.createdCount, 0); assert.equal(parent.children.length, 0);
  }
});

test('revérifie le parent après préparation et ne laisse aucun nœud parasite', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME'); const engine = await engineFor(f.figma);
  const apply = await engine.prepare(command([frameOp(parent.id)])); parent.locked = true;
  assert.equal((await apply()).status, 'failed'); assert.equal(f.figma.createdCount, 0);
  parent.locked = false;
  const failing = await engine.prepare(command([frameOp(parent.id)]));
  parent.insertChild = () => { throw new Error('Insertion refusée par Figma'); };
  const result = await failing(); assert.equal(result.status, 'failed');
  assert.equal([...f.nodes.values()].filter(n => !n.removed).length, 1);
});

test('si le nettoyage d’une création échoue, le résultat expose son ID', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME'); const factory = f.figma.createFrame.bind(f.figma);
  f.figma.createFrame = () => { const n = factory(); n.remove = () => { throw new Error('Nettoyage impossible'); }; return n; };
  const engine = await engineFor(f.figma); const apply = await engine.prepare(command([frameOp(parent.id)]));
  parent.insertChild = () => { throw new Error('Insertion impossible'); };
  const result = await apply();
  assert.equal(result.status, 'failed'); assert.equal(result.results[0].cleanupFailed, true); assert.ok(result.results[0].createdNodeId);
});

test('police indisponible : aucun texte ni autre cadre du lot n’est créé', async () => {
  const f = fakeFigma(); f.figma.loadFontAsync = async () => { throw new Error('Police indisponible'); };
  await assert.rejects((await engineFor(f.figma)).prepare(command([frameOp(f.page.id), textOp(f.page.id)])), /Police indisponible/);
  assert.equal(f.figma.createdCount, 0); assert.equal(f.page.children.length, 0);
});

test('texte créé réellement éditable avec contenu exact et typographie locale', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME'); const source = f.add('TEXT', '1:3'); source.fontSize = 22;
  const engine = await engineFor(f.figma);
  const result = await execute(engine, [{ type: 'createText', parentId: parent.id, name: 'Retour personnel', text: '[Texte temporaire — à remplacer]', width: 320, typographySourceId: source.id }]);
  const text = f.nodes.get(result.results[0].textId);
  assert.equal(text.type, 'TEXT'); assert.equal(text.parent, parent); assert.equal(text.fontSize, 22);
  assert.equal(text.characters, '[Texte temporaire — à remplacer]'); assert.equal(text.textAutoResize, 'HEIGHT');
  assert.equal((await execute(engine, [{ type: 'setText', nodeId: text.id, text: 'Texte utilisateur' }])).status, 'succeeded');
});

test('copie d’apparence : garde dégradés, contours, coins et aliases sans contenu ni enfants', async () => {
  const f = fakeFigma(); const source = f.add('FRAME'); const target = f.add('FRAME', '1:3');
  source.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 0, g: 1, b: 1, a: 1 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'v:1' } } }] }];
  source.boundVariables.opacity = { type: 'VARIABLE_ALIAS', id: 'v:2' }; source.opacity = 0.8;
  source.topLeftRadius = 12; source.topRightRadius = 24;
  const before = JSON.stringify(source.fills);
  const result = await execute(await engineFor(f.figma), [{ type: 'copyAppearance', sourceId: source.id, targetId: target.id, properties: ['fills', 'strokes', 'corners', 'effects', 'opacity'] }]);
  assert.equal(result.status, 'succeeded'); assert.equal(JSON.stringify(source.fills), before);
  assert.equal(JSON.stringify(target.fills), JSON.stringify(source.fills)); assert.notEqual(target.fills, source.fills);
  assert.equal(target.boundVariables.opacity.id, 'v:2'); assert.equal(target.topRightRadius, 24); assert.equal(target.children.length, 0);
});

test('styles locaux : conserve les références et refuse les surcharges impossibles à reproduire', async () => {
  const f = fakeFigma(); const source = f.add(); const target = f.add('RECTANGLE', '1:3');
  source.fillStyleId = 'S:1'; source.fills = [{ type: 'SOLID', color: { r: 0, g: 1, b: 1 } }];
  f.figma.getStyleByIdAsync = async id => ({ id, type: 'PAINT', paints: source.fills });
  const engine = await engineFor(f.figma);
  assert.equal((await execute(engine, [{ type: 'copyAppearance', sourceId: source.id, targetId: target.id, properties: ['fills'] }])).status, 'succeeded');
  assert.equal(target.fillStyleId, 'S:1');
  f.figma.getStyleByIdAsync = async id => ({ id, type: 'PAINT', paints: [] });
  await assert.rejects(engine.prepare(command([{ type: 'copyAppearance', sourceId: source.id, targetId: target.id, properties: ['fills'] }])), /surcharge/);
});

test('copie typographique refuse les styles mixtes et n’écrase pas le texte cible', async () => {
  const f = fakeFigma(); const source = f.add('TEXT'), target = f.add('TEXT', '1:3'); target.characters = 'À conserver';
  const engine = await engineFor(f.figma); source.fontSize = f.figma.mixed;
  await assert.rejects(engine.prepare(command([{ type: 'copyAppearance', sourceId: source.id, targetId: target.id, properties: ['typography'] }])), /mixte/);
  source.fontSize = 24;
  assert.equal((await execute(engine, [{ type: 'copyAppearance', sourceId: source.id, targetId: target.id, properties: ['typography'] }])).status, 'succeeded');
  assert.equal(target.characters, 'À conserver'); assert.equal(target.fontSize, 24);
});

test('session fermée ou expiration après préparation : aucune création', async () => {
  const f = fakeFigma(); let authorized = true;
  const apply = await (await engineFor(f.figma)).prepare(command([frameOp(f.page.id)]), () => authorized);
  authorized = false; await assert.rejects(apply(), /Session fermée/); assert.equal(f.figma.createdCount, 0);
});

test('le pont annonce les capacités et refuse les nouvelles commandes pour un ancien plugin', async t => {
  const b = await liveBridge(t);
  const cap = await b.api('/agent/capabilities'); assert.equal(cap.data.protocolRevision, '1.1.0'); assert.ok(cap.data.operations.includes('createText'));
  const old = await b.register(null);
  assert.equal((await b.api('/agent/commands', command([{ type: 'getChildren', nodeId: '1:2' }], old))).status, 409);
  await b.api('/plugin/disconnect', { sessionId: old.sessionId }, 'plugin');
  const fresh = await b.register();
  assert.equal((await b.api('/agent/commands', command([{ type: 'getChildren', nodeId: '1:2' }], fresh))).status, 202);
});

test('refuse les dimensions liées à une variable et les boucles HUG/FILL implicites', async () => {
  const f = fakeFigma(); const parent = f.add('FRAME'); parent.layoutMode = 'VERTICAL'; parent.layoutSizingHorizontal = 'HUG';
  const child = f.add('FRAME', '1:3', parent); const engine = await engineFor(f.figma);
  await assert.rejects(engine.prepare(command([{ type: 'setLayout', nodeId: child.id, layout: { layoutSizingHorizontal: 'FILL' } }])), /parent HUG/);
  child.boundVariables.height = { type: 'VARIABLE_ALIAS', id: 'v:1' };
  await assert.rejects(engine.prepare(command([{ type: 'resizeNode', nodeId: child.id, height: 320 }])), /variable/);
});

test('erreur partielle de création : conserve et retourne les IDs des opérations terminées', async () => {
  const f = fakeFigma(); const first = f.add('FRAME'), second = f.add('FRAME', '1:3'); const engine = await engineFor(f.figma);
  const apply = await engine.prepare(command([frameOp(first.id), frameOp(second.id)]));
  second.insertChild = () => { throw new Error('Insertion refusée'); };
  const result = await apply();
  assert.equal(result.status, 'failed'); assert.equal(result.appliedCount, 1); assert.ok(result.results[0].frameId);
  assert.equal(first.children.length, 1); assert.equal(second.children.length, 0);
});
