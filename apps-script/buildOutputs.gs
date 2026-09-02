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

function participantResponseGroups_(inputBatches) {
  var batch = inputBatches.find(function (candidate) {
    return candidate.source && candidate.source.type === 'FORM';
  });
  if (!batch) {
    throw makeAppError_('E_PARTICIPANT_FORM_MISSING', '参参フォーム回答を取得できません。');
  }
  var collected = collectInputRecords_([batch]);
  var groups = {};
  var keysByBase = {};
  collected.records.forEach(function (record) {
    var key = buildProvisionalKey_(record.email, record.participation, record.projectName);
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
    var baseKey = participantBaseKey_(record.email, record.participation);
    if (!keysByBase[baseKey]) keysByBase[baseKey] = [];
    if (keysByBase[baseKey].indexOf(key) < 0) keysByBase[baseKey].push(key);
  });
  Object.keys(keysByBase).forEach(function (baseKey) {
    keysByBase[baseKey].sort();
  });
  var autoResolvedKeys = {};
  Object.keys(groups).forEach(function (key) {
    var resolution = resolveImageOnlyResubmission_(groups[key]);
    if (!resolution.resolved) return;
    collected.skipped += groups[key].length - 1;
    groups[key] = [resolution.record];
    autoResolvedKeys[key] = true;
    collected.issues.push(
      makeIssue_(
        'INFO',
        'I_IMAGE_RESUBMISSION_LATEST_SELECTED',
        '同一企画の画像リンクのみ異なる再送のため、回答日時が新しい回答を採用しました。',
        {
          sourceSheet: resolution.record.sourceSheet,
          rowNumber: resolution.record.rowNumber,
          columnName: '画像リンク,タイムスタンプ'
        }
      )
    );
  });
  return {
    batch: batch,
    groups: groups,
    keysByBase: keysByBase,
    autoResolvedKeys: autoResolvedKeys,
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
    return {
      row: copy,
      rowNumber: offset + 2,
      key: participantTrackerKeyFromRow_(copy, index),
      baseKey: participantBaseKey_(
        participantTrackerCell_(copy, index, 'メールアドレス'),
        participantTrackerCell_(copy, index, '参加企画')
      ),
      result: normalizeText_(participantTrackerCell_(copy, index, '照合結果')),
      legacyPlaceholder: false
    };
  }).filter(function (record) {
    return !isBlankRow_(record.row);
  });
  var existingByKey = {};
  existing.forEach(function (record) {
    if (!record.key) return;
    if (!existingByKey[record.key]) existingByKey[record.key] = [];
    existingByKey[record.key].push(record);
  });

  var claimedLegacyKeys = {};
  existing.forEach(function (record) {
    if (
      record.key ||
      record.result !== 'フォーム回答重複' ||
      !record.baseKey
    ) return;
    var candidates = (responsePlan.keysByBase[record.baseKey] || []).filter(function (key) {
      return !existingByKey[key] && !claimedLegacyKeys[key];
    });
    if (candidates.length === 0) return;
    record.key = candidates[0];
    record.legacyPlaceholder = true;
    claimedLegacyKeys[record.key] = true;
    existingByKey[record.key] = [record];
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
        '参参一覧のメールアドレス、参加企画、または企画名が空です。',
        record.rowNumber,
        'メールアドレス,参加企画,企画名'
      ));
      return;
    }
    if (existingByKey[record.key].length > 1) {
      planExistingUpdate(record, null, '一覧内重複');
      needsReview += 1;
      issues.push(participantIssue_(
        'E_PARTICIPANT_TRACKER_DUPLICATE',
        '参参一覧に同じメールアドレス、参加企画、企画名の行が複数あります。',
        record.rowNumber,
        'メールアドレス,参加企画,企画名'
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
        '同じメールアドレス、参加企画、企画名のフォーム回答が複数あるため自動採用しません。',
        responses[0].rowNumber,
        'メールアドレス,参加企画,企画名',
        responsePlan.batch.source.name
      ));
      return;
    }
    if (
      (record.legacyPlaceholder || responsePlan.autoResolvedKeys[record.key]) &&
      record.result === 'フォーム回答重複' &&
      normalizeText_(participantTrackerCell_(record.row, index, '提出状況')) === '確認中'
    ) {
      setParticipantTrackerCell_(record.row, index, '提出状況', '');
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
        '同じメールアドレス、参加企画、企画名のフォーム回答が複数あるため自動採用しません。',
        first.rowNumber,
        'メールアドレス,参加企画,企画名',
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
    nowIso_()
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

function buildFoodStallSummary() {
  return executeBuildFromUi_('food');
}
