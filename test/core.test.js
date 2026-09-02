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
  'buildOutputs.gs',
  'buildBureauOutputs.gs',
  'setup.gs'
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

function makeBureauOutputState(bureau, rows = []) {
  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);
  return {
    bureau,
    values: [headers, ...rows],
    sheet: { getName: () => `26${bureau}` }
  };
}

function makeBureauRecord(overrides = {}) {
  return {
    timestamp: 'TIME',
    bureau: '企画局',
    department: '部署',
    projectName: '差分企画',
    staffName: '担当者',
    introduction: '原典',
    place: '場所',
    scheduleOverride: '日時',
    genres: '',
    mainGenre: '',
    ticketDistribution: '',
    ticketDetails: '',
    guest: '',
    guestName: '',
    guestKana: '',
    guestTitle: '',
    guestPublication: '',
    notes: '',
    beforeChange: '',
    beforeImage: '',
    afterChange: '',
    afterImage: '',
    sourceSheet: '26運スタ企画フォーム回答',
    sourceType: 'STAFF_FORM',
    rowNumber: 2,
    changeStatus: '変更なし',
    lastChangeAt: '',
    matchProjectKeys: ['差分企画'],
    ...overrides
  };
}

function makeGridSheet(initialValues) {
  const grid = initialValues.map((row) => row.slice());
  return {
    grid,
    tabColor: null,
    getLastRow() {
      return grid.length;
    },
    getLastColumn() {
      return grid.reduce((width, row) => Math.max(width, row.length), 0);
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              grid[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
            )
          );
        },
        setValues(values) {
          values.forEach((sourceRow, rowOffset) => {
            const targetRowIndex = row - 1 + rowOffset;
            while (grid.length <= targetRowIndex) grid.push([]);
            sourceRow.forEach((value, columnOffset) => {
              grid[targetRowIndex][column - 1 + columnOffset] = value;
            });
          });
        }
      };
    },
    setTabColor(value) {
      this.tabColor = value;
    }
  };
}

test('ヘッダー順変更と表記ゆれを候補名から解決する', () => {
  const batch = makeBatch(fixture.standard.headers, fixture.standard.rows);
  assert.equal(batch.columns.email, 3);
  assert.equal(batch.columns.participation, 1);
  assert.equal(batch.columns.officialId, 7);
  assert.equal(batch.columns.projectName, 4);
});

test('入力フォームの未使用重複ヘッダーを許容する', () => {
  const headers = [
    'メールアドレス',
    '参加企画',
    '団体名',
    '企画名',
    'サムネイル画像ファイル名',
    'サムネイル画像ファイル名'
  ];
  const resolution = context.resolveHeaders_(
    headers,
    context.APP_CONFIG.inputHeaderCandidates,
    context.APP_CONFIG.requiredInputFields
  );
  assert.deepEqual(plain(resolution.missing), []);
  assert.equal(resolution.columns.email, 0);
  assert.equal(resolution.columns.projectName, 3);
});

test('入力フォームの同名候補列は行ごとの代替候補として保持する', () => {
  const headers = ['メールアドレス', '参加企画', '団体名', '企画名', '企画名'];
  const batch = makeBatch(headers, [
    ['duplicate@example.com', '教室企画', '合成団体', '', '重複列の企画名']
  ]);
  assert.deepEqual(plain(batch.columnAlternatives.projectName), [3, 4]);

  const result = context.planMasterUpsert_(masterHeaders, [], [batch], 'TIME');
  assert.equal(masterValue(result.rows[0], '企画名'), '重複列の企画名');
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

test('参参一覧はメール・参加企画・企画名でフォーム回答を照合して差分更新する', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const existing = new Array(headers.length).fill('');
  existing[headers.indexOf('参加企画')] = '教室企画';
  existing[headers.indexOf('提出状況')] = '未提出';
  existing[headers.indexOf('メールアドレス')] = 'participant@example.com';
  existing[headers.indexOf('企画名・フォーム回答')] = '合成企画';
  existing[headers.indexOf('企画名・確定版')] = '合成企画';
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [['participant@example.com', '教室企画', '合成参加団体', '合成企画']]
  );

  const delta = plain(context.planParticipantTrackerDelta_(
    [headers, existing],
    [batch],
    'TIME'
  ));
  const updated = delta.updates[0].row;

  assert.equal(delta.summary.created, 0);
  assert.equal(delta.summary.updated, 1);
  assert.equal(delta.summary.needsReview, 0);
  assert.equal(updated[headers.indexOf('参加企画')], '教室企画');
  assert.equal(updated[headers.indexOf('メールアドレス')], 'participant@example.com');
  assert.equal(updated[headers.indexOf('提出状況')], '提出済み');
  assert.equal(updated[headers.indexOf('参参名・フォーム回答')], '合成参加団体');
  assert.equal(updated[headers.indexOf('参参名・確定版')], '合成参加団体');
  assert.equal(updated[headers.indexOf('企画名・確定版')], '合成企画');
  assert.equal(updated[headers.indexOf('照合結果')], '一致');
  assert.equal(updated[headers.indexOf('最終同期日時')], 'TIME');
  const changedColumns = delta.updates[0].segments.flatMap((segment) =>
    segment.values.map((_, offset) => segment.startColumn + offset)
  );
  ['参加企画', 'メールアドレス'].forEach((header) => {
    assert.equal(changedColumns.includes(headers.indexOf(header) + 1), false);
  });
});

