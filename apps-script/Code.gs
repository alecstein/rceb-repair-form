// Paste the spreadsheet ID from its URL between /d/ and /edit.
const SPREADSHEET_ID = '1qQ7RrKcBTBhsxVu9fn28fEnA0Lq6E_CCDBeaMMNUKSI';
const SHEET_NAME = 'Repair Form Submissions';
// Paste the ID from the photo folder URL after /folders/.
const SHARED_PHOTO_FOLDER_ID = '1_E9LxWVdTZOs1h3wtt7WZrOPwylVFW_7';
const RM_PRODUCT_AUTOCOMPLETE_URL = 'https://www.repairmonitor.org/en/kind_product_autocomplete/taxonomy_term/default%3Ataxonomy_term/HnNwTT2VlSuQATdNR_eXD-f1b4Q797uTKVyIhd2Kdjk';
const RM_BRAND_AUTOCOMPLETE_URL = 'https://www.repairmonitor.org/en/brand_autocomplete/taxonomy_term/default%3Ataxonomy_term/gEOAwRaHjAqY5yzY4R7uND2yYOY1Zg_vOGhm4pd2Nsk';

const HEADERS = [
  'Timestamp', 'Date', 'Device ID', 'Volunteer name', 'Guest name', 'Item type',
  'Brand', 'Brand status', 'Model / type / serial', 'Photos before',
  'Condition on arrival', 'Repair outcome', 'Guest experience',
  'Problem / solution description', 'Guest notes', 'Tool purchase request(s)',
  'Photos after', 'Submission ID'
];

const LEGACY_HEADERS = [
  'Timestamp', 'Date', 'Device ID', 'Volunteer name', 'Guest name', 'Item type',
  'Brand', 'Brand status', 'Model / type / serial', 'Photos before',
  'Condition on arrival', 'Repair outcome', 'Guest experience',
  'Problem / solution description', 'Guest notes', 'Photos after', 'Submission ID'
];

function openRepairSpreadsheet_() {
  const id = SPREADSHEET_ID.trim();
  if (!id) throw new Error('Set SPREADSHEET_ID at the top of Code.gs first.');
  return SpreadsheetApp.openById(id);
}

function setup() {
  const ss = openRepairSpreadsheet_();

  const folderId = SHARED_PHOTO_FOLDER_ID.trim();
  if (!folderId) throw new Error('Set SHARED_PHOTO_FOLDER_ID at the top of Code.gs first.');
  checkPhotoFolder_(folderId);

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  ensureHeaders_(sheet);
  sheet.setFrozenRows(1);

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('PHOTO_FOLDER_ID', folderId);
}

// Timings contain identifiers and stages only, never repair details.
function trace_(id, startedAt) {
  startedAt = startedAt || Date.now();
  const safeId = /^[A-Za-z0-9_-]{4,64}$/.test(String(id || '')) ? id : 'UNKNOWN';
  return stage => console.log(JSON.stringify({
    traceId: safeId, stage, elapsedMs: Date.now() - startedAt
  }));
}

