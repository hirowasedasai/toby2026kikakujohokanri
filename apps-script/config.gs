/** Central configuration. Keep sheet names, headers, aliases, and policy here. */
var APP_CONFIG = Object.freeze({
  appName: '当日情報媒体AI',
  timeZone: 'Asia/Tokyo',
  lockTimeoutMs: 30000,
  sheets: Object.freeze({
    inputs: Object.freeze([
      Object.freeze({ name: '26参参フォーム回答', type: 'FORM', priority: 10 }),
      Object.freeze({ name: '提出遅延フォーム回答', type: 'LATE', priority: 20 }),
      Object.freeze({ name: '変更申請', type: 'CHANGE', priority: 30 })
    ]),
    master: '26掲載情報マスター',
    participantOutput: '参参一覧',
    foodOutput: '屋台情報まとめ',
    log: '26処理ログ'
  }),
  properties: Object.freeze({
    environment: 'APP_ENV',
    spreadsheetId: 'EXPECTED_SPREADSHEET_ID',
    releaseId: 'RELEASE_ID',
    scheduledSync: 'ENABLE_SCHEDULED_SYNC'
  }),
  masterHeaders: Object.freeze([
    '管理ID',
    'メールアドレス',
    '参加企画',
    '団体名',
    '企画名',
    '販売物',
    '画像リンク',
    'データソース',
    '同期ステータス',
    '最終更新日時',
    '要確認',
    '要確認理由'
  ]),
  participantOutputHeaders: Object.freeze([
    '管理ID',
    '参加企画',
    '団体名',
    '企画名',
    '販売物',
    '画像リンク',
    '最終更新日時'
  ]),
  foodOutputHeaders: Object.freeze([
    '管理ID',
    '参加企画',
    '団体名',
    '企画名',
    '販売物',
    '画像リンク',
    '要確認'
  ]),
  logHeaders: Object.freeze([
    '実行ID',
    '記録日時',
    '環境',
    '処理',
    'レベル',
    'エラーコード',
    '入力タブ',
    '行番号',
    '列名',
    '説明',
    '新規件数',
    '更新件数',
    'スキップ件数',
    '要確認件数',
    'リリースID'
  ]),
  inputHeaderCandidates: Object.freeze({
    officialId: Object.freeze(['企画ID', '正式企画ID', '管理ID', '企画番号']),
    email: Object.freeze(['メールアドレス', 'メール', 'Email', 'E-mailアドレス']),
    participation: Object.freeze(['参加企画', '参加形態', '企画区分', '部門']),
    organization: Object.freeze(['団体名', '参加団体名', 'サークル名']),
    projectName: Object.freeze(['変更後企画名', '企画名', '掲載企画名', '催事名']),
    salesItems: Object.freeze(['変更後販売物', '販売物', '販売品目', '販売内容', '飲食物']),
    imageLink: Object.freeze(['変更後画像リンク', '画像リンク', '画像URL', '画像', '掲載画像']),
    timestamp: Object.freeze(['タイムスタンプ', '回答日時', '申請日時', '送信日時'])
  }),
  requiredInputFields: Object.freeze([
    'email',
    'participation',
    'organization',
    'projectName'
  ]),
  foodRule: Object.freeze({
    exactParticipationValues: Object.freeze([
      '飲食物販売企画',
      '飲食販売企画',
      '模擬店',
      '屋台'
    ]),
    participationKeywords: Object.freeze(['飲食', '食品', '模擬店', '屋台']),
    requireSalesItem: true
  }),
  provisionalIdPrefix: 'TMP-',
  triggerHandlers: Object.freeze(['handleFormSubmit_', 'scheduledSyncMaster_'])
});
