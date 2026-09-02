function inputCell_(row, column) {
  return column >= 0 && column < row.length ? row[column] : '';
}

function inputField_(row, batch, field) {
  var alternatives = batch.columnAlternatives && batch.columnAlternatives[field]
    ? batch.columnAlternatives[field]
    : [batch.columns[field]];
  for (var i = 0; i < alternatives.length; i += 1) {
    var value = inputCell_(row, alternatives[i]);
    if (normalizeText_(value)) return value;
  }
  var fallback = inputCell_(row, batch.columns[field]);
  if (normalizeText_(fallback)) return fallback;
  var defaults = batch.source && batch.source.defaults ? batch.source.defaults : {};
  return Object.prototype.hasOwnProperty.call(defaults, field) ? defaults[field] : fallback;
}

function collectInputRecords_(inputBatches) {
  var records = [];
  var issues = [];
  var skipped = 0;

  inputBatches.forEach(function (batch) {
    if (batch.source && batch.source.syncToMaster === false) return;
    batch.values.slice(1).forEach(function (row, offset) {
      var rowNumber = offset + 2;
      if (isBlankRow_(row)) return;

      var record = {
        officialId: normalizeText_(inputField_(row, batch, 'officialId')),
        email: normalizeEmail_(inputField_(row, batch, 'email')),
        participation: normalizeText_(inputField_(row, batch, 'participation')),
        bureau: normalizeText_(inputField_(row, batch, 'bureau')),
        organization: normalizeText_(inputField_(row, batch, 'organization')),
        projectName: normalizeText_(inputField_(row, batch, 'projectName')),
        salesItems: normalizeText_(inputField_(row, batch, 'salesItems')),
        imageLink: normalizeText_(inputField_(row, batch, 'imageLink')),
        timestamp: inputField_(row, batch, 'timestamp'),
        sourceSheet: batch.source.name,
        sourceType: batch.source.type,
        priority: batch.source.priority,
        rowNumber: rowNumber
      };

      var missing = [];
      if (!record.email) missing.push('メールアドレス');
      if (!record.participation) missing.push('参加企画');
      if (!record.organization) missing.push('団体名');
      if (!record.projectName) missing.push('企画名');
      if (missing.length > 0) {
        skipped += 1;
        issues.push(
          makeIssue_('ERROR', 'E_ROW_REQUIRED_VALUE', '必須値が空です。', {
            sourceSheet: record.sourceSheet,
            rowNumber: rowNumber,
            columnName: missing.join(',')
          })
        );
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
        skipped += 1;
        issues.push(
          makeIssue_('ERROR', 'E_ROW_EMAIL_INVALID', 'メールアドレスの形式を確認してください。', {
            sourceSheet: record.sourceSheet,
            rowNumber: rowNumber,
            columnName: 'メールアドレス'
          })
        );
        return;
      }
      var formulaField = [
        ['企画ID', record.officialId],
        ['参加企画', record.participation],
        ['所属局', record.bureau],
        ['団体名', record.organization],
        ['企画名', record.projectName],
        ['販売物', record.salesItems],
        ['画像リンク', record.imageLink]
      ].find(function (entry) {
        return isPotentialFormula_(entry[1]);
      });
      if (formulaField) {
        skipped += 1;
        issues.push(
          makeIssue_(
            'ERROR',
            'E_FORMULA_INPUT_REJECTED',
            '数式として解釈される可能性がある入力を拒否しました。',
            {
              sourceSheet: record.sourceSheet,
              rowNumber: rowNumber,
              columnName: formulaField[0]
            }
          )
        );
        return;
      }
      if (record.officialId.indexOf(APP_CONFIG.provisionalIdPrefix) === 0) {
        skipped += 1;
        issues.push(
          makeIssue_(
            'ERROR',
            'E_OFFICIAL_ID_RESERVED_PREFIX',
            '正式企画IDに暫定ID用の予約prefixは使用できません。',
            {
              sourceSheet: record.sourceSheet,
              rowNumber: rowNumber,
              columnName: '企画ID'
            }
          )
        );
        return;
      }

      record.key = record.officialId
        ? buildOfficialKey_(record.officialId)
        : buildProvisionalKey_(record.email, record.participation, record.projectName);
      record.keyType = record.officialId ? 'official' : 'provisional';
      records.push(record);
    });
  });

  return { records: records, issues: issues, skipped: skipped };
}

