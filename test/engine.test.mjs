import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeFigma, engineFor, command } from './helpers.mjs';

test('charge les polices, modifie texte/couleur/position et crée une étape annuler', async () => {
  const f = fakeFigma(); const node = f.add('TEXT'); const engine = await engineFor(f.figma);
  const apply = await engine.prepare(command([
    { type: 'setText', nodeId: node.id, text: 'Après' },
    { type: 'setFill', nodeId: node.id, color: '#FF0080', opacity: 0.5 },
    { type: 'setPosition', nodeId: node.id, x: 120, y: -5 }
  ]));
  assert.equal(node.characters, 'Avant'); assert.equal(f.fonts.length, 1);
  const result = await apply();
  assert.equal(result.status, 'succeeded'); assert.equal(node.characters, 'Après');
  assert.equal(node.fills[0].color.r, 1); assert.equal(node.fills[0].color.b, 128 / 255);
  assert.equal(node.fills[0].opacity, 0.5); assert.equal(node.x, 120); assert.equal(node.y, -5);
  assert.equal(f.figma.undoCount, 2);
});
test('texte vide : charge fontName sans plage vide', async () => {
  const f = fakeFigma(); const node = f.add('TEXT'); node.characters = '';
  const apply = await (await engineFor(f.figma)).prepare(command([{ type: 'setText', nodeId: node.id, text: 'Rempli' }]));
  assert.equal(f.fonts.length, 1); assert.equal((await apply()).status, 'succeeded');
});
test('prévalidation complète : aucune mutation si un calque est invalide', async () => {
  const f = fakeFigma(); const node = f.add('TEXT');
  await assert.rejects((await engineFor(f.figma)).prepare(command([
    { type: 'setText', nodeId: node.id, text: 'Après' }, { type: 'setText', nodeId: 'missing', text: 'X' }
  ])));
  assert.equal(node.characters, 'Avant'); assert.equal(f.figma.undoCount, 0);
});
test('bloque page différente, ancêtre verrouillé, Auto Layout et police manquante', async () => {
  const f = fakeFigma(); const node = f.add('TEXT', '1:2', f.otherPage); const engine = await engineFor(f.figma);
  const cmd = command([{ type: 'setText', nodeId: node.id, text: 'Après' }]);
  await assert.rejects(engine.prepare(cmd), /hors de la page/);
  node.parent = { id: '1:3', type: 'FRAME', locked: true, parent: f.page };
  await assert.rejects(engine.prepare(cmd), /verrouillé/);
  node.parent.locked = false; node.parent.layoutMode = 'HORIZONTAL';
  await assert.rejects(engine.prepare(command([{ type: 'setPosition', nodeId: node.id, x: 10, y: 20 }])), /Auto Layout/);
  node.hasMissingFont = true;
  await assert.rejects(engine.prepare(cmd), /Police manquante/);
});
test('revérifie page et verrou après prévalidation', async () => {
  const f = fakeFigma(); const node = f.add(); const engine = await engineFor(f.figma);
  const apply = await engine.prepare(command([{ type: 'setPosition', nodeId: node.id, x: 10, y: 20 }]));
  node.locked = true; assert.equal((await apply()).status, 'failed'); assert.equal(node.x, 0);
  node.locked = false; f.figma.currentPage = f.otherPage;
  await assert.rejects(apply(), /Page changée/);
});
test('signale une erreur partielle sans annuler les autres actions de l’utilisateur', async () => {
  const f = fakeFigma(); const first = f.add(); const second = f.add('RECTANGLE', '1:3');
  Object.defineProperty(second, 'fills', { get: () => [], set: () => { throw new Error('Figma refuse'); } });
  const apply = await (await engineFor(f.figma)).prepare(command([
    { type: 'setPosition', nodeId: first.id, x: 50, y: 10 }, { type: 'setFill', nodeId: second.id, color: '#000000' }
  ]));
  const result = await apply(); assert.equal(result.status, 'failed'); assert.equal(result.appliedCount, 1);
  assert.equal(result.failedIndex, 1); assert.equal(result.partialPossible, true); assert.equal(first.x, 50);
});
test('composants : conversion, instance et propriétés typées', async () => {
  const f = fakeFigma(); const rect = f.add(); const engine = await engineFor(f.figma);
  const converted = await (await engine.prepare(command([{ type: 'createComponent', nodeId: rect.id, name: 'Bouton' }])))();
  assert.equal(converted.results[0].componentId, '1:200');
  const instanced = await (await engine.prepare(command([{ type: 'createInstance', componentId: '1:200', x: 120, y: 80 }])))();
  assert.equal(instanced.results[0].instanceId, '1:201'); assert.equal(f.nodes.get('1:201').parent, f.page);
  const properties = { 'Label#1:0': 'Continuer', Visible: false };
  assert.equal((await (await engine.prepare(command([{ type: 'setInstanceProperties', nodeId: '1:201', properties }])))()).status, 'succeeded');
  assert.deepEqual(f.nodes.get('1:201').propertiesSet, properties);
  await assert.rejects(engine.prepare(command([{ type: 'setInstanceProperties', nodeId: '1:201', properties: { Visible: 'non' } }])), /Type incorrect/);
  await assert.rejects(engine.prepare(command([{ type: 'setInstanceProperties', nodeId: '1:201', properties: { Unknown: 'x' } }])), /inconnue/);
});
test('lecture seule sans mutation ni étape annuler', async () => {
  const f = fakeFigma(); const node = f.add('TEXT'); f.page.selection = [node];
  const result = await (await (await engineFor(f.figma)).prepare(command([{ type: 'getSelection' }, { type: 'getNodes', nodeIds: [node.id] }])))();
  assert.equal(result.status, 'succeeded'); assert.equal(result.results[0].nodes[0].text, 'Avant'); assert.equal(f.figma.undoCount, 0);
});
test('une lecture ne divulgue pas un nœud déplacé hors page après préparation', async () => {
  const f = fakeFigma(); const node = f.add('TEXT');
  const apply = await (await engineFor(f.figma)).prepare(command([{ type: 'getNodes', nodeIds: [node.id] }]));
  node.parent = f.otherPage;
  const result = await apply();
  assert.equal(result.status, 'failed'); assert.equal(result.results.length, 0);
});