function doGet(e) {
  const trace = trace_(e && e.parameter && e.parameter.traceId);
  trace('GET entered');
  try {
    const action = String(e && e.parameter && e.parameter.action || '').trim();
    const query = String(e && e.parameter && e.parameter.q || '').trim();

    if (action === 'products') {
      return jsonResponse_({ ok: true, results: searchRepairMonitorProducts(query) });
    }
    if (action === 'brands') {
      return jsonResponse_({ ok: true, results: searchRepairMonitorBrands(query) });
    }

    if (action === 'status') {
      const submissionId = String(e && e.parameter && e.parameter.id || '').trim();
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(submissionId)) {
        throw new Error('Invalid submission ID.');
      }

      trace('status spreadsheet open started');
      const ss = openRepairSpreadsheet_();
      trace('status spreadsheet opened');
      const sheet = ss.getSheetByName(SHEET_NAME);
      if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" is missing.`);

      trace('status lookup started');
      const saved = submissionExists_(sheet, submissionId);
      trace('status lookup finished');
      const response = jsonResponse_({ ok: true, submissionId, saved });
      trace('status returning response');
      return response;
    }

    return jsonResponse_({ ok: true, service: 'RCEB Repair Form API' });
  } catch (error) {
    trace('returning error response');
    return jsonResponse_({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}

function doPost(e) {
  const startedAt = Date.now();
  let trace = trace_('UNKNOWN', startedAt);
  trace('POST entered');
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Missing request body.');
    const payload = JSON.parse(e.postData.contents);
    trace = trace_(payload.debugId, startedAt);
    trace('POST parsed');
    const form = decodeApiForm_(payload);
    trace('photos decoded');
    const submissionId = submitRepair(form, trace);
    const response = jsonResponse_({ ok: true, submissionId });
    trace('POST returning response');
    return response;
  } catch (error) {
    trace('returning error response');
    return jsonResponse_({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}

function decodeApiForm_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid request body.');
  }

  const form = Object.assign({}, payload);
  for (const prefix of ['photoBefore', 'photoAfter']) {
    const count = Number(form[prefix + 'Count'] || 0);
    if (!Number.isInteger(count) || count < 0 || count > 5) {
      throw new Error('Choose up to five photos per section.');
    }

    for (let i = 1; i <= count; i++) {
      const file = form[prefix + i];
      if (!file || typeof file !== 'object' || typeof file.data !== 'string') {
        throw new Error('A photo could not be read. Remove it and add it again.');
      }
      const bytes = Utilities.base64Decode(file.data);
      form[prefix + i] = Utilities.newBlob(
        bytes,
        file.type || 'image/jpeg',
        file.name || `${prefix}${i}.jpg`
      );
    }
  }
  return form;
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}


function searchRepairMonitorProducts(query) {
  return searchRepairMonitorAutocomplete_(RM_PRODUCT_AUTOCOMPLETE_URL, query, 'Add new product');
}

function searchRepairMonitorBrands(query) {
  return searchRepairMonitorAutocomplete_(RM_BRAND_AUTOCOMPLETE_URL, query, 'Add new brand');
}

function searchRepairMonitorAutocomplete_(url, query, excludedValue) {
  query = String(query || '').trim();
  if (query.length < 2) return [];
  if (query.length > 200) throw new Error('Please use a shorter search.');

  const response = UrlFetchApp.fetch(`${url}?q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json' },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Could not load choices.');
  }

  const data = JSON.parse(response.getContentText());
  if (!Array.isArray(data)) throw new Error('Could not load choices.');
  const seen = new Set();

  return data
    .filter(item => item && typeof item.value === 'string' && item.value && item.value !== excludedValue)
    .filter(item => {
      const key = String(item.value).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(item => ({ value: item.value, label: item.label || item.value }))
    .slice(0, 20);
}

function submitRepair(form, trace) {
  trace = trace || trace_(form && form.debugId);
  trace('spreadsheet open started');
  const properties = PropertiesService.getScriptProperties();
  const ss = openRepairSpreadsheet_();
  trace('spreadsheet opened');
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" is missing. Run setup() in the Apps Script editor.`);
  ensureHeaders_(sheet);
  trace('headers checked');
  form = validateForm_(form);
  trace('form validated');
  const timestamp = new Date();
  const date = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // The browser creates this ID before POSTing. It is also written to the sheet.
  // We use the saved ID as the source of truth because Apps Script can finish
  // successfully even when its redirected HTTP response fails on the way back.
  const submissionId = String(form.debugId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(submissionId)) {
    throw new Error('Missing or invalid submission ID.');
  }

  // Makes a repeated POST with the same ID safe.
  trace('duplicate lookup started');
  if (submissionExists_(sheet, submissionId)) { trace('duplicate found'); return submissionId; }
  trace('duplicate lookup finished');

  const beforeCount = Number(form.photoBeforeCount || 0);
  const afterCount = Number(form.photoAfterCount || 0);

  const rowData = [
    timestamp, date, form.deviceId, form.volunteerName, form.guestName,
    form.itemType, form.brand, form.brandStatus, form.modelInfo, '',
    form.condition, form.outcome, form.guestExperience, form.problemSolution,
    form.guestReflection, form.toolPurchaseRequests, '', submissionId
  ];

  const createdFiles = [];
  let beforePhotos = [];
  let afterPhotos = [];
  const lock = LockService.getScriptLock();
  let writeStarted = false;
  try {
    if (beforeCount || afterCount) {
      const folderId = properties.getProperty('PHOTO_FOLDER_ID');
      if (!folderId) throw new Error('Photo folder is not configured. Run setup() once.');
      checkPhotoFolder_(folderId);
      beforePhotos = savePhotos_(form, 'photoBefore', beforeCount, folderId, timestamp,
        form.itemType, 'before', submissionId, createdFiles);
      afterPhotos = savePhotos_(form, 'photoAfter', afterCount, folderId, timestamp,
        form.itemType, 'after', submissionId, createdFiles);
    }

    trace('photos prepared');
    // All submissions share the lock. Store usable URLs before adding pretty links.
    trace('lock wait started');
    lock.waitLock(30000);
    trace('lock acquired');

    // A retry could have completed while this request was preparing photos.
    trace('duplicate lookup started');
    if (submissionExists_(sheet, submissionId)) { trace('duplicate found'); return submissionId; }
    trace('duplicate lookup finished');

    rowData[9] = beforePhotos.join('\n');
    rowData[16] = afterPhotos.join('\n');
    const row = sheet.getLastRow() + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    trace('row write started');
    writeStarted = true;
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([rowData.map(sheetValue_)]);
    trace('row values set');
    SpreadsheetApp.flush();
    trace('row flushed');
    try {
      if (beforePhotos.length) sheet.getRange(row, 10).setRichTextValue(makePhotoLinks_(beforePhotos));
      if (afterPhotos.length) sheet.getRange(row, 17).setRichTextValue(makePhotoLinks_(afterPhotos));
      SpreadsheetApp.flush();
      trace('photo formatting flushed');
    } catch (error) {
      console.warn('Photo link formatting failed; the row already contains photo URLs.', error);
    }
  } catch (error) {
    // A failed sheet write can have an uncertain outcome; retain its photos.
    if (!writeStarted) {
      for (const file of createdFiles) {
        try {
          Drive.Files.update({ trashed: true }, file, null, { supportsAllDrives: true });
        } catch (cleanupError) { console.warn(cleanupError); }
      }
    }
    throw error;
  } finally {
    if (lock.hasLock()) lock.releaseLock();
    trace('lock released');
  }
  return submissionId;
}

function checkPhotoFolder_(folderId) {
  if (typeof Drive === 'undefined') {
    throw new Error('Enable Drive API v3 in Apps Script: Services > + > Drive API.');
  }
  const folder = Drive.Files.get(folderId, {
    supportsAllDrives: true,
    fields: 'id,mimeType,trashed,driveId,capabilities(canAddChildren)'
  });
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('Photo destination must be a folder that is not in Trash.');
  }
  if (!folder.driveId) throw new Error('Choose a photo folder inside your organization’s Shared drive.');
  if (!folder.capabilities || !folder.capabilities.canAddChildren) {
    throw new Error('The account running this script needs permission to upload to the photo folder.');
  }
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length))
    .getValues()[0];

  const matches = headers =>
    headers.every((header, i) => current[i] === header);

  if (matches(HEADERS)) return;

  // One-time migration from the previous 17-column schema.
  // Insert the new Tool purchase request(s) column immediately before Photos after.
  if (matches(LEGACY_HEADERS)) {
    sheet.insertColumnBefore(16);
    sheet.getRange(1, 16).setValue('Tool purchase request(s)');

    const migrated = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (HEADERS.some((header, i) => migrated[i] !== header)) {
      throw new Error('Could not migrate submission columns automatically.');
    }
    return;
  }

  throw new Error(
    'Submission columns do not match the form. Expected the standard RCEB submission headers.'
  );
}

