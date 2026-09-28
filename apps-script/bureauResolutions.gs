// Explicit operator decisions. Input answers are never edited or deleted.
function bureauResponseId_(record) {
  return record.sourceSheet + ':' + record.rowNumber;
}

function bureauSourceFingerprint_(record) {
  var snapshot = {};
  Object.keys(record).sort().forEach(function (key) {
    if (['separateProject', 'changeStatus', 'lastChangeAt', 'matchProjectKeys'].indexOf(key) < 0) {
      snapshot[key] = record[key];
    }
  });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(snapshot), Utilities.Charset.UTF_8).map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function bureauResolutionSet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(APP_CONFIG.sheets.bureauResolutions);
  if (!sheet) return {};
  var output = validateExactHeaders_(sheet, APP_CONFIG.bureauResolutionHeaders,
    'E_BUREAU_RESOLUTION_HEADER_MISSING');
  var index = output.headerIndex;
  var result = {};
  output.values.slice(1).forEach(function (row) {
    if (isBlankRow_(row)) return;
    var value = function (header) { return normalizeText_(row[index[normalizeHeader_(header)]]); };
    var id = value('入力識別子');
    var kind = value('処理区分');
    var fingerprint = value('原本照合値');
    if (!id || result[id] || ['別企画', '変更補正'].indexOf(kind) < 0 || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw makeAppError_('E_BUREAU_RESOLUTION_INVALID', '局別確認結果の識別子・区分・原本照合値を確認してください。');
    }
    result[id] = { kind: kind, fingerprint: fingerprint,
      before: value('補正変更前'), after: value('補正変更後') };
  });
  return result;
}

function rawBureauRecords_(inputs) {
  var records = [];
  inputs.forEach(function (batch) {
    if (!isStaffBureauSource_(batch.source)) return;
    var positions = buildHeaderPositions_(batch.values[0] || []);
    batch.values.slice(1).forEach(function (row, offset) {
      if (!isBlankRow_(row)) records.push(bureauRecordFromInputRow_(row, offset + 2, batch, positions));
    });
  });
  return records;
}

function separateBureauMatches_(entries, records) {
  var groups = {};
  var result = {};
  records.filter(function (record) { return record.sourceType === 'STAFF_FORM'; }).forEach(function (record) {
    var key = normalizeProjectNameKey_(record.projectName);
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  });
  Object.keys(groups).forEach(function (key) {
    var group = groups[key];
    // A new or changed answer requires a new decision for the entire group.
    if (!key || !group.every(function (record) { return record.separateProject; })) return;
    var ids = group.map(bureauResponseId_);
    var aliases = {};
    group.forEach(function (record) {
      (record.matchProjectKeys || [key]).forEach(function (alias) { aliases[alias] = true; });
    });
    var candidates = entries.filter(function (entry) {
      return entry.group === 'normal' && (aliases[entry.projectKey] || ids.indexOf(entry.responseId) >= 0);
    });
    var mapping = {};
    ids.forEach(function (id) { mapping[id] = []; });
    var blocked = false;
    candidates.forEach(function (entry) {
      var matches = entry.responseId ? group.filter(function (record) {
        return entry.responseId === bureauResponseId_(record);
      }) : group.filter(function (record) {
        var index = buildHeaderIndex_(entry.output.values[0]);
        return normalizeText_(entry.output.bureau) === normalizeText_(record.bureau) &&
          (normalizeText_(record.introduction) || normalizeText_(guestSummary_(record))) &&
          ['部署名', '担当者名', '企画紹介文', 'ゲスト情報'].every(function (header) {
            return normalizeChangeValue_(entry.row[index[normalizeHeader_(header)]]) ===
              normalizeChangeValue_(bureauOutputValueByHeader_(record, header));
          });
      });
      if (matches.length !== 1) { blocked = true; return; }
      mapping[bureauResponseId_(matches[0])].push(entry);
    });
    ids.forEach(function (id) { if (mapping[id].length > 1) blocked = true; });
    ids.forEach(function (id) { result[id] = { candidates: mapping[id], blocked: blocked }; });
  });
  return result;
}

function bureauOutputsWithResponseIds_(outputs, records) {
  return outputs.map(function (output) {
    var needed = records.some(function (record) {
      return record.separateProject && record.bureau === output.bureau;
    });
    if (!needed || buildHeaderIndex_(output.values[0])[normalizeHeader_(APP_CONFIG.bureauResponseIdHeader)] !== undefined) {
      return output;
    }
    var width = output.values.reduce(function (max, row) { return Math.max(max, row.length); }, 0);
    var values = output.values.map(function (row, offset) {
      var next = row.slice();
      while (next.length < width) next.push('');
      next.push(offset === 0 ? APP_CONFIG.bureauResponseIdHeader : '');
      return next;
    });
    return { bureau: output.bureau, sheet: output.sheet, values: values };
  });
}

