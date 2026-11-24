import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import protocol from '../src/protocol.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required.');
  for (const file of ['plugin/manifest.json', 'plugin/code.js', 'plugin/ui.html']) await access(path.join(root, file));
  console.log('OK: Node.js and installable plugin files are present.');
  let config;
  try { config = JSON.parse(await readFile(path.join(root, '.local/agent.json'), 'utf8')); }
  catch { throw new Error('No valid generated agent configuration. Run npm start in this project folder first.'); }
  if (config.url !== 'http://127.0.0.1:38475' || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Unexpected local agent configuration. Restart the bridge in this folder.');
  async function get(route) {
    let response;
    try { response = await fetch(config.url + route, { headers: { Authorization: 'Bearer ' + config.token }, signal: AbortSignal.timeout(3000) }); }
    catch { throw new Error('Cannot reach the local bridge. Keep npm start running on this computer.'); }
    if (response.status === 401) throw new Error('The saved key does not match the running bridge. Start the bridge from this project folder.');
    if (!response.ok) throw new Error('Bridge returned HTTP ' + response.status + '. Check that the running bridge is up to date.');
    return response.json();
  }
  const capabilities = await get('/agent/capabilities');
  if (capabilities.protocolRevision !== protocol.REVISION) throw new Error('Protocol mismatch. Update and restart the bridge.');
  console.log('OK: authenticated localhost bridge, protocol ' + protocol.REVISION + '.');
  const { session } = await get('/agent/session');
  if (!session) {
    console.log('ACTION: open the plugin in Figma Desktop and connect with the PLUGIN key.');
    process.exitCode = 2;
  } else {
    if (session.protocolRevision !== protocol.REVISION) throw new Error('The connected plugin is outdated. Reload and reconnect it.');
    console.log('OK: a compatible Figma plugin is connected.');
    console.log('Ready. Select a layer, then run: node client/cli.mjs send examples/01-selection.json');
  }
} catch (e) {
  console.error('CHECK FAILED: ' + String(e.message || e));
  process.exitCode = 1;
}