function validateForm_(form) {
  if (!form || typeof form !== 'object') throw new Error('Missing repair form.');
  const fields = ['deviceId', 'volunteerName', 'guestName', 'itemType', 'brand',
    'brandStatus', 'modelInfo', 'condition', 'outcome', 'guestExperience',
    'problemSolution', 'guestReflection', 'toolPurchaseRequests'];
  const result = Object.assign({}, form);
  for (const field of fields) {
    if (form[field] != null && typeof form[field] !== 'string') throw new Error(`Invalid ${field}.`);
    result[field] = (form[field] || '').trim();
    if (result[field].length > 10000) throw new Error(`${field} is too long.`);
  }
  for (const field of ['volunteerName', 'guestName', 'itemType']) {
    if (!result[field]) throw new Error('Volunteer name, guest name, and item type are required.');
  }
  const choices = {
    condition: ['Good', 'Okay', 'Broken'],
    outcome: ['Success', 'Some improvement', 'Advice given', "Couldn't help"],
    guestExperience: ['Great', 'Good', 'Neutral', 'Bad']
  };
  for (const [field, allowed] of Object.entries(choices)) {
    if (!allowed.includes(result[field])) throw new Error(`Choose a valid ${field}.`);
  }
  if (result.brand && !['existing', 'new'].includes(result.brandStatus)) {
    throw new Error('Choose a brand from the list or add it as a new brand.');
  }
  if (!result.brand) result.brandStatus = '';
  for (const prefix of ['photoBefore', 'photoAfter']) {
    const count = Number(form[prefix + 'Count'] || 0);
    if (!Number.isInteger(count) || count < 0 || count > 5) throw new Error('Choose up to five photos per section.');
    result[prefix + 'Count'] = count;
    for (let i = 1; i <= count; i++) {
      const blob = form[prefix + i];
      if (!isPhotoBlob_(blob) || blob.getContentType() !== 'image/jpeg' || !blob.getBytes().length) {
        throw new Error('A photo could not be read. Remove it and add it again.');
      }
    }
  }
  return result;
}

