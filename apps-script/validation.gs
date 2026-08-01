function getScriptSettings_() {
  var properties = PropertiesService.getScriptProperties();
  return {
    environment: normalizeText_(properties.getProperty(APP_CONFIG.properties.environment)).toLowerCase(),
    expectedSpreadsheetId: normalizeText_(properties.getProperty(APP_CONFIG.properties.spreadsheetId)),
    releaseId: normalizeText_(properties.getProperty(APP_CONFIG.properties.releaseId)) || 'UNSET',
    scheduledSyncEnabled:
      normalizeText_(properties.getProperty(APP_CONFIG.properties.scheduledSync)).toLowerCase() === 'true'
  };
}

function validateEnvironment_(spreadsheet) {
  var settings = getScriptSettings_();
  if (settings.environment !== 'staging' && settings.environment !== 'production') {
    throw makeAppError_('E_ENV_INVALID', 'APP_ENVはstagingまたはproductionに設定してください。');
  }
  if (!settings.expectedSpreadsheetId) {
    throw makeAppError_(
      'E_EXPECTED_SPREADSHEET_ID_MISSING',
      'EXPECTED_SPREADSHEET_IDが設定されていません。'
    );
  }
  if (spreadsheet.getId() !== settings.expectedSpreadsheetId) {
    throw makeAppError_(
      'E_SPREADSHEET_MISMATCH',
      'バウンド先とEXPECTED_SPREADSHEET_IDが一致しないため停止しました。'
    );
  }
  return settings;
}

function assertNonProduction_(operation) {
  var settings = getScriptSettings_();
  if (settings.environment === 'production') {
    throw makeAppError_(
      'E_PRODUCTION_GUARD',
      operation + 'はproductionでは実行できません。'
    );
  }
}

function buildHeaderIndex_(headers) {
  var index = {};
  var duplicates = [];
  headers.forEach(function (header, position) {
    var normalized = normalizeHeader_(header);
    if (!normalized) return;
    if (Object.prototype.hasOwnProperty.call(index, normalized)) {
      duplicates.push(normalizeText_(header));
      return;
    }
    index[normalized] = position;
  });
  if (duplicates.length > 0) {
    throw makeAppError_(
      'E_DUPLICATE_HEADER',
      '重複ヘッダーがあります: ' + duplicates.join(', ')
    );
  }
  return index;
}

function resolveHeaders_(headers, candidates, requiredFields) {
  var headerIndex = buildHeaderIndex_(headers);
  var resolved = {};
  var alternatives = {};
  Object.keys(candidates).forEach(function (field) {
    alternatives[field] = candidates[field].filter(function (candidate) {
      return Object.prototype.hasOwnProperty.call(headerIndex, normalizeHeader_(candidate));
    }).map(function (candidate) {
      return headerIndex[normalizeHeader_(candidate)];
    });
    resolved[field] = alternatives[field].length === 0 ? -1 : alternatives[field][0];
  });
  var missing = requiredFields.filter(function (field) {
    return resolved[field] < 0;
  });
  return { columns: resolved, alternatives: alternatives, missing: missing };
}

function requireSheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw makeAppError_('E_SHEET_MISSING', '必要なシートがありません: ' + sheetName, {
      sheetName: sheetName
    });
  }
  return sheet;
}

function readSheetValues_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) return [];
  return sheet.getRange(1, 1, lastRow, lastColumn).getValues();
}

function validateExactHeaders_(sheet, requiredHeaders, code) {
  var values = readSheetValues_(sheet);
  if (values.length === 0) {
    throw makeAppError_(code, sheet.getName() + 'のヘッダー行がありません。');
  }
  var index = buildHeaderIndex_(values[0]);
  var missing = requiredHeaders.filter(function (header) {
    return !Object.prototype.hasOwnProperty.call(index, normalizeHeader_(header));
  });
  if (missing.length > 0) {
    throw makeAppError_(code, sheet.getName() + 'に必須ヘッダーがありません: ' + missing.join(', '), {
      sheetName: sheet.getName(),
      missing: missing
    });
  }
  return { sheet: sheet, values: values, headerIndex: index };
}

function validateInputSheet_(sheet) {
  var values = readSheetValues_(sheet);
  if (values.length === 0) {
    throw makeAppError_('E_INPUT_HEADER_MISSING', sheet.getName() + 'のヘッダー行がありません。', {
      sheetName: sheet.getName()
    });
  }
  var resolution = resolveHeaders_(
    values[0],
    APP_CONFIG.inputHeaderCandidates,
    APP_CONFIG.requiredInputFields
  );
  if (resolution.missing.length > 0) {
    throw makeAppError_(
      'E_INPUT_HEADER_MISSING',
      sheet.getName() + 'に必須ヘッダーがありません: ' + resolution.missing.join(', '),
      { sheetName: sheet.getName(), missing: resolution.missing }
    );
  }
  return {
    sheet: sheet,
    values: values,
    columns: resolution.columns,
    columnAlternatives: resolution.alternatives
  };
}

function preflightInternal_(options) {
  var spreadsheet = getBoundSpreadsheet_();
  var settings = validateEnvironment_(spreadsheet);
  var result = { spreadsheet: spreadsheet, settings: settings, inputs: [] };

  if (options.inputs) {
    APP_CONFIG.sheets.inputs.forEach(function (source) {
      var input = validateInputSheet_(requireSheet_(spreadsheet, source.name));
      input.source = source;
      result.inputs.push(input);
    });
  }
  if (options.master) {
    result.master = validateExactHeaders_(
      requireSheet_(spreadsheet, APP_CONFIG.sheets.master),
      APP_CONFIG.masterHeaders,
      'E_MASTER_HEADER_MISSING'
    );
  }
  if (options.outputs) {
    result.participantOutput = validateExactHeaders_(
      requireSheet_(spreadsheet, APP_CONFIG.sheets.participantOutput),
      APP_CONFIG.participantOutputHeaders,
      'E_OUTPUT_HEADER_MISSING'
    );
    result.foodOutput = validateExactHeaders_(
      requireSheet_(spreadsheet, APP_CONFIG.sheets.foodOutput),
      APP_CONFIG.foodOutputHeaders,
      'E_OUTPUT_HEADER_MISSING'
    );
  }
  if (options.log) {
    result.log = validateExactHeaders_(
      requireSheet_(spreadsheet, APP_CONFIG.sheets.log),
      APP_CONFIG.logHeaders,
      'E_LOG_HEADER_MISSING'
    );
  }
  return result;
}

function preflightCheck() {
  var executionId = newExecutionId_();
  try {
    var result = preflightInternal_({ inputs: true, master: true, outputs: true, log: true });
    SpreadsheetApp.getUi().alert(
      '事前チェック完了',
      '環境: ' + result.settings.environment + '\n実行ID: ' + executionId + '\n必要なタブとヘッダーは正常です。',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return { ok: true, executionId: executionId, environment: result.settings.environment };
  } catch (error) {
    safeAppendFailureLog_('preflight', executionId, error);
    SpreadsheetApp.getUi().alert(
      '事前チェック失敗',
      (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return { ok: false, executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}
