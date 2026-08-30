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
    bureau: normalizeText_(getMasterCell_(row, index, '所属局')),
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
    '所属局': record.bureau,
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

function participantTrackerCell_(row, index, header) {
  var column = index[normalizeHeader_(header)];
  return column === undefined ? '' : row[column];
}

function setParticipantTrackerCell_(row, index, header, value) {
  var column = index[normalizeHeader_(header)];
  if (column !== undefined) row[column] = value;
}

function participantTrackerKeyFromRow_(row, index) {
  return buildProvisionalKey_(
    participantTrackerCell_(row, index, 'メールアドレス'),
    participantTrackerCell_(row, index, '参加企画')
  );
}

function participantResponseGroups_(inputBatches) {
  var batch = inputBatches.find(function (candidate) {
    return candidate.source && candidate.source.type === 'FORM';
  });
  if (!batch) {
    throw makeAppError_('E_PARTICIPANT_FORM_MISSING', '参参フォーム回答を取得できません。');
  }
  var collected = collectInputRecords_([batch]);
  var groups = {};
  collected.records.forEach(function (record) {
    var key = buildProvisionalKey_(record.email, record.participation);
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  });
  return {
    batch: batch,
    groups: groups,
    issues: collected.issues.slice(),
    skipped: collected.skipped
  };
}

function participantSuggestedStatus_(currentStatus, suggestedStatus) {
  var current = normalizeText_(currentStatus);
  if (current === 'キャンセル') return current;
  if (current === '確認中' && suggestedStatus !== '確認中') return current;
  return suggestedStatus;
}

function participantDesiredRow_(existingRow, index, response, result, currentIso) {
  var desired = existingRow.slice();
  var currentStatus = participantTrackerCell_(existingRow, index, '提出状況');
  var suggestedStatus = result === '一致'
    ? '提出済み'
    : result === '未提出'
      ? '未提出'
      : '確認中';
  setParticipantTrackerCell_(
    desired,
    index,
    '提出状況',
    participantSuggestedStatus_(currentStatus, suggestedStatus)
  );
  setParticipantTrackerCell_(desired, index, '参参名・フォーム回答', response ? response.organization : '');
  setParticipantTrackerCell_(desired, index, '参参名・確定版', response ? response.organization : '');
  setParticipantTrackerCell_(desired, index, '企画名・フォーム回答', response ? response.projectName : '');
  setParticipantTrackerCell_(desired, index, '企画名・確定版', response ? response.projectName : '');
  setParticipantTrackerCell_(desired, index, '照合結果', result);

  var trackedHeaders = ['提出状況'].concat(
    APP_CONFIG.participantAutomaticHeaders.filter(function (header) {
      return header !== '最終同期日時';
    })
  );
  var changed = trackedHeaders.some(function (header) {
    return stringifyCell_(participantTrackerCell_(existingRow, index, header)) !==
      stringifyCell_(participantTrackerCell_(desired, index, header));
  });
  if (changed) setParticipantTrackerCell_(desired, index, '最終同期日時', currentIso);
  return desired;
}

function changedParticipantSegments_(existingRow, desiredRow, headers) {
  var writable = ['提出状況'].concat(APP_CONFIG.participantAutomaticHeaders).map(normalizeHeader_);
  var writableSet = {};
  writable.forEach(function (header) {
    writableSet[header] = true;
  });
  var segments = [];
  var current = null;
  headers.forEach(function (header, index) {
    var changed = writableSet[normalizeHeader_(header)] &&
      stringifyCell_(existingRow[index]) !== stringifyCell_(desiredRow[index]);
    if (!changed) {
      if (current) segments.push(current);
      current = null;
      return;
    }
    if (!current) current = { startColumn: index + 1, values: [] };
    current.values.push(desiredRow[index]);
  });
  if (current) segments.push(current);
  return segments;
}

function participantIssue_(code, message, rowNumber, columnName, sourceSheet) {
  return makeIssue_('WARN', code, message, {
    sourceSheet: sourceSheet || APP_CONFIG.sheets.participantOutput,
    rowNumber: rowNumber,
    columnName: columnName
  });
}

