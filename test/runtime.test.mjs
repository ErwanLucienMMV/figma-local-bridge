import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { liveBridge, fakeFigma, command, until } from './helpers.mjs';

test('plugin construit + vrai HTTP : lecture, validation manuelle, application et refus', async t => {
  const b = await liveBridge(t); const f = fakeFigma(); const text = f.add('TEXT'); f.page.selection = [text];
  const timers = [];
  let dropAck = false;
  const sandbox = vm.createContext({ figma: f.figma, __html__: '<html></html>',
    fetch: async (url, options) => {
      const response = await fetch(url.replace('http://localhost:38475', b.url), options);
      if (dropAck && url.endsWith('/plugin/result')) { dropAck = false; throw new Error('Accusé réseau perdu après acceptation'); }
      return response;
    },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {}
  });
  const source = await readFile(new URL('../plugin/code.js', import.meta.url), 'utf8');
  vm.runInContext(source, sandbox);
  await f.figma.ui.onmessage({ type: 'setAutoApply', enabled: false });
  await f.figma.ui.onmessage({ type: 'connect', token: b.pluginToken });
  await until(() => timers.length > 0);
  const session = (await b.api('/agent/session')).data.session;
  const identity = { sessionId: session.sessionId, pageId: session.pageId };
  async function tick() { const callback = timers.shift(); assert.ok(callback); await callback(); }
  await b.api('/agent/commands', command([{ type: 'getSelection' }], { ...identity, commandId: 'read' }));
  await tick(); await tick();
  assert.equal((await b.api('/agent/commands/read')).data.result.results[0].nodes[0].text, 'Avant');
  await b.api('/agent/commands', command([{ type: 'setText', nodeId: text.id, text: 'Après' }], { ...identity, commandId: 'edit' }));
  await tick();
  assert.equal(text.characters, 'Avant'); assert.ok(f.messages.find(m => m.type === 'pending'));
  await f.figma.ui.onmessage({ type: 'apply', commandId: 'edit' });
  assert.equal(text.characters, 'Après'); dropAck = true; await tick(); await tick();
  assert.equal((await b.api('/agent/commands/edit')).data.status, 'succeeded');
  assert.equal(f.figma.undoCount, 2, 'un accusé perdu ne rejoue pas la mutation');
  await b.api('/agent/commands', command([{ type: 'setText', nodeId: text.id, text: 'Interdit' }], { ...identity, commandId: 'refused' }));
  await tick(); await f.figma.ui.onmessage({ type: 'reject', commandId: 'refused' }); await tick();
  assert.equal(text.characters, 'Après'); assert.equal((await b.api('/agent/commands/refused')).data.status, 'rejected');
  await b.api('/agent/commands', command([{ type: 'createFrame', parentId: f.page.id, name: 'Test création', width: 320, height: 240 }], { ...identity, commandId: 'new-frame' }));
  await tick(); assert.equal(f.figma.createdCount, 0, 'aucune création avant validation');
  await f.figma.ui.onmessage({ type: 'reject', commandId: 'new-frame' }); await tick();
  assert.equal(f.figma.createdCount, 0, 'aucun calque après refus');
  await b.api('/agent/commands', command([{ type: 'createFrame', parentId: f.page.id, name: 'Test approuvé', width: 320, height: 240 }], { ...identity, commandId: 'approved-frame' }));
  await tick(); assert.equal(f.figma.createdCount, 0);
  await f.figma.ui.onmessage({ type: 'apply', commandId: 'approved-frame' }); await tick();
  assert.equal(f.figma.createdCount, 1); assert.equal((await b.api('/agent/commands/approved-frame')).data.status, 'succeeded');
  await f.figma.ui.onmessage({ type: 'ready' });
  assert.equal(f.messages.at(-1).type, 'connected', 'une interface rechargée récupère le statut réel');
  await f.figma.ui.onmessage({ type: 'execute', code: 'throw 1' });
  assert.ok(f.messages.find(m => m.type === 'warning' && m.message.includes('inconnue')));
  await f.figma.ui.onmessage({ type: 'disconnect' });
  assert.equal((await b.api('/agent/session')).data.session, null);
});