test('参参一覧の同一内容再同期は更新せず、人が付けた状態を保持する', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const existing = new Array(headers.length).fill('');
  existing[headers.indexOf('参加企画')] = '教室企画';
  existing[headers.indexOf('提出状況')] = 'キャンセル';
  existing[headers.indexOf('メールアドレス')] = 'cancelled@example.com';
  existing[headers.indexOf('参参名・フォーム回答')] = '合成参加団体';
  existing[headers.indexOf('参参名・確定版')] = '合成参加団体';
  existing[headers.indexOf('企画名・フォーム回答')] = '合成企画';
  existing[headers.indexOf('企画名・確定版')] = '合成企画';
  existing[headers.indexOf('照合結果')] = '一致';
  existing[headers.indexOf('最終同期日時')] = 'OLD-TIME';
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [['cancelled@example.com', '教室企画', '合成参加団体', '合成企画']]
  );

  const delta = plain(context.planParticipantTrackerDelta_(
    [headers, existing],
    [batch],
    'NEW-TIME'
  ));

  assert.equal(delta.summary.updated, 0);
  assert.equal(delta.summary.skipped, 1);
  assert.equal(delta.updates.length, 0);
});

test('参参一覧は参加企画ごとに行全体を並べ替え、手動の提出状況を保持する', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const makeRow = (participation, status, email, organization, projectName) => {
    const row = new Array(headers.length).fill('');
    row[index['参加企画']] = participation;
    row[index['提出状況']] = status;
    row[index['メールアドレス']] = email;
    row[index['参参名・確定版']] = organization;
    row[index['企画名・確定版']] = projectName;
    return row;
  };
  const rows = [
    makeRow('普通教室企画', '確認中', 'ordinary-z@example.com', '団体Z', '企画Z'),
    makeRow('ストリート短時間企画', 'キャンセル', 'street@example.com', '団体S', '企画S'),
    makeRow('普通教室企画', '提出済み', 'ordinary-a@example.com', '団体A', '企画A')
  ];
  const statusByEmail = Object.fromEntries(
    rows.map((row) => [row[index['メールアドレス']], row[index['提出状況']]])
  );
  const sortCalls = [];
  const sheet = {
    getLastRow: () => rows.length + 1,
    getLastColumn: () => headers.length,
    getRange(row, column, rowCount, columnCount) {
      assert.deepEqual({ row, column, rowCount, columnCount }, {
        row: 2,
        column: 1,
        rowCount: rows.length,
        columnCount: headers.length
      });
      return {
        sort(specs) {
          sortCalls.push(plain(specs));
          rows.sort((left, right) => {
            for (const spec of specs) {
              const leftValue = String(left[spec.column - 1] ?? '');
              const rightValue = String(right[spec.column - 1] ?? '');
              const compared = leftValue.localeCompare(rightValue, 'ja');
              if (compared !== 0) return spec.ascending ? compared : -compared;
            }
            return 0;
          });
        }
      };
    }
  };

  context.sortParticipantTrackerSheet_(sheet, headers);

  assert.deepEqual(sortCalls, [[
    { column: index['参加企画'] + 1, ascending: true },
    { column: index['企画名・確定版'] + 1, ascending: true },
    { column: index['参参名・確定版'] + 1, ascending: true }
  ]]);
  const ordinaryRows = rows.filter((row) => row[index['参加企画']] === '普通教室企画');
  assert.deepEqual(
    ordinaryRows.map((row) => row[index['企画名・確定版']]),
    ['企画A', '企画Z']
  );
  rows.forEach((row) => {
    assert.equal(
      row[index['提出状況']],
      statusByEmail[row[index['メールアドレス']]]
    );
  });
});

test('参参名はフォーム回答を確定版として既存行と新規行へ反映する', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const existing = new Array(headers.length).fill('');
  existing[headers.indexOf('参加企画')] = '教室企画';
  existing[headers.indexOf('提出状況')] = '未提出';
  existing[headers.indexOf('メールアドレス')] = 'existing@example.com';
  existing[headers.indexOf('企画名・フォーム回答')] = '確定企画';
  existing[headers.indexOf('企画名・確定版')] = '確定企画';
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['existing@example.com', '教室企画', '回答時名称', '確定企画'],
      ['new@example.com', 'ステージ企画', '新規回答団体', '新規回答企画']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_(
    [headers, existing],
    [batch],
    'TIME'
  ));
  const updated = delta.updates[0].row;
  const appended = delta.appends[0];

  assert.equal(delta.summary.created, 1);
  assert.equal(delta.summary.updated, 1);
  assert.equal(delta.summary.needsReview, 0);
  assert.equal(delta.summary.errors, 0);
  assert.equal(updated[headers.indexOf('提出状況')], '提出済み');
  assert.equal(updated[headers.indexOf('参参名・フォーム回答')], '回答時名称');
  assert.equal(updated[headers.indexOf('参参名・確定版')], '回答時名称');
  assert.equal(updated[headers.indexOf('企画名・確定版')], '確定企画');
  assert.equal(updated[headers.indexOf('照合結果')], '一致');
  assert.equal(appended[headers.indexOf('参加企画')], 'ステージ企画');
  assert.equal(appended[headers.indexOf('メールアドレス')], 'new@example.com');
  assert.equal(appended[headers.indexOf('提出状況')], '提出済み');
  assert.equal(appended[headers.indexOf('参参名・確定版')], '新規回答団体');
  assert.equal(appended[headers.indexOf('企画名・確定版')], '新規回答企画');
  assert.equal(appended[headers.indexOf('照合結果')], '一致');
  assert.deepEqual(delta.issues, []);
});

test('参参一覧は同じ提出者の別企画を別行として扱う', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const unsubmitted = new Array(headers.length).fill('');
  unsubmitted[headers.indexOf('参加企画')] = '教室企画';
  unsubmitted[headers.indexOf('メールアドレス')] = 'waiting@example.com';
  unsubmitted[headers.indexOf('企画名・フォーム回答')] = '未提出企画';
  unsubmitted[headers.indexOf('企画名・確定版')] = '未提出企画';
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['multiple@example.com', '教室企画', '同一団体', '企画A'],
      ['multiple@example.com', '教室企画', '同一団体', '企画B']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_(
    [headers, unsubmitted],
    [batch],
    'TIME'
  ));
  const waiting = delta.updates[0].row;

  assert.equal(waiting[headers.indexOf('提出状況')], '未提出');
  assert.equal(waiting[headers.indexOf('照合結果')], '未提出');
  assert.equal(delta.appends.length, 2);
  assert.deepEqual(
    delta.appends.map((row) => row[headers.indexOf('企画名・確定版')]).sort(),
    ['企画A', '企画B']
  );
  assert.equal(delta.appends.every(
    (row) => row[headers.indexOf('提出状況')] === '提出済み'
  ), true);
  assert.equal(delta.summary.needsReview, 0);
  assert.deepEqual(delta.issues, []);
});

