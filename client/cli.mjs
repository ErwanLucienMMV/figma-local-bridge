import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import protocol from '../src/protocol.cjs';

const [action, argument, ...extra] = process.argv.slice(2);
const print = value => console.log(JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  if (!['session', 'capabilities', 'send', 'status'].includes(action) || extra.length || (['session', 'capabilities'].includes(action) && argument) || (['send', 'status'].includes(action) && !argument)) {
    throw new Error('Usage : node client/cli.mjs session | capabilities | send examples/01-selection.json | status COMMAND_ID');
  }
  const configPath = fileURLToPath(new URL('../.local/agent.json', import.meta.url));
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.url !== 'http://127.0.0.1:38475' || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Configuration locale invalide');
  async function api(route, data) {
    const response = await fetch(config.url + route, {
      method: data ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + config.token, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(5000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error('HTTP ' + response.status + ' : ' + result.error);
    return result;
  }
  if (action === 'session') print(await api('/agent/session'));
  if (action === 'capabilities') print(await api('/agent/capabilities'));
  if (action === 'status') { protocol.id(argument, 'commandId'); print(await api('/agent/commands/' + argument)); }
  if (action === 'send') {
    const input = JSON.parse(await readFile(argument, 'utf8'));
    protocol.keys(input, ['operations'], [], 'fichier exemple');
    const { session } = await api('/agent/session');
    if (!session) throw new Error('Ouvrir le plugin dans Figma et le connecter avec la clé plugin.');
    if (session.protocolRevision !== protocol.REVISION) throw new Error('Mettre à jour et redémarrer le pont, puis recharger/reconnecter le plugin ' + protocol.REVISION + ' avant d’envoyer une commande.');
    const command = { version: 1, commandId: randomUUID(), sessionId: session.sessionId, pageId: session.pageId, operations: input.operations };
    protocol.command(command);
    // Print the ID BEFORE sending: if POST times out, inspect this ID rather than resending.
    print({ commandId: command.commandId, sessionId: command.sessionId, pageId: command.pageId });
    print(await api('/agent/commands', command));
    console.error('En attente de Figma ; application automatique ou validation selon le mode du plugin. Ctrl+C arrête seulement cette attente.');
    const until = Date.now() + 130000;
    while (Date.now() < until) {
      const status = await api('/agent/commands/' + command.commandId);
      if (!['queued', 'dispatched'].includes(status.status)) {
        print(status);
        if (status.status !== 'succeeded') process.exitCode = 2;
        break;
      }
      await sleep(1000);
    }
  }
} catch (e) {
  console.error(String(e.message || e));
  console.error('Si une commande a été envoyée, consulter son statut avant de réessayer.');
  process.exitCode = 1;
}
