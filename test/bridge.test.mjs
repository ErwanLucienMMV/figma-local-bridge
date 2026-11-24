import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { liveBridge, command } from './helpers.mjs';

test('authentification, rôles, CORS et validation des commandes', async t => {
  const b = await liveBridge(t);
  assert.equal((await b.api('/agent/session', undefined, 'plugin')).status, 401);
  assert.equal((await b.api('/plugin/register', {}, 'agent')).status, 401);
  assert.equal((await b.api('/agent/session', undefined, 'agent', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await b.api('/agent/session', undefined, 'agent', { Origin: 'null' })).status, 403);
  const session = await b.register();
  const { status, headers } = await b.api('/plugin/next', { sessionId: session.sessionId, ready: true }, 'plugin', { Origin: 'null' });
  assert.equal(status, 200); assert.equal(headers.get('access-control-allow-origin'), '*');
  assert.equal((await b.api('/agent/commands', command([{ type: 'execute', code: 'process.exit()' }], session))).status, 400);
  assert.equal((await b.api('/agent/commands', command([{ type: 'getSelection' }], { ...session, pageId: '2:1' }))).status, 409);
  assert.equal((await b.api('/agent/commands', command([{ type: 'getSelection' }], { ...session, sessionId: 'wrong' }))).status, 409);
  assert.equal((await b.api('/agent/session?token=x')).status, 400);
});

test('dispatch au plus une fois, ready, accusé de réception idempotent et doublons', async t => {
  const b = await liveBridge(t); const session = await b.register();
  const cmd = command([{ type: 'getSelection' }], session);
  assert.equal((await b.api('/agent/commands', cmd)).status, 202);
  assert.equal((await b.api('/agent/commands', cmd)).status, 409);
  assert.equal((await b.api('/plugin/next', { sessionId: session.sessionId, ready: false }, 'plugin')).data.job, null);
  const next = () => b.api('/plugin/next', { sessionId: session.sessionId, ready: true }, 'plugin');
  assert.deepEqual((await next()).data.job.command, cmd);
  assert.equal((await next()).data.job, null);
  const result = { sessionId: session.sessionId, commandId: cmd.commandId, result: { status: 'succeeded', results: [] } };
  assert.equal((await b.api('/plugin/result', result, 'plugin')).status, 200);
  assert.equal((await b.api('/plugin/result', result, 'plugin')).status, 200);
  assert.equal((await b.api('/plugin/result', { ...result, result: { status: 'failed' } }, 'plugin')).status, 409);
  assert.equal((await b.api('/agent/commands/' + cmd.commandId)).data.status, 'succeeded');
  assert.equal((await b.api('/plugin/result', result, 'agent')).status, 401);
});

test('expiration queued, résultat inconnu après dispatch, aucune redistribution', async t => {
  let time = 1000;
  const b = await liveBridge(t, { now: () => time, jobTTL: 100, sessionTTL: 1000 });
  const session = await b.register();
  await b.api('/agent/commands', command([{ type: 'getSelection' }], session));
  time += 101;
  assert.equal((await b.api('/agent/commands/test-command')).data.status, 'expired');
  await b.api('/agent/commands', command([{ type: 'getSelection' }], { ...session, commandId: 'second' }));
  await b.api('/plugin/next', { sessionId: session.sessionId, ready: true }, 'plugin'); time += 101;
  assert.equal((await b.api('/agent/commands/second')).data.status, 'unknown');
  assert.equal((await b.api('/plugin/next', { sessionId: session.sessionId, ready: true }, 'plugin')).data.job, null);
  // Late acknowledgement resolves uncertainty, without executing again.
  assert.equal((await b.api('/plugin/result', { sessionId: session.sessionId, commandId: 'second', result: { status: 'succeeded' } }, 'plugin')).status, 200);
});

test('une session unique, déconnexion et renouvellement sans réutilisation', async t => {
  const b = await liveBridge(t); const s = await b.register();
  assert.equal((await b.api('/plugin/register', { pageId: '1:1', pageName: 'X', documentName: 'X' }, 'plugin')).status, 409);
  await b.api('/agent/commands', command([{ type: 'getSelection' }], s));
  await b.api('/plugin/disconnect', { sessionId: s.sessionId }, 'plugin');
  assert.equal((await b.api('/agent/commands/test-command')).data.status, 'cancelled');
  const next = await b.register(); assert.notEqual(next.sessionId, s.sessionId);
  assert.equal((await b.api('/plugin/next', { sessionId: s.sessionId, ready: true }, 'plugin')).status, 409);
});

test('Host anti DNS rebinding et limite du corps', async t => {
  const b = await liveBridge(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(b.url + '/agent/session', { headers: { Host: 'evil.test', Authorization: 'Bearer ' + b.agentToken } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 403);
  const large = await fetch(b.url + '/agent/commands', { method: 'POST', headers: { Authorization: 'Bearer ' + b.agentToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'x'.repeat(66000) }) });
  assert.equal(large.status, 413);
});
