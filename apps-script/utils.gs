function normalizeText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').trim();
}

function normalizeEmail_(value) {
  return normalizeText_(value).toLowerCase();
}

function normalizeHeader_(value) {
  return normalizeText_(value).replace(/[\s\u3000]+/g, '').toLowerCase();
}

function normalizeProjectNameKey_(value) {
  return normalizeText_(value).replace(/[\s\u3000]+/g, ' ').toLowerCase();
}

function stringifyCell_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, APP_CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return normalizeText_(value);
}

function isBlankRow_(row) {
  return row.every(function (value) {
    return normalizeText_(value) === '';
  });
}

function isPotentialFormula_(value) {
  return normalizeText_(value).indexOf('=') === 0;
}

function hashString_(value) {
  var hash = 2166136261;
  for (var i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0');
}

function buildProvisionalKey_(email, participation, projectName) {
  var normalizedEmail = normalizeEmail_(email);
  var normalizedParticipation = normalizeText_(participation);
  var normalizedProjectName = normalizeProjectNameKey_(projectName);
  if (!normalizedEmail || !normalizedParticipation || !normalizedProjectName) return '';
  return 'provisional:' + normalizedEmail + '|' + normalizedParticipation + '|' + normalizedProjectName;
}

function buildOfficialKey_(officialId) {
  var normalized = normalizeText_(officialId);
  return normalized ? 'official:' + normalized : '';
}

function provisionalManagementId_(key) {
  return APP_CONFIG.provisionalIdPrefix + hashString_(key + '|A') + hashString_(key + '|B');
}

function newExecutionId_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function makeAppError_(code, message, details) {
  var error = new Error(message);
  error.code = code;
  error.details = details || {};
  return error;
}

function sanitizeLogText_(value) {
  var text = normalizeText_(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
    .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]');
  return text.slice(0, 240);
}

function acquireScriptLock_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP_CONFIG.lockTimeoutMs)) {
    throw makeAppError_('E_LOCK_TIMEOUT', '別の処理が実行中です。時間を置いて再実行してください。');
  }
  return lock;
}

function getBoundSpreadsheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw makeAppError_('E_NOT_CONTAINER_BOUND', 'バウンド先スプレッドシートを取得できません。');
  }
  return spreadsheet;
}

function withScriptLock_(callback) {
  var lock = acquireScriptLock_();
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function confirmProductionAction_(actionLabel) {
  var settings = getScriptSettings_();
  if (settings.environment !== 'production') return true;
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'production確認',
    actionLabel + 'をproductionで実行します。続行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  return response === ui.Button.OK;
}

function showSummary_(title, summary) {
  var lines = [
    '実行ID: ' + (summary.executionId || '-'),
    '新規: ' + (summary.created || 0),
    '更新: ' + (summary.updated || 0),
    'スキップ: ' + (summary.skipped || 0),
    '要確認: ' + (summary.needsReview || 0),
    'エラー: ' + (summary.errors || 0)
  ];
  SpreadsheetApp.getUi().alert(title, lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function columnLetter_(columnNumber) {
  var letter = '';
  var value = columnNumber;
  while (value > 0) {
    var remainder = (value - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    value = Math.floor((value - 1) / 26);
  }
  return letter;
}
