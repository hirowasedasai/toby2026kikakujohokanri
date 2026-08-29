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
  var record = {
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
  record.matchProjectKeys = [normalizeProjectNameKey_(record.projectName)];
  return record;
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
    if (target.matchProjectKeys.indexOf(previousProjectKey) < 0) {
      target.matchProjectKeys.push(previousProjectKey);
    }
    if (target.matchProjectKeys.indexOf(nextProjectKey) < 0) {
      target.matchProjectKeys.push(nextProjectKey);
    }
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
    records: baseRecords,
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

function bureauManualDefaultByHeader_(record, header) {
  var values = {
    '内部向け企画・取り組み名': record ? record.projectName : '',
    '掲載文字情報': record ? record.introduction : '',
    'ページ名': '',
    '掲載媒体': '',
    '当媒チェック': '未確認',
    '校閲チェック': '未確認'
  };
  var normalized = normalizeHeader_(header);
  return Object.prototype.hasOwnProperty.call(values, normalized)
    ? safeBureauOutputCell_(values[normalized])
    : '';
}

function isBureauManualHeader_(header) {
  var normalized = normalizeHeader_(header);
  return APP_CONFIG.bureauManualHeaders.some(function (candidate) {
    return normalizeHeader_(candidate) === normalized;
  });
}

function migratePreviousBureauRows_(values) {
  if (!values || values.length < 2) return [];
  var previousHeaders = values[0];
  var previousIndex = buildHeaderIndex_(previousHeaders);
  var projectColumn = previousIndex[normalizeHeader_('企画名')];
  var introductionColumn = previousIndex[normalizeHeader_('企画紹介文')];
  return values.slice(1).filter(function (row) {
    return !isBlankRow_(row);
  }).map(function (row) {
    var record = {
      projectName: projectColumn === undefined ? '' : row[projectColumn],
      introduction: introductionColumn === undefined ? '' : row[introductionColumn]
    };
    return APP_CONFIG.bureauOutputHeaders.map(function (header) {
      var previousColumn = previousIndex[normalizeHeader_(header)];
      if (previousColumn !== undefined) return row[previousColumn];
      return bureauManualDefaultByHeader_(record, header);
    });
  });
}

function migrateBureauSheet_(sheet, values) {
  var migratedRows = migratePreviousBureauRows_(values);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow > 0 && lastColumn > 0) {
    sheet.getRange(1, 1, lastRow, lastColumn).clearContent();
  }
  sheet.getRange(1, 1, 1, APP_CONFIG.bureauOutputHeaders.length)
    .setValues([APP_CONFIG.bureauOutputHeaders.slice()]);
  if (migratedRows.length > 0) {
    sheet.getRange(2, 1, migratedRows.length, APP_CONFIG.bureauOutputHeaders.length)
      .setValues(migratedRows);
  }
  sheet.setFrozenRows(1);
}

function applyBureauCheckValidation_(sheet, headerIndex) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['未確認', '確認中', '確認済み', '修正必要'], true)
    .setAllowInvalid(false)
    .build();
  ['当媒チェック', '校閲チェック'].forEach(function (header) {
    var column = headerIndex[normalizeHeader_(header)];
    if (column === undefined) return;
    sheet.getRange(2, column + 1, Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setDataValidation(rule);
  });
}