test('参参一覧は同じ提出者・参加企画・企画名の複数回答だけを重複にする', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['duplicate@example.com', '教室企画', '重複団体A', '同一企画'],
      ['duplicate@example.com', '教室企画', '重複団体B', '同一企画']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_([headers], [batch], 'TIME'));
  const duplicate = delta.appends[0];

  assert.equal(duplicate[headers.indexOf('提出状況')], '確認中');
  assert.equal(duplicate[headers.indexOf('参参名・フォーム回答')], '');
  assert.equal(duplicate[headers.indexOf('企画名・フォーム回答')], '');
  assert.equal(duplicate[headers.indexOf('照合結果')], 'フォーム回答重複');
  assert.equal(delta.summary.needsReview, 1);
  assert.equal(delta.issues[0].code, 'E_PARTICIPANT_FORM_DUPLICATE');
});

test('参参一覧は同一企画の再送から一意に新しい回答を採用する', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const placeholder = new Array(headers.length).fill('');
  placeholder[headers.indexOf('参加企画')] = '教室企画';
  placeholder[headers.indexOf('提出状況')] = '確認中';
  placeholder[headers.indexOf('メールアドレス')] = 'image-update@example.com';
  placeholder[headers.indexOf('照合結果')] = 'フォーム回答重複';
  const batch = makeBatch(
    ['タイムスタンプ', 'メールアドレス', '参加企画', '団体名', '企画名', '画像リンク'],
    [
      ['2026-08-30T01:00:00+09:00', 'image-update@example.com', '教室企画', '同一団体', '同一企画', 'https://example.com/old'],
      ['2026-08-30T02:00:00+09:00', 'image-update@example.com', '教室企画', '更新団体', '同一企画', 'https://example.com/new']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_(
    [headers, placeholder],
    [batch],
    'TIME'
  ));
  const updated = delta.updates[0].row;

  assert.equal(delta.summary.created, 0);
  assert.equal(delta.summary.updated, 1);
  assert.equal(delta.summary.needsReview, 0);
  assert.equal(delta.summary.errors, 0);
  assert.equal(updated[headers.indexOf('提出状況')], '提出済み');
  assert.equal(updated[headers.indexOf('照合結果')], '一致');
  assert.equal(updated[headers.indexOf('参参名・確定版')], '更新団体');
  assert.equal(updated[headers.indexOf('企画名・確定版')], '同一企画');
  assert.equal(delta.issues[0].code, 'I_RESUBMISSION_LATEST_SELECTED');
  assert.equal(delta.issues[0].level, 'INFO');
});

test('参参一覧は旧回答の日時がヘッダー文字列でも正常日時の再送を採用する', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const placeholder = new Array(headers.length).fill('');
  placeholder[headers.indexOf('参加企画')] = 'ストリート短時間企画';
  placeholder[headers.indexOf('提出状況')] = '確認中';
  placeholder[headers.indexOf('メールアドレス')] = 'header-time@example.com';
  placeholder[headers.indexOf('照合結果')] = 'フォーム回答重複';
  const batch = makeBatch(
    ['タイムスタンプ', 'メールアドレス', '参加企画', '団体名', '企画名', '画像リンク'],
    [
      ['タイムスタンプ', 'header-time@example.com', 'ストリート短時間企画', '旧団体名', '同一　企画', ''],
      ['2026-08-31T15:26:12+09:00', 'header-time@example.com', 'ストリート短時間企画', '更新団体名', '同一 企画', 'https://example.com/new']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_(
    [headers, placeholder],
    [batch],
    'TIME'
  ));
  const updated = delta.updates[0].row;

  assert.equal(delta.summary.needsReview, 0);
  assert.equal(delta.summary.errors, 0);
  assert.equal(updated[headers.indexOf('提出状況')], '提出済み');
  assert.equal(updated[headers.indexOf('参参名・確定版')], '更新団体名');
  assert.equal(updated[headers.indexOf('企画名・確定版')], '同一 企画');
  assert.equal(updated[headers.indexOf('照合結果')], '一致');
  assert.equal(delta.issues[0].code, 'I_RESUBMISSION_HEADER_TIMESTAMP_SELECTED');
});

test('参参一覧は任意の不正日時を含む重複回答を自動採用しない', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const batch = makeBatch(
    ['タイムスタンプ', 'メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['壊れた日時', 'invalid-time@example.com', '教室企画', '旧団体名', '同一企画'],
      ['2026-08-31T16:00:00+09:00', 'invalid-time@example.com', '教室企画', '更新団体名', '同一企画']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_([headers], [batch], 'TIME'));

  assert.equal(delta.summary.needsReview, 1);
  assert.equal(delta.appends[0][headers.indexOf('提出状況')], '確認中');
  assert.equal(delta.appends[0][headers.indexOf('照合結果')], 'フォーム回答重複');
  assert.equal(delta.issues[0].code, 'E_PARTICIPANT_FORM_DUPLICATE');
});

