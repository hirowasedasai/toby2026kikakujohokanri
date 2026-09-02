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

function participantBaseKey_(email, participation) {
  var normalizedEmail = normalizeEmail_(email);
  var normalizedParticipation = normalizeText_(participation);
  if (!normalizedEmail || !normalizedParticipation) return '';
  return 'participant-base:' + normalizedEmail + '|' + normalizedParticipation;
}

function participantProjectNameFromRow_(row, index) {
  return participantTrackerCell_(row, index, '企画名・フォーム回答') ||
    participantTrackerCell_(row, index, '企画名・確定版');
}

function participantTrackerKeyFromRow_(row, index) {
  return buildProvisionalKey_(
    participantTrackerCell_(row, index, 'メールアドレス'),
    participantTrackerCell_(row, index, '参加企画'),
    participantProjectNameFromRow_(row, index)
  );
}

function participantResponseId_(record) {
  var sourceSheet = normalizeText_(record && record.sourceSheet);
  var rowNumber = Number(record && record.rowNumber);
  if (!sourceSheet || !rowNumber || rowNumber < 2) return '';
  return 'PR-' + hashString_(sourceSheet + '|' + rowNumber) + '-' + rowNumber;
}

function participantDuplicateKey_(email, organization) {
  var normalizedEmail = normalizeEmail_(email);
  var normalizedOrganization = normalizeProjectNameKey_(organization);
  if (!normalizedEmail || !normalizedOrganization) return '';
  return 'participant-duplicate:' + normalizedEmail + '|' + normalizedOrganization;
}

function participantExclusionSetFromValues_(values) {
  var excluded = {};
  if (!values || values.length < 2) return excluded;
  var index = buildHeaderIndex_(values[0]);
  var idColumn = index[normalizeHeader_('回答識別子')];
  if (idColumn === undefined) return excluded;
  values.slice(1).forEach(function (row) {
    var responseId = normalizeText_(row[idColumn]);
    if (responseId) excluded[responseId] = true;
  });
  return excluded;
}

function participantResponsePlan_(inputBatches, excludedResponseIds) {
  var batch = inputBatches.find(function (candidate) {
    return candidate.source && candidate.source.type === 'FORM';
  });
  if (!batch) {
    throw makeAppError_('E_PARTICIPANT_FORM_MISSING', '参参フォーム回答を取得できません。');
  }
  var collected = collectInputRecords_([batch]);
  var excluded = excludedResponseIds || {};
  var records = [];
  var byId = {};
  var byTrackerKey = {};
  var byBase = {};
  var duplicateGroups = {};
  collected.records.sort(function (left, right) {
    return left.rowNumber - right.rowNumber;
  }).forEach(function (record) {
    record.responseId = participantResponseId_(record);
    record.trackerKey = buildProvisionalKey_(record.email, record.participation, record.projectName);
    record.baseKey = participantBaseKey_(record.email, record.participation);
    record.duplicateKey = participantDuplicateKey_(record.email, record.organization);
    if (!record.responseId || excluded[record.responseId]) {
      collected.skipped += 1;
      return;
    }
    records.push(record);
    byId[record.responseId] = record;
    if (!byTrackerKey[record.trackerKey]) byTrackerKey[record.trackerKey] = [];
    byTrackerKey[record.trackerKey].push(record);
    var baseKey = participantBaseKey_(record.email, record.participation);
    if (!byBase[baseKey]) byBase[baseKey] = [];
    byBase[baseKey].push(record);
    if (record.duplicateKey) {
      if (!duplicateGroups[record.duplicateKey]) duplicateGroups[record.duplicateKey] = [];
      duplicateGroups[record.duplicateKey].push(record);
    }
  });
  var duplicateKeys = {};
  Object.keys(duplicateGroups).forEach(function (key) {
    var group = duplicateGroups[key];
    if (group.length < 2) return;
    duplicateKeys[key] = true;
    collected.issues.push(
      makeIssue_(
        'WARN',
        'E_PARTICIPANT_EMAIL_NAME_DUPLICATE',
        '同じメールアドレスと参参名のフォーム回答が複数あるため、人力確認が必要です。',
        {
          sourceSheet: group[0].sourceSheet,
          rowNumber: group[0].rowNumber,
          columnName: 'メールアドレス,参参名'
        }
      )
    );
  });
  return {
    batch: batch,
    records: records,
    byId: byId,
    byTrackerKey: byTrackerKey,
    byBase: byBase,
    duplicateKeys: duplicateKeys,
    issues: collected.issues.slice(),
    skipped: collected.skipped,
    needsReview: records.filter(function (record) {
      return Boolean(duplicateKeys[record.duplicateKey]);
    }).length
  };
}

