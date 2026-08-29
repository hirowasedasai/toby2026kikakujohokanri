function isStaffBureauSource_(source) {
  return source && (source.type === 'STAFF_FORM' || source.type === 'STAFF_CHANGE');
}

function bureauOutputByValue_(bureau) {
  var normalized = normalizeText_(bureau);
  return APP_CONFIG.sheets.bureauOutputs.find(function (output) {
    return normalizeText_(output.bureau) === normalized;
  }) || null;
}

function bureauInputField_(row, headerPositions, field) {
  var candidates = APP_CONFIG.bureauViewHeaderCandidates[field] || [];
  for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    var positions = headerPositions[normalizeHeader_(candidates[candidateIndex])] || [];
    for (var positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
      var value = inputCell_(row, positions[positionIndex]);
      if (normalizeText_(value)) return value;
    }
  }
  return '';
}

function safeBureauOutputCell_(value) {
  if (value instanceof Date) return value;
  if (value === null || value === undefined) return '';
  var text = String(value);
  return normalizeText_(text).indexOf('=') === 0 ? "'" + text : text;
}

function normalizeProjectNameKey_(value) {
  return normalizeText_(value).replace(/[\s\u3000]+/g, ' ').toLowerCase();
}

function normalizeChangeValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, APP_CONFIG.timeZone, 'HH:mm');
  }
  return normalizeText_(value).replace(/[\s\u3000]+/g, ' ');
}

function formatBureauTime_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, APP_CONFIG.timeZone, 'HH:mm');
  }
  return normalizeText_(value);
}

function bureauRecordFromInputRow_(row, rowNumber, batch, headerPositions) {
  return {
    timestamp: bureauInputField_(row, headerPositions, 'timestamp'),
    bureau: normalizeText_(bureauInputField_(row, headerPositions, 'bureau')),
    department: bureauInputField_(row, headerPositions, 'department'),
    projectName: bureauInputField_(row, headerPositions, 'projectName'),
    staffName: bureauInputField_(row, headerPositions, 'staffName'),
    introduction: bureauInputField_(row, headerPositions, 'introduction'),
    place: bureauInputField_(row, headerPositions, 'place'),
    scheduleOverride: '',
    firstDayStart: bureauInputField_(row, headerPositions, 'firstDayStart'),
    firstDayEnd: bureauInputField_(row, headerPositions, 'firstDayEnd'),
    secondDayStart: bureauInputField_(row, headerPositions, 'secondDayStart'),
    secondDayEnd: bureauInputField_(row, headerPositions, 'secondDayEnd'),
    otherSchedule: bureauInputField_(row, headerPositions, 'otherSchedule'),
    genres: bureauInputField_(row, headerPositions, 'genres'),
    mainGenre: bureauInputField_(row, headerPositions, 'mainGenre'),
    ticketDistribution: bureauInputField_(row, headerPositions, 'ticketDistribution'),
    ticketDetails: bureauInputField_(row, headerPositions, 'ticketDetails'),
    guest: bureauInputField_(row, headerPositions, 'guest'),
    guestName: bureauInputField_(row, headerPositions, 'guestName'),
    guestKana: bureauInputField_(row, headerPositions, 'guestKana'),
    guestTitle: bureauInputField_(row, headerPositions, 'guestTitle'),
    guestPublication: bureauInputField_(row, headerPositions, 'guestPublication'),
    beforeChange: bureauInputField_(row, headerPositions, 'beforeChange'),
    beforeImage: bureauInputField_(row, headerPositions, 'beforeImage'),
    afterChange: bureauInputField_(row, headerPositions, 'afterChange'),
    afterImage: bureauInputField_(row, headerPositions, 'afterImage'),
    notes: bureauInputField_(row, headerPositions, 'notes'),
    sourceSheet: batch.source.name,
    sourceType: batch.source.type,
    rowNumber: rowNumber,
    changeStatus: '変更なし',
    lastChangeAt: ''
  };
}