function ensureBureauResponseIdColumns_(outputs, records) {
  var proposed = bureauOutputsWithResponseIds_(outputs, records);
  proposed.forEach(function (output, index) {
    if (output === outputs[index]) return;
    var column = buildHeaderIndex_(output.values[0])[normalizeHeader_(APP_CONFIG.bureauResponseIdHeader)] + 1;
    var sheet = output.sheet;
    if (sheet.getMaxColumns() < column) sheet.insertColumnsAfter(sheet.getMaxColumns(), column - sheet.getMaxColumns());
    sheet.getRange(1, column).setValues([[APP_CONFIG.bureauResponseIdHeader]]);
    sheet.hideColumns(column);
  });
  return proposed;
}

function completeBureauResolutions_(reviewSheet, plan, outputs, activeReviews, resolutionIssues) {
  var live = outputs.map(function (output) {
    return { bureau: output.bureau, sheet: output.sheet, values: readSheetValues_(output.sheet) };
  });
  var remaining = planBureauDelta_(live, plan.records);
  var pendingKeys = {};
  activeReviews.concat(remaining.reviews).forEach(function (review) { pendingKeys[review.reviewKey] = true; });
  var incompleteIds = {};
  remaining.appends.forEach(function (append) { incompleteIds[bureauResponseId_(append.record)] = true; });
  remaining.updates.forEach(function (update) {
    // Updates carry the source id when a distinct project is being synchronized.
    var index = buildHeaderIndex_(update.output.values[0]);
    var id = normalizeText_(update.row[index[normalizeHeader_(APP_CONFIG.bureauResponseIdHeader)]]);
    if (id) incompleteIds[id] = true;
  });
  var resolved = [];
  plan.records.forEach(function (record) {
    var id = bureauResponseId_(record);
    if (record.separateProject && !pendingKeys[id] && !incompleteIds[id]) resolved.push(record);
  });
  Object.keys(plan.resolvedChanges || {}).forEach(function (changeId) {
    var targetId = plan.resolvedChanges[changeId];
    var target = plan.records.find(function (record) { return bureauResponseId_(record) === targetId; });
    if (!target || pendingKeys[changeId] || pendingKeys[targetId]) return;
    var check = planBureauDelta_(live, [target]);
    if (check.appends.length || check.updates.length || check.deletes.length ||
      check.issues.some(function (issue) { return issue.code !== 'E_BUREAU_ORPHAN_PRESERVED'; })) return;
    var splitAt = changeId.lastIndexOf(':');
    resolved.push({ sourceSheet: changeId.slice(0, splitAt), rowNumber: Number(changeId.slice(splitAt + 1)) });
  });
  var resolvedKeys = {};
  resolved.forEach(function (record) { resolvedKeys[bureauResponseId_(record)] = true; });
  var values = readSheetValues_(reviewSheet);
  var index = buildHeaderIndex_(values[0]);
  var keyColumn = index[normalizeHeader_('確認キー')];
  var statusColumn = index[normalizeHeader_('対応状況')];
  values.slice(1).forEach(function (row, offset) {
    if (!resolvedKeys[normalizeText_(row[keyColumn])] || normalizeText_(row[statusColumn]) === '対応済み') return;
    try {
      reviewSheet.getRange(offset + 2, statusColumn + 1).setValues([['対応済み']]);
    } catch (error) {
      if (!resolutionIssues) throw error;
      resolutionIssues.push(makeIssue_('ERROR', 'E_BUREAU_RESOLUTION_STATUS_FAILED',
        '確認結果の完了更新に失敗しました。次回の局別同期で再確認します。', {
          sourceSheet: APP_CONFIG.sheets.manualReview, rowNumber: offset + 2, columnName: '対応状況'
        }));
    }
  });
  var pending = pendingManualReviewCountFromValues_(readSheetValues_(reviewSheet));
  reviewSheet.setTabColor(pending > 0 ? '#d93025' : null);
  return pending;
}

function selectedBureauReviewKeys_(spreadsheet) {
  var sheet = spreadsheet.getActiveSheet();
  var range = sheet && sheet.getActiveRange();
  if (!sheet || sheet.getName() !== APP_CONFIG.sheets.manualReview || !range || range.getRow() < 2) {
    throw makeAppError_('E_BUREAU_RESOLUTION_SELECTION', '26要手動確認で対象の行を選択してください。');
  }
  var output = validateExactHeaders_(sheet, APP_CONFIG.manualReviewHeaders, 'E_MANUAL_REVIEW_HEADER_MISSING');
  var index = output.headerIndex[normalizeHeader_('確認キー')];
  var keys = output.values.slice(range.getRow() - 1, range.getRow() - 1 + range.getNumRows())
    .map(function (row) { return normalizeText_(row[index]); });
  if (keys.length !== range.getNumRows() || keys.some(function (key) { return !key; })) {
    throw makeAppError_('E_BUREAU_RESOLUTION_SELECTION', '確認キーのある対象行だけを選択してください。');
  }
  return keys;
}