function participantResultForResponse_(response, responsePlan) {
  return responsePlan.duplicateKeys[response.duplicateKey]
    ? APP_CONFIG.participantDuplicateResult
    : '一致';
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
  if (response) {
    setParticipantTrackerCell_(desired, index, '参参名・フォーム回答', response.organization);
    setParticipantTrackerCell_(desired, index, '参参名・確定版', response.organization);
    setParticipantTrackerCell_(desired, index, '企画名・フォーム回答', response.projectName);
    setParticipantTrackerCell_(desired, index, '企画名・確定版', response.projectName);
    setParticipantTrackerCell_(desired, index, '回答識別子', response.responseId);
  }
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

function planParticipantTrackerDelta_(trackerValues, inputBatches, currentIso, excludedResponseIds) {
  var headers = trackerValues[0];
  var index = buildHeaderIndex_(headers);
  var responsePlan = participantResponsePlan_(inputBatches, excludedResponseIds);
  var existing = trackerValues.slice(1).map(function (row, offset) {
    var copy = row.slice(0, headers.length);
    while (copy.length < headers.length) copy.push('');
    return {
      row: copy,
      rowNumber: offset + 2,
      responseId: normalizeText_(participantTrackerCell_(copy, index, '回答識別子')),
      key: participantTrackerKeyFromRow_(copy, index),
      baseKey: participantBaseKey_(
        participantTrackerCell_(copy, index, 'メールアドレス'),
        participantTrackerCell_(copy, index, '参加企画')
      ),
      result: normalizeText_(participantTrackerCell_(copy, index, '照合結果'))
    };
  }).filter(function (record) {
    return !isBlankRow_(record.row);
  });
  var existingByResponseId = {};
  existing.forEach(function (record) {
    if (!record.responseId) return;
    if (!existingByResponseId[record.responseId]) existingByResponseId[record.responseId] = [];
    existingByResponseId[record.responseId].push(record);
  });

  var updates = [];
  var appends = [];
  var deletes = [];
  var issues = responsePlan.issues.slice();
  var claimedResponseIds = {};
  var needsReview = responsePlan.needsReview;
  var skipped = responsePlan.skipped;

  function planExistingUpdate(record, response, result) {
    if (
      (record.result === APP_CONFIG.participantDuplicateResult || record.result === 'フォーム回答重複') &&
      result === '一致' &&
      normalizeText_(participantTrackerCell_(record.row, index, '提出状況')) === '確認中'
    ) {
      setParticipantTrackerCell_(record.row, index, '提出状況', '');
    }
    var desired = participantDesiredRow_(record.row, index, response, result, currentIso);
    var segments = changedParticipantSegments_(record.row, desired, headers);
    if (segments.length > 0) {
      updates.push({ rowNumber: record.rowNumber, segments: segments, row: desired });
    } else {
      skipped += 1;
    }
  }

  existing.forEach(function (record) {
    if (record.responseId) {
      if (excludedResponseIds && excludedResponseIds[record.responseId]) {
        deletes.push(record.rowNumber);
        return;
      }
      if (existingByResponseId[record.responseId].length > 1) {
        var firstExisting = existingByResponseId[record.responseId][0];
        if (firstExisting !== record) {
          planExistingUpdate(record, null, '一覧内重複');
          needsReview += 1;
          issues.push(participantIssue_(
            'E_PARTICIPANT_TRACKER_RESPONSE_ID_DUPLICATE',
            '参参一覧に同じ回答識別子の行が複数あります。',
            record.rowNumber,
            '回答識別子'
          ));
          return;
        }
      }
      var identifiedResponse = responsePlan.byId[record.responseId];
      if (!identifiedResponse) {
        planExistingUpdate(record, null, '回答元不明');
        needsReview += 1;
        issues.push(participantIssue_(
          'E_PARTICIPANT_RESPONSE_MISSING',
          '参参一覧の回答識別子に対応するフォーム回答がありません。',
          record.rowNumber,
          '回答識別子'
        ));
        return;
      }
      claimedResponseIds[record.responseId] = true;
      planExistingUpdate(
        record,
        identifiedResponse,
        participantResultForResponse_(identifiedResponse, responsePlan)
      );
      return;
    }
    var candidates = (responsePlan.byTrackerKey[record.key] || []).filter(function (response) {
      return !claimedResponseIds[response.responseId];
    });
    if (candidates.length === 0 && record.result === 'フォーム回答重複' && record.baseKey) {
      candidates = (responsePlan.byBase[record.baseKey] || []).filter(function (response) {
        return !claimedResponseIds[response.responseId];
      });
    }
    if (candidates.length > 0) {
      var claimedResponse = candidates[0];
      claimedResponseIds[claimedResponse.responseId] = true;
      planExistingUpdate(
        record,
        claimedResponse,
        participantResultForResponse_(claimedResponse, responsePlan)
      );
      return;
    }
    if (record.key) {
      if ((responsePlan.byTrackerKey[record.key] || []).length > 0) {
        planExistingUpdate(record, null, '一覧内重複');
        needsReview += 1;
        issues.push(participantIssue_(
          'E_PARTICIPANT_TRACKER_DUPLICATE',
          '参参一覧に同じメールアドレス、参加企画、企画名の余分な行があります。',
          record.rowNumber,
          'メールアドレス,参加企画,企画名'
        ));
      } else {
        planExistingUpdate(record, null, '未提出');
      }
      return;
    }
    planExistingUpdate(record, null, '一覧行不備');
    needsReview += 1;
    issues.push(participantIssue_(
      'E_PARTICIPANT_TRACKER_ROW_INVALID',
      '参参一覧のメールアドレス、参加企画、または企画名が空です。',
      record.rowNumber,
      'メールアドレス,参加企画,企画名'
    ));
  });

  responsePlan.records.forEach(function (response) {
    if (claimedResponseIds[response.responseId]) return;
    var row = new Array(headers.length).fill('');
    setParticipantTrackerCell_(row, index, '参加企画', response.participation);
    setParticipantTrackerCell_(row, index, 'メールアドレス', response.email);
    row = participantDesiredRow_(
      row,
      index,
      response,
      participantResultForResponse_(response, responsePlan),
      currentIso
    );
    appends.push(row);
  });

  return {
    updates: updates,
    appends: appends,
    deletes: deletes,
    issues: issues,
    summary: {
      created: appends.length,
      updated: updates.length,
      deleted: deletes.length,
      skipped: skipped,
      needsReview: needsReview,
      errors: issues.filter(function (issue) { return issue.level !== 'INFO'; }).length
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
  (delta.deletes || []).slice().sort(function (left, right) {
    return right - left;
  }).forEach(function (rowNumber) {
    sheet.deleteRow(rowNumber);
  });
  if (delta.appends.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, delta.appends.length, width)
      .setValues(delta.appends);
  }
}

function participantTrackerSortSpec_(headers) {
  var index = buildHeaderIndex_(headers);
  return ['参加企画', '企画名・確定版', '参参名・確定版'].map(function (header) {
    return {
      column: index[normalizeHeader_(header)] + 1,
      ascending: true
    };
  });
}

function sortParticipantTrackerSheet_(sheet, headers) {
  var dataRowCount = Math.max(sheet.getLastRow() - 1, 0);
  if (dataRowCount < 2) return;
  var width = Math.max(headers.length, sheet.getLastColumn());
  sheet.getRange(2, 1, dataRowCount, width)
    .sort(participantTrackerSortSpec_(headers));
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
    nowIso_(),
    participantExclusionSetFromValues_(preflight.participantExclusions.values)
  );
  applyParticipantTrackerDelta_(
    preflight.participantOutput.sheet,
    plan,
    preflight.participantOutput.values[0].length
  );
  sortParticipantTrackerSheet_(
    preflight.participantOutput.sheet,
    preflight.participantOutput.values[0]
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

function participantResponseIdsFromSelection_(headers, values) {
  var index = buildHeaderIndex_(headers);
  var idColumn = index[normalizeHeader_('回答識別子')];
  var resultColumn = index[normalizeHeader_('照合結果')];
  if (idColumn === undefined || resultColumn === undefined) return [];
  var seen = {};
  var ids = [];
  values.forEach(function (row) {
    if (normalizeText_(row[resultColumn]) !== APP_CONFIG.participantDuplicateResult) return;
    var responseId = normalizeText_(row[idColumn]);
    if (!responseId || seen[responseId]) return;
    seen[responseId] = true;
    ids.push(responseId);
  });
  return ids;
}

function participantFullySelectedDuplicateGroupCount_(headers, values, selectedResponseIds) {
  var index = buildHeaderIndex_(headers);
  var idColumn = index[normalizeHeader_('回答識別子')];
  var resultColumn = index[normalizeHeader_('照合結果')];
  if (idColumn === undefined || resultColumn === undefined) return 0;
  var selected = {};
  selectedResponseIds.forEach(function (responseId) {
    selected[normalizeText_(responseId)] = true;
  });
  var totals = {};
  var selectedTotals = {};
  values.forEach(function (row) {
    if (normalizeText_(row[resultColumn]) !== APP_CONFIG.participantDuplicateResult) return;
    var responseId = normalizeText_(row[idColumn]);
    var duplicateKey = participantDuplicateKey_(
      participantTrackerCell_(row, index, 'メールアドレス'),
      participantTrackerCell_(row, index, '参参名・フォーム回答') ||
        participantTrackerCell_(row, index, '参参名・確定版')
    );
    if (!responseId || !duplicateKey) return;
    totals[duplicateKey] = (totals[duplicateKey] || 0) + 1;
    if (selected[responseId]) {
      selectedTotals[duplicateKey] = (selectedTotals[duplicateKey] || 0) + 1;
    }
  });
  return Object.keys(selectedTotals).filter(function (duplicateKey) {
    return selectedTotals[duplicateKey] >= totals[duplicateKey];
  }).length;
}

function appendParticipantExclusions_(exclusionOutput, responseIds, currentIso) {
  var headers = exclusionOutput.values[0];
  var index = buildHeaderIndex_(headers);
  var existing = participantExclusionSetFromValues_(exclusionOutput.values);
  var rows = responseIds.filter(function (responseId) {
    return !existing[responseId];
  }).map(function (responseId) {
    var row = new Array(headers.length).fill('');
    row[index[normalizeHeader_('回答識別子')]] = responseId;
    row[index[normalizeHeader_('除外日時')]] = currentIso;
    row[index[normalizeHeader_('除外理由')]] = '誤回答として手動除外';
    return row;
  });
  if (rows.length > 0) {
    exclusionOutput.sheet
      .getRange(exclusionOutput.sheet.getLastRow() + 1, 1, rows.length, headers.length)
      .setValues(rows);
  }
  return rows.length;
}

function excludeSelectedParticipantResponses() {
  var executionId = newExecutionId_();
  var spreadsheet = getBoundSpreadsheet_();
  var ui = SpreadsheetApp.getUi();
  try {
    validateEnvironment_(spreadsheet);
    var sheet = spreadsheet.getActiveSheet();
    if (!sheet || sheet.getName() !== APP_CONFIG.sheets.participantOutput) {
      throw makeAppError_(
        'E_PARTICIPANT_EXCLUSION_WRONG_SHEET',
        '参参一覧で誤回答の行を選択してから実行してください。'
      );
    }
    var validation = validateExactHeaders_(
      sheet,
      APP_CONFIG.participantOutputHeaders,
      'E_OUTPUT_HEADER_MISSING'
    );
    var selection = sheet.getActiveRange();
    var startRow = Math.max(selection ? selection.getRow() : 0, 2);
    var endRow = selection ? selection.getLastRow() : 0;
    if (!selection || endRow < 2 || startRow > endRow) {
      throw makeAppError_(
        'E_PARTICIPANT_EXCLUSION_NO_SELECTION',
        '参参一覧のデータ行を1行以上選択してください。'
      );
    }
    var selectedValues = sheet.getRange(
      startRow,
      1,
      endRow - startRow + 1,
      validation.values[0].length
    ).getValues();
    var responseIds = participantResponseIdsFromSelection_(
      validation.values[0],
      selectedValues
    );
    if (responseIds.length === 0) {
      throw makeAppError_(
        'E_PARTICIPANT_EXCLUSION_ID_MISSING',
        '選択行に同一メアド・参参名の警告中フォーム回答がありません。先に参参一覧を更新してください。'
      );
    }
    if (participantFullySelectedDuplicateGroupCount_(
      validation.values[0],
      validation.values.slice(1),
      responseIds
    ) > 0) {
      throw makeAppError_(
        'E_PARTICIPANT_EXCLUSION_WOULD_REMOVE_ALL',
        '同じメールアドレスと参参名の回答をすべて除外することはできません。正しい1件を選択から外してください。'
      );
    }
    var confirmation = ui.alert(
      '参参の誤回答を除外',
      '選択したフォーム回答 ' + responseIds.length + ' 件を参参一覧から除外します。' +
        'フォーム回答原本は変更しません。続行しますか？',
      ui.ButtonSet.YES_NO
    );
    if (confirmation !== ui.Button.YES) return { executionId: executionId, cancelled: true };

    var result = withScriptLock_(function () {
      var preflight = preflightInternal_({
        inputs: true,
        master: false,
        outputs: true,
        log: true
      });
      var selectedIdSet = {};
      responseIds.forEach(function (responseId) {
        selectedIdSet[responseId] = true;
      });
      var currentHeaders = preflight.participantOutput.values[0];
      var currentIndex = buildHeaderIndex_(currentHeaders);
      var currentSelectedRows = preflight.participantOutput.values.slice(1).filter(function (row) {
        var responseId = normalizeText_(
          participantTrackerCell_(row, currentIndex, '回答識別子')
        );
        return Boolean(selectedIdSet[responseId]);
      });
      var currentResponseIds = participantResponseIdsFromSelection_(
        currentHeaders,
        currentSelectedRows
      );
      if (currentResponseIds.length !== responseIds.length) {
        throw makeAppError_(
          'E_PARTICIPANT_EXCLUSION_SELECTION_STALE',
          '選択後に参参一覧が更新されました。現在の警告行を確認して選択し直してください。'
        );
      }
      if (participantFullySelectedDuplicateGroupCount_(
        currentHeaders,
        preflight.participantOutput.values.slice(1),
        currentResponseIds
      ) > 0) {
        throw makeAppError_(
          'E_PARTICIPANT_EXCLUSION_WOULD_REMOVE_ALL',
          '同じメールアドレスと参参名の回答をすべて除外することはできません。正しい1件を選択から外してください。'
        );
      }
      var excluded = appendParticipantExclusions_(
        preflight.participantExclusions,
        currentResponseIds,
        nowIso_()
      );
      var refreshed = preflightInternal_({
        inputs: true,
        master: false,
        outputs: true,
        log: true
      });
      var summary = performBuildParticipantTracker_(refreshed, executionId);
      summary.excluded = excluded;
      return summary;
    });
    ui.alert(
      '参参の誤回答を除外しました',
      '除外登録: ' + result.excluded + ' 件\n' +
        '一覧から削除: ' + (result.deleted || 0) + ' 件\n' +
        '残りの要確認: ' + (result.needsReview || 0) + ' 件',
      ui.ButtonSet.OK
    );
    return result;
  } catch (error) {
    safeAppendFailureLog_('participant:excludeSelected', executionId, error);
    ui.alert(
      '参参の誤回答除外に失敗しました',
      (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message),
      ui.ButtonSet.OK
    );
    return { executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}

function buildFoodStallSummary() {
  return executeBuildFromUi_('food');
}
