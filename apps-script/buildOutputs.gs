function isReviewRequired_(value) {
  var normalized = normalizeText_(value).toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '要確認' || normalized === '1';
}

function isFoodRecord_(record) {
  var participation = normalizeText_(record.participation);
  var exact = APP_CONFIG.foodRule.exactParticipationValues.some(function (value) {
    return participation === normalizeText_(value);
  });
  var keyword = APP_CONFIG.foodRule.participationKeywords.some(function (value) {
    return participation.indexOf(normalizeText_(value)) >= 0;
  });
  var categoryMatches = exact || keyword;
  return categoryMatches && (!APP_CONFIG.foodRule.requireSalesItem || Boolean(normalizeText_(record.salesItems)));
}

function outputRecordFromMaster_(row, index) {
  return {
    managementId: normalizeText_(getMasterCell_(row, index, '管理ID')),
    participation: normalizeText_(getMasterCell_(row, index, '参加企画')),
    organization: normalizeText_(getMasterCell_(row, index, '団体名')),
    projectName: normalizeText_(getMasterCell_(row, index, '企画名')),
    salesItems: normalizeText_(getMasterCell_(row, index, '販売物')),
    imageLink: normalizeText_(getMasterCell_(row, index, '画像リンク')),
    status: normalizeText_(getMasterCell_(row, index, '同期ステータス')),
    updatedAt: getMasterCell_(row, index, '最終更新日時'),
    needsReview: getMasterCell_(row, index, '要確認')
  };
}

function validateOutputRecord_(record, rowNumber) {
  var missing = [];
  if (!record.managementId) missing.push('管理ID');
  if (!record.participation) missing.push('参加企画');
  if (!record.organization) missing.push('団体名');
  if (!record.projectName) missing.push('企画名');
  if (missing.length > 0) {
    return makeIssue_('ERROR', 'E_MASTER_ROW_INVALID', '出力に必要なマスター値が空です。', {
      sourceSheet: APP_CONFIG.sheets.master,
      rowNumber: rowNumber,
      columnName: missing.join(',')
    });
  }
  return null;
}

function outputValueByHeader_(record, header) {
  var values = {
    '管理id': record.managementId,
    '参加企画': record.participation,
    '団体名': record.organization,
    '企画名': record.projectName,
    '販売物': record.salesItems,
    '画像リンク': record.imageLink,
    '同期ステータス': record.status,
    '最終更新日時': record.updatedAt,
    '要確認': record.needsReview
  };
  var normalizedHeader = normalizeHeader_(header);
  return Object.prototype.hasOwnProperty.call(values, normalizedHeader)
    ? values[normalizedHeader]
    : '';
}

function buildOutputPlan_(masterHeaders, masterRows, outputType, outputHeaders) {
  var index = buildHeaderIndex_(masterHeaders);
  var records = [];
  var issues = [];
  masterRows.forEach(function (row, offset) {
    if (isBlankRow_(row)) return;
    var record = outputRecordFromMaster_(row, index);
    var issue = validateOutputRecord_(record, offset + 2);
    if (issue) {
      issues.push(issue);
      return;
    }
    if (record.status !== '同期済み' || isReviewRequired_(record.needsReview)) return;
    if (outputType === 'food' && !isFoodRecord_(record)) return;
    records.push(record);
  });

  var targetHeaders = outputHeaders || (outputType === 'food'
    ? APP_CONFIG.foodOutputHeaders
    : APP_CONFIG.participantOutputHeaders);
  var rows = records.map(function (record) {
    return targetHeaders.map(function (header) {
      return outputValueByHeader_(record, header);
    });
  });
  return { rows: rows, issues: issues, sourceRowCount: masterRows.filter(function (row) {
    return !isBlankRow_(row);
  }).length };
}

function replaceOutputData_(sheet, rows, width) {
  var previousDataRows = Math.max(sheet.getLastRow() - 1, 0);
  if (rows.length === 0 && previousDataRows > 0) {
    throw makeAppError_(
      'E_OUTPUT_EMPTY_GUARD',
      '生成結果が0件になるため、既存出力を維持しました。内容を確認してください。'
    );
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
  }
  if (previousDataRows > rows.length) {
    sheet.getRange(rows.length + 2, 1, previousDataRows - rows.length, width).clearContent();
  }
}

function performBuildOutput_(outputType, suppliedPreflight, executionId) {
  var preflight = suppliedPreflight || preflightInternal_({
    inputs: false,
    master: true,
    outputs: true,
    log: true
  });
  var masterValues = readSheetValues_(preflight.master.sheet);
  var output = outputType === 'food' ? preflight.foodOutput : preflight.participantOutput;
  var plan = buildOutputPlan_(
    masterValues[0],
    masterValues.slice(1),
    outputType,
    output.values[0]
  );
  replaceOutputData_(
    output.sheet,
    plan.rows,
    output.values[0].length
  );
  var summary = {
    created: plan.rows.length,
    updated: 0,
    skipped: plan.sourceRowCount - plan.rows.length,
    needsReview: 0,
    errors: plan.issues.length,
    executionId: executionId
  };
  appendProcessLog_(preflight, executionId, 'buildOutput:' + outputType, summary, plan.issues);
  return summary;
}

function executeBuildFromUi_(outputType) {
  var executionId = newExecutionId_();
  try {
    var summary = withScriptLock_(function () {
      return performBuildOutput_(outputType, null, executionId);
    });
    showSummary_(outputType === 'food' ? '屋台情報まとめ更新完了' : '参参一覧更新完了', summary);
    return summary;
  } catch (error) {
    safeAppendFailureLog_('buildOutput:' + outputType, executionId, error);
    SpreadsheetApp.getUi().alert(
      '出力更新失敗',
      (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return { executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}

function buildParticipantList() {
  return executeBuildFromUi_('participant');
}

function buildFoodStallSummary() {
  return executeBuildFromUi_('food');
}