test('参参一覧は最新回答が同時刻なら自動採用しない', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const batch = makeBatch(
    ['タイムスタンプ', 'メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['2026-08-31T16:00:00+09:00', 'same-time@example.com', '教室企画', '団体A', '同一企画'],
      ['2026-08-31T16:00:00+09:00', 'same-time@example.com', '教室企画', '団体B', '同一企画']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_([headers], [batch], 'TIME'));

  assert.equal(delta.summary.needsReview, 1);
  assert.equal(delta.appends[0][headers.indexOf('提出状況')], '確認中');
  assert.equal(delta.appends[0][headers.indexOf('照合結果')], 'フォーム回答重複');
  assert.equal(delta.issues[0].code, 'E_PARTICIPANT_FORM_DUPLICATE');
});

test('旧フォーム回答重複行は1企画目へ再利用し、別企画を追加する', () => {
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);
  const placeholder = new Array(headers.length).fill('');
  placeholder[headers.indexOf('参加企画')] = '飲食物販売企画';
  placeholder[headers.indexOf('提出状況')] = '確認中';
  placeholder[headers.indexOf('メールアドレス')] = 'legacy-multiple@example.com';
  placeholder[headers.indexOf('照合結果')] = 'フォーム回答重複';
  placeholder[headers.indexOf('最終同期日時')] = 'OLD-TIME';
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['legacy-multiple@example.com', '飲食物販売企画', '同一団体', '飲食企画A'],
      ['legacy-multiple@example.com', '飲食物販売企画', '同一団体', '飲食企画B']
    ]
  );

  const delta = plain(context.planParticipantTrackerDelta_(
    [headers, placeholder],
    [batch],
    'TIME'
  ));
  const projects = [delta.updates[0].row, delta.appends[0]].map(
    (row) => row[headers.indexOf('企画名・確定版')]
  ).sort();

  assert.equal(delta.summary.created, 1);
  assert.equal(delta.summary.updated, 1);
  assert.equal(delta.summary.needsReview, 0);
  assert.deepEqual(projects, ['飲食企画A', '飲食企画B']);
  assert.equal(delta.updates[0].row[headers.indexOf('提出状況')], '提出済み');
  assert.equal(delta.appends[0][headers.indexOf('提出状況')], '提出済み');
  assert.deepEqual(delta.issues, []);
});

test('旧参参一覧はマスターからメールを補って提出管理形式へ移行する', () => {
  const oldHeaders = plain(context.APP_CONFIG.previousParticipantOutputHeaders);
  const oldRow = oldHeaders.map((header) => ({
    管理ID: 'TMP-SYNTHETIC',
    参加企画: '教室企画',
    団体名: '移行団体',
    企画名: '移行企画',
    最終更新日時: 'OLD-TIME'
  })[header] || '');
  const masterRow = masterHeaders.map((header) => ({
    管理ID: 'TMP-SYNTHETIC',
    メールアドレス: 'migration@example.com',
    参加企画: '教室企画',
    団体名: '移行団体',
    企画名: '移行企画',
    データソース: '26参参フォーム回答'
  })[header] || '');
  const migrated = plain(context.migratePreviousParticipantRows_(
    [oldHeaders, oldRow],
    [masterHeaders, masterRow]
  ));
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);

  assert.equal(migrated.length, 1);
  assert.equal(migrated[0][headers.indexOf('参加企画')], '教室企画');
  assert.equal(migrated[0][headers.indexOf('メールアドレス')], 'migration@example.com');
  assert.equal(migrated[0][headers.indexOf('参参名・フォーム回答')], '移行団体');
  assert.equal(migrated[0][headers.indexOf('企画名・確定版')], '移行企画');
  assert.equal(migrated[0][headers.indexOf('提出状況')], '提出済み');
  assert.equal(migrated[0][headers.indexOf('照合結果')], '一致');
});