function prepareBureauOutputSheets_(spreadsheet) {
  return APP_CONFIG.sheets.bureauOutputs.map(function (output) {
    var sheet = requireSheet_(spreadsheet, output.name);
    var values = readSheetValues_(sheet);
    var schemaChanged = false;
    if (values.length === 0 || isBlankRow_(values[0])) {
      writeGeneratedHeaders_(sheet, APP_CONFIG.bureauOutputHeaders);
      schemaChanged = true;
    } else if (headerSetMatches_(values[0], APP_CONFIG.previousBureauOutputHeaders)) {
      migrateBureauSheet_(sheet, values);
      schemaChanged = true;
    } else if (headerSetMatches_(values[0], APP_CONFIG.legacyBureauOutputHeaders)) {
      writeGeneratedHeaders_(sheet, APP_CONFIG.bureauOutputHeaders);
      schemaChanged = true;
    }
    var validation = validateExactHeaders_(
      sheet,
      APP_CONFIG.bureauOutputHeaders,
      'E_BUREAU_OUTPUT_HEADER_MISSING'
    );
    validation.bureau = output.bureau;
    if (schemaChanged) applyBureauCheckValidation_(sheet, validation.headerIndex);
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

function bureauRowsEqual_(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every(function (value, index) {
    return stringifyCell_(value) === stringifyCell_(right[index]);
  });
}

function changedBureauSegments_(existingRow, mergedRow) {
  var segments = [];
  var current = null;
  mergedRow.forEach(function (value, index) {
    if (stringifyCell_(existingRow[index]) === stringifyCell_(value)) {
      current = null;
      return;
    }
    if (!current || current.startColumn + current.values.length !== index + 1) {
      current = { startColumn: index + 1, values: [] };
      segments.push(current);
    }
    current.values.push(value);
  });
  return segments;
}

function mergeBureauRecordWithManualRow_(record, existingRow, existingHeaders, targetHeaders) {
  var existingIndex = existingHeaders ? buildHeaderIndex_(existingHeaders) : {};
  var existingIntroductionColumn = existingIndex[normalizeHeader_('企画紹介文')];
  var introductionChanged = Boolean(existingRow) && existingIntroductionColumn !== undefined &&
    normalizeChangeValue_(existingRow[existingIntroductionColumn]) !==
      normalizeChangeValue_(record.introduction);
  return targetHeaders.map(function (header) {
    if (!isBureauManualHeader_(header)) return bureauOutputValueByHeader_(record, header);
    if (
      introductionChanged &&
      (normalizeHeader_(header) === normalizeHeader_('当媒チェック') ||
        normalizeHeader_(header) === normalizeHeader_('校閲チェック'))
    ) {
      return '未確認';
    }
    var existingColumn = existingIndex[normalizeHeader_(header)];
    if (existingRow && existingColumn !== undefined) return existingRow[existingColumn];
    return bureauManualDefaultByHeader_(record, header);
  });
}

function manualReviewFromRecord_(record, reason) {
  return {
    reviewKey: record.sourceSheet + ':' + record.rowNumber,
    timestamp: record.timestamp,
    bureau: record.bureau,
    department: record.department,
    projectName: record.projectName,
    staffName: record.staffName,
    reason: reason,
    beforeChange: record.beforeChange || '',
    afterChange: record.afterChange || '',
    beforeImage: record.beforeImage || '',
    afterImage: record.afterImage || '',
    sourceSheet: record.sourceSheet,
    rowNumber: record.rowNumber
  };
}

function existingBureauEntries_(bureauOutputs) {
  var entries = [];
  bureauOutputs.forEach(function (output) {
    var headers = output.values[0] || [];
    var index = buildHeaderIndex_(headers);
    var projectColumn = index[normalizeHeader_('企画名')];
    output.values.slice(1).forEach(function (row, offset) {
      if (isBlankRow_(row)) return;
      entries.push({
        id: entries.length,
        output: output,
        row: row,
        rowNumber: offset + 2,
        projectKey: normalizeProjectNameKey_(row[projectColumn])
      });
    });
  });
  return entries;
}

function uniqueEntries_(entries) {
  var seen = {};
  return entries.filter(function (entry) {
    if (seen[entry.id]) return false;
    seen[entry.id] = true;
    return true;
  });
}

function planBureauDelta_(bureauOutputs, records) {
  var existing = existingBureauEntries_(bureauOutputs);
  var existingByKey = {};
  existing.forEach(function (entry) {
    if (!existingByKey[entry.projectKey]) existingByKey[entry.projectKey] = [];
    existingByKey[entry.projectKey].push(entry);
  });
  var desiredCounts = {};
  var desiredAliases = {};
  records.forEach(function (record) {
    var finalKey = normalizeProjectNameKey_(record.projectName);
    desiredCounts[finalKey] = (desiredCounts[finalKey] || 0) + 1;
    (record.matchProjectKeys || [finalKey]).forEach(function (key) {
      if (key) desiredAliases[key] = true;
    });
  });

  var delta = {
    appends: [],
    updates: [],
    deletes: [],
    reviews: [],
    issues: [],
    created: 0,
    updated: 0,
    skipped: 0
  };
  var consumed = {};
  records.forEach(function (record) {
    var finalKey = normalizeProjectNameKey_(record.projectName);
    if (!finalKey || desiredCounts[finalKey] > 1) {
      var sourceReason = !finalKey
        ? '企画名が空欄のため局別タブへ追加できません。'
        : '同じ企画名の通常回答が複数あるため差分更新しません。';
      delta.skipped += 1;
      delta.reviews.push(manualReviewFromRecord_(record, sourceReason));
      delta.issues.push(makeIssue_('WARN', 'E_BUREAU_SOURCE_PROJECT_AMBIGUOUS', sourceReason, {
        sourceSheet: record.sourceSheet,
        rowNumber: record.rowNumber,
        columnName: '企画名'
      }));
      return;
    }
    var matchKeys = (record.matchProjectKeys || [finalKey]).filter(function (key, index, keys) {
      return key && keys.indexOf(key) === index;
    });
    var candidates = uniqueEntries_(matchKeys.reduce(function (matches, key) {
      return matches.concat(existingByKey[key] || []);
    }, [])).filter(function (entry) {
      return !consumed[entry.id];
    });
    if (candidates.length > 1) {
      var existingReason = '企画名に一致する局別タブの既存行が複数あるため差分更新しません。';
      delta.skipped += 1;
      delta.reviews.push(manualReviewFromRecord_(record, existingReason));
      delta.issues.push(makeIssue_('WARN', 'E_BUREAU_EXISTING_PROJECT_AMBIGUOUS', existingReason, {
        sourceSheet: record.sourceSheet,
        rowNumber: record.rowNumber,
        columnName: '企画名'
      }));
      return;
    }
    var targetOutput = bureauOutputs.find(function (output) {
      return normalizeText_(output.bureau) === normalizeText_(record.bureau);
    });
    if (!targetOutput) return;
    if (candidates.length === 0) {
      delta.appends.push({
        output: targetOutput,
        row: mergeBureauRecordWithManualRow_(record, null, null, targetOutput.values[0])
      });
      delta.created += 1;
      return;
    }
    var existingEntry = candidates[0];
    consumed[existingEntry.id] = true;
    var merged = mergeBureauRecordWithManualRow_(
      record,
      existingEntry.row,
      existingEntry.output.values[0],
      targetOutput.values[0]
    );
    if (existingEntry.output === targetOutput) {
      if (bureauRowsEqual_(existingEntry.row.slice(0, merged.length), merged)) {
        delta.skipped += 1;
        return;
      }
      delta.updates.push({
        output: targetOutput,
        rowNumber: existingEntry.rowNumber,
        row: merged,
        segments: changedBureauSegments_(existingEntry.row, merged)
      });
      delta.updated += 1;
      return;
    }
    delta.appends.push({
      output: targetOutput,
      row: merged,
      source: existingEntry,
      record: record
    });
    delta.deletes.push(existingEntry);
    delta.updated += 1;
  });

  existing.forEach(function (entry) {
    if (consumed[entry.id] || desiredAliases[entry.projectKey]) return;
    var headers = entry.output.values[0];
    var index = buildHeaderIndex_(headers);
    var preservedRecord = {
      timestamp: '',
      bureau: entry.output.bureau,
      department: entry.row[index[normalizeHeader_('部署名')]],
      projectName: entry.row[index[normalizeHeader_('企画名')]],
      staffName: entry.row[index[normalizeHeader_('担当者名')]],
      sourceSheet: entry.output.sheet.getName(),
      rowNumber: entry.rowNumber
    };
    var orphanReason = '入力回答と照合できない既存行を削除せず保持しています。';
    delta.reviews.push(manualReviewFromRecord_(preservedRecord, orphanReason));
    delta.issues.push(makeIssue_('WARN', 'E_BUREAU_ORPHAN_PRESERVED', orphanReason, {
      sourceSheet: entry.output.sheet.getName(),
      rowNumber: entry.rowNumber,
      columnName: '企画名'
    }));
  });
  return delta;
}

function applyBureauDelta_(delta) {
  delta.updates.forEach(function (update) {
    update.segments.forEach(function (segment) {
      update.output.sheet.getRange(update.rowNumber, segment.startColumn, 1, segment.values.length)
        .setValues([segment.values]);
    });
  });
  var appendGroups = {};
  var approvedMoveSources = {};
  delta.appends.forEach(function (append) {
    if (append.source) {
      var sourceHeaders = append.source.output.values[0];
      var latestSourceRow = append.source.output.sheet
        .getRange(append.source.rowNumber, 1, 1, sourceHeaders.length)
        .getValues()[0];
      var sourceProjectColumn = buildHeaderIndex_(sourceHeaders)[normalizeHeader_('企画名')];
      if (normalizeProjectNameKey_(latestSourceRow[sourceProjectColumn]) !== append.source.projectKey) {
        var beforeMoveReason = '所属局移動前に移動元行が変わったため、この企画だけをスキップしました。';
        delta.updated = Math.max(delta.updated - 1, 0);
        delta.skipped += 1;
        delta.reviews.push(manualReviewFromRecord_(append.record, beforeMoveReason));
        delta.issues.push(makeIssue_('WARN', 'E_BUREAU_MOVE_SOURCE_CHANGED', beforeMoveReason, {
          sourceSheet: append.record.sourceSheet,
          rowNumber: append.record.rowNumber,
          columnName: '企画名'
        }));
        return;
      }
      append.row = mergeBureauRecordWithManualRow_(
        append.record,
        latestSourceRow,
        sourceHeaders,
        append.output.values[0]
      );
      approvedMoveSources[append.source.id] = append.record;
    }
    var key = append.output.bureau;
    if (!appendGroups[key]) appendGroups[key] = { output: append.output, rows: [] };
    appendGroups[key].rows.push(append.row);
  });
  Object.keys(appendGroups).forEach(function (key) {
    var group = appendGroups[key];
    var startRow = group.output.sheet.getLastRow() + 1;
    group.output.sheet.getRange(startRow, 1, group.rows.length, group.rows[0].length)
      .setValues(group.rows);
  });
  var deleteGroups = {};
  delta.deletes.forEach(function (entry) {
    if (!approvedMoveSources[entry.id]) return;
    var key = entry.output.bureau;
    if (!deleteGroups[key]) deleteGroups[key] = { output: entry.output, rows: [] };
    deleteGroups[key].rows.push(entry.rowNumber);
  });
  Object.keys(deleteGroups).forEach(function (key) {
    var group = deleteGroups[key];
    group.rows.sort(function (left, right) { return right - left; }).forEach(function (rowNumber) {
      var headers = group.output.values[0];
      var projectColumn = buildHeaderIndex_(headers)[normalizeHeader_('企画名')];
      var currentProject = group.output.sheet.getRange(rowNumber, projectColumn + 1).getValue();
      var expectedEntry = delta.deletes.find(function (entry) {
        return entry.output === group.output && entry.rowNumber === rowNumber;
      });
      if (!expectedEntry || normalizeProjectNameKey_(currentProject) !== expectedEntry.projectKey) {
        var afterMoveReason = '所属局移動後に削除対象行が変わったため、移動元を削除せず保持しました。';
        var moveRecord = expectedEntry ? approvedMoveSources[expectedEntry.id] : null;
        delta.skipped += 1;
        if (moveRecord) delta.reviews.push(manualReviewFromRecord_(moveRecord, afterMoveReason));
        delta.issues.push(makeIssue_('WARN', 'E_BUREAU_MOVE_SOURCE_CHANGED', afterMoveReason, {
          sourceSheet: group.output.sheet.getName(),
          rowNumber: rowNumber,
          columnName: '企画名'
        }));
        return;
      }
      group.output.sheet.deleteRow(rowNumber);
    });
  });
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

function syncManualReviewData_(reviewSheet, reviews) {
  var latestValues = readSheetValues_(reviewSheet.sheet);
  var headers = latestValues[0];
  var index = buildHeaderIndex_(headers);
  var keyColumn = index[normalizeHeader_('確認キー')];
  var statusColumn = index[normalizeHeader_('対応状況')];
  var statuses = existingReviewStatuses_(latestValues);
  var existingByKey = {};
  latestValues.slice(1).forEach(function (row, offset) {
    var key = normalizeText_(row[keyColumn]);
    if (key && !existingByKey[key]) {
      existingByKey[key] = { row: row, rowNumber: offset + 2 };
    }
  });
  var appends = [];
  reviews.forEach(function (review) {
    var desired = headers.map(function (header) {
      return manualReviewValueByHeader_(review, header, statuses);
    });
    var existing = existingByKey[review.reviewKey];
    if (!existing) {
      appends.push(desired);
      return;
    }
    desired[statusColumn] = existing.row[statusColumn];
    changedBureauSegments_(existing.row, desired).forEach(function (segment) {
      reviewSheet.sheet
        .getRange(existing.rowNumber, segment.startColumn, 1, segment.values.length)
        .setValues([segment.values]);
    });
  });
  if (appends.length > 0) {
    reviewSheet.sheet
      .getRange(reviewSheet.sheet.getLastRow() + 1, 1, appends.length, headers.length)
      .setValues(appends);
  }
  var pending = pendingManualReviewCountFromValues_(readSheetValues_(reviewSheet.sheet));
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
  var delta = planBureauDelta_(bureauOutputs, plan.records);
  applyBureauDelta_(delta);
  var allReviews = plan.reviews.concat(delta.reviews);
  var pendingReviews = syncManualReviewData_(manualReview, allReviews);
  var issues = plan.issues.concat(delta.issues);
  var summary = {
    created: delta.created,
    updated: delta.updated,
    skipped: plan.skipped + delta.skipped,
    needsReview: pendingReviews,
    errors: issues.length,
    executionId: executionId
  };
  appendProcessLog_(preflight, executionId, 'syncDelta:bureaus', summary, issues);
  return summary;
}

function buildBureauOutputs() {
  var executionId = newExecutionId_();
  try {
    var summary = withScriptLock_(function () {
      return performBuildBureauOutputs_(null, executionId);
    });
    showSummary_('局別タブ差分同期完了', summary);
    return summary;
  } catch (error) {
    safeAppendFailureLog_('syncDelta:bureaus', executionId, error);
    SpreadsheetApp.getUi().alert(
      '局別タブ差分同期失敗',
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

function onEdit(event) {
  try {
    if (!event || !event.range || event.range.getRow() <= 1) return;
    var sheet = event.range.getSheet();
    var isBureauSheet = APP_CONFIG.sheets.bureauOutputs.some(function (output) {
      return output.name === sheet.getName();
    });
    if (!isBureauSheet) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var index = buildHeaderIndex_(headers);
    var publishedColumn = index[normalizeHeader_('掲載文字情報')];
    if (publishedColumn === undefined) return;
    var firstEditedColumn = event.range.getColumn() - 1;
    var lastEditedColumn = firstEditedColumn + event.range.getNumColumns() - 1;
    if (publishedColumn < firstEditedColumn || publishedColumn > lastEditedColumn) return;
    var rowCount = event.range.getNumRows();
    ['当媒チェック', '校閲チェック'].forEach(function (header) {
      var checkColumn = index[normalizeHeader_(header)];
      if (checkColumn === undefined) return;
      var values = Array.from({ length: rowCount }, function () { return ['未確認']; });
      sheet.getRange(event.range.getRow(), checkColumn + 1, rowCount, 1).setValues(values);
    });
  } catch {
    console.error('Bureau manual check reset could not be applied.');
  }
}
