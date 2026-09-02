function ensureSchemaSheet_(spreadsheet, sheetName, headers) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  var values = readSheetValues_(sheet);
  if (values.length === 0 || isBlankRow_(values[0])) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
    sheet.setFrozenRows(1);
    return;
  }
  validateExactHeaders_(sheet, headers, 'E_EXISTING_SCHEMA_MISMATCH');
}

function migrateParticipantRowsByHeader_(values) {
  if (!values || values.length < 2) return [];
  var sourceIndex = buildHeaderIndex_(values[0]);
  return values.slice(1).filter(function (row) {
    return !isBlankRow_(row);
  }).map(function (row) {
    return APP_CONFIG.participantOutputHeaders.map(function (header) {
      var column = sourceIndex[normalizeHeader_(header)];
      return column === undefined ? '' : row[column];
    });
  });
}

function migratePreviousParticipantTrackerRows_(values) {
  if (!values || values.length < 2) return [];
  var sourceIndex = buildHeaderIndex_(values[0]);
  var outputIndex = buildHeaderIndex_(APP_CONFIG.participantOutputHeaders);
  return values.slice(1).filter(function (sourceRow) {
    return !isBlankRow_(sourceRow);
  }).map(function (sourceRow) {
    var row = APP_CONFIG.participantOutputHeaders.map(function (header) {
      var column = sourceIndex[normalizeHeader_(header)];
      return column === undefined ? '' : sourceRow[column];
    });
    var oldResult = normalizeText_(
      sourceRow[sourceIndex[normalizeHeader_('照合結果')]]
    );
    var responseName = normalizeText_(
      participantTrackerCell_(row, outputIndex, '参参名・フォーム回答')
    );
    if (
      responseName &&
      (oldResult === '申込情報未登録' || oldResult === '参参名差異')
    ) {
      var currentStatus = normalizeText_(
        participantTrackerCell_(row, outputIndex, '提出状況')
      );
      if (currentStatus !== 'キャンセル') {
        setParticipantTrackerCell_(row, outputIndex, '提出状況', '提出済み');
      }
      setParticipantTrackerCell_(row, outputIndex, '照合結果', '一致');
    }
    if (oldResult === '申込情報不備') {
      setParticipantTrackerCell_(row, outputIndex, '照合結果', '一覧行不備');
    }
    return row;
  });
}

function migratePreviousParticipantRows_(values, masterValues) {
  if (!values || values.length < 2) return [];
  var previousIndex = buildHeaderIndex_(values[0]);
  var masterIndex = masterValues && masterValues.length > 0
    ? buildHeaderIndex_(masterValues[0])
    : {};
  var masterById = {};
  (masterValues || []).slice(1).forEach(function (row) {
    var idColumn = masterIndex[normalizeHeader_('管理ID')];
    if (idColumn === undefined) return;
    var managementId = normalizeText_(row[idColumn]);
    if (managementId) masterById[managementId] = row;
  });
  var participantSource = APP_CONFIG.sheets.inputs.find(function (source) {
    return source.type === 'FORM';
  });
  return values.slice(1).filter(function (row) {
    return !isBlankRow_(row);
  }).map(function (row) {
    var managementId = normalizeText_(
      row[previousIndex[normalizeHeader_('管理ID')]]
    );
    var masterRow = masterById[managementId];
    if (masterRow && participantSource) {
      var dataSource = normalizeText_(masterRow[masterIndex[normalizeHeader_('データソース')]]);
      if (dataSource && dataSource !== participantSource.name) return null;
    }
    var participation = row[previousIndex[normalizeHeader_('参加企画')]] || '';
    var organization = row[previousIndex[normalizeHeader_('団体名')]] || '';
    var projectName = row[previousIndex[normalizeHeader_('企画名')]] || '';
    var email = masterRow
      ? masterRow[masterIndex[normalizeHeader_('メールアドレス')]] || ''
      : '';
    var output = new Array(APP_CONFIG.participantOutputHeaders.length).fill('');
    var outputIndex = buildHeaderIndex_(APP_CONFIG.participantOutputHeaders);
    setParticipantTrackerCell_(output, outputIndex, '参加企画', participation);
    setParticipantTrackerCell_(output, outputIndex, '提出状況', email ? '提出済み' : '確認中');
    setParticipantTrackerCell_(output, outputIndex, 'メールアドレス', email);
    setParticipantTrackerCell_(output, outputIndex, '参参名・フォーム回答', organization);
    setParticipantTrackerCell_(output, outputIndex, '参参名・確定版', organization);
    setParticipantTrackerCell_(output, outputIndex, '企画名・フォーム回答', projectName);
    setParticipantTrackerCell_(output, outputIndex, '企画名・確定版', projectName);
    setParticipantTrackerCell_(
      output,
      outputIndex,
      '照合結果',
      email ? '一致' : '移行要確認'
    );
    setParticipantTrackerCell_(
      output,
      outputIndex,
      '最終同期日時',
      row[previousIndex[normalizeHeader_('最終更新日時')]] || ''
    );
    return output;
  }).filter(function (row) {
    return row !== null;
  });
}