test('申込時列を持つ参参一覧は列を削除し、誤った要確認状態を提出済みへ移行する', () => {
  const oldHeaders = plain(context.APP_CONFIG.previousParticipantTrackerHeaders);
  const oldValues = {
    参加企画: '教室企画',
    提出状況: '確認中',
    メールアドレス: 'tracker-migration@example.com',
    '参参名・参加申し込み時': '',
    '参参名・フォーム回答': '移行回答団体',
    '参参名・確定版': '移行回答団体',
    '企画名・フォーム回答': '移行回答企画',
    '企画名・確定版': '移行回答企画',
    照合結果: '申込情報未登録',
    最終同期日時: 'OLD-TIME'
  };
  const oldRow = oldHeaders.map((header) => oldValues[header] || '');
  const cancelledRow = oldHeaders.map((header) => ({
    ...oldValues,
    提出状況: 'キャンセル',
    メールアドレス: 'cancelled-migration@example.com'
  })[header] || '');
  const migrated = plain(context.migratePreviousParticipantTrackerRows_([
    oldHeaders,
    oldRow,
    cancelledRow
  ]));
  const headers = plain(context.APP_CONFIG.participantOutputHeaders);

  assert.equal(headers.includes('参参名・参加申し込み時'), false);
  assert.equal(migrated.length, 2);
  assert.equal(migrated[0][headers.indexOf('提出状況')], '提出済み');
  assert.equal(migrated[0][headers.indexOf('参参名・確定版')], '移行回答団体');
  assert.equal(migrated[0][headers.indexOf('照合結果')], '一致');
  assert.equal(migrated[1][headers.indexOf('提出状況')], 'キャンセル');
  assert.equal(migrated[1][headers.indexOf('照合結果')], '一致');
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

test('企画名で一意に照合した変更申請を企画情報へ自動反映する', () => {
  const staffFormSource = context.APP_CONFIG.sheets.inputs.find(
    (source) => source.type === 'STAFF_FORM'
  );
  const staffChangeSource = context.APP_CONFIG.sheets.inputs.find(
    (source) => source.type === 'STAFF_CHANGE'
  );
  const normalHeaders = [
    'タイムスタンプ',
    '担当者名',
    '所属局',
    '部署名（チーム、PJなど）',
    '企画名（26字以内）',
    '企画紹介文（75字以内）',
    '備考'
  ];
  const changeHeaders = [
    'タイムスタンプ',
    '担当者名',
    '所属局',
    '部署名（チーム、PJなど）',
    '企画名',
    '変更前',
    '変更後',
    '備考'
  ];
  const plan = context.buildBureauOutputPlan_([
    {
      values: [
        normalHeaders,
        ['TIME-1', '合成担当者', '企画局', '合成部署', '合成企画', '変更前の紹介文', '通常備考']
      ],
      source: staffFormSource
    },
    {
      values: [
        changeHeaders,
        [
          'TIME-2',
          '合成担当者',
          '企画局',
          '合成部署',
          '合成企画',
          '企画紹介文：「変更前の紹介文」',
          '企画紹介文：「変更後の紹介文」',
          '変更備考'
        ]
      ],
      source: staffChangeSource
    }
  ]);

  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);
  const introIndex = headers.indexOf('企画紹介文');
  const statusIndex = headers.indexOf('変更反映状況');
  const changedAtIndex = headers.indexOf('最終変更申請日時');
  assert.equal(plan.rowsByBureau['企画局'].length, 1);
  assert.equal(plan.rowsByBureau['企画局'][0][introIndex], '変更後の紹介文');
  assert.equal(plan.rowsByBureau['企画局'][0][statusIndex], '自動反映済み');
  assert.equal(plan.rowsByBureau['企画局'][0][changedAtIndex], 'TIME-2');
  assert.equal(plan.appliedChanges, 1);
  assert.equal(plan.reviews.length, 0);
  assert.equal(plan.issues.length, 0);
});

test('曖昧または不正な変更申請は上書きせず要手動確認へ回す', () => {
  const staffFormSource = context.APP_CONFIG.sheets.inputs.find(
    (source) => source.type === 'STAFF_FORM'
  );
  const staffChangeSource = context.APP_CONFIG.sheets.inputs.find(
    (source) => source.type === 'STAFF_CHANGE'
  );
  const normalHeaders = ['タイムスタンプ', '担当者名', '所属局', '部署名', '企画名', '企画場所（正式名称）'];
  const changeHeaders = ['タイムスタンプ', '担当者名', '所属局', '部署名', '企画名', '変更前', '変更後'];
  const plan = context.buildBureauOutputPlan_([
    {
      values: [normalHeaders, ['TIME-1', '担当者', '開発局', '開発部署', '一意な企画', '旧場所']],
      source: staffFormSource
    },
    {
      values: [
        changeHeaders,
        ['TIME-2', '担当者', '開発局', '開発部署', '存在しない企画', '企画場所：「旧場所」', '企画場所：「新場所」'],
        ['TIME-3', '担当者', '開発局', '開発部署', '一意な企画', '自由記述だけ', '企画場所：「新場所」'],
        ['TIME-4', '担当者', '開発局', '開発部署', '一意な企画', '企画場所：「別の旧場所」', '企画場所：「新場所」']
      ],
      source: staffChangeSource
    }
  ]);

  assert.equal(plan.appliedChanges, 0);
  assert.equal(plan.reviews.length, 3);
  assert.deepEqual(
    plain(plan.issues).map((issue) => issue.code),
    ['E_CHANGE_PROJECT_NOT_FOUND', 'E_CHANGE_FORMAT_INVALID', 'E_CHANGE_BEFORE_MISMATCH']
  );
  assert.equal(plan.rowsByBureau['開発局'].length, 1);
  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);
  assert.equal(
    plan.rowsByBureau['開発局'][0][headers.indexOf('企画場所')],
    '旧場所'
  );
  assert.equal(
    plan.rowsByBureau['開発局'][0][headers.indexOf('変更反映状況')],
    '要手動確認'
  );
});

test('同じ企画名の通常回答が複数ある変更申請は自動反映しない', () => {
  const staffFormSource = context.APP_CONFIG.sheets.inputs.find(
    (source) => source.type === 'STAFF_FORM'
  );
  const staffChangeSource = context.APP_CONFIG.sheets.inputs.find(
    (source) => source.type === 'STAFF_CHANGE'
  );
  const normalHeaders = ['タイムスタンプ', '担当者名', '所属局', '部署名', '企画名', '企画場所（正式名称）'];
  const changeHeaders = ['タイムスタンプ', '担当者名', '所属局', '部署名', '企画名', '変更前', '変更後'];
  const plan = context.buildBureauOutputPlan_([
    {
      values: [
        normalHeaders,
        ['TIME-1', '担当者A', '企画局', '部署A', '重複企画', '場所A'],
        ['TIME-2', '担当者B', '企画局', '部署B', '重複企画', '場所B']
      ],
      source: staffFormSource
    },
    {
      values: [
        changeHeaders,
        ['TIME-3', '担当者A', '企画局', '部署A', '重複企画', '企画場所：「場所A」', '企画場所：「新場所」']
      ],
      source: staffChangeSource
    }
  ]);

  assert.equal(plan.appliedChanges, 0);
  assert.equal(plan.reviews.length, 1);
  assert.equal(plain(plan.issues)[0].code, 'E_CHANGE_PROJECT_AMBIGUOUS');
  const placeIndex = plain(context.APP_CONFIG.bureauOutputHeaders).indexOf('企画場所');
  assert.deepEqual(
    plain(plan.rowsByBureau['企画局']).map((row) => row[placeIndex]),
    ['場所A', '場所B']
  );
});

test('旧12列から手動6列を初期化して18列へ移行する', () => {
  const previousHeaders = plain(context.APP_CONFIG.previousBureauOutputHeaders);
  const previousRow = previousHeaders.map((header) => ({
    企画名: '移行企画',
    企画紹介文: '原典文章',
    担当者名: '担当者'
  })[header] || '');
  const migrated = context.migratePreviousBureauRows_([previousHeaders, previousRow]);
  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);

  assert.equal(migrated.length, 1);
  assert.equal(migrated[0][headers.indexOf('内部向け企画・取り組み名')], '移行企画');
  assert.equal(migrated[0][headers.indexOf('掲載文字情報')], '原典文章');
  assert.equal(migrated[0][headers.indexOf('当媒チェック')], '未確認');
  assert.equal(migrated[0][headers.indexOf('校閲チェック')], '未確認');
});