function scheduleSummary_(record) {
  if (normalizeText_(record.scheduleOverride)) return record.scheduleOverride;
  var parts = [];
  var firstStart = formatBureauTime_(record.firstDayStart);
  var firstEnd = formatBureauTime_(record.firstDayEnd);
  var secondStart = formatBureauTime_(record.secondDayStart);
  var secondEnd = formatBureauTime_(record.secondDayEnd);
  if (firstStart || firstEnd) parts.push('11/7 ' + firstStart + (firstEnd ? '〜' + firstEnd : ''));
  if (secondStart || secondEnd) parts.push('11/8 ' + secondStart + (secondEnd ? '〜' + secondEnd : ''));
  if (normalizeText_(record.otherSchedule)) parts.push(normalizeText_(record.otherSchedule));
  return parts.join(' / ');
}

function genreSummary_(record) {
  var parts = [];
  if (normalizeText_(record.mainGenre)) parts.push('メイン: ' + normalizeText_(record.mainGenre));
  if (normalizeText_(record.genres)) parts.push(normalizeText_(record.genres));
  return parts.join(' / ');
}

function ticketSummary_(record) {
  var parts = [];
  if (normalizeText_(record.ticketDistribution)) parts.push(normalizeText_(record.ticketDistribution));
  if (normalizeText_(record.ticketDetails)) parts.push(normalizeText_(record.ticketDetails));
  return parts.join(' / ');
}

function guestSummary_(record) {
  var parts = [];
  [
    ['有無', record.guest],
    ['氏名', record.guestName],
    ['フリガナ', record.guestKana],
    ['肩書き', record.guestTitle],
    ['公表', record.guestPublication]
  ].forEach(function (entry) {
    if (normalizeText_(entry[1])) parts.push(entry[0] + ': ' + normalizeText_(entry[1]));
  });
  return parts.join(' / ');
}

function bureauOutputValueByHeader_(record, header) {
  var values = {
    '企画名': record.projectName,
    '企画紹介文': record.introduction,
    '担当者名': record.staffName,
    '部署名': record.department,
    '企画場所': record.place,
    '企画日時': scheduleSummary_(record),
    '企画ジャンル': genreSummary_(record),
    '整理券情報': ticketSummary_(record),
    'ゲスト情報': guestSummary_(record),
    '備考': record.notes,
    '変更反映状況': record.changeStatus,
    '最終変更申請日時': record.lastChangeAt
  };
  var normalizedHeader = normalizeHeader_(header);
  return Object.prototype.hasOwnProperty.call(values, normalizedHeader)
    ? safeBureauOutputCell_(values[normalizedHeader])
    : '';
}

function changeFieldFromLabel_(label) {
  var normalized = normalizeHeader_(label);
  for (var index = 0; index < APP_CONFIG.staffChangeFields.length; index += 1) {
    var definition = APP_CONFIG.staffChangeFields[index];
    var matches = definition.labels.some(function (candidate) {
      return normalizeHeader_(candidate) === normalized;
    });
    if (matches) return definition.field;
  }
  return '';
}

function parseStructuredChange_(value) {
  var text = normalizeText_(value);
  if (!text) return { ok: false, reason: '変更内容が空欄です。', entries: [] };
  var lines = String(value).split(/\r?\n/).map(function (line) {
    return line.trim();
  }).filter(function (line) {
    return Boolean(line);
  });
  var entries = [];
  var seenFields = {};
  for (var index = 0; index < lines.length; index += 1) {
    var match = lines[index].match(/^(.+?)[：:]\s*[「『](.*)[」』]\s*[。．]?\s*$/);
    if (!match) {
      return { ok: false, reason: '「項目名：「内容」」の形式で解析できない行があります。', entries: [] };
    }
    var field = changeFieldFromLabel_(match[1]);
    if (!field) {
      return { ok: false, reason: '自動反映に未対応の変更項目があります。', entries: [] };
    }
    if (seenFields[field]) {
      return { ok: false, reason: '同じ変更項目が複数回記載されています。', entries: [] };
    }
    seenFields[field] = true;
    entries.push({ field: field, value: match[2] });
  }
  return { ok: true, reason: '', entries: entries };
}

