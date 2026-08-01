import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
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

run('npm', ['run', 'verify']);
run(process.execPath, ['scripts/select-environment.mjs', 'staging']);
const stagingConfig = JSON.parse(
  await readFile(path.join(repoRoot, '.clasp.staging.json'), 'utf8')
);
const gitSha = run('git', ['rev-parse', '--short=12', 'HEAD'], { capture: true });
run('npx', ['--no-install', 'clasp', 'push'], { secrets: [stagingConfig.scriptId] });
run('npx', ['--no-install', 'clasp', 'version', `staging ${gitSha}`], {
  secrets: [stagingConfig.scriptId]
});
console.log(`stagingへ同期し、Git ${gitSha} のApps Script versionを作成しました。deploymentは作成していません。`);