test('局別18列は前年の業務順に並び、旧順序から値を保持して移行する', () => {
  const expected = [
    'ページ名',
    '内部向け企画・取り組み名',
    '企画名',
    '掲載文字情報',
    '担当者名',
    '部署名',
    '掲載媒体',
    '当媒チェック',
    '校閲チェック',
    '変更反映状況',
    '企画日時',
    '企画場所',
    '企画紹介文',
    '企画ジャンル',
    '整理券情報',
    'ゲスト情報',
    '備考',
    '最終変更申請日時'
  ];
  const current = plain(context.APP_CONFIG.bureauOutputHeaders);
  assert.deepEqual(current, expected);

  const oldOrder = [
    '企画名',
    '内部向け企画・取り組み名',
    '企画紹介文',
    '掲載文字情報',
    'ページ名',
    '掲載媒体',
    '担当者名',
    '部署名',
    '企画場所',
    '企画日時',
    '企画ジャンル',
    '整理券情報',
    'ゲスト情報',
    '備考',
    '当媒チェック',
    '校閲チェック',
    '変更反映状況',
    '最終変更申請日時'
  ];
  const valuesByHeader = Object.fromEntries(oldOrder.map((header) => [header, '値:' + header]));
  const migrated = plain(context.migratePreviousBureauRows_([
    oldOrder,
    oldOrder.map((header) => valuesByHeader[header])
  ]));

  assert.equal(context.headerSetMatches_(oldOrder, current), true);
  assert.equal(context.headerOrderMatches_(oldOrder, current), false);
  assert.deepEqual(migrated[0], current.map((header) => valuesByHeader[header]));
});

test('局別タブの入力規則と固定列を現在のヘッダー名から設定する', () => {
  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);
  const headerIndex = context.buildHeaderIndex_(headers);
  const operations = {
    cleared: [],
    validations: [],
    widths: [],
    frozenRows: 0,
    frozenColumns: 0
  };
  context.SpreadsheetApp = {
    newDataValidation() {
      const definition = { values: [], showDropdown: false, allowInvalid: true };
      return {
        requireValueInList(values, showDropdown) {
          definition.values = plain(values);
          definition.showDropdown = showDropdown;
          return this;
        },
        setAllowInvalid(value) {
          definition.allowInvalid = value;
          return this;
        },
        build() {
          return { ...definition };
        }
      };
    }
  };
  const sheet = {
    getMaxRows: () => 1000,
    getMaxColumns: () => 26,
    getRange(row, column, rowCount, columnCount) {
      return {
        clearDataValidations() {
          operations.cleared.push({ row, column, rowCount, columnCount });
        },
        setDataValidation(rule) {
          operations.validations.push({ row, column, rowCount, columnCount, rule });
        }
      };
    },
    setFrozenRows(value) {
      operations.frozenRows = value;
    },
    setFrozenColumns(value) {
      operations.frozenColumns = value;
    },
    setColumnWidth(column, width) {
      operations.widths.push({ column, width });
    }
  };

  context.applyBureauSheetPresentation_(sheet, headerIndex);

  assert.deepEqual(operations.cleared, [
    { row: 2, column: 1, rowCount: 999, columnCount: 26 }
  ]);
  assert.deepEqual(
    operations.validations.map((entry) => ({
      header: headers[entry.column - 1],
      values: entry.rule.values,
      allowInvalid: entry.rule.allowInvalid
    })),
    [
      {
        header: '掲載媒体',
        values: ['パンフレット', 'Webサイト', 'パンフ／Web'],
        allowInvalid: false
      },
      {
        header: '当媒チェック',
        values: ['未確認', '確認中', '確認済み', '修正必要'],
        allowInvalid: false
      },
      {
        header: '校閲チェック',
        values: ['未確認', '確認中', '確認済み', '修正必要'],
        allowInvalid: false
      }
    ]
  );
  assert.equal(operations.validations.some((entry) => ['整理券情報', 'ゲスト情報'].includes(headers[entry.column - 1])), false);
  assert.equal(operations.frozenRows, 1);
  assert.equal(operations.frozenColumns, headers.indexOf('掲載媒体') + 1);
  assert.equal(operations.widths.length, headers.length);
  assert.equal(
    operations.widths.find((entry) => headers[entry.column - 1] === '企画紹介文').width,
    260
  );
});

test('差分更新は手動列を保持し、原典変更時だけ確認状態を戻す', () => {
  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);
  const oldRecord = makeBureauRecord({ introduction: '旧原典' });
  const existingRow = plain(context.mergeBureauRecordWithManualRow_(oldRecord, null, null, headers));
  existingRow[headers.indexOf('掲載文字情報')] = '編集済み掲載文';
  existingRow[headers.indexOf('ページ名')] = '企画紹介ページ';
  existingRow[headers.indexOf('掲載媒体')] = 'Web';
  existingRow[headers.indexOf('当媒チェック')] = '確認済み';
  existingRow[headers.indexOf('校閲チェック')] = '確認済み';
  const output = makeBureauOutputState('企画局', [existingRow]);
  const newRecord = makeBureauRecord({ introduction: '新原典' });
  const delta = context.planBureauDelta_([output], [newRecord]);
  const updatedRow = plain(delta.updates[0].row);

  assert.equal(delta.created, 0);
  assert.equal(delta.updated, 1);
  assert.equal(delta.deletes.length, 0);
  assert.equal(updatedRow[headers.indexOf('企画紹介文')], '新原典');
  assert.equal(updatedRow[headers.indexOf('掲載文字情報')], '編集済み掲載文');
  assert.equal(updatedRow[headers.indexOf('ページ名')], '企画紹介ページ');
  assert.equal(updatedRow[headers.indexOf('掲載媒体')], 'Web');
  assert.equal(updatedRow[headers.indexOf('当媒チェック')], '未確認');
  assert.equal(updatedRow[headers.indexOf('校閲チェック')], '未確認');
  const changedColumns = plain(delta.updates[0].segments).flatMap((segment) =>
    segment.values.map((_, offset) => segment.startColumn + offset)
  );
  assert.equal(changedColumns.includes(headers.indexOf('掲載文字情報') + 1), false);
  assert.equal(changedColumns.includes(headers.indexOf('ページ名') + 1), false);
  assert.equal(changedColumns.includes(headers.indexOf('掲載媒体') + 1), false);
  assert.equal(changedColumns.includes(headers.indexOf('企画紹介文') + 1), true);
});

