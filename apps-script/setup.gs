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

function setupSchemaInternal_() {
  var spreadsheet = getBoundSpreadsheet_();
  validateEnvironment_(spreadsheet);
  ensureSchemaSheet_(spreadsheet, APP_CONFIG.sheets.master, APP_CONFIG.masterHeaders);
  ensureSchemaSheet_(
    spreadsheet,
    APP_CONFIG.sheets.participantOutput,
    APP_CONFIG.participantOutputHeaders
  );
  ensureSchemaSheet_(spreadsheet, APP_CONFIG.sheets.foodOutput, APP_CONFIG.foodOutputHeaders);
  ensureSchemaSheet_(spreadsheet, APP_CONFIG.sheets.log, APP_CONFIG.logHeaders);
}

function setupStagingSchema() {
  assertNonProduction_('stagingスキーマ作成');
  setupSchemaInternal_();
  SpreadsheetApp.getUi().alert(
    'stagingスキーマ作成完了',
    'マスター、出力、ログのスキーマを確認しました。入力タブは作成・変更していません。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
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
    '入力4タブには触れません。続行する場合は PRODUCTION と入力してください。',
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
    'マスター、出力、ログのスキーマを確認しました。入力タブは作成・変更していません。',
    ui.ButtonSet.OK
  );
}
