function makeIssue_(level, code, message, context) {
  var safeContext = context || {};
  return {
    level: level,
    code: code,
    sourceSheet: normalizeText_(safeContext.sourceSheet),
    rowNumber: Number(safeContext.rowNumber) || '',
    columnName: normalizeText_(safeContext.columnName),
    message: sanitizeLogText_(message)
  };
}

function logRowFromIssue_(execution, operation, issue, summary, logHeaders) {
  var values = {
    '実行id': execution.executionId,
    '記録日時': nowIso_(),
    '環境': execution.settings.environment,
    '処理': operation,
    'レベル': issue.level,
    'エラーコード': issue.code,
    '入力タブ': issue.sourceSheet,
    '行番号': issue.rowNumber,
    '列名': issue.columnName,
    '説明': sanitizeLogText_(issue.message),
    '新規件数': summary.created || 0,
    '更新件数': summary.updated || 0,
    'スキップ件数': summary.skipped || 0,
    '要確認件数': summary.needsReview || 0,
    'リリースid': execution.settings.releaseId
  };
  return (logHeaders || APP_CONFIG.logHeaders).map(function (header) {
    var normalizedHeader = normalizeHeader_(header);
    return Object.prototype.hasOwnProperty.call(values, normalizedHeader)
      ? values[normalizedHeader]
      : '';
  });
}

function appendProcessLog_(preflight, executionId, operation, summary, issues) {
  var execution = { executionId: executionId, settings: preflight.settings };
  var sheet = preflight.log ? preflight.log.sheet : requireSheet_(preflight.spreadsheet, APP_CONFIG.sheets.log);
  var logHeaders = preflight.log
    ? preflight.log.values[0]
    : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rows = (issues || []).map(function (issue) {
    return logRowFromIssue_(execution, operation, issue, summary, logHeaders);
  });
  rows.push(
    logRowFromIssue_(
      execution,
      operation,
      makeIssue_(summary.errors > 0 ? 'WARN' : 'INFO', 'SUMMARY', '処理サマリー', {}),
      summary,
      logHeaders
    )
  );
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, logHeaders.length).setValues(rows);
}

function safeAppendFailureLog_(operation, executionId, error) {
  try {
    var preflight = preflightInternal_({ inputs: false, master: false, outputs: false, log: true });
    var summary = { created: 0, updated: 0, skipped: 0, needsReview: 0, errors: 1 };
    appendProcessLog_(preflight, executionId, operation, summary, [
      makeIssue_(
        'ERROR',
        error.code || 'E_UNEXPECTED',
        error.message || '予期しないエラー',
        {
          sourceSheet: error.details && error.details.sheetName,
          rowNumber: error.details && error.details.rowNumber,
          columnName: error.details && error.details.missing
            ? error.details.missing.join(',')
            : ''
        }
      )
    ]);
  } catch {
    console.error('Failure log could not be written.');
  }
}
