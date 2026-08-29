function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(APP_CONFIG.appName)
    .addItem('事前チェック', 'preflightCheck')
    .addSeparator()
    .addItem('ドライラン: フォーム回答を同期', 'dryRunSyncMaster')
    .addItem('フォーム回答を同期', 'syncMaster')
    .addItem('参参一覧を更新', 'buildParticipantList')
    .addItem('屋台情報まとめを更新', 'buildFoodStallSummary')
    .addItem('局別タブを更新', 'buildBureauOutputs')
    .addItem('全処理を実行', 'runAll')
    .addSeparator()
    .addItem('処理ログを開く', 'openProcessLog')
    .addItem('環境情報を表示', 'showEnvironmentInfo')
    .addToUi();
}

function runAll() {
  var executionId = newExecutionId_();
  try {
    var result = withScriptLock_(function () {
      var preflight = preflightInternal_({
        inputs: true,
        master: true,
        outputs: true,
        bureaus: true,
        log: true
      });
      var syncSummary = performSyncMaster_(false, preflight, executionId);
      var participantSummary = performBuildOutput_('participant', preflight, executionId);
      var foodSummary = performBuildOutput_('food', preflight, executionId);
      var bureauSummary = performBuildBureauOutputs_(preflight, executionId);
      return {
        executionId: executionId,
        created: syncSummary.created,
        updated: syncSummary.updated,
        skipped: syncSummary.skipped,
        needsReview: syncSummary.needsReview,
        errors: syncSummary.errors + participantSummary.errors + foodSummary.errors + bureauSummary.errors
      };
    });
    showSummary_('全処理完了', result);
    return result;
  } catch (error) {
    safeAppendFailureLog_('runAll', executionId, error);
    SpreadsheetApp.getUi().alert(
      '全処理失敗',
      (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return { executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}

function openProcessLog() {
  var spreadsheet = getBoundSpreadsheet_();
  validateEnvironment_(spreadsheet);
  var sheet = requireSheet_(spreadsheet, APP_CONFIG.sheets.log);
  spreadsheet.setActiveSheet(sheet);
  sheet.activate();
}

function showEnvironmentInfo() {
  var spreadsheet = getBoundSpreadsheet_();
  var settings = validateEnvironment_(spreadsheet);
  var message = [
    '環境: ' + settings.environment,
    'リリースID: ' + settings.releaseId,
    'バウンド先検証: OK',
    '定期同期: ' + (settings.scheduledSyncEnabled ? '有効' : '無効')
  ].join('\n');
  SpreadsheetApp.getUi().alert('環境情報', message, SpreadsheetApp.getUi().ButtonSet.OK);
}