function changeEntriesByField_(entries) {
  var result = {};
  entries.forEach(function (entry) {
    result[entry.field] = entry.value;
  });
  return result;
}

function recordValueForChangeField_(record, field) {
  if (field === 'scheduleOverride') return scheduleSummary_(record);
  return Object.prototype.hasOwnProperty.call(record, field) ? record[field] : '';
}

function copyBureauRecord_(record) {
  var copy = {};
  Object.keys(record).forEach(function (key) {
    copy[key] = record[key];
  });
  return copy;
}

function manualReviewFromChange_(change, reason) {
  return {
    reviewKey: change.sourceSheet + ':' + change.rowNumber,
    timestamp: change.timestamp,
    bureau: change.bureau,
    department: change.department,
    projectName: change.projectName,
    staffName: change.staffName,
    reason: reason,
    beforeChange: change.beforeChange,
    afterChange: change.afterChange,
    beforeImage: change.beforeImage,
    afterImage: change.afterImage,
    sourceSheet: change.sourceSheet,
    rowNumber: change.rowNumber
  };
}

function makeChangeReviewIssue_(change, code, reason) {
  return makeIssue_('WARN', code, reason, {
    sourceSheet: change.sourceSheet,
    rowNumber: change.rowNumber,
    columnName: '変更前,変更後'
  });
}

function addProjectIndexRecord_(index, record) {
  var key = normalizeProjectNameKey_(record.projectName);
  if (!index[key]) index[key] = [];
  index[key].push(record);
}

function removeProjectIndexRecord_(index, key, record) {
  if (!index[key]) return;
  index[key] = index[key].filter(function (candidate) {
    return candidate !== record;
  });
  if (index[key].length === 0) delete index[key];
}

function evaluateStaffChange_(change, projectIndex) {
  var key = normalizeProjectNameKey_(change.projectName);
  var matches = projectIndex[key] || [];
  if (matches.length === 0) {
    return { applied: false, code: 'E_CHANGE_PROJECT_NOT_FOUND', reason: '企画名に一致する通常回答がありません。' };
  }
  if (matches.length > 1) {
    return { applied: false, code: 'E_CHANGE_PROJECT_AMBIGUOUS', reason: '同じ企画名の通常回答が複数あります。' };
  }
  var target = matches[0];
  if (normalizeText_(target.bureau) !== normalizeText_(change.bureau)) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return { applied: false, code: 'E_CHANGE_BUREAU_MISMATCH', reason: '変更申請と通常回答の所属局が一致しません。', target: target };
  }
  if (normalizeText_(target.department) !== normalizeText_(change.department)) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return { applied: false, code: 'E_CHANGE_DEPARTMENT_MISMATCH', reason: '変更申請と通常回答の部署名が一致しません。', target: target };
  }
  if (normalizeText_(change.beforeImage) || normalizeText_(change.afterImage)) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return { applied: false, code: 'E_CHANGE_IMAGE_REVIEW_REQUIRED', reason: '画像変更は自動反映せず手動確認が必要です。', target: target };
  }

  var before = parseStructuredChange_(change.beforeChange);
  var after = parseStructuredChange_(change.afterChange);
  if (!before.ok || !after.ok) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return {
      applied: false,
      code: 'E_CHANGE_FORMAT_INVALID',
      reason: !before.ok ? '変更前: ' + before.reason : '変更後: ' + after.reason,
      target: target
    };
  }
  var beforeByField = changeEntriesByField_(before.entries);
  var afterByField = changeEntriesByField_(after.entries);
  var beforeFields = Object.keys(beforeByField).sort();
  var afterFields = Object.keys(afterByField).sort();
  if (beforeFields.join('|') !== afterFields.join('|')) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return { applied: false, code: 'E_CHANGE_FIELDS_MISMATCH', reason: '変更前と変更後の項目が一致しません。', target: target };
  }
  var mismatch = beforeFields.find(function (field) {
    return normalizeChangeValue_(recordValueForChangeField_(target, field)) !==
      normalizeChangeValue_(beforeByField[field]);
  });
  if (mismatch) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return { applied: false, code: 'E_CHANGE_BEFORE_MISMATCH', reason: '通常回答の現在値と「変更前」が一致しません。', target: target };
  }

  var next = copyBureauRecord_(target);
  beforeFields.forEach(function (field) {
    next[field] = afterByField[field];
  });
  if (!bureauOutputByValue_(next.bureau)) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return { applied: false, code: 'E_CHANGE_BUREAU_INVALID', reason: '変更後の所属局が許可された選択肢に一致しません。', target: target };
  }
  var nextProjectKey = normalizeProjectNameKey_(next.projectName);
  var conflicts = (projectIndex[nextProjectKey] || []).filter(function (candidate) {
    return candidate !== target;
  });
  if (!nextProjectKey || conflicts.length > 0) {
    target.changeStatus = '要手動確認';
    target.lastChangeAt = change.timestamp;
    return { applied: false, code: 'E_CHANGE_PROJECT_NAME_CONFLICT', reason: '変更後の企画名が空欄、または既存企画名と重複します。', target: target };
  }

  var previousProjectKey = normalizeProjectNameKey_(target.projectName);
  Object.keys(next).forEach(function (field) {
    target[field] = next[field];
  });
  target.changeStatus = '自動反映済み';
  target.lastChangeAt = change.timestamp;
  if (previousProjectKey !== nextProjectKey) {
    removeProjectIndexRecord_(projectIndex, previousProjectKey, target);
    addProjectIndexRecord_(projectIndex, target);
  }
  return { applied: true, code: '', reason: '', target: target };
}

