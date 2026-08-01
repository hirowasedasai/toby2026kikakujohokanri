import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  await readFile(path.join(repoRoot, 'test/fixtures/synthetic-form-rows.json'), 'utf8')
);
const context = vm.createContext({
  console,
  Date,
  Math,
  Object,
  String,
  Array,
  Boolean,
  Number,
  JSON,
  RegExp,
  Error,
  Utilities: {
    formatDate(value) {
      return new Date(value).toISOString();
    },
    getUuid() {
      return 'synthetic-execution-id';
    }
  }
});

for (const file of [
  'config.gs',
  'utils.gs',
  'validation.gs',
  'logger.gs',
  'syncMaster.gs',
  'buildOutputs.gs'
]) {
  const source = await readFile(path.join(repoRoot, 'apps-script', file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const masterHeaders = plain(context.APP_CONFIG.masterHeaders);

function makeBatch(headers, rows, source = { name: '26参参フォーム回答', type: 'FORM', priority: 10 }) {
  const resolution = context.resolveHeaders_(
    headers,
    context.APP_CONFIG.inputHeaderCandidates,
    context.APP_CONFIG.requiredInputFields
  );
  assert.deepEqual(plain(resolution.missing), []);
  return {
    values: [headers, ...rows],
    columns: resolution.columns,
    columnAlternatives: resolution.alternatives,
    source
  };
}

function masterValue(row, header) {
  const index = context.buildHeaderIndex_(masterHeaders);
  return row[index[context.normalizeHeader_(header)]];
}

test('ヘッダー順変更と表記ゆれを候補名から解決する', () => {
  const batch = makeBatch(fixture.standard.headers, fixture.standard.rows);
  assert.equal(batch.columns.email, 3);
  assert.equal(batch.columns.participation, 1);
  assert.equal(batch.columns.officialId, 7);
  assert.equal(batch.columns.projectName, 4);
});

test('優先候補列が空なら同じ論理項目の次候補を行ごとに使う', () => {
  const headers = [
    'メールアドレス',
    '参加企画',
    '団体名',
    '企画名',
    '変更後企画名'
  ];
  const batch = makeBatch(
    headers,
    [['fallback@example.com', '教室企画', '合成団体', '元の企画名', '']]
  );
  const result = context.planMasterUpsert_(masterHeaders, [], [batch], 'TIME');
  assert.equal(masterValue(result.rows[0], '企画名'), '元の企画名');
});

test('Unicode・trim・メール小文字化で暫定キーを正規化する', () => {
  const left = context.buildProvisionalKey_(' ＴＥＳＴ＠ＥＸＡＭＰＬＥ．ＣＯＭ ', ' 屋台 ');
  const right = context.buildProvisionalKey_('test@example.com', '屋台');
  assert.equal(left, right);
  assert.match(context.provisionalManagementId_(left), /^TMP-[A-Z0-9]{14}$/);
});

test('新規・更新・スキップが冪等で管理IDを維持する', () => {
  const initialBatch = makeBatch(
    ['企画ID', 'メールアドレス', '参加企画', '団体名', '企画名'],
    [['SYN-100', 'alpha@example.com', '教室企画', '合成団体', '初版']]
  );
  const created = context.planMasterUpsert_(masterHeaders, [], [initialBatch], 'TIME-1');
  assert.equal(created.summary.created, 1);
  assert.equal(masterValue(created.rows[0], '管理ID'), 'SYN-100');

  const updateBatch = makeBatch(
    ['企画名', '団体名', '参加企画', 'メールアドレス', '正式企画ID'],
    [['改訂版', '合成団体', '教室企画', 'alpha@example.com', 'SYN-100']],
    { name: '変更申請', type: 'CHANGE', priority: 30 }
  );
  const updated = context.planMasterUpsert_(masterHeaders, created.rows, [updateBatch], 'TIME-2');
  assert.equal(updated.summary.updated, 1);
  assert.equal(masterValue(updated.rows[0], '管理ID'), 'SYN-100');
  assert.equal(masterValue(updated.rows[0], '企画名'), '改訂版');

  const repeated = context.planMasterUpsert_(masterHeaders, updated.rows, [updateBatch], 'TIME-3');
  assert.equal(repeated.summary.created, 0);
  assert.equal(repeated.summary.updated, 0);
  assert.equal(repeated.summary.skipped, 1);
  assert.equal(masterValue(repeated.rows[0], '最終更新日時'), 'TIME-2');
});

test('不正行があっても正常行のupsertを継続する', () => {
  const batch = makeBatch(fixture.invalid.headers, fixture.invalid.rows);
  const result = context.planMasterUpsert_(masterHeaders, [], [batch], 'TIME');
  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.issues[0].code, 'E_ROW_EMAIL_INVALID');
  assert.equal(result.issues[0].rowNumber, 2);
});

test('暫定キー衝突は統合せず要確認にし、再実行でも重複しない', () => {
  const headers = ['メール', '参加形態', 'サークル名', '催事名'];
  const rows = [
    ['collision@example.com', '教室企画', '合成団体1', '企画1'],
    ['collision@example.com', '教室企画', '合成団体2', '企画2']
  ];
  const batch = makeBatch(headers, rows);
  const first = context.planMasterUpsert_(masterHeaders, [], [batch], 'TIME-1');
  assert.equal(first.rows.length, 1);
  assert.equal(first.summary.needsReview, 1);
  assert.equal(masterValue(first.rows[0], '要確認'), 'TRUE');
  assert.equal(first.issues.at(-1).code, 'E_PROVISIONAL_KEY_COLLISION');

  const second = context.planMasterUpsert_(masterHeaders, first.rows, [batch], 'TIME-2');
  assert.equal(second.rows.length, 1);
  assert.equal(second.summary.created, 0);
});

test('キー項目変更の疑いは新旧行を自動統合せず要確認にする', () => {
  const headers = ['メールアドレス', '参加企画', '団体名', '企画名'];
  const firstBatch = makeBatch(
    headers,
    [['before@example.com', '教室企画', '合成団体', '同一掲載企画']]
  );
  const first = context.planMasterUpsert_(masterHeaders, [], [firstBatch], 'TIME-1');
  const changedKeyBatch = makeBatch(
    headers,
    [['after@example.com', '教室企画', '合成団体', '同一掲載企画']]
  );
  const second = context.planMasterUpsert_(masterHeaders, first.rows, [changedKeyBatch], 'TIME-2');
  assert.equal(second.rows.length, 2);
  assert.equal(second.summary.needsReview, 2);
  assert.equal(masterValue(second.rows[0], '要確認'), 'TRUE');
  assert.equal(masterValue(second.rows[1], '要確認'), 'TRUE');
  assert.equal(second.issues.at(-1).code, 'E_SUSPECTED_KEY_CHANGE');
});

test('飲食物フィルタは区分、販売物、公開可否をすべて確認する', () => {
  const compactHeaders = [
    '管理ID',
    '参加企画',
    '団体名',
    '企画名',
    '販売物',
    '画像リンク',
    '同期ステータス',
    '最終更新日時',
    '要確認'
  ];
  const plan = context.buildOutputPlan_(compactHeaders, fixture.foodCases, 'food');
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0][0], 'SYN-F1');
});