function planParticipantTrackerDelta_(trackerValues, inputBatches, currentIso) {
  var headers = trackerValues[0];
  var index = buildHeaderIndex_(headers);
  var responsePlan = participantResponseGroups_(inputBatches);
  var existing = trackerValues.slice(1).map(function (row, offset) {
    var copy = row.slice(0, headers.length);
    while (copy.length < headers.length) copy.push('');
    return { row: copy, rowNumber: offset + 2, key: participantTrackerKeyFromRow_(copy, index) };
  }).filter(function (record) {
    return !isBlankRow_(record.row);
  });
  var existingByKey = {};
  existing.forEach(function (record) {
    if (!record.key) return;
    if (!existingByKey[record.key]) existingByKey[record.key] = [];
    existingByKey[record.key].push(record);
  });

  var updates = [];
  var appends = [];
  var issues = responsePlan.issues.slice();
  var usedResponseKeys = {};
  var needsReview = 0;
  var skipped = responsePlan.skipped;

  function planExistingUpdate(record, response, result) {
    var desired = participantDesiredRow_(record.row, index, response, result, currentIso);
    var segments = changedParticipantSegments_(record.row, desired, headers);
    if (segments.length > 0) {
      updates.push({ rowNumber: record.rowNumber, segments: segments, row: desired });
    } else {
      skipped += 1;
    }
  }

  existing.forEach(function (record) {
    if (!record.key) {
      planExistingUpdate(record, null, '一覧行不備');
      needsReview += 1;
      issues.push(participantIssue_(
        'E_PARTICIPANT_TRACKER_ROW_INVALID',
        '参参一覧の参加企画またはメールアドレスが空です。',
        record.rowNumber,
        '参加企画,メールアドレス'
      ));
      return;
    }
    if (existingByKey[record.key].length > 1) {
      planExistingUpdate(record, null, '一覧内重複');
      needsReview += 1;
      issues.push(participantIssue_(
        'E_PARTICIPANT_TRACKER_DUPLICATE',
        '参参一覧に同じメールアドレスと参加企画の行が複数あります。',
        record.rowNumber,
        'メールアドレス,参加企画'
      ));
      return;
    }
    var responses = responsePlan.groups[record.key] || [];
    if (responses.length === 0) {
      planExistingUpdate(record, null, '未提出');
      return;
    }
    usedResponseKeys[record.key] = true;
    if (responses.length > 1) {
      planExistingUpdate(record, null, 'フォーム回答重複');
      needsReview += 1;
      skipped += responses.length - 1;
      issues.push(participantIssue_(
        'E_PARTICIPANT_FORM_DUPLICATE',
        '同じメールアドレスと参加企画のフォーム回答が複数あるため自動採用しません。',
        responses[0].rowNumber,
        'メールアドレス,参加企画',
        responsePlan.batch.source.name
      ));
      return;
    }
    planExistingUpdate(record, responses[0], '一致');
  });

  Object.keys(responsePlan.groups).sort().forEach(function (key) {
    if (usedResponseKeys[key] || existingByKey[key]) return;
    var responses = responsePlan.groups[key];
    var response = responses.length === 1 ? responses[0] : null;
    var row = new Array(headers.length).fill('');
    var first = responses[0];
    setParticipantTrackerCell_(row, index, '参加企画', first.participation);
    setParticipantTrackerCell_(row, index, 'メールアドレス', first.email);
    row = participantDesiredRow_(
      row,
      index,
      response,
      response ? '一致' : 'フォーム回答重複',
      currentIso
    );
    appends.push(row);
    if (!response) {
      needsReview += 1;
      skipped += responses.length - 1;
      issues.push(participantIssue_(
        'E_PARTICIPANT_FORM_DUPLICATE',
        '同じメールアドレスと参加企画のフォーム回答が複数あるため自動採用しません。',
        first.rowNumber,
        'メールアドレス,参加企画',
        responsePlan.batch.source.name
      ));
    }
  });

  return {
    updates: updates,
    appends: appends,
    issues: issues,
    summary: {
      created: appends.length,
      updated: updates.length,
      skipped: skipped,
      needsReview: needsReview,
      errors: issues.length
    }
  };
}

function applyParticipantTrackerDelta_(sheet, delta, width) {
  delta.updates.forEach(function (update) {
    update.segments.forEach(function (segment) {
      sheet.getRange(update.rowNumber, segment.startColumn, 1, segment.values.length)
        .setValues([segment.values]);
    });
  });
  if (delta.appends.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, delta.appends.length, width)
      .setValues(delta.appends);
  }
}

function performBuildParticipantTracker_(suppliedPreflight, executionId) {
  var preflight = suppliedPreflight || preflightInternal_({
    inputs: true,
    master: false,
    outputs: true,
    log: true
  });
  var plan = planParticipantTrackerDelta_(
    preflight.participantOutput.values,
    preflight.inputs,
    nowIso_()
  );
  applyParticipantTrackerDelta_(
    preflight.participantOutput.sheet,
    plan,
    preflight.participantOutput.values[0].length
  );
  plan.summary.executionId = executionId;
  appendProcessLog_(
    preflight,
    executionId,
    'syncDelta:participantTracker',
    plan.summary,
    plan.issues
  );
  return plan.summary;
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
  if (outputType === 'participant') {
    return performBuildParticipantTracker_(suppliedPreflight, executionId);
  }
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