function inputTimestampMillis_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  if (!normalizeText_(value)) return NaN;
  var parsed = new Date(value).getTime();
  return isNaN(parsed) ? NaN : parsed;
}

function isTimestampHeaderPlaceholder_(value) {
  var normalized = normalizeHeader_(value);
  if (!normalized) return false;
  return APP_CONFIG.inputHeaderCandidates.timestamp.some(function (candidate) {
    return normalizeHeader_(candidate) === normalized;
  });
}

function resolveLatestResubmission_(group) {
  if (!group || group.length < 2) return { resolved: false };
  var firstKey = buildProvisionalKey_(
    group[0].email,
    group[0].participation,
    group[0].projectName
  );
  var firstSourceSheet = normalizeText_(group[0].sourceSheet);
  var firstSourceType = normalizeText_(group[0].sourceType);
  var sameSubmissionSeries = firstKey && group.every(function (record) {
    return buildProvisionalKey_(record.email, record.participation, record.projectName) === firstKey &&
      normalizeText_(record.sourceSheet) === firstSourceSheet &&
      normalizeText_(record.sourceType) === firstSourceType;
  });
  if (!sameSubmissionSeries) return { resolved: false };

  var candidates = group.map(function (record) {
    var timestamp = inputTimestampMillis_(record.timestamp);
    return {
      record: record,
      timestamp: timestamp,
      headerPlaceholder: isNaN(timestamp) && isTimestampHeaderPlaceholder_(record.timestamp)
    };
  });
  if (candidates.some(function (candidate) {
    return isNaN(candidate.timestamp) && !candidate.headerPlaceholder;
  })) {
    return { resolved: false };
  }
  var validCandidates = candidates.filter(function (candidate) {
    return !isNaN(candidate.timestamp);
  }).sort(function (left, right) {
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
    return left.record.rowNumber - right.record.rowNumber;
  });
  if (validCandidates.length === 0) return { resolved: false };
  if (
    validCandidates.length > 1 &&
    validCandidates[validCandidates.length - 1].timestamp ===
      validCandidates[validCandidates.length - 2].timestamp
  ) {
    return { resolved: false };
  }
  return {
    resolved: true,
    record: validCandidates[validCandidates.length - 1].record,
    reason: candidates.some(function (candidate) { return candidate.headerPlaceholder; })
      ? 'header-timestamp-placeholder'
      : 'unique-latest-timestamp'
  };
}

function masterRecordFromRow_(row, index, rowNumber) {
  var managementId = normalizeText_(row[index[normalizeHeader_('管理ID')]]);
  var email = normalizeEmail_(row[index[normalizeHeader_('メールアドレス')]]);
  var participation = normalizeText_(row[index[normalizeHeader_('参加企画')]]);
  var projectName = normalizeText_(row[index[normalizeHeader_('企画名')]]);
  var key = managementId.indexOf(APP_CONFIG.provisionalIdPrefix) === 0
    ? buildProvisionalKey_(email, participation, projectName)
    : buildOfficialKey_(managementId);
  return {
    managementId: managementId,
    email: email,
    participation: participation,
    organization: normalizeText_(row[index[normalizeHeader_('団体名')]]),
    projectName: projectName,
    row: row,
    rowNumber: rowNumber,
    key: key,
    keyType: managementId.indexOf(APP_CONFIG.provisionalIdPrefix) === 0
      ? 'provisional'
      : 'official'
  };
}

function setMasterCell_(row, index, header, value) {
  row[index[normalizeHeader_(header)]] = value;
}

function getMasterCell_(row, index, header) {
  return row[index[normalizeHeader_(header)]];
}

function valuesDiffer_(left, right) {
  return stringifyCell_(left) !== stringifyCell_(right);
}

