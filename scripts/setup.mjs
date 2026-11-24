import { access, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required. Install a supported Node.js release.');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--plugin-id' || !/^[1-9][0-9]{5,39}$/.test(args[1]))) {
    throw new Error('Usage: npm run setup [-- --plugin-id YOUR_NUMERIC_PLUGIN_ID]');
  }
  for (const file of ['bridge/server.mjs', 'client/cli.mjs', 'src/protocol.cjs', 'src/engine.js', 'src/main.js', 'src/ui.html', 'plugin/manifest.json']) await access(path.join(root, file));
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin/manifest.json'), 'utf8'));
  if (manifest.main !== 'code.js' || manifest.ui !== 'ui.html' || !manifest.editorType?.includes('figma')) throw new Error('Unexpected plugin manifest. Restore the project manifest before running setup.');
  function run(script, extra = []) {
    const result = spawnSync(process.execPath, [path.join(root, script), ...extra], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Setup step failed').trim());
  }
  if (args.length) run('scripts/set-plugin-id.mjs', [args[1]]);
  run('scripts/build.mjs');
  run('scripts/build.mjs', ['--check']);
  await mkdir(path.join(root, 'commands'), { recursive: true });
  console.log('Setup complete. No npm install, .env values, or API credentials are required.');
  console.log('1. Import this manifest in Figma Desktop: ' + path.join(root, 'plugin/manifest.json'));
  console.log('2. Start the bridge in this folder: npm start');
  console.log('3. Open Codex Local Bridge in Figma and connect with the printed PLUGIN key.');
  console.log('4. In a second terminal, verify the connection: npm run doctor');
  console.log('Save personal command JSON files in commands/ (ignored by Git).');
} catch (e) {
  console.error('Setup failed: ' + String(e.message || e));
  process.exitCode = 1;
}
