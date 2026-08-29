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

function bureauRecordFromInputRow_(row, rowNumber, batch, headerPositions) {
  var sourceType = batch.source.type;
  return {
    submissionType: sourceType === 'STAFF_CHANGE' ? '変更申請' : '企画情報',
    timestamp: bureauInputField_(row, headerPositions, 'timestamp'),
    bureau: normalizeText_(bureauInputField_(row, headerPositions, 'bureau')),
    department: bureauInputField_(row, headerPositions, 'department'),
    projectName: bureauInputField_(row, headerPositions, 'projectName'),
    staffName: bureauInputField_(row, headerPositions, 'staffName'),
    introduction: bureauInputField_(row, headerPositions, 'introduction'),
    place: bureauInputField_(row, headerPositions, 'place'),
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
    rowNumber: rowNumber
  };
}

function bureauOutputValueByHeader_(record, header) {
  var values = {
    '受付種別': record.submissionType,
    '回答日時': record.timestamp,
    '所属局': record.bureau,
    '部署名': record.department,
    '企画名': record.projectName,
    '担当者名': record.staffName,
    '企画紹介文': record.introduction,
    '企画場所': record.place,
    '11月7日開始': record.firstDayStart,
    '11月7日終了': record.firstDayEnd,
    '11月8日開始': record.secondDayStart,
    '11月8日終了': record.secondDayEnd,
    'その他企画日時': record.otherSchedule,
    '企画ジャンル': record.genres,
    '企画ジャンル(メイン)': record.mainGenre,
    '整理券配布': record.ticketDistribution,
    '整理券配布詳細': record.ticketDetails,
    'ゲスト': record.guest,
    'ゲスト名': record.guestName,
    'ゲスト名フリガナ': record.guestKana,
    'ゲスト肩書き': record.guestTitle,
    'ゲスト名の公表': record.guestPublication,
    '変更前': record.beforeChange,
    '変更前画像': record.beforeImage,
    '変更後': record.afterChange,
    '変更後画像': record.afterImage,
    '備考': record.notes,
    '入力タブ': record.sourceSheet,
    '入力行': record.rowNumber
  };
  var normalizedHeader = normalizeHeader_(header);
  return Object.prototype.hasOwnProperty.call(values, normalizedHeader)
    ? safeBureauOutputCell_(values[normalizedHeader])
    : '';
}

function buildBureauOutputPlan_(inputBatches, headersByBureau) {
  var rowsByBureau = {};
  APP_CONFIG.sheets.bureauOutputs.forEach(function (output) {
    rowsByBureau[output.bureau] = [];
  });
  var issues = [];
  var skipped = 0;
  var sourceRowCount = 0;

  inputBatches.forEach(function (batch) {
    if (!isStaffBureauSource_(batch.source)) return;
    var headerPositions = buildHeaderPositions_(batch.values[0] || []);
    batch.values.slice(1).forEach(function (row, offset) {
      if (isBlankRow_(row)) return;
      sourceRowCount += 1;
      var record = bureauRecordFromInputRow_(row, offset + 2, batch, headerPositions);
      var output = bureauOutputByValue_(record.bureau);
      if (!output) {
        skipped += 1;
        issues.push(makeIssue_(
          'ERROR',
          'E_BUREAU_VALUE_INVALID',
          '所属局が空欄、または許可された選択肢に一致しないため局別出力をスキップしました。',
          {
            sourceSheet: batch.source.name,
            rowNumber: record.rowNumber,
            columnName: '所属局'
          }
        ));
        return;
      }
      var targetHeaders = headersByBureau && headersByBureau[output.bureau]
        ? headersByBureau[output.bureau]
        : APP_CONFIG.bureauOutputHeaders;
      rowsByBureau[output.bureau].push(targetHeaders.map(function (header) {
        return bureauOutputValueByHeader_(record, header);
      }));
    });
  });

  return {
    rowsByBureau: rowsByBureau,
    issues: issues,
    skipped: skipped,
    sourceRowCount: sourceRowCount
  };
}

function prepareBureauOutputSheets_(spreadsheet) {
  return APP_CONFIG.sheets.bureauOutputs.map(function (output) {
    var sheet = requireSheet_(spreadsheet, output.name);
    var values = readSheetValues_(sheet);
    if (values.length === 0 || isBlankRow_(values[0])) {
      sheet.getRange(1, 1, 1, APP_CONFIG.bureauOutputHeaders.length)
        .setValues([APP_CONFIG.bureauOutputHeaders.slice()]);
      sheet.setFrozenRows(1);
      values = [APP_CONFIG.bureauOutputHeaders.slice()];
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

function replaceBureauOutputData_(sheet, rows, width) {
  var previousDataRows = Math.max(sheet.getLastRow() - 1, 0);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
  }
  if (previousDataRows > rows.length) {
    sheet.getRange(rows.length + 2, 1, previousDataRows - rows.length, width).clearContent();
  }
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
  var summary = {
    created: created,
    updated: 0,
    skipped: plan.skipped,
    needsReview: 0,
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
