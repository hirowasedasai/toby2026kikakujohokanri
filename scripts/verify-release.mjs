import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'AGENTS.md',
  'README.md',
  '.claspignore',
  'apps-script/appsscript.json',
  'apps-script/config.gs',
  'apps-script/menu.gs',
  'apps-script/setup.gs',
  'apps-script/triggers.gs',
  'apps-script/syncMaster.gs',
  'apps-script/buildOutputs.gs',
  'apps-script/buildBureauOutputs.gs',
  'apps-script/bureauResponseSelection.gs',
  'apps-script/resize.gs',
  'apps-script/image_resize.gs.gs',
  'apps-script/validation.gs',
  'apps-script/logger.gs',
  'apps-script/utils.gs',
  'test/fixtures/synthetic-form-rows.json',
  'docs/architecture.md',
  'docs/sheet-structure.md',
  'docs/column-mapping.md',
  'docs/operation-flow.md',
  'docs/release-runbook.md',
  'docs/rollback-runbook.md',
  'docs/incident-runbook.md',
  'docs/access-control.md'
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const relativePath of requiredFiles) {
  try {
    await readFile(path.join(repoRoot, relativePath));
  } catch {
    console.error(`Required file is missing: ${relativePath}`);
    process.exit(1);
  }
}

const manifest = JSON.parse(
  await readFile(path.join(repoRoot, 'apps-script/appsscript.json'), 'utf8')
);
const expectedScopes = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/script.external_request'
];
if (
  manifest.timeZone !== 'Asia/Tokyo' ||
  manifest.runtimeVersion !== 'V8' ||
  manifest.exceptionLogging !== 'STACKDRIVER' ||
  JSON.stringify(manifest.oauthScopes) !== JSON.stringify(expectedScopes) ||
  JSON.stringify(manifest.dependencies) !== JSON.stringify({
    enabledAdvancedServices: [{ userSymbol: 'Drive', version: 'v3', serviceId: 'drive' }]
  })
) {
  console.error('Apps Script manifest does not match the approved runtime or scopes.');
  process.exit(1);
}

const gitignore = await readFile(path.join(repoRoot, '.gitignore'), 'utf8');
for (const pattern of ['.clasp.json', '.clasp.*.json', '.clasprc.json']) {
  if (!gitignore.split(/\r?\n/).includes(pattern)) {
    console.error(`.gitignore must include: ${pattern}`);
    process.exit(1);
  }
}

for (const environment of ['staging', 'production']) {
  const example = JSON.parse(
    await readFile(path.join(repoRoot, `config/clasp.${environment}.example.json`), 'utf8')
  );
  if (
    !String(example.scriptId).includes('PLACEHOLDER') ||
    example.rootDir !== 'apps-script' ||
    Object.keys(example).sort().join(',') !== 'rootDir,scriptId'
  ) {
    console.error(`The ${environment} clasp example must contain only a placeholder.`);
    process.exit(1);
  }
}

const appsScriptSource = (
  await Promise.all(
    requiredFiles
      .filter((relativePath) => relativePath.endsWith('.gs') && relativePath !== 'apps-script/image_resize.gs.gs')
      .map((relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8'))
  )
).join('\n');
if (appsScriptSource.includes('UrlFetchApp')) {
  console.error('External URL access is allowed only in the Google thumbnail utility.');
  process.exit(1);
}

const deploymentSource = await Promise.all(
  ['scripts/deploy-staging.mjs', 'scripts/deploy-production.mjs'].map((relativePath) =>
    readFile(path.join(repoRoot, relativePath), 'utf8')
  )
);
if (deploymentSource.some((source) => source.includes("'--force'") || source.includes("'deploy'"))) {
  console.error('Deployment scripts must not use --force or create a clasp deployment.');
  process.exit(1);
}

const workflow = await readFile(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
if (
  !workflow.includes('npm ci') ||
  !workflow.includes('npm run verify') ||
  /clasp|deploy/i.test(workflow)
) {
  console.error('Pull request CI must only install dependencies and verify locally.');
  process.exit(1);
}

run('npm', ['run', 'lint']);
run('npm', ['test']);
console.log('Release verification passed without Google authentication.');
