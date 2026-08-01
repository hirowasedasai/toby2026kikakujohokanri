import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2];

if (!['staging', 'production'].includes(environment)) {
  console.error('Usage: node scripts/select-environment.mjs <staging|production>');
  process.exit(1);
}

const sourcePath = path.join(repoRoot, `.clasp.${environment}.json`);
const destinationPath = path.join(repoRoot, '.clasp.json');

let config;
try {
  config = JSON.parse(await readFile(sourcePath, 'utf8'));
} catch {
  console.error(`Missing or invalid ignored config: .clasp.${environment}.json`);
  console.error(`Copy config/clasp.${environment}.example.json and replace only the local placeholder.`);
  process.exit(1);
}

if (
  typeof config.scriptId !== 'string' ||
  !config.scriptId.trim() ||
  config.scriptId.includes('PLACEHOLDER') ||
  config.rootDir !== 'apps-script'
) {
  console.error(`.clasp.${environment}.json must contain a real local scriptId and rootDir "apps-script".`);
  process.exit(1);
}

const temporaryPath = path.join(repoRoot, `.clasp.selected-${process.pid}.json`);
await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryPath, destinationPath);
console.log(`Selected ${environment}. Script ID was not printed.`);