test('UI : commandes affichées comme texte, messages étrangers ignorés et boutons fonctionnels', async () => {
  const html = await readFile(new URL('../plugin/ui.html', import.meta.url), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const elements = new Map(); const sent = [];
  const host = {}; host.parent = host;
  const relay = { parent: host };
  const parent = { parent: relay, postMessage: value => sent.push(value) }; const window = { parent };
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', value: '', hidden: true, disabled: false });
    return elements.get(id);
  } };
  vm.runInNewContext(script, { document, parent, window, console });
  assert.equal(sent[0].pluginMessage.type, 'ready');
  assert.equal(elements.get('autoApply').checked, true);
  elements.get('autoApply').checked = false; elements.get('autoApply').onchange();
  assert.equal(sent.at(-1).pluginMessage.type, 'setAutoApply'); assert.equal(sent.at(-1).pluginMessage.enabled, false);
  const message = { type: 'pending', command: { commandId: 'x', text: '<img src=x onerror=alert(1)>' }, deadline: Date.now() + 1000 };
  window.onmessage({ source: {}, origin: 'https://www.figma.com', data: { pluginMessage: message } });
  assert.equal(document.getElementById('review').hidden, true);
  window.onmessage({ source: parent, origin: 'https://evil.test', data: { pluginMessage: message } });
  assert.equal(elements.get('review').hidden, true);
  window.onmessage({ source: parent, origin: 'null', data: { pluginMessage: message } });
  assert.equal(elements.get('review').hidden, false);
  assert.ok(elements.get('command').textContent.includes('<img'));
  elements.get('apply').onclick(); assert.equal(sent.at(-1).pluginMessage.type, 'apply');
  assert.equal(sent.at(-1).pluginMessage.commandId, 'x');
  window.onmessage({ source: host, origin: 'https://www.figma.com', data: { pluginMessage: {
    type: 'selection', pageId: '1:1', pageName: 'Page Figma', nodes: [{ id: '1:2' }], truncated: false
  } } });
  assert.match(elements.get('selection').textContent, /Page Figma/, 'les réponses du relais Figma traversent trois ancêtres');
  window.onmessage({ source: host, origin: 'https://www.figma.com', data: { pluginMessage: { type: 'mode', autoApply: true } } });
  assert.equal(elements.get('autoApply').checked, true);
});

async function automaticRuntime(t) {
  const b = await liveBridge(t); const f = fakeFigma(); const timers = [];
  vm.runInNewContext(await readFile(new URL('../plugin/code.js', import.meta.url), 'utf8'), {
    figma: f.figma, __html__: '<html></html>', fetch: (url, options) => fetch(url.replace('http://localhost:38475', b.url), options),
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {}
  });
  await f.figma.ui.onmessage({ type: 'connect', token: b.pluginToken });
  await until(() => timers.length > 0);
  const { session } = (await b.api('/agent/session')).data;
  let sequence = 0;
  return { b, f, timers, tick: () => timers.shift()(),
    send: async operations => { const id = 'auto-' + (++sequence); const result = await b.api('/agent/commands', command(operations, { commandId: id, sessionId: session.sessionId, pageId: session.pageId })); assert.equal(result.status, 202); return id; }
  };
}

test('mode automatique par défaut : texte et cadre appliqués sans clic, contrôles toujours actifs', async t => {
  const r = await automaticRuntime(t); const text = r.f.add('TEXT');
  const id = await r.send([{ type: 'setText', nodeId: text.id, text: 'Automatique' }]);
  await r.tick(); assert.equal(text.characters, 'Automatique'); assert.equal(r.f.messages.some(m => m.type === 'pending'), false);
  await r.tick(); assert.equal((await r.b.api('/agent/commands/' + id)).data.status, 'succeeded');
  await r.send([{ type: 'createFrame', parentId: r.f.page.id, name: 'Cadre automatique', width: 300, height: 200 }]);
  await r.tick(); assert.equal(r.f.figma.createdCount, 1); await r.tick();
  text.locked = true;
  const blocked = await r.send([{ type: 'setText', nodeId: text.id, text: 'Interdit' }]);
  await r.tick(); await r.tick(); assert.equal(text.characters, 'Automatique');
  assert.equal((await r.b.api('/agent/commands/' + blocked)).data.status, 'failed');
  assert.equal(r.f.figma.undoCount, 4, 'une étape annuler par lot appliqué, aucune pour la prévalidation refusée');
});

test('changer de mode conserve les lots déjà en attente et permet le retour au manuel', async t => {
  const r = await automaticRuntime(t); const text = r.f.add('TEXT');
  await r.f.figma.ui.onmessage({ type: 'setAutoApply', enabled: false });
  const id = await r.send([{ type: 'setText', nodeId: text.id, text: 'Validé manuellement' }]);
  await r.tick(); assert.equal(text.characters, 'Avant');
  await r.f.figma.ui.onmessage({ type: 'setAutoApply', enabled: true });
  await r.tick(); assert.equal(text.characters, 'Avant', 'activer le mode ne valide pas rétroactivement un lot déjà en attente');
  await r.f.figma.ui.onmessage({ type: 'apply', commandId: id }); await r.tick(); assert.equal(text.characters, 'Validé manuellement');
  await r.f.figma.ui.onmessage({ type: 'setAutoApply', enabled: 'non' });
  assert.match(r.f.messages.at(-1).message, /booléen/);
  const next = await r.send([{ type: 'setText', nodeId: text.id, text: 'Automatique après bascule' }]);
  await r.tick(); await r.tick(); assert.equal((await r.b.api('/agent/commands/' + next)).data.status, 'succeeded');
});

test('mode automatique : changement de page pendant la prévalidation interdit la mutation', async t => {
  const r = await automaticRuntime(t); const text = r.f.add('TEXT'); let releaseFont;
  r.f.figma.loadFontAsync = () => new Promise(resolve => { releaseFont = resolve; });
  await r.send([{ type: 'setText', nodeId: text.id, text: 'Ne doit pas être écrit' }]);
  const pendingTick = r.tick(); await until(() => !!releaseFont);
  r.f.figma.currentPage = r.f.otherPage; releaseFont(); await pendingTick;
  assert.equal(text.characters, 'Avant'); assert.equal(r.f.figma.undoCount, 0);
  assert.equal(r.f.messages.findLast(m => m.type === 'result').result.status, 'failed');
});
