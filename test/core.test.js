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

test('運スタ企画フォームを通常入力として部署名と固定参加区分で解決する', () => {
  const source = context.APP_CONFIG.sheets.inputs.find(
    (input) => input.name === '26運スタ企画フォーム回答'
  );
  assert.ok(source);
  assert.equal(context.APP_CONFIG.sheets.inputs.length, 4);

  const headers = [
    'メールアドレス',
    '所属局',
    '部署名（チーム、PJなど）',
    '企画名（26字以内）'
  ];
  const resolution = context.resolveHeaders_(
    headers,
    context.APP_CONFIG.inputHeaderCandidates,
    context.requiredInputFieldsForSource_(source)
  );
  assert.deepEqual(plain(resolution.missing), []);

  const batch = {
    values: [headers, ['staff@example.com', '企画局', '合成部署', '合成企画']],
    columns: resolution.columns,
    columnAlternatives: resolution.alternatives,
    source
  };
  const result = context.planMasterUpsert_(masterHeaders, [], [batch], 'TIME');
  assert.equal(result.summary.created, 1);
  assert.equal(masterValue(result.rows[0], '参加企画'), '運営スタッフ企画');
  assert.equal(masterValue(result.rows[0], '所属局'), '企画局');
  assert.equal(masterValue(result.rows[0], '団体名'), '合成部署');
  assert.equal(masterValue(result.rows[0], '企画名'), '合成企画');

  const output = context.buildOutputPlan_(masterHeaders, result.rows, 'participant');
  const bureauIndex = plain(context.APP_CONFIG.participantOutputHeaders).indexOf('所属局');
  assert.equal(output.rows[0][bureauIndex], '企画局');
});

test('参参フォームの実ヘッダーを列番号に依存せず解決する', () => {
  const source = context.APP_CONFIG.sheets.inputs.find(
    (input) => input.name === '26参参フォーム回答'
  );
  const headers = [
    '画像提出（飲食サムネイル画像）',
    '企画名（24字以内）',
    '販売物について',
    '参加企画',
    'メールアドレス',
    '参加団体・参加者名（17字以内推奨・36字以内）',
    '企画名（26字以内）',
    'サムネイル画像提出'
  ];
  const resolution = context.resolveHeaders_(
    headers,
    context.APP_CONFIG.inputHeaderCandidates,
    context.requiredInputFieldsForSource_(source)
  );
  assert.deepEqual(plain(resolution.missing), []);

  const batch = {
    values: [
      headers,
      ['', '', '', '教室企画', 'normal@example.com', '合成参加団体', '一般企画', '一般画像'],
      ['飲食画像', '飲食企画', '合成販売物', '飲食物販売企画', 'food@example.com', '合成参加団体', '', '']
    ],
    columns: resolution.columns,
    columnAlternatives: resolution.alternatives,
    source
  };
  const collected = context.collectInputRecords_([batch]);
  assert.equal(collected.records.length, 2);
  assert.equal(collected.records[0].organization, '合成参加団体');
  assert.equal(collected.records[0].projectName, '一般企画');
  assert.equal(collected.records[0].imageLink, '一般画像');
  assert.equal(collected.records[1].projectName, '飲食企画');
  assert.equal(collected.records[1].salesItems, '合成販売物');
  assert.equal(collected.records[1].imageLink, '飲食画像');
});

test('変更申請2タブは自由記述をマスターへ自動反映しない', () => {
  const reviewSources = plain(context.APP_CONFIG.sheets.inputs).filter(
    (source) => source.syncToMaster === false
  );
  assert.deepEqual(
    reviewSources.map((source) => source.name),
    ['26参参変更申請', '26運スタ企画変更申請']
  );

  const reviewBatch = {
    values: [['タイムスタンプ', '変更内容'], ['TIME', '合成された変更内容']],
    columns: {},
    columnAlternatives: {},
    source: reviewSources[0]
  };
  const collected = context.collectInputRecords_([reviewBatch]);
  assert.equal(collected.records.length, 0);
  assert.equal(collected.skipped, 0);
  assert.equal(collected.issues.length, 0);
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