function markMasterForReview_(masterRecord, index, reason) {
  var changed = false;
  if (normalizeText_(getMasterCell_(masterRecord.row, index, '要確認')).toUpperCase() !== 'TRUE') {
    setMasterCell_(masterRecord.row, index, '要確認', 'TRUE');
    changed = true;
  }
  if (normalizeText_(getMasterCell_(masterRecord.row, index, '要確認理由')) !== reason) {
    setMasterCell_(masterRecord.row, index, '要確認理由', reason);
    changed = true;
  }
  if (normalizeText_(getMasterCell_(masterRecord.row, index, '同期ステータス')) !== '要確認') {
    setMasterCell_(masterRecord.row, index, '同期ステータス', '要確認');
    changed = true;
  }
  return changed;
}

function makeNewMasterRow_(headers, index, record, currentIso, reviewReason) {
  var row = new Array(headers.length).fill('');
  setMasterCell_(
    row,
    index,
    '管理ID',
    record.officialId || provisionalManagementId_(record.key)
  );
  setMasterCell_(row, index, 'メールアドレス', record.email);
  setMasterCell_(row, index, '参加企画', record.participation);
  setMasterCell_(row, index, '所属局', record.bureau);
  setMasterCell_(row, index, '団体名', record.organization);
  setMasterCell_(row, index, '企画名', record.projectName);
  setMasterCell_(row, index, '販売物', record.salesItems);
  setMasterCell_(row, index, '画像リンク', record.imageLink);
  setMasterCell_(row, index, 'データソース', record.sourceSheet);
  setMasterCell_(row, index, '同期ステータス', reviewReason ? '要確認' : '同期済み');
  setMasterCell_(row, index, '最終更新日時', currentIso);
  setMasterCell_(row, index, '要確認', reviewReason ? 'TRUE' : 'FALSE');
  setMasterCell_(row, index, '要確認理由', reviewReason || '');
  return row;
}

function updateExistingMasterRow_(masterRecord, index, record, currentIso) {
  var updates = {
    'メールアドレス': record.email,
    '参加企画': record.participation,
    '所属局': record.bureau,
    '団体名': record.organization,
    '企画名': record.projectName,
    '販売物': record.salesItems,
    '画像リンク': record.imageLink,
    'データソース': record.sourceSheet
  };
  var changed = false;
  Object.keys(updates).forEach(function (header) {
    var nextValue = updates[header];
    if (!nextValue && (header === '所属局' || header === '販売物' || header === '画像リンク')) return;
    if (valuesDiffer_(getMasterCell_(masterRecord.row, index, header), nextValue)) {
      setMasterCell_(masterRecord.row, index, header, nextValue);
      changed = true;
    }
  });
  var reviewReason = normalizeText_(getMasterCell_(masterRecord.row, index, '要確認理由'));
  if (reviewReason.indexOf('暫定キー衝突:') === 0) changed = true;
  if (changed) {
    setMasterCell_(masterRecord.row, index, '同期ステータス', '同期済み');
    setMasterCell_(masterRecord.row, index, '最終更新日時', currentIso);
    setMasterCell_(masterRecord.row, index, '要確認', 'FALSE');
    setMasterCell_(masterRecord.row, index, '要確認理由', '');
  }
  return changed;
}

function findSuspectedKeyChanges_(record, masterRecords) {
  return masterRecords.filter(function (masterRecord) {
    if (masterRecord.key === record.key) return false;
    var sameParticipation =
      masterRecord.participation && masterRecord.participation === record.participation;
    var samePublishedIdentity =
      sameParticipation &&
      masterRecord.organization === record.organization &&
      masterRecord.projectName === record.projectName;
    return samePublishedIdentity && masterRecord.keyType === 'provisional';
  });
}