test('出力列を固定列番号ではなく出力ヘッダー順で構築する', () => {
  const compactHeaders = [
    '管理ID',
    '参加企画',
    '団体名',
    '企画名',
    '販売物',
    '画像リンク',
    '同期ステータス',
    '最終更新日時',
    '要確認'
  ];
  const reorderedOutput = ['企画名', '管理ID', '販売物', '団体名', '参加企画', '要確認', '画像リンク'];
  const plan = context.buildOutputPlan_(
    compactHeaders,
    [fixture.foodCases[0]],
    'food',
    reorderedOutput
  );
  assert.deepEqual(plain(plan.rows[0]), [
    '食品あり',
    'SYN-F1',
    'クッキー',
    '合成団体',
    '飲食物販売企画',
    'FALSE',
    ''
  ]);
});

test('ログ用サニタイズでメールアドレスとURLを除外する', () => {
  const issue = context.makeIssue_(
    'ERROR',
    'E_SYNTHETIC',
    'contact synthetic.user@example.com and https://example.invalid/free-text',
    { sourceSheet: '変更申請', rowNumber: 9, columnName: '企画名' }
  );
  const row = context.logRowFromIssue_(
    {
      executionId: 'synthetic-id',
      settings: { environment: 'staging', releaseId: 'test-release' }
    },
    'test',
    issue,
    { created: 0, updated: 0, skipped: 1, needsReview: 0 }
  );
  const serialized = row.join('|');
  assert.doesNotMatch(serialized, /synthetic\.user@example\.com/);
  assert.doesNotMatch(serialized, /https:\/\//);
  assert.match(serialized, /EMAIL_REDACTED/);
  assert.match(serialized, /URL_REDACTED/);
});
