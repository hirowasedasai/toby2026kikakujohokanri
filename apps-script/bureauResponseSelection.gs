function bureauResponseExclusionSet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(APP_CONFIG.sheets.bureauExclusions);
  if (!sheet) return {};
  var output = validateExactHeaders_(sheet, APP_CONFIG.participantExclusionHeaders,
    'E_BUREAU_EXCLUSION_HEADER_MISSING');
  return participantExclusionSetFromValues_(output.values);
}

function otherPublicationAdoptionPlan_(inputs, reviewKey, excludedIds) {
  var records = buildBureauOutputPlan_(inputs).records.filter(isOtherPublicationRecord_);
  var selected = records.find(function (record) {
    return record.sourceSheet + ':' + record.rowNumber === reviewKey;
  });
  if (!selected || (excludedIds && excludedIds[reviewKey])) {
    throw makeAppError_('E_BUREAU_ADOPTION_SOURCE_INVALID',
      '選択した回答が見つからないか、すでに除外されています。原本と除外管理を確認してください。');
  }
  var key = normalizeProjectNameKey_(selected.projectName);
  var group = records.filter(function (record) {
    return normalizeProjectNameKey_(record.projectName) === key;
  });
  if (!key || group.length < 2) {
    throw makeAppError_('E_BUREAU_ADOPTION_NOT_DUPLICATE',
      'この操作はその他掲載情報の同名重複回答だけが対象です。');
  }
  return {
    selected: selected,
    group: group,
    excludedIds: group.filter(function (record) {
      return record !== selected;
    }).map(function (record) { return record.sourceSheet + ':' + record.rowNumber; })
  };
}

function selectedOtherPublicationReview_(spreadsheet) {
  var sheet = spreadsheet.getActiveSheet();
  var range = sheet && sheet.getActiveRange();
  if (!sheet || sheet.getName() !== APP_CONFIG.sheets.manualReview ||
    !range || range.getRow() < 2 || range.getNumRows() !== 1) {
    throw makeAppError_('E_BUREAU_ADOPTION_SELECTION_INVALID',
      '26要手動確認で、採用するその他掲載情報の回答を1行だけ選択してください。');
  }
  var output = validateExactHeaders_(sheet, APP_CONFIG.manualReviewHeaders,
    'E_MANUAL_REVIEW_HEADER_MISSING');
  var index = buildHeaderIndex_(output.values[0]);
  var row = output.values[range.getRow() - 1] || [];
  return {
    key: normalizeText_(row[index[normalizeHeader_('確認キー')]]),
    projectName: normalizeText_(row[index[normalizeHeader_('企画名')]]),
    bureau: normalizeText_(row[index[normalizeHeader_('所属局')]]),
    department: normalizeText_(row[index[normalizeHeader_('部署名')]])
  };
}

function validateAdoptionReview_(review, selected) {
  if (['projectName', 'bureau', 'department'].some(function (field) {
    return normalizeText_(selected[field]) !== review[field];
  })) {
    throw makeAppError_('E_BUREAU_ADOPTION_SELECTION_STALE',
      '要手動確認と原本の内容が一致しません。局別タブを差分同期して選択し直してください。');
  }
}

function completeOtherPublicationReviews_(reviewSheet, group) {
  var keys = {};
  group.forEach(function (record) { keys[record.sourceSheet + ':' + record.rowNumber] = true; });
  var values = readSheetValues_(reviewSheet);
  var index = buildHeaderIndex_(values[0]);
  var keyColumn = index[normalizeHeader_('確認キー')];
  var statusColumn = index[normalizeHeader_('対応状況')];
  values.slice(1).forEach(function (row, offset) {
    if (keys[normalizeText_(row[keyColumn])]) {
      reviewSheet.getRange(offset + 2, statusColumn + 1).setValue('対応済み');
    }
  });
  var pending = pendingManualReviewCountFromValues_(readSheetValues_(reviewSheet));
  reviewSheet.setTabColor(pending > 0 ? '#d93025' : null);
  return pending;
}

