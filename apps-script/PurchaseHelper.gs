// This manages the checkboxes for purchase requests.
//
// The RawData sheet is read by header name. The two purchase sheets are
// managed by this script and keep their own small, named schemas.

const RAW_DATA_HEADERS = {
  repairId: 'RepairID',
  date: 'Date',
  requester: 'Volunteer name',
  item: 'Purchase requests'
};

const PURCHASE_HELPER_HEADERS = [
  'RepairID',
  'Bought',
  'Date',
  'Requester',
  'Item'
];

const PURCHASE_REQUEST_HEADERS = [
  'RepairID',
  'Date',
  'Requester',
  'Item',
  'Bought'
];

const PURCHASE_HELPER_SCHEMA = {
  repairId: 'RepairID',
  bought: 'Bought',
  date: 'Date',
  requester: 'Requester',
  item: 'Item'
};

const PURCHASE_REQUEST_SCHEMA = {
  repairId: 'RepairID',
  date: 'Date',
  requester: 'Requester',
  item: 'Item',
  bought: 'Bought'
};

// Existing installations: replace the code and save; keep the current triggers.
function installPurchaseSync() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('PR_SPREADSHEET', ss.getId());

  for (const name of ['PurchaseHelper', 'PurchaseRequests']) {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  }

  ss.getSheetByName('PurchaseHelper')
    .getRange(1, 1, 1, PURCHASE_HELPER_HEADERS.length)
    .setValues([PURCHASE_HELPER_HEADERS]);

  ss.getSheetByName('PurchaseRequests')
    .getRange(1, 1, 1, PURCHASE_REQUEST_HEADERS.length)
    .setValues([PURCHASE_REQUEST_HEADERS]);

  // Re-running setup must not create duplicate triggers.
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (['refreshPurchaseSync', 'purchaseSyncEdited'].includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  refreshPurchaseSync();
  ScriptApp.newTrigger('purchaseSyncEdited').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('refreshPurchaseSync').timeBased().everyMinutes(1).create();
  ss.getSheetByName('PurchaseHelper').hideSheet();
}

function purchaseSyncEdited(e) {
  if (e && e.range && ['RawData', 'PurchaseRequests'].includes(e.range.getSheet().getName())) {
    refreshPurchaseSync();
  }
}

function refreshPurchaseSync() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(
      PropertiesService.getScriptProperties().getProperty('PR_SPREADSHEET')
    );

    const rawSheet = ss.getSheetByName('RawData');
    const helper = ss.getSheetByName('PurchaseHelper');
    const view = ss.getSheetByName('PurchaseRequests');

    const raw = prRawRows_(rawSheet);
    const savedTable = prTable_(helper, PURCHASE_HELPER_SCHEMA);
    const visibleTable = prTable_(view, PURCHASE_REQUEST_SCHEMA);
    const saved = savedTable.rows;
    const visible = visibleTable.rows;

    prValidate_(raw, 'RawData');
    prValidate_(saved, 'PurchaseHelper');
    prValidate_(visible, 'PurchaseRequests');

    if (raw.some(row => !String(row.repairId).trim() && String(row.item).trim())) {
      throw new Error('A purchase request is missing its RepairID.');
    }

    const result = prPlan_(raw.filter(row => String(row.repairId).trim()), saved, visible);
    prWrite_(helper, result.helper, savedTable, PURCHASE_HELPER_SCHEMA);
    prWrite_(view, result.view, visibleTable, PURCHASE_REQUEST_SCHEMA);

    result.view.forEach((row, i) => {
      if (String(row.item).trim()) view.showRows(i + 2);
      else view.hideRows(i + 2);
    });

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function prRawRows_(sheet) {
  const indexes = prHeaderIndexes_(sheet, RAW_DATA_HEADERS);
  const values = prDataRows_(sheet);

  return values.map(row => ({
    repairId: String(row[indexes.repairId] || '').trim(),
    date: row[indexes.date],
    requester: row[indexes.requester],
    item: row[indexes.item] || ''
  }));
}

function prTable_(sheet, schema) {
  const indexes = prHeaderIndexes_(sheet, schema);
  const values = prDataRows_(sheet);
  const rows = values.map(row => {
    const result = {};

    for (const field in schema) {
      result[field] = row[indexes[field]];
    }

    return result;
  });

  return { indexes, values, rows };
}

function prDataRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];

  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues();
}

function prHeaderIndexes_(sheet, schema) {
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(header => String(header).trim());

  const indexes = {};

  for (const field in schema) {
    const headerName = schema[field];
    const matches = [];

    headers.forEach((header, i) => {
      if (header === headerName) matches.push(i);
    });

    if (matches.length === 0) {
      throw new Error(
        'The ' + sheet.getName() + ' sheet is missing the required header "' +
        headerName + '".'
      );
    }

    if (matches.length > 1) {
      throw new Error(
        'The ' + sheet.getName() + ' sheet has duplicate headers named "' +
        headerName + '".'
      );
    }

    indexes[field] = matches[0];
  }

  return indexes;
}

function prValidate_(rows, name) {
  const seen = new Set();

  for (const row of rows) {
    const id = String(row.repairId).trim();
    if (!id) continue;
    if (seen.has(id)) throw new Error('Duplicate RepairID in ' + name + ': ' + id);
    seen.add(id);
  }
}

function prPlan_(raw, saved, visible) {
  const source = new Map(raw.map(row => [row.repairId, row]));
  const status = new Map(
    saved.map(row => [String(row.repairId).trim(), row.bought === true])
  );

  // Save checkbox clicks before updating either sheet.
  for (const row of visible) {
    const id = String(row.repairId).trim();
    if (id && String(row.item).trim()) {
      status.set(id, row.bought === true);
    }
  }

  // Keep existing row positions. Append new IDs; never reorder existing ones.
  const helper = saved.map(row => ({ ...row }));
  const known = new Set(helper.map(row => String(row.repairId).trim()));

  for (const row of raw) {
    const id = String(row.repairId).trim();
    if (String(row.item).trim() && !known.has(id)) {
      helper.push(prEmptyHelperRow_(id));
      known.add(id);
    }
  }

  helper.forEach((row, i) => {
    const id = String(row.repairId).trim();
    const sourceRow = source.get(id);

    helper[i] = sourceRow && String(sourceRow.item).trim()
      ? {
          repairId: id,
          bought: status.get(id) === true,
          date: sourceRow.date,
          requester: sourceRow.requester,
          item: sourceRow.item
        }
      : prEmptyHelperRow_(id);
  });

  const byId = new Map(helper.map(row => [row.repairId, row]));
  const view = visible.map(row => ({ ...row }));
  const displayed = new Set(view.map(row => String(row.repairId).trim()));

  for (const row of helper) {
    const id = String(row.repairId).trim();
    if (id && String(row.item).trim() && !displayed.has(id)) {
      view.push(prEmptyViewRow_(id));
      displayed.add(id);
    }
  }

  view.forEach((row, i) => {
    const id = String(row.repairId).trim();
    const helperRow = byId.get(id) || prEmptyHelperRow_(id);

    view[i] = {
      repairId: id,
      date: helperRow.date,
      requester: helperRow.requester,
      item: helperRow.item,
      bought: helperRow.bought
    };
  });

  return { helper, view };
}

function prEmptyHelperRow_(repairId) {
  return {
    repairId: repairId,
    bought: false,
    date: '',
    requester: '',
    item: ''
  };
}

function prEmptyViewRow_(repairId) {
  return {
    repairId: repairId,
    date: '',
    requester: '',
    item: '',
    bought: false
  };
}

function prWrite_(sheet, rows, table, schema) {
  if (!rows.length) return;

  if (sheet.getMaxRows() < rows.length + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  }

  rows.forEach((row, i) => {
    for (const field in schema) {
      const column = table.indexes[field];
      const previous = table.values[i] ? table.values[i][column] : undefined;
      const value = row[field];
      const same = previous instanceof Date && value instanceof Date
        ? previous.getTime() === value.getTime()
        : previous === value;

      // Do not rewrite unchanged checkboxes while someone might be clicking them.
      if (!same) sheet.getRange(i + 2, column + 1).setValue(value);
    }
  });

  const boughtColumn = table.indexes.bought + 1;
  const dateColumn = table.indexes.date + 1;

  sheet.getRange(2, boughtColumn, rows.length, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().build()
  );
  sheet.getRange(2, dateColumn, rows.length, 1).setNumberFormat('m/d/yyyy');
}