function proposeBureauResolutions_(inputs, keys, kind, before, after) {
  var raw = rawBureauRecords_(inputs);
  var additions = {};
  keys.forEach(function (key) {
    var record = raw.find(function (candidate) { return bureauResponseId_(candidate) === key; });
    if (!record || (kind === '別企画' ? record.sourceType !== 'STAFF_FORM' : record.sourceType !== 'STAFF_CHANGE')) {
      throw makeAppError_('E_BUREAU_RESOLUTION_SELECTION', '選択した入力種別はこの操作の対象外です。');
    }
    additions[key] = { kind: kind, fingerprint: bureauSourceFingerprint_(record), before: before || '', after: after || '' };
  });
  if (kind === '変更補正' && (keys.length !== 1 || !parseStructuredChange_(before).ok || !parseStructuredChange_(after).ok)) {
    throw makeAppError_('E_BUREAU_RESOLUTION_FORMAT', '変更申請を1行選び、補正前後を項目名：「内容」の形式で入力してください。');
  }
  if (kind === '別企画') {
    keys.forEach(function (key) {
      var record = raw.find(function (candidate) { return bureauResponseId_(candidate) === key; });
      var group = raw.filter(function (candidate) {
        return candidate.sourceType === 'STAFF_FORM' &&
          normalizeProjectNameKey_(candidate.projectName) === normalizeProjectNameKey_(record.projectName);
      });
      if (group.length < 2 || group.some(function (candidate) { return !additions[bureauResponseId_(candidate)]; })) {
        throw makeAppError_('E_BUREAU_RESOLUTION_GROUP', '別企画として残す同名の通常回答をすべて選択してください。');
      }
    });
  }
  return additions;
}

function saveBureauResolutions_(spreadsheet, additions) {
  var sheet = spreadsheet.getSheetByName(APP_CONFIG.sheets.bureauResolutions);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(APP_CONFIG.sheets.bureauResolutions);
    sheet.getRange(1, 1, 1, APP_CONFIG.bureauResolutionHeaders.length)
      .setValues([APP_CONFIG.bureauResolutionHeaders.slice()]);
    sheet.hideSheet();
  }
  var output = validateExactHeaders_(sheet, APP_CONFIG.bureauResolutionHeaders, 'E_BUREAU_RESOLUTION_HEADER_MISSING');
  var keyColumn = output.headerIndex[normalizeHeader_('入力識別子')];
  Object.keys(additions).forEach(function (key) {
    var resolution = additions[key];
    var fields = { '入力識別子': key, '処理区分': resolution.kind, '原本照合値': resolution.fingerprint,
      '補正変更前': resolution.before, '補正変更後': resolution.after, '記録日時': nowIso_() };
    var row = output.values[0].map(function (header) { return safeBureauOutputCell_(fields[normalizeHeader_(header)] || ''); });
    var existing = output.values.findIndex(function (value, index) { return index > 0 && normalizeText_(value[keyColumn]) === key; });
    sheet.getRange(existing < 0 ? sheet.getLastRow() + 1 : existing + 1, 1, 1, row.length).setValues([row]);
  });
}

