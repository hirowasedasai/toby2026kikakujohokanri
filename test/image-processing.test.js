import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { remoteCodeDifferences } from '../scripts/check-remote-code.mjs';

const sources = await Promise.all(['config.gs', 'utils.gs', 'validation.gs', 'image_resize.gs.gs', 'resize.gs']
  .map(name => readFile(new URL('../apps-script/' + name, import.meta.url), 'utf8')));
const context = vm.createContext({ console });
sources.forEach(source => vm.runInContext(source, context));

test('画像列はヘッダー順から解決し欠落・重複時は停止する', () => {
  const headers = ['参加団体・参加者名（17字以内推奨・36字以内）', '画像提出（飲食アイコン画像）'];
  assert.equal(context.participantImageColumns_(headers).image, 1);
  assert.equal(context.participantImageColumns_(headers.slice().reverse()).image, 0);
  assert.throws(() => context.participantImageColumns_(headers.concat(headers[1])));
  assert.throws(() => context.participantImageColumns_([headers[0]]));
});

test('サムネイルのOAuth送信先をGoogleに限定する', () => {
  assert.equal(context.resizedThumbnailUrl_('https://lh3.googleusercontent.com/d/synthetic=s220', 300),
    'https://lh3.googleusercontent.com/d/synthetic=w300-h300-c');
  for (const url of ['https://evil.example/x', 'https://googleusercontent.com.evil.example/x',
    'https://googleusercontent.com@evil.example/x', 'http://lh3.googleusercontent.com/x']) {
    assert.throws(() => context.resizedThumbnailUrl_(url, 300));
  }
});

test('画像の行エラー後も継続し、原本・共有に書き込まずログに実データを出さない', () => {
  const rows = [
    ['画像提出（飲食アイコン画像）', '参加団体・参加者名（17字以内推奨・36字以内）'],
    ['https://drive.google.com/file/d/synthetic_failed/view', '合成名1'],
    ['https://drive.google.com/file/d/synthetic_ok/view', '合成名2'],
    ['', '合成名3']
  ];
  const before = JSON.stringify(rows);
  const saved = [];
  let log;
  const preflight = { spreadsheet: {} };
  context.withScriptLock_ = fn => fn();
  context.newExecutionId_ = () => 'synthetic';
  context.preflightInternal_ = () => preflight;
  context.requireSheet_ = () => ({});
  context.readSheetValues_ = () => rows;
  context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => key }) };
  context.DriveApp = {
    getFolderById: () => ({ createFile: blob => saved.push(blob) }),
    getFileById: id => {
      if (id === 'synthetic_failed') throw new Error('private-name private-url');
      return { getName: () => 'original', makeCopy: () => ({ getId: () => 'synthetic_copy' }) };
    }
  };
  context.fetchResizedThumbnail = () => ({ setName: name => ({ name }) });
  context.makeIssue_ = (level, code, message, details) => ({ level, code, message, details });
  context.appendProcessLog_ = (...args) => { log = JSON.stringify(args); };
  const result = context.processImages();
  assert.equal(result.created, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.skipped, 1);
  assert.equal(saved[0].name, '合成名2.jpg');
  assert.equal(JSON.stringify(rows), before);
  assert.doesNotMatch(log, /合成名|private-|drive.google|synthetic_failed/);
});

test('deployは未登録の本番ファイルやpush後の内容不一致を検出する', () => {
  const local = [{ remotePath: 'config', source: 'new', type: 'SERVER_JS' }];
  const remote = [{ remotePath: 'config', source: 'old', type: 'SERVER_JS' },
    { remotePath: 'resize', source: 'existing', type: 'SERVER_JS' }];
  assert.deepEqual(remoteCodeDifferences(local, remote, true), { extra: ['resize'], changed: [] });
  assert.deepEqual(remoteCodeDifferences(local, remote), { extra: ['resize'], changed: ['config'] });
  assert.deepEqual(remoteCodeDifferences(local, local), { extra: [], changed: [] });
});