function sheetValue_(value) {
  return typeof value === 'string' && value.startsWith('=') ? "'" + value : value;
}

function isPhotoBlob_(value) {
  return value && typeof value.getBytes === 'function';
}

function savePhotos_(form, prefix, count, folderId, timestamp, objectName, stage, submissionId, createdFiles) {
  const time = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
  const safeName = (objectName || 'item').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  const urls = [];
  for (let i = 1; i <= count; i++) {
    const file = Drive.Files.create({
      name: `${submissionId}_${time}_${safeName}_${stage}_${i}.jpg`,
      mimeType: 'image/jpeg',
      parents: [folderId]
    }, form[prefix + i], { supportsAllDrives: true, fields: 'id,webViewLink' });
    createdFiles.push(file.id);
    urls.push(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`);
  }
  return urls;
}

function makePhotoLinks_(urls) {
  const labels = urls.map((url, index) => `Photo ${index + 1}`);
  const richText = SpreadsheetApp.newRichTextValue().setText(labels.join('\n'));
  let position = 0;

  urls.forEach((url, index) => {
    const label = labels[index];
    const end = position + label.length;
    richText.setLinkUrl(position, end, url);
    position = end + 1;
  });

  return richText.build();
}

function submissionExists_(sheet, submissionId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const submissionIdColumn = HEADERS.indexOf('Submission ID') + 1;
  return !!sheet
    .getRange(2, submissionIdColumn, lastRow - 1, 1)
    .createTextFinder(submissionId)
    .matchEntireCell(true)
    .findNext();
}

function makeSubmissionId_(timestamp) {
  const date = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyyMMdd');
  const random = Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
  return `${date}-${random}`;
}