function buildBureauOutputPlan_(inputBatches, headersByBureau) {
  var rowsByBureau = {};
  APP_CONFIG.sheets.bureauOutputs.forEach(function (output) {
    rowsByBureau[output.bureau] = [];
  });
  var baseRecords = [];
  var changeRecords = [];
  var issues = [];
  var reviews = [];
  var skipped = 0;

  inputBatches.forEach(function (batch) {
    if (!isStaffBureauSource_(batch.source)) return;
    var headerPositions = buildHeaderPositions_(batch.values[0] || []);
    batch.values.slice(1).forEach(function (row, offset) {
      if (isBlankRow_(row)) return;
      var record = bureauRecordFromInputRow_(row, offset + 2, batch, headerPositions);
      if (batch.source.type === 'STAFF_CHANGE') {
        changeRecords.push(record);
        return;
      }
      if (!bureauOutputByValue_(record.bureau)) {
        skipped += 1;
        issues.push(makeIssue_('ERROR', 'E_BUREAU_VALUE_INVALID', '通常回答の所属局が許可された選択肢に一致しません。', {
          sourceSheet: record.sourceSheet,
          rowNumber: record.rowNumber,
          columnName: '所属局'
        }));
        return;
      }
      baseRecords.push(record);
    });
  });

  var projectIndex = {};
  baseRecords.forEach(function (record) {
    addProjectIndexRecord_(projectIndex, record);
  });

  var appliedChanges = 0;
  changeRecords.forEach(function (change) {
    var result = evaluateStaffChange_(change, projectIndex);
    if (result.applied) {
      appliedChanges += 1;
      return;
    }
    skipped += 1;
    reviews.push(manualReviewFromChange_(change, result.reason));
    issues.push(makeChangeReviewIssue_(change, result.code, result.reason));
  });

  baseRecords.forEach(function (record) {
    var output = bureauOutputByValue_(record.bureau);
    if (!output) return;
    var targetHeaders = headersByBureau && headersByBureau[output.bureau]
      ? headersByBureau[output.bureau]
      : APP_CONFIG.bureauOutputHeaders;
    rowsByBureau[output.bureau].push(targetHeaders.map(function (header) {
      return bureauOutputValueByHeader_(record, header);
    }));
  });

  return {
    rowsByBureau: rowsByBureau,
    reviews: reviews,
    issues: issues,
    skipped: skipped,
    appliedChanges: appliedChanges,
    sourceRowCount: baseRecords.length + changeRecords.length
  };
}