function planMasterUpsert_(masterHeaders, masterRows, inputBatches, currentIso) {
  var index = buildHeaderIndex_(masterHeaders);
  var missingMasterHeaders = APP_CONFIG.masterHeaders.filter(function (header) {
    return !Object.prototype.hasOwnProperty.call(index, normalizeHeader_(header));
  });
  if (missingMasterHeaders.length > 0) {
    throw makeAppError_(
      'E_MASTER_HEADER_MISSING',
      'マスターに必須ヘッダーがありません: ' + missingMasterHeaders.join(', ')
    );
  }

  var rows = masterRows.filter(function (row) {
    return !isBlankRow_(row);
  }).map(function (row) {
    var copy = row.slice(0, masterHeaders.length);
    while (copy.length < masterHeaders.length) copy.push('');
    return copy;
  });
  var masterRecords = rows.map(function (row, offset) {
    return masterRecordFromRow_(row, index, offset + 2);
  });
  var byKey = {};
  var byManagementId = {};
  masterRecords.forEach(function (record) {
    if (!record.managementId || !record.key) {
      throw makeAppError_(
        'E_MASTER_KEY_INVALID',
        'マスターの管理IDまたは暫定キー項目が不正です。',
        { rowNumber: record.rowNumber }
      );
    }
    if (byKey[record.key]) {
      throw makeAppError_(
        'E_MASTER_DUPLICATE_KEY',
        'マスター内に重複キーがあります。',
        { rowNumber: record.rowNumber }
      );
    }
    if (byManagementId[record.managementId]) {
      throw makeAppError_(
        'E_MASTER_DUPLICATE_ID',
        'マスター内に重複する管理IDがあります。',
        { rowNumber: record.rowNumber }
      );
    }
    byKey[record.key] = record;
    byManagementId[record.managementId] = record;
  });

  var collected = collectInputRecords_(inputBatches);
  var issues = collected.issues.slice();
  var summary = {
    created: 0,
    updated: 0,
    skipped: collected.skipped,
    needsReview: 0,
    errors: collected.issues.length
  };
  var groups = {};
  collected.records.forEach(function (record) {
    if (!groups[record.key]) groups[record.key] = [];
    groups[record.key].push(record);
  });

  Object.keys(groups).sort().forEach(function (key) {
    var group = groups[key].sort(function (left, right) {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.rowNumber - right.rowNumber;
    });
    var resubmission = group[0].keyType === 'provisional'
      ? resolveLatestResubmission_(group)
      : { resolved: false };
    var isProvisionalCollision =
      group[0].keyType === 'provisional' && group.length > 1 && !resubmission.resolved;
    var record = resubmission.resolved
      ? resubmission.record
      : isProvisionalCollision
        ? group[0]
        : group[group.length - 1];
    if (group.length > 1) summary.skipped += group.length - 1;

    if (resubmission.resolved) {
      var hasHeaderTimestampPlaceholder =
        resubmission.reason === 'header-timestamp-placeholder';
      issues.push(
        makeIssue_(
          'INFO',
          hasHeaderTimestampPlaceholder
            ? 'I_RESUBMISSION_HEADER_TIMESTAMP_SELECTED'
            : 'I_RESUBMISSION_LATEST_SELECTED',
          hasHeaderTimestampPlaceholder
            ? '同一企画の旧回答に回答日時ヘッダー文字列が含まれるため、正常な回答日時を持つ回答を採用しました。'
            : '同一企画の再送として、回答日時が一意に新しい回答を採用しました。',
          {
            sourceSheet: record.sourceSheet,
            rowNumber: record.rowNumber,
            columnName: 'タイムスタンプ'
          }
        )
      );
    }

    if (isProvisionalCollision) {
      var collisionReason = '暫定キー衝突: 同一キーの複数回答を自動統合していません';
      var collisionExisting = byKey[key];
      if (collisionExisting) {
        if (markMasterForReview_(collisionExisting, index, collisionReason)) {
          setMasterCell_(collisionExisting.row, index, '最終更新日時', currentIso);
          summary.updated += 1;
        } else {
          summary.skipped += 1;
        }
      } else {
        var collisionRow = makeNewMasterRow_(
          masterHeaders,
          index,
          record,
          currentIso,
          collisionReason
        );
        rows.push(collisionRow);
        var collisionMaster = masterRecordFromRow_(collisionRow, index, rows.length + 1);
        masterRecords.push(collisionMaster);
        byKey[key] = collisionMaster;
        byManagementId[collisionMaster.managementId] = collisionMaster;
        summary.created += 1;
      }
      summary.needsReview += 1;
      summary.errors += 1;
      issues.push(
        makeIssue_('WARN', 'E_PROVISIONAL_KEY_COLLISION', collisionReason, {
          sourceSheet: record.sourceSheet,
          rowNumber: record.rowNumber,
          columnName: 'メールアドレス,参加企画,企画名'
        })
      );
      return;
    }

    var existing = byKey[key];
    if (existing) {
      if (updateExistingMasterRow_(existing, index, record, currentIso)) {
        summary.updated += 1;
      } else {
        summary.skipped += 1;
      }
      return;
    }

    var suspected = findSuspectedKeyChanges_(record, masterRecords);
    var reviewReason = suspected.length > 0
      ? 'キー項目変更の可能性: 既存行とは自動統合していません'
      : '';
    var newRow = makeNewMasterRow_(masterHeaders, index, record, currentIso, reviewReason);
    rows.push(newRow);
    var newMaster = masterRecordFromRow_(newRow, index, rows.length + 1);
    masterRecords.push(newMaster);
    byKey[key] = newMaster;
    byManagementId[newMaster.managementId] = newMaster;
    summary.created += 1;

    if (reviewReason) {
      suspected.forEach(function (suspectedRecord) {
        if (markMasterForReview_(suspectedRecord, index, reviewReason)) {
          setMasterCell_(suspectedRecord.row, index, '最終更新日時', currentIso);
          summary.updated += 1;
        }
      });
      summary.needsReview += 1 + suspected.length;
      summary.errors += 1;
      issues.push(
        makeIssue_('WARN', 'E_SUSPECTED_KEY_CHANGE', reviewReason, {
          sourceSheet: record.sourceSheet,
          rowNumber: record.rowNumber,
          columnName: '管理ID,メールアドレス,参加企画'
        })
      );
    }
  });

  return {
    rows: rows,
    issues: issues,
    summary: summary,
    changed: summary.created > 0 || summary.updated > 0
  };
}

