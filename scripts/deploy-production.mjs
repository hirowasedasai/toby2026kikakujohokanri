import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  const shouldCapture = Boolean(options.capture || options.secrets);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: shouldCapture ? 'utf8' : undefined,
    stdio: shouldCapture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  const redact = (value) => {
    let output = value || '';
    for (const secret of options.secrets || []) {
      output = output.split(secret).join('[SECRET_REDACTED]');
    }
    return output.replace(/ya29\.[A-Za-z0-9_-]+/g, '[OAUTH_TOKEN_REDACTED]');
  };
  if (options.secrets) {
    if (result.stdout) process.stdout.write(redact(result.stdout));
    if (result.stderr) process.stderr.write(redact(result.stderr));
  }
  if (result.status !== 0) {
    if (options.capture && result.stderr) console.error(redact(result.stderr).trim());
    process.exit(result.status || 1);
  }
  return options.capture ? result.stdout.trim() : '';
}

const branch = run('git', ['branch', '--show-current'], { capture: true });
if (branch !== 'main') {
  console.error(`production反映はmain branchのみ許可されています。現在: ${branch || '(detached)'}`);
  process.exit(1);
}

const worktree = run('git', ['status', '--porcelain', '--untracked-files=all'], { capture: true });
if (worktree) {
  console.error('production反映にはclean worktreeが必要です。');
  process.exit(1);
}

run('npm', ['run', 'verify']);

let productionConfig;
try {
  productionConfig = JSON.parse(
    await readFile(path.join(repoRoot, '.clasp.production.json'), 'utf8')
  );
} catch {
  console.error('Missing or invalid ignored config: .clasp.production.json');
  process.exit(1);
}
if (
  typeof productionConfig.scriptId !== 'string' ||
  !productionConfig.scriptId.trim() ||
  productionConfig.scriptId.includes('PLACEHOLDER') ||
  productionConfig.rootDir !== 'apps-script'
) {
  console.error('.clasp.production.jsonのローカル設定が不正です。');
  process.exit(1);
}

const scriptId = productionConfig.scriptId.trim();
const maskedScriptId = scriptId.length > 10
  ? `${scriptId.slice(0, 4)}…${scriptId.slice(-4)}`
  : '[configured]';
console.log('対象環境: production');
console.log(`対象Script ID（部分表示）: ${maskedScriptId}`);

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question('続行する場合は PRODUCTION と入力してください: ');
prompt.close();
if (answer !== 'PRODUCTION') {
  console.error('入力が一致しないため停止しました。');
  process.exit(1);
}

run(process.execPath, ['scripts/select-environment.mjs', 'production']);
const gitSha = run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true });
run('npx', ['--no-install', 'clasp', 'push'], { secrets: [scriptId] });
run('npx', ['--no-install', 'clasp', 'version', `production ${gitSha}`], {
  secrets: [scriptId]
});
console.log(`productionへ同期し、Git ${gitSha} のApps Script versionを作成しました。deploymentは作成していません。`);