function headerSetMatches_(actualHeaders, expectedHeaders) {
  if (actualHeaders.length !== expectedHeaders.length) return false;
  var actual = actualHeaders.map(normalizeHeader_).sort();
  var expected = expectedHeaders.map(normalizeHeader_).sort();
  return actual.join('|') === expected.join('|');
}

function writeGeneratedHeaders_(sheet, headers) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow > 0 && lastColumn > 0) sheet.getRange(1, 1, lastRow, lastColumn).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
  sheet.setFrozenRows(1);
}

function prepareBureauOutputSheets_(spreadsheet) {
  return APP_CONFIG.sheets.bureauOutputs.map(function (output) {
    var sheet = requireSheet_(spreadsheet, output.name);
    var values = readSheetValues_(sheet);
    if (values.length === 0 || isBlankRow_(values[0])) {
      writeGeneratedHeaders_(sheet, APP_CONFIG.bureauOutputHeaders);
    } else if (headerSetMatches_(values[0], APP_CONFIG.legacyBureauOutputHeaders)) {
      writeGeneratedHeaders_(sheet, APP_CONFIG.bureauOutputHeaders);
    }
    var validation = validateExactHeaders_(
      sheet,
      APP_CONFIG.bureauOutputHeaders,
      'E_BUREAU_OUTPUT_HEADER_MISSING'
    );
    validation.bureau = output.bureau;
    return validation;
  });
}

function prepareManualReviewSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(APP_CONFIG.sheets.manualReview);
  if (!sheet) sheet = spreadsheet.insertSheet(APP_CONFIG.sheets.manualReview);
  var values = readSheetValues_(sheet);
  if (values.length === 0 || isBlankRow_(values[0])) {
    writeGeneratedHeaders_(sheet, APP_CONFIG.manualReviewHeaders);
  }
  return validateExactHeaders_(
    sheet,
    APP_CONFIG.manualReviewHeaders,
    'E_MANUAL_REVIEW_HEADER_MISSING'
  );
}

function replaceBureauOutputData_(sheet, rows, width) {
  var previousDataRows = Math.max(sheet.getLastRow() - 1, 0);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, width).setValues(rows);
  if (previousDataRows > rows.length) {
    sheet.getRange(rows.length + 2, 1, previousDataRows - rows.length, width).clearContent();
  }
}

function existingReviewStatuses_(values) {
  if (!values || values.length < 2) return {};
  var index = buildHeaderIndex_(values[0]);
  var keyColumn = index[normalizeHeader_('確認キー')];
  var statusColumn = index[normalizeHeader_('対応状況')];
  var statuses = {};
  values.slice(1).forEach(function (row) {
    var key = normalizeText_(row[keyColumn]);
    if (key) statuses[key] = normalizeText_(row[statusColumn]);
  });
  return statuses;
}

function manualReviewValueByHeader_(review, header, statuses) {
  var values = {
    '確認キー': review.reviewKey,
    '受付日時': review.timestamp,
    '所属局': review.bureau,
    '部署名': review.department,
    '企画名': review.projectName,
    '担当者名': review.staffName,
    '要確認理由': review.reason,
    '変更前': review.beforeChange,
    '変更後': review.afterChange,
    '変更前画像': review.beforeImage,
    '変更後画像': review.afterImage,
    '入力タブ': review.sourceSheet,
    '入力行': review.rowNumber,
    '対応状況': statuses[review.reviewKey] || '未対応'
  };
  var normalizedHeader = normalizeHeader_(header);
  return Object.prototype.hasOwnProperty.call(values, normalizedHeader)
    ? safeBureauOutputCell_(values[normalizedHeader])
    : '';
}