function writeParticipantSchema_(sheet, rows) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow > 0 && lastColumn > 0) {
    sheet.getRange(1, 1, lastRow, lastColumn).clearContent();
  }
  sheet.getRange(1, 1, 1, APP_CONFIG.participantOutputHeaders.length)
    .setValues([APP_CONFIG.participantOutputHeaders.slice()]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, APP_CONFIG.participantOutputHeaders.length)
      .setValues(rows);
  }
}

function applyParticipantSheetPresentation_(sheet, headerIndex) {
  var statusColumn = headerIndex[normalizeHeader_('提出状況')];
  var dataRowCount = sheet.getMaxRows() - 1;
  if (statusColumn !== undefined && dataRowCount > 0) {
    var statusRange = sheet.getRange(2, statusColumn + 1, dataRowCount, 1);
    statusRange.clearDataValidations();
    statusRange.setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(APP_CONFIG.participantStatusOptions, true)
        .setAllowInvalid(false)
        .build()
    );
  }
  sheet.setFrozenRows(1);
  var frozenColumn = headerIndex[normalizeHeader_('メールアドレス')];
  if (frozenColumn !== undefined) sheet.setFrozenColumns(frozenColumn + 1);
  Object.keys(APP_CONFIG.participantColumnWidths).forEach(function (header) {
    var column = headerIndex[normalizeHeader_(header)];
    if (column !== undefined) sheet.setColumnWidth(column + 1, APP_CONFIG.participantColumnWidths[header]);
  });
  sheet.showColumns(1, APP_CONFIG.participantOutputHeaders.length);
  ['参参名・フォーム回答', '企画名・フォーム回答'].forEach(function (header) {
    var column = headerIndex[normalizeHeader_(header)];
    if (column !== undefined) sheet.hideColumns(column + 1);
  });
}

function ensureParticipantSchemaSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(APP_CONFIG.sheets.participantOutput);
  if (!sheet) sheet = spreadsheet.insertSheet(APP_CONFIG.sheets.participantOutput);
  var values = readSheetValues_(sheet);
  if (values.length === 0 || isBlankRow_(values[0])) {
    writeParticipantSchema_(sheet, []);
  } else if (
    headerSetMatches_(values[0], APP_CONFIG.participantOutputHeaders) &&
    !headerOrderMatches_(values[0], APP_CONFIG.participantOutputHeaders)
  ) {
    writeParticipantSchema_(sheet, migrateParticipantRowsByHeader_(values));
  } else if (headerSetMatches_(values[0], APP_CONFIG.previousParticipantTrackerHeaders)) {
    writeParticipantSchema_(sheet, migratePreviousParticipantTrackerRows_(values));
  } else if (headerSetMatches_(values[0], APP_CONFIG.previousParticipantOutputHeaders)) {
    var masterSheet = requireSheet_(spreadsheet, APP_CONFIG.sheets.master);
    writeParticipantSchema_(
      sheet,
      migratePreviousParticipantRows_(values, readSheetValues_(masterSheet))
    );
  }
  var validation = validateExactHeaders_(
    sheet,
    APP_CONFIG.participantOutputHeaders,
    'E_EXISTING_SCHEMA_MISMATCH'
  );
  applyParticipantSheetPresentation_(sheet, validation.headerIndex);
}

function ensureBureauSchemaSheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  var values = readSheetValues_(sheet);
  if (values.length === 0 || isBlankRow_(values[0])) {
    writeGeneratedHeaders_(sheet, APP_CONFIG.bureauOutputHeaders);
  } else if (
    headerSetMatches_(values[0], APP_CONFIG.bureauOutputHeaders) &&
    !headerOrderMatches_(values[0], APP_CONFIG.bureauOutputHeaders)
  ) {
    migrateBureauSheet_(sheet, values);
  } else if (headerSetMatches_(values[0], APP_CONFIG.previousBureauOutputHeaders)) {
    migrateBureauSheet_(sheet, values);
  } else if (headerSetMatches_(values[0], APP_CONFIG.legacyBureauOutputHeaders)) {
    writeGeneratedHeaders_(sheet, APP_CONFIG.bureauOutputHeaders);
  }
  var validation = validateExactHeaders_(
    sheet,
    APP_CONFIG.bureauOutputHeaders,
    'E_EXISTING_SCHEMA_MISMATCH'
  );
  applyBureauSheetPresentation_(sheet, validation.headerIndex);
}

function setupSchemaInternal_() {
  var spreadsheet = getBoundSpreadsheet_();
  validateEnvironment_(spreadsheet);
  ensureSchemaSheet_(spreadsheet, APP_CONFIG.sheets.master, APP_CONFIG.masterHeaders);
  ensureParticipantSchemaSheet_(spreadsheet);
  ensureSchemaSheet_(spreadsheet, APP_CONFIG.sheets.foodOutput, APP_CONFIG.foodOutputHeaders);
  APP_CONFIG.sheets.bureauOutputs.forEach(function (output) {
    ensureBureauSchemaSheet_(spreadsheet, output.name);
  });
  ensureSchemaSheet_(
    spreadsheet,
    APP_CONFIG.sheets.manualReview,
    APP_CONFIG.manualReviewHeaders
  );
  ensureSchemaSheet_(spreadsheet, APP_CONFIG.sheets.log, APP_CONFIG.logHeaders);
}

function setupStagingSchema() {
  assertNonProduction_('stagingスキーマ作成');
  setupSchemaInternal_();
  SpreadsheetApp.getUi().alert(
    'stagingスキーマ作成完了',
    'マスター、出力、局別タブ、要手動確認、ログのスキーマを確認しました。入力タブは作成・変更していません。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function setupSchemaFromUi() {
  var settings = getScriptSettings_();
  return settings.environment === 'production'
    ? setupProductionSchema()
    : setupStagingSchema();
}
function setupProductionSchema() {
  var spreadsheet = getBoundSpreadsheet_();
  var settings = validateEnvironment_(spreadsheet);
  if (settings.environment !== 'production') {
    throw makeAppError_(
      'E_ENV_NOT_PRODUCTION',
      'setupProductionSchemaはproduction専用です。'
    );
  }
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'productionスキーマ作成確認',
    '入力5タブには触れません。続行する場合は PRODUCTION と入力してください。',
    ui.ButtonSet.OK_CANCEL
  );
  if (
    response.getSelectedButton() !== ui.Button.OK ||
    normalizeText_(response.getResponseText()) !== 'PRODUCTION'
  ) {
    ui.alert('中止しました。');
    return;
  }
  setupSchemaInternal_();
  ui.alert(
    'productionスキーマ作成完了',
    'マスター、出力、局別タブ、要手動確認、ログのスキーマを確認しました。入力タブは作成・変更していません。',
    ui.ButtonSet.OK
  );
}