function writeMasterRows_(masterSheet, rows, width) {
  if (rows.length > 0) {
    masterSheet.getRange(2, 1, rows.length, width).setValues(rows);
  }
  var previousDataRows = Math.max(masterSheet.getLastRow() - 1, 0);
  if (previousDataRows > rows.length) {
    masterSheet
      .getRange(rows.length + 2, 1, previousDataRows - rows.length, width)
      .clearContent();
  }
}

function performSyncMaster_(dryRun, suppliedPreflight, executionId) {
  var preflight = suppliedPreflight || preflightInternal_({
    inputs: true,
    master: true,
    outputs: false,
    log: true
  });
  var plan = planMasterUpsert_(
    preflight.master.values[0],
    preflight.master.values.slice(1),
    preflight.inputs,
    nowIso_()
  );
  if (!dryRun && plan.changed) {
    writeMasterRows_(preflight.master.sheet, plan.rows, preflight.master.values[0].length);
  }
  var operation = dryRun ? 'syncMaster:dryRun' : 'syncMaster';
  appendProcessLog_(preflight, executionId, operation, plan.summary, plan.issues);
  plan.summary.executionId = executionId;
  plan.summary.dryRun = dryRun;
  return plan.summary;
}

function executeSyncFromUi_(dryRun) {
  var executionId = newExecutionId_();
  try {
    var summary = withScriptLock_(function () {
      return performSyncMaster_(dryRun, null, executionId);
    });
    showSummary_(dryRun ? 'ドライラン完了' : '同期完了', summary);
    return summary;
  } catch (error) {
    safeAppendFailureLog_(dryRun ? 'syncMaster:dryRun' : 'syncMaster', executionId, error);
    SpreadsheetApp.getUi().alert(
      '同期失敗',
      (error.code || 'E_UNEXPECTED') + ': ' + sanitizeLogText_(error.message),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return { executionId: executionId, errorCode: error.code || 'E_UNEXPECTED' };
  }
}

function dryRunSyncMaster() {
  return executeSyncFromUi_(true);
}

function syncMaster() {
  return executeSyncFromUi_(false);
}