function pendingManualReviewCountFromValues_(values) {
  if (!values || values.length < 2) return 0;
  var index = buildHeaderIndex_(values[0]);
  var statusColumn = index[normalizeHeader_('対応状況')];
  return values.slice(1).filter(function (row) {
    return !isBlankRow_(row) && normalizeText_(row[statusColumn]) !== '対応済み';
  }).length;
}

function replaceManualReviewData_(reviewSheet, reviews) {
  var headers = reviewSheet.values[0];
  var statuses = existingReviewStatuses_(reviewSheet.values);
  var rows = reviews.map(function (review) {
    return headers.map(function (header) {
      return manualReviewValueByHeader_(review, header, statuses);
    });
  });
  var previousDataRows = Math.max(reviewSheet.sheet.getLastRow() - 1, 0);
  if (rows.length > 0) reviewSheet.sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  if (previousDataRows > rows.length) {
    reviewSheet.sheet.getRange(rows.length + 2, 1, previousDataRows - rows.length, headers.length).clearContent();
  }
  var pending = rows.filter(function (row) {
    return normalizeText_(row[headers.map(normalizeHeader_).indexOf(normalizeHeader_('対応状況'))]) !== '対応済み';
  }).length;
  reviewSheet.sheet.setTabColor(pending > 0 ? '#d93025' : null);
  return pending;
}

function performBuildBureauOutputs_(suppliedPreflight, executionId) {
  var preflight = suppliedPreflight || preflightInternal_({
    inputs: true,
    master: false,
    outputs: false,
    bureaus: false,
    log: true
  });
  var bureauOutputs = preflight.bureauOutputs || prepareBureauOutputSheets_(preflight.spreadsheet);
  var manualReview = preflight.manualReview || prepareManualReviewSheet_(preflight.spreadsheet);
  var headersByBureau = {};
  bureauOutputs.forEach(function (output) {
    headersByBureau[output.bureau] = output.values[0];
  });
  var plan = buildBureauOutputPlan_(preflight.inputs, headersByBureau);
  var created = 0;
  bureauOutputs.forEach(function (output) {
    var rows = plan.rowsByBureau[output.bureau];
    replaceBureauOutputData_(output.sheet, rows, output.values[0].length);
    created += rows.length;
  });
  var pendingReviews = replaceManualReviewData_(manualReview, plan.reviews);
  var summary = {
    created: created,
    updated: plan.appliedChanges,
    skipped: plan.skipped,
    needsReview: pendingReviews,
    errors: plan.issues.length,
    executionId: executionId
  };
  appendProcessLog_(preflight, executionId, 'buildOutput:bureaus', summary, plan.issues);
  return summary;
}

function buildBureauOutputs() {
  var executionId = newExecutionId_();
  try {
    var summary = withScriptLock_(function () {
      return performBuildBureauOutputs_(null, executionId);
    });
    showSummary_('局別タブ更新完了', summary);
    return summary;
  } catch (error) {
    safeAppendFailureLog_('buildOutput:bureaus', executionId, error);
    SpreadsheetApp.getUi().alert(
      '局別タブ更新失敗',
      (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return { executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}

function openManualReview() {
  var spreadsheet = getBoundSpreadsheet_();
  validateEnvironment_(spreadsheet);
  var sheet = requireSheet_(spreadsheet, APP_CONFIG.sheets.manualReview);
  spreadsheet.setActiveSheet(sheet);
  sheet.activate();
}

function showPendingManualReviewToast_() {
  try {
    var spreadsheet = getBoundSpreadsheet_();
    var sheet = spreadsheet.getSheetByName(APP_CONFIG.sheets.manualReview);
    if (!sheet) return;
    var pending = pendingManualReviewCountFromValues_(readSheetValues_(sheet));
    if (pending > 0) {
      spreadsheet.toast('未対応の変更申請が' + pending + '件あります。26要手動確認を確認してください。', APP_CONFIG.appName, 10);
    }
  } catch {
    console.error('Manual review notification could not be shown.');
  }
}