function applyOtherPublicationAdoption_(preflight, adoption, executionId) {
  var delta = planBureauDelta_(preflight.bureauOutputs, [adoption.selected]);
  // Other projects are outside this operation; their orphan notices are irrelevant here.
  var blockingIssues = delta.issues.filter(function (issue) {
    return issue.code !== 'E_BUREAU_ORPHAN_PRESERVED';
  });
  if (blockingIssues.length > 0) {
    throw makeAppError_('E_BUREAU_ADOPTION_OUTPUT_AMBIGUOUS',
      '局別タブに一致する行が複数あるため採用を停止しました。既存行を確認してください。');
  }
  var exclusionSheet = preflight.spreadsheet.getSheetByName(APP_CONFIG.sheets.bureauExclusions);
  if (!exclusionSheet) {
    exclusionSheet = preflight.spreadsheet.insertSheet(APP_CONFIG.sheets.bureauExclusions);
    exclusionSheet.getRange(1, 1, 1, APP_CONFIG.participantExclusionHeaders.length)
      .setValues([APP_CONFIG.participantExclusionHeaders.slice()]);
  }
  var exclusionOutput = validateExactHeaders_(exclusionSheet,
    APP_CONFIG.participantExclusionHeaders, 'E_BUREAU_EXCLUSION_HEADER_MISSING');
  exclusionSheet.hideSheet();
  var excluded = appendParticipantExclusions_(exclusionOutput, adoption.excludedIds, nowIso_());
  // Persist exclusions first so a failed move can be safely retried by ordinary sync.
  applyBureauDelta_(delta);
  var refreshedOutputs = preflight.bureauOutputs.map(function (output) {
    return { bureau: output.bureau, sheet: output.sheet, values: readSheetValues_(output.sheet) };
  });
  var remaining = planBureauDelta_(refreshedOutputs, [adoption.selected]);
  if (remaining.appends.length || remaining.updates.length || remaining.deletes.length ||
    remaining.issues.some(function (issue) { return issue.code !== 'E_BUREAU_ORPHAN_PRESERVED'; })) {
    throw makeAppError_('E_BUREAU_ADOPTION_INCOMPLETE',
      '除外は登録済みですが反映完了を確認できません。要手動確認を残して停止しました。');
  }
  var pending = completeOtherPublicationReviews_(preflight.manualReview.sheet, adoption.group);
  var summary = {
    executionId: executionId, created: delta.created, updated: delta.updated,
    deleted: delta.deletes.length, excluded: excluded, needsReview: pending, errors: 0
  };
  appendProcessLog_(preflight, executionId, 'bureau:adoptOtherPublication', summary, []);
  return summary;
}

function adoptSelectedOtherPublicationResponse() {
  var executionId = newExecutionId_();
  var ui = SpreadsheetApp.getUi();
  try {
    var spreadsheet = getBoundSpreadsheet_();
    validateEnvironment_(spreadsheet);
    var review = selectedOtherPublicationReview_(spreadsheet);
    var before = preflightInternal_({ inputs: true, bureaus: true, log: true });
    var proposed = otherPublicationAdoptionPlan_(before.inputs, review.key,
      bureauResponseExclusionSet_(spreadsheet));
    validateAdoptionReview_(review, proposed.selected);
    var answer = ui.alert('その他掲載情報の回答を採用',
      '企画名: ' + proposed.selected.projectName + '\n採用先: ' + proposed.selected.bureau +
      ' / ' + proposed.selected.department + '\n入力行: ' + proposed.selected.rowNumber +
      '\n同名の他回答 ' + proposed.excludedIds.length + ' 件を同期対象から除外します。' +
      '\n局別タブの手動入力を保持して反映し、該当する確認行を対応済みにします。' +
      '\nフォーム回答原本は保持します。続行しますか？', ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) return { executionId: executionId, cancelled: true };
    var result = withScriptLock_(function () {
      var preflight = preflightInternal_({ inputs: true, bureaus: true, log: true });
      var adoption = otherPublicationAdoptionPlan_(preflight.inputs, review.key,
        bureauResponseExclusionSet_(spreadsheet));
      if (JSON.stringify(proposed) !== JSON.stringify(adoption)) {
        throw makeAppError_('E_BUREAU_ADOPTION_SELECTION_STALE',
          '確認中に回答が変更されました。内容を確認して実行し直してください。');
      }
      return applyOtherPublicationAdoption_(preflight, adoption, executionId);
    });
    showSummary_('その他掲載情報の回答を採用しました', result);
    return result;
  } catch (error) {
    safeAppendFailureLog_('bureau:adoptOtherPublication', executionId, error);
    ui.alert('その他掲載情報の回答採用に失敗しました',
      (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message), ui.ButtonSet.OK);
    return { executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}
