function triggerExists_(handlerName, triggers) {
  return triggers.some(function (trigger) {
    return trigger.getHandlerFunction() === handlerName;
  });
}

function installTriggers() {
  var spreadsheet = getBoundSpreadsheet_();
  var settings = validateEnvironment_(spreadsheet);
  if (!confirmProductionAction_('トリガーのインストール')) return;

  var triggers = ScriptApp.getProjectTriggers();
  var created = [];
  if (!triggerExists_('handleFormSubmit_', triggers)) {
    ScriptApp.newTrigger('handleFormSubmit_').forSpreadsheet(spreadsheet).onFormSubmit().create();
    created.push('フォーム送信時同期');
  }
  if (settings.scheduledSyncEnabled && !triggerExists_('scheduledSyncMaster_', triggers)) {
    ScriptApp.newTrigger('scheduledSyncMaster_').timeBased().everyHours(1).create();
    created.push('1時間ごとの定期同期');
  }
  SpreadsheetApp.getUi().alert(
    'トリガー確認完了',
    created.length > 0
      ? '作成: ' + created.join(', ')
      : '対象トリガーは既に存在するか、定期同期が無効です。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function uninstallTriggers() {
  var spreadsheet = getBoundSpreadsheet_();
  validateEnvironment_(spreadsheet);
  if (!confirmProductionAction_('管理対象トリガーの削除')) return;

  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (APP_CONFIG.triggerHandlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  SpreadsheetApp.getUi().alert(
    'トリガー削除完了',
    '削除件数: ' + removed,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function runTriggeredSync_(operation, includeBureauOutputs, includeParticipantOutput) {
  var executionId = newExecutionId_();
  try {
    return withScriptLock_(function () {
      var preflight = preflightInternal_({
        inputs: true,
        master: true,
        outputs: includeParticipantOutput,
        log: true
      });
      var syncSummary = performSyncMaster_(false, preflight, executionId);
      if (includeParticipantOutput) {
        performBuildParticipantTracker_(preflight, executionId);
      }
      if (includeBureauOutputs) performBuildBureauOutputs_(null, executionId);
      return syncSummary;
    });
  } catch (error) {
    safeAppendFailureLog_(operation, executionId, error);
    throw error;
  }
}

function runTriggeredBureauOutputs_(operation) {
  var executionId = newExecutionId_();
  try {
    return withScriptLock_(function () {
      return performBuildBureauOutputs_(null, executionId);
    });
  } catch (error) {
    safeAppendFailureLog_(operation, executionId, error);
    throw error;
  }
}

function handleFormSubmit_(event) {
  var sheetName = event && event.range && event.range.getSheet().getName();
  var source = APP_CONFIG.sheets.inputs.find(function (candidate) {
    return candidate.name === sheetName;
  });
  if (!source) return;
  if (source.type === 'STAFF_CHANGE') {
    runTriggeredBureauOutputs_('trigger:staffChangeBureauDelta');
    return;
  }
  if (source.syncToBureaus === true) {
    runTriggeredBureauOutputs_('trigger:staffOtherPublicationBureauDelta');
    return;
  }
  if (source.syncToMaster === false) return;
  runTriggeredSync_(
    'trigger:formSubmit',
    source.type === 'STAFF_FORM',
    source.type === 'FORM'
  );
}

function scheduledSyncMaster_() {
  var settings = getScriptSettings_();
  if (!settings.scheduledSyncEnabled) return;
  runTriggeredSync_('trigger:scheduledSync', true, true);
}
