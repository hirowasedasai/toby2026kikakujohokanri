import { initAuth } from '../node_modules/@google/clasp/build/src/auth/auth.js';
import { initClaspInstance } from '../node_modules/@google/clasp/build/src/core/clasp.js';

export function remoteCodeDifferences(local, remote, beforePush = false) {
  const localByName = new Map(local.map(file => [file.remotePath, file]));
  const remoteByName = new Map(remote.map(file => [file.remotePath, file]));
  const extra = remote.filter(file => !localByName.has(file.remotePath)).map(file => file.remotePath);
  const changed = beforePush ? [] : local.filter(file => {
    const other = remoteByName.get(file.remotePath);
    if (!other || file.type !== other.type) return true;
    if (file.type === 'JSON') return JSON.stringify(JSON.parse(file.source)) !== JSON.stringify(JSON.parse(other.source));
    return file.source.replace(/\r\n/g, '\n') !== other.source.replace(/\r\n/g, '\n');
  }).map(file => file.remotePath);
  return { extra, changed };
}

if (process.argv[1]?.endsWith('/check-remote-code.mjs')) {
  try {
    const auth = await initAuth({ userKey: 'default' });
    const clasp = await initClaspInstance({ credentials: auth.credentials });
    const [local, remote] = await Promise.all([clasp.files.collectLocalFiles(), clasp.files.fetchRemote()]);
    const differences = remoteCodeDifferences(local, remote, process.argv.includes('--before'));
    if (differences.extra.length || differences.changed.length) {
      console.error('Remote code verification failed:', JSON.stringify(differences));
      process.exitCode = 1;
    } else {
      console.log('Remote code verification passed.');
    }
  } catch {
    console.error('Remote code could not be verified; release stopped.');
    process.exitCode = 1;
  }
}