function applyBureauResolutions_(preflight, additions, executionId) {
  var resolutions = bureauResolutionSet_(preflight.spreadsheet);
  var raw = rawBureauRecords_(preflight.inputs);
  Object.keys(additions).forEach(function (key) {
    var record = raw.find(function (candidate) { return bureauResponseId_(candidate) === key; });
    if (!record || additions[key].fingerprint !== bureauSourceFingerprint_(record)) {
      throw makeAppError_('E_BUREAU_RESOLUTION_STALE', '確認結果と原本が一致しません。再確認してください。');
    }
  });
  Object.keys(additions).forEach(function (key) { resolutions[key] = additions[key]; });
  var plan = buildBureauOutputPlan_(preflight.inputs, null,
    bureauResponseExclusionSet_(preflight.spreadsheet), resolutions);
  var targetIds = {};
  Object.keys(additions).forEach(function (key) {
    var targetId = additions[key].kind === '別企画' ? key : plan.resolvedChanges[key];
    if (!targetId) throw makeAppError_('E_BUREAU_RESOLUTION_NOT_APPLIED',
      '補正を適用できません。対象企画・変更前の完全一致・変更項目を確認してください。');
    targetIds[targetId] = true;
  });
  var targets = plan.records.filter(function (record) { return targetIds[bureauResponseId_(record)]; });
  var proposedOutputs = bureauOutputsWithResponseIds_(preflight.bureauOutputs, targets);
  var preview = planBureauDelta_(proposedOutputs, targets);
  if (targets.length !== Object.keys(targetIds).length || preview.issues.some(function (issue) {
    return issue.code !== 'E_BUREAU_ORPHAN_PRESERVED';
  })) throw makeAppError_('E_BUREAU_RESOLUTION_OUTPUT_AMBIGUOUS', '対象の既存行を一意に照合できないため登録を停止しました。');
  saveBureauResolutions_(preflight.spreadsheet, additions);
  var outputs = ensureBureauResponseIdColumns_(preflight.bureauOutputs, targets);
  var delta = planBureauDelta_(outputs, targets);
  applyBureauDelta_(delta);
  var live = outputs.map(function (output) {
    return { bureau: output.bureau, sheet: output.sheet, values: readSheetValues_(output.sheet) };
  });
  var remaining = planBureauDelta_(live, targets);
  if (remaining.appends.length || remaining.updates.length || remaining.deletes.length ||
    remaining.issues.some(function (issue) { return issue.code !== 'E_BUREAU_ORPHAN_PRESERVED'; }) ||
    delta.issues.some(function (issue) { return issue.code !== 'E_BUREAU_ORPHAN_PRESERVED'; })) {
    throw makeAppError_('E_BUREAU_RESOLUTION_INCOMPLETE', '確認結果は登録済みですが反映完了を確認できません。局別同期で再試行してください。');
  }
  var pending = completeBureauResolutions_(preflight.manualReview.sheet, plan, live, plan.reviews);
  var summary = { executionId: executionId, created: delta.created, updated: delta.updated,
    skipped: delta.skipped, needsReview: pending, errors: 0 };
  appendProcessLog_(preflight, executionId, 'bureau:resolveReview', summary, []);
  return summary;
}

function registerBureauResolutionFromUi_(kind) {
  var ui = SpreadsheetApp.getUi();
  var executionId = newExecutionId_();
  try {
    var spreadsheet = getBoundSpreadsheet_();
    validateEnvironment_(spreadsheet);
    var keys = selectedBureauReviewKeys_(spreadsheet);
    var before = '';
    var after = '';
    if (kind === '変更補正') {
      if (keys.length !== 1) throw makeAppError_('E_BUREAU_RESOLUTION_SELECTION', '変更申請を1行だけ選択してください。');
      var beforePrompt = ui.prompt('補正した変更前', '現在値を項目名：「内容」の形式で入力してください。原本は変更しません。', ui.ButtonSet.OK_CANCEL);
      if (beforePrompt.getSelectedButton() !== ui.Button.OK) return { cancelled: true };
      before = beforePrompt.getResponseText();
      var afterPrompt = ui.prompt('補正した変更後', '反映する値を同じ項目名：「内容」の形式で入力してください。', ui.ButtonSet.OK_CANCEL);
      if (afterPrompt.getSelectedButton() !== ui.Button.OK) return { cancelled: true };
      after = afterPrompt.getResponseText();
    }
    var initial = preflightInternal_({ inputs: true, bureaus: true, log: true });
    var proposed = proposeBureauResolutions_(initial.inputs, keys, kind, before, after);
    var raw = rawBureauRecords_(initial.inputs);
    var description = keys.map(function (key) {
      var record = raw.find(function (candidate) { return bureauResponseId_(candidate) === key; });
      return record.projectName + ' / ' + record.bureau + ' / 入力行 ' + record.rowNumber;
    }).join('\n');
    if (kind === '変更補正') description += '\n変更前:\n' + before + '\n変更後:\n' + after;
    else description += '\n選択した回答をそれぞれ別企画として残します。';
    if (ui.alert('局別の確認結果を登録', description + '\n反映を確認してから対応済みにします。続行しますか？',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return { cancelled: true };
    var result = withScriptLock_(function () {
      var current = preflightInternal_({ inputs: true, bureaus: true, log: true });
      var checked = proposeBureauResolutions_(current.inputs, keys, kind, before, after);
      if (JSON.stringify(checked) !== JSON.stringify(proposed)) {
        throw makeAppError_('E_BUREAU_RESOLUTION_STALE', '確認中に原本が変わりました。選択し直してください。');
      }
      return applyBureauResolutions_(current, checked, executionId);
    });
    showSummary_('局別の確認結果を反映しました', result);
    return result;
  } catch (error) {
    safeAppendFailureLog_('bureau:resolveReview', executionId, error);
    ui.alert('確認結果の反映に失敗しました', (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message), ui.ButtonSet.OK);
    return { executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}

function registerSelectedSeparateProjects() {
  return registerBureauResolutionFromUi_('別企画');
}

function registerSelectedChangeCorrection() {
  return registerBureauResolutionFromUi_('変更補正');
}
