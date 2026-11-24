import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../src/protocol.cjs';
import { command } from './helpers.mjs';

test('accepte les huit opérations déclaratives', () => {
  const operations = [
    { type: 'getSelection' }, { type: 'getNodes', nodeIds: ['1:2'] },
    { type: 'setText', nodeId: '1:2', text: '' }, { type: 'setFill', nodeId: '1:2', color: '#123aBC', opacity: 0 },
    { type: 'setPosition', nodeId: '1:2', x: -2, y: 1 }, { type: 'createComponent', nodeId: '1:2' },
    { type: 'createInstance', componentId: '1:2', x: 0, y: 0 },
    { type: 'setInstanceProperties', nodeId: '1:2', properties: { Label: 'OK', Visible: true } }
  ];
  for (const op of operations) assert.doesNotThrow(() => protocol.command(command([op])));
});
for (const [label, op] of [
  ['exécution arbitraire', { type: 'eval', code: 'delete figma.root' }],
  ['champ supplémentaire', { type: 'getSelection', code: 'alert(1)' }],
  ['coordonnée infinie', { type: 'setPosition', nodeId: '1:2', x: Infinity, y: 0 }],
  ['couleur invalide', { type: 'setFill', nodeId: '1:2', color: 'red' }],
  ['opacité invalide', { type: 'setFill', nodeId: '1:2', color: '#ffffff', opacity: 2 }],
  ['texte excessif', { type: 'setText', nodeId: '1:2', text: 'a'.repeat(10001) }],
  ['identifiant URL', { type: 'getNodes', nodeIds: ['http://evil.test'] }],
  ['prototype', JSON.parse('{"type":"setInstanceProperties","nodeId":"1:2","properties":{"__proto__":"x"}}')]
]) test('refuse ' + label, () => assert.throws(() => protocol.command(command([op]))));
test('limite les lots et isole la conversion en composant', () => {
  assert.throws(() => protocol.command(command(Array(21).fill({ type: 'getSelection' }))));
  assert.throws(() => protocol.command(command([{ type: 'createComponent', nodeId: '1:2' }, { type: 'getSelection' }])));
  assert.throws(() => protocol.command(command([], { version: 2 })));
});
