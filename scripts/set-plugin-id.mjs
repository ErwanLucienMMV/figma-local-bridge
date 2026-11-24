import { readFile, writeFile } from 'node:fs/promises';
const id = process.argv[2];
if (!id || !/^[1-9][0-9]{5,39}$/.test(id) || process.argv.length !== 3) {
  console.error('Usage : npm run configure -- IDENTIFIANT_NUMERIQUE_FOURNI_PAR_FIGMA');
  process.exitCode = 1;
} else {
  const file = new URL('../plugin/manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.id = id;
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Identifiant configuré. Importer plugin/manifest.json dans Figma Desktop.');
}