test('変更申請から掲載文字情報を自動上書きしない', () => {
  const parsed = context.parseStructuredChange_('掲載文字情報：「自動上書きしない文章」');
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /未対応/);
});

test('所属局の差分更新は手動列を保持して移動し、元行だけを削除対象にする', () => {
  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);
  const oldRecord = makeBureauRecord();
  const existingRow = plain(context.mergeBureauRecordWithManualRow_(oldRecord, null, null, headers));
  existingRow[headers.indexOf('内部向け企画・取り組み名')] = '内部名称';
  existingRow[headers.indexOf('掲載文字情報')] = '掲載文';
  existingRow[headers.indexOf('ページ名')] = 'ページ';
  const sourceOutput = makeBureauOutputState('企画局', [existingRow]);
  const targetOutput = makeBureauOutputState('開発局');
  const movedRecord = makeBureauRecord({ bureau: '開発局' });
  const delta = context.planBureauDelta_([sourceOutput, targetOutput], [movedRecord]);
  const movedRow = plain(delta.appends[0].row);

  assert.equal(delta.created, 0);
  assert.equal(delta.updated, 1);
  assert.equal(delta.deletes.length, 1);
  assert.equal(delta.deletes[0].rowNumber, 2);
  assert.equal(movedRow[headers.indexOf('内部向け企画・取り組み名')], '内部名称');
  assert.equal(movedRow[headers.indexOf('掲載文字情報')], '掲載文');
  assert.equal(movedRow[headers.indexOf('ページ名')], 'ページ');
});

test('入力と照合できない既存行は削除せず要手動確認へ残す', () => {
  const headers = plain(context.APP_CONFIG.bureauOutputHeaders);
  const orphanRow = plain(context.mergeBureauRecordWithManualRow_(
    makeBureauRecord({ projectName: '孤立企画', matchProjectKeys: ['孤立企画'] }),
    null,
    null,
    headers
  ));
  const delta = context.planBureauDelta_([makeBureauOutputState('企画局', [orphanRow])], []);

  assert.equal(delta.deletes.length, 0);
  assert.equal(delta.updates.length, 0);
  assert.equal(delta.appends.length, 0);
  assert.equal(delta.reviews.length, 1);
  assert.equal(delta.issues[0].code, 'E_BUREAU_ORPHAN_PRESERVED');
});

test('要手動確認は対応済みを除いて未対応件数を数える', () => {
  const headers = plain(context.APP_CONFIG.manualReviewHeaders);
  const statusIndex = headers.indexOf('対応状況');
  const pending = new Array(headers.length).fill('');
  const resolved = new Array(headers.length).fill('');
  pending[0] = 'source:2';
  pending[statusIndex] = '未対応';
  resolved[0] = 'source:3';
  resolved[statusIndex] = '対応済み';
  assert.equal(context.pendingManualReviewCountFromValues_([headers, pending, resolved]), 1);
});

test('要手動確認も差分更新し、対応状況と過去行を保持する', () => {
  const headers = plain(context.APP_CONFIG.manualReviewHeaders);
  const existing = new Array(headers.length).fill('');
  existing[headers.indexOf('確認キー')] = 'source:2';
  existing[headers.indexOf('要確認理由')] = '旧理由';
  existing[headers.indexOf('対応状況')] = '対応済み';
  const historical = new Array(headers.length).fill('');
  historical[headers.indexOf('確認キー')] = 'source:1';
  historical[headers.indexOf('対応状況')] = '対応済み';
  const sheet = makeGridSheet([headers, existing, historical]);
  const reviewSheet = { sheet, values: sheet.grid };

  const pending = context.syncManualReviewData_(reviewSheet, [
    {
      reviewKey: 'source:2',
      timestamp: 'TIME',
      bureau: '企画局',
      department: '部署',
      projectName: '企画',
      staffName: '担当者',
      reason: '新理由',
      beforeChange: '',
      afterChange: '',
      beforeImage: '',
      afterImage: '',
      sourceSheet: 'source',
      rowNumber: 2
    },
    {
      reviewKey: 'source:3',
      timestamp: 'TIME',
      bureau: '企画局',
      department: '部署',
      projectName: '新規企画',
      staffName: '担当者',
      reason: '新規理由',
      beforeChange: '',
      afterChange: '',
      beforeImage: '',
      afterImage: '',
      sourceSheet: 'source',
      rowNumber: 3
    }
  ]);

  assert.equal(sheet.grid[1][headers.indexOf('要確認理由')], '新理由');
  assert.equal(sheet.grid[1][headers.indexOf('対応状況')], '対応済み');
  assert.equal(sheet.grid[2][headers.indexOf('確認キー')], 'source:1');
  assert.equal(sheet.grid[3][headers.indexOf('確認キー')], 'source:3');
  assert.equal(sheet.grid[3][headers.indexOf('対応状況')], '未対応');
  assert.equal(pending, 1);
});

