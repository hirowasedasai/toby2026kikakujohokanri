// Imported from the production image utility, with environment-specific IDs in properties.
function processImages() {
  return processParticipantImages_(false);
}

function participantImageColumns_(headers) {
  var positions = buildHeaderPositions_(headers);
  var resolve = function (header) {
    var matches = positions[normalizeHeader_(header)] || [];
    if (matches.length !== 1) {
      throw makeAppError_('E_IMAGE_HEADER', '画像処理の列見出しを一意に確認できません。');
    }
    return matches[0];
  };
  return {
    image: resolve('画像提出（飲食アイコン画像）'),
    name: resolve('参加団体・参加者名（17字以内推奨・36字以内）')
  };
}

function processParticipantImages_(legacyNames) {
  var executionId = newExecutionId_();
  return withScriptLock_(function () {
    var preflight = preflightInternal_({ inputs: false, master: false, outputs: false, log: true });
    var sheet = requireSheet_(preflight.spreadsheet, '26参参フォーム回答');
    var values = readSheetValues_(sheet);
    var columns = participantImageColumns_(values[0] || []);
    var properties = PropertiesService.getScriptProperties();
    var stagingId = properties.getProperty('IMAGE_STAGING_FOLDER_ID');
    var outputId = properties.getProperty(legacyNames ? 'IMAGE_LEGACY_OUTPUT_FOLDER_ID' : 'IMAGE_OUTPUT_FOLDER_ID');
    if (!stagingId || !outputId) {
      throw makeAppError_('E_IMAGE_CONFIG', '画像処理の保存先プロパティが未設定です。');
    }
    var stagingFolder = DriveApp.getFolderById(stagingId);
    var outputFolder = DriveApp.getFolderById(outputId);
    var usedNames = Object.create(null);
    var summary = { created: 0, updated: 0, skipped: 0, errors: 0, executionId: executionId };
    var issues = [];
    values.slice(1).forEach(function (row, offset) {
      if (!normalizeText_(row[columns.image])) {
        summary.skipped += 1;
        return;
      }
      try {
        var fileId = extractFileId(row[columns.image]);
        if (!fileId) throw makeAppError_('E_IMAGE_ID', '画像リンクを解析できません。');
        var original = DriveApp.getFileById(fileId);
        var copied = original.makeCopy(original.getName(), stagingFolder);
        var blob = fetchResizedThumbnail(copied.getId(), 300);
        var name = legacyNames
          ? 'Resized_300x300_' + original.getName()
          : getUniqueName(normalizeText_(row[columns.name]) || '団体_' + (offset + 2), usedNames) + '.jpg';
        outputFolder.createFile(blob.setName(name));
        summary.created += 1;
      } catch {
        summary.errors += 1;
        issues.push(makeIssue_('ERROR', 'E_IMAGE_ROW', '画像処理に失敗しました。原本は保持しています。', {
          sourceSheet: '26参参フォーム回答', rowNumber: offset + 2,
          columnName: '画像提出（飲食アイコン画像）'
        }));
      }
    });
    appendProcessLog_(preflight, executionId, 'images:resize', summary, issues);
    return summary;
  });
}

function resizedThumbnailUrl_(link, size) {
  // OAuth is sent only to the Google thumbnail host returned by Drive, never redirected.
  if (!/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\//i.test(String(link))) {
    throw makeAppError_('E_IMAGE_HOST', '画像取得先がGoogleのサムネイルホストではありません。');
  }
  return String(link).replace(/=s\d+$/, '') + '=w' + size + '-h' + size + '-c';
}

function fetchResizedThumbnail(fileId, size) {
  var thumbnailLink;
  for (var attempt = 0; attempt < 5; attempt += 1) {
    var meta = Drive.Files.get(fileId, { fields: 'thumbnailLink' });
    if (meta.thumbnailLink) {
      thumbnailLink = meta.thumbnailLink;
      break;
    }
    Utilities.sleep(1500);
  }
  if (!thumbnailLink) throw makeAppError_('E_IMAGE_THUMBNAIL', 'サムネイルがまだ生成されていません。');
  var url = resizedThumbnailUrl_(thumbnailLink, size);
  for (var retry = 0; retry < 4; retry += 1) {
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
      followRedirects: false
    });
    var blob = response.getBlob();
    if (response.getResponseCode() === 200 && blob.getBytes().length > 0 &&
        /^image\//.test(blob.getContentType() || '') && !isHtmlBlob(blob)) return blob;
    Utilities.sleep(1500);
  }
  throw makeAppError_('E_IMAGE_FETCH', 'サムネイルの取得に失敗しました。');
}

function isHtmlBlob(blob) {
  return (blob.getContentType() || '').indexOf('text/html') !== -1;
}

function extractFileId(value) {
  var str = String(value).split(',')[0].trim();
  var match = str.match(/[?&]id=([a-zA-Z0-9_-]+)/) || str.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9_-]{25,}$/.test(str) ? str : null;
}

function getUniqueName(baseName, usedNames) {
  var count = Object.prototype.hasOwnProperty.call(usedNames, baseName) ? usedNames[baseName] + 1 : 1;
  usedNames[baseName] = count;
  return count === 1 ? baseName : baseName + '_' + count;
}