test('局別タブは9選択肢に対応し、不明な所属局の行だけをスキップする', () => {
  const staffFormSource = context.APP_CONFIG.sheets.inputs.find(
    (source) => source.type === 'STAFF_FORM'
  );
  assert.deepEqual(
    plain(context.APP_CONFIG.sheets.bureauOutputs).map((output) => output.bureau),
    ['会場整備局', '参加対応局', '開発局', '企画局', '広報制作局', '渉外局', '総務局', '財務局', '超局PJ']
  );
  assert.equal(
    plain(context.APP_CONFIG.sheets.bureauOutputs).some((output) => output.name === 'はじめに'),
    false
  );

  const plan = context.buildBureauOutputPlan_([{
    values: [
      ['タイムスタンプ', '担当者名', '所属局', '部署名', '企画名'],
      ['TIME', '合成担当者', '未登録局', '合成部署', '合成企画']
    ],
    source: staffFormSource
  }]);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.issues.length, 1);
  assert.equal(plan.issues[0].code, 'E_BUREAU_VALUE_INVALID');
  assert.equal(plan.issues[0].rowNumber, 2);
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

test('Unicode・trim・メール小文字化・企画名空白で暫定キーを正規化する', () => {
  const left = context.buildProvisionalKey_(
    ' ＴＥＳＴ＠ＥＸＡＭＰＬＥ．ＣＯＭ ',
    ' 屋台 ',
    ' 合成　Project '
  );
  const right = context.buildProvisionalKey_('test@example.com', '屋台', '合成 project');
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
    ['collision@example.com', '教室企画', '合成団体1', '同一企画'],
    ['collision@example.com', '教室企画', '合成団体2', '同一企画']
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

test('一意に新しい再送は最新回答を採用して旧衝突を解除する', () => {
  const existing = masterHeaders.map((header) => ({
    管理ID: 'TMP-IMAGEUPDATE01',
    メールアドレス: 'image-master@example.com',
    参加企画: '教室企画',
    団体名: '同一団体',
    企画名: '同一企画',
    画像リンク: 'https://example.com/old',
    データソース: '26参参フォーム回答',
    同期ステータス: '要確認',
    最終更新日時: 'OLD-TIME',
    要確認: 'TRUE',
    要確認理由: '暫定キー衝突: 同一キーの複数回答を自動統合していません'
  })[header] || '');
  const batch = makeBatch(
    ['タイムスタンプ', 'メールアドレス', '参加企画', '団体名', '企画名', '画像リンク'],
    [
      ['2026-08-30T01:00:00+09:00', 'image-master@example.com', '教室企画', '同一団体', '同一企画', 'https://example.com/old'],
      ['2026-08-30T02:00:00+09:00', 'image-master@example.com', '教室企画', '更新団体', '同一企画', 'https://example.com/new']
    ]
  );
  const result = plain(context.planMasterUpsert_(masterHeaders, [existing], [batch], 'TIME'));

  assert.equal(result.rows.length, 1);
  assert.equal(result.summary.created, 0);
  assert.equal(result.summary.updated, 1);
  assert.equal(result.summary.needsReview, 0);
  assert.equal(result.summary.errors, 0);
  assert.equal(masterValue(result.rows[0], '団体名'), '更新団体');
  assert.equal(masterValue(result.rows[0], '画像リンク'), 'https://example.com/new');
  assert.equal(masterValue(result.rows[0], '同期ステータス'), '同期済み');
  assert.equal(masterValue(result.rows[0], '要確認'), 'FALSE');
  assert.equal(masterValue(result.rows[0], '要確認理由'), '');
  assert.equal(result.issues[0].code, 'I_RESUBMISSION_LATEST_SELECTED');
  assert.equal(result.issues[0].level, 'INFO');
});

test('マスターも同じ提出者の別企画を別行として同期する', () => {
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['multiple-master@example.com', '教室企画', '同一団体', '企画A'],
      ['multiple-master@example.com', '教室企画', '同一団体', '企画B']
    ]
  );
  const result = context.planMasterUpsert_(masterHeaders, [], [batch], 'TIME');

  assert.equal(result.rows.length, 2);
  assert.equal(result.summary.created, 2);
  assert.equal(result.summary.needsReview, 0);
  assert.equal(result.summary.errors, 0);
  assert.deepEqual(
    result.rows.map((row) => masterValue(row, '企画名')).sort(),
    ['企画A', '企画B']
  );
});

test('旧暫定キー衝突は企画名別に解消し、既存行を再利用する', () => {
  const existing = masterHeaders.map((header) => ({
    管理ID: 'TMP-LEGACYKEY0001',
    メールアドレス: 'legacy-master@example.com',
    参加企画: '飲食物販売企画',
    団体名: '同一団体',
    企画名: '飲食企画A',
    データソース: '26参参フォーム回答',
    同期ステータス: '要確認',
    最終更新日時: 'OLD-TIME',
    要確認: 'TRUE',
    要確認理由: '暫定キー衝突: 同一キーの複数回答を自動統合していません'
  })[header] || '');
  const batch = makeBatch(
    ['メールアドレス', '参加企画', '団体名', '企画名'],
    [
      ['legacy-master@example.com', '飲食物販売企画', '同一団体', '飲食企画A'],
      ['legacy-master@example.com', '飲食物販売企画', '同一団体', '飲食企画B']
    ]
  );
  const result = context.planMasterUpsert_(masterHeaders, [existing], [batch], 'TIME');

  assert.equal(result.rows.length, 2);
  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.updated, 1);
  assert.equal(result.summary.needsReview, 0);
  assert.equal(masterValue(result.rows[0], '管理ID'), 'TMP-LEGACYKEY0001');
  assert.equal(masterValue(result.rows[0], '同期ステータス'), '同期済み');
  assert.equal(masterValue(result.rows[0], '要確認'), 'FALSE');
  assert.equal(masterValue(result.rows[0], '要確認理由'), '');
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
