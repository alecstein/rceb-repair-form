// RepairMonitorConfig.gs
// Configuration and RepairMonitor-specific lookup tables.
//
// Apps Script .gs files share one global scope. These files are split only
// to keep responsibilities understandable; there are no imports.

// -----------------------------------------------------------------------------
// General configuration
// -----------------------------------------------------------------------------

const RM_CONFIG = {
  sourceSheet: 'RawData',
  linkSheet: 'RepairMonitor',
  timeZone: 'America/New_York',

  origin: 'https://www.repairmonitor.org',
  addRepairUrl: 'https://www.repairmonitor.org/en/node/add/repair',
  closedRepairsUrl: 'https://www.repairmonitor.org/en/repairs/closed',

  productAutocompleteUrl:
    'https://www.repairmonitor.org/en/kind_product_autocomplete/taxonomy_term/default%3Ataxonomy_term/HnNwTT2VlSuQATdNR_eXD-f1b4Q797uTKVyIhd2Kdjk',

  brandAutocompleteUrl:
    'https://www.repairmonitor.org/en/brand_autocomplete/taxonomy_term/default%3Ataxonomy_term/gEOAwRaHjAqY5yzY4R7uND2yYOY1Zg_vOGhm4pd2Nsk',

  repairCafeId: '0562',
  unknownBrand: 'Unknown/n.a.',

  // RepairMonitor's reference field is a signed 32-bit integer.
  maxReference: 2147483647,

  // Stop ourselves before Apps Script's execution limit gets uncomfortably close.
  stopAfterMs: 240000,

  maxRedirects: 6,

  // Set true temporarily when debugging RepairMonitor payloads/taxonomy.
  debug: false
};


// -----------------------------------------------------------------------------
// Spreadsheet schemas
// -----------------------------------------------------------------------------
//
// RawData is header-driven, but intentionally STRICT about names.
// Column order may change. Header spelling may not.
//
// If somebody renames one of these columns, the uploader should fail loudly
// before contacting RepairMonitor so the reason is obvious.

const SOURCE_HEADERS = {
  repairId: 'RepairID',
  date: 'Date',
  repairer: 'Volunteer name',
  productName: 'Product name',
  brandName: 'Brand',
  model: 'Model / serial',
  categoryName: 'RM Category [auto-generated]',
  outcomeName: 'Outcome',
  cause: 'Problem / solution description'
};


// RepairMonitor is also header-driven. These exact headers are required.
// Additional columns are allowed and ignored.

const LINK_HEADERS = {
  repairId: 'RepairID',
  date: 'Repair date',
  reference: 'RM reference',
  link: 'Link'
};

const DEFAULT_LINK_HEADERS = [
  LINK_HEADERS.repairId,
  LINK_HEADERS.date,
  LINK_HEADERS.reference,
  LINK_HEADERS.link
];


// -----------------------------------------------------------------------------
// RepairMonitor form values
// -----------------------------------------------------------------------------

const CATEGORIES = {
  'Bicycles': '1679',
  'Clocks / alarm clocks': '18706',
  'Computer equipment / phones': '1677',
  'Display and sound equipment': '1689',
  'Furniture': '1683',
  'Household appliances electric': '1678',
  'Household appliances non-electric': '5343',
  'Jewelry': '18707',
  'Other': '1685',
  'Textile': '1684',
  'Tools electric': '1690',
  'Tools non-electric': '1691',
  'Toys electric': '1692',
  'Toys non-electric': '1693'
};

const OUTCOMES = {
  'Success': 'yes',
  'Some improvement': 'half',
  'Advice given': 'half',
  "Couldn't help": 'no'
};


// -----------------------------------------------------------------------------
// RepairMonitor invariants
// -----------------------------------------------------------------------------
//
// These are intentionally short, but they are NOT ordinary cleanup comments.
// They encode behavior confirmed against RepairMonitor's real Drupal form.
//
// 1. RawData's old "new product / new brand" status is historical only.
//    Always check RepairMonitor's live taxonomy immediately before submission.
//
// 2. Deleting a repair does not necessarily remove taxonomy terms or free a
//    reference number.
//
// 3. A blank brand must be submitted as the existing taxonomy term
//    "Unknown/n.a.".
//
// 4. For a genuinely new brand, RepairMonitor's browser currently posts
//       target_id               = "Add new brand"
//       autocomplete_fill_field = "Add new brand"
//       other                   = actual brand name
//    RepairMonitor may then display "Add new brand". That is a RepairMonitor
//    bug. Do not invent a different payload without re-capturing the browser.
//
// 5. A POST returning without throwing is NOT proof of success. RepairMonitor
//    sometimes returns the Add Repair form with HTTP 200 on validation failure.
//    Every submission must be confirmed in Completed repairs.
//
// 6. GET the dated Add Repair form to obtain fresh Drupal tokens, but POST the
//    completed repair to the bare /en/node/add/repair URL.
//
// 7. Existing taxonomy fields must use RepairMonitor's returned autocomplete
//    value. Do not reconstruct that value locally.
//
// 8. If this integration breaks, capture RepairMonitor's real browser POST and
//    autocomplete response before changing Drupal field semantics.


// RepairMonitorSheets.gs
// Everything here is about reading/writing Google Sheets.
// No RepairMonitor HTTP behavior belongs in this file.

function getRequiredSheet(book, name) {
  const sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('Cannot find the ' + name + ' tab.');
  return sheet;
}


function ensureRepairMonitorSheet(book) {
  let sheet = book.getSheetByName(RM_CONFIG.linkSheet);

  if (!sheet) {
    sheet = book.insertSheet(RM_CONFIG.linkSheet);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, DEFAULT_LINK_HEADERS.length)
      .setValues([DEFAULT_LINK_HEADERS]);
  }

  return sheet;
}


function headerText(value) {
  // Header names are deliberately exact. Do not trim or normalize them.
  return String(value == null ? '' : value);
}


function resolveExactColumns(headerRow, requiredHeaders, sheetName) {
  const headers = headerRow.map(headerText);
  const columns = {};

  for (const [field, requiredHeader] of Object.entries(requiredHeaders)) {
    const matches = [];

    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === requiredHeader) {
        matches.push(i);
      }
    }

    if (matches.length === 0) {
      throw new Error(
        sheetName +
        ' is missing required column "' +
        requiredHeader +
        '". Header names are exact. Found: ' +
        headers
          .filter(header => header !== '')
          .map(header => JSON.stringify(header))
          .join(' | ')
      );
    }

    if (matches.length > 1) {
      throw new Error(
        sheetName +
        ' has duplicate required column "' +
        requiredHeader +
        '".'
      );
    }

    columns[field] = matches[0];
  }

  return columns;
}


function cellText(value) {
  if (value == null) return '';
  return String(value).trim();
}


function loadSourceRepairs(sheet) {
  const rows = sheet.getDataRange().getValues();

  if (!rows.length || rows[0].every(value => headerText(value) === '')) {
    throw new Error(RM_CONFIG.sourceSheet + ' is empty.');
  }

  const columns = resolveExactColumns(
    rows[0],
    SOURCE_HEADERS,
    RM_CONFIG.sourceSheet
  );

  const repairs = [];
  const seen = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawId = row[columns.repairId];

    if (rawId === '' || rawId == null) continue;

    if (typeof rawId !== 'string') {
      throw new Error(
        'RepairID must be text in ' +
        RM_CONFIG.sourceSheet +
        ' row ' +
        (i + 1) +
        '.'
      );
    }

    const id = rawId.trim();
    if (!id) continue;

    if (seen.has(id)) {
      throw new Error('Duplicate RepairID in source sheet: ' + id);
    }

    seen.add(id);

    const dateTime = sourceRepairDateTime(row[columns.date]);

    repairs.push({
      id,
      sourceRow: i + 1,
      date: sourceRepairDate(dateTime),
      dateTime,
      repairer: cellText(row[columns.repairer]),
      productName: cellText(row[columns.productName]),
      brandName: cellText(row[columns.brandName]),
      model: cellText(row[columns.model]),
      categoryName: cellText(row[columns.categoryName]),
      outcomeName: cellText(row[columns.outcomeName]),
      cause: cellText(row[columns.cause])
    });
  }

  return repairs;
}


function loadRepairLinkState(sheet) {
  const rows = sheet.getDataRange().getValues();

  const columns = resolveExactColumns(
    rows[0],
    LINK_HEADERS,
    RM_CONFIG.linkSheet
  );

  const byId = new Map();
  let lastReference = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawId = row[columns.repairId];

    if (rawId === '' || rawId == null) continue;

    if (typeof rawId !== 'string') {
      throw new Error(
        'RepairID must be text in ' +
        RM_CONFIG.linkSheet +
        ' row ' +
        (i + 1) +
        '.'
      );
    }

    const id = rawId.trim();

    if (byId.has(id)) {
      throw new Error('Duplicate RepairID in linking table: ' + id);
    }

    const reference = row[columns.reference];

    if (
      !Number.isInteger(reference) ||
      reference <= 0 ||
      reference > RM_CONFIG.maxReference
    ) {
      throw new Error('Invalid RM reference for ' + id);
    }

    const entry = {
      row: i + 1,
      date: repairMonitorDate(row[columns.date]),
      reference,
      link: cellText(row[columns.link])
    };

    byId.set(id, entry);
    lastReference = Math.max(lastReference, reference);
  }

  return {
    byId,
    columns,
    lastReference
  };
}


function createRepairLinkEntry(sheet, columns, repair, reference) {
  const row = sheet.getLastRow() + 1;

  sheet.getRange(row, columns.date + 1)
    .setNumberFormat('mmm d, yyyy h:mm:ss.000 AM/PM');

  sheet.getRange(row, columns.repairId + 1).setValue(repair.id);
  sheet.getRange(row, columns.date + 1)
    .setValue(repair.dateTime);
  sheet.getRange(row, columns.reference + 1).setValue(reference);
  sheet.getRange(row, columns.link + 1).setValue('');

  return {
    row,
    date: repair.date,
    reference,
    link: ''
  };
}


function updatePendingRepairEntry(sheet, columns, entry, repair, reference) {
  // If a previous pending attempt is no longer present on RepairMonitor,
  // the new attempt should use the CURRENT RawData date as well as a fresh
  // reference.
  sheet.getRange(entry.row, columns.date + 1)
    .setNumberFormat('mmm d, yyyy h:mm:ss.000 AM/PM');
  sheet.getRange(entry.row, columns.date + 1)
    .setValue(repair.dateTime);
  sheet.getRange(entry.row, columns.reference + 1).setValue(reference);

  entry.date = repair.date;
  entry.reference = reference;
}


function saveRepairLink(sheet, columns, entry, link) {
  sheet.getRange(entry.row, columns.link + 1).setValue(link);
  entry.link = link;
}


function repairMonitorDate(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) {
    throw new Error('Repair date must be a real date in the linking table.');
  }

  return Utilities.formatDate(value, RM_CONFIG.timeZone, 'yyyy-MM-dd');
}


function sourceRepairDate(value) {
  return Utilities.formatDate(
    sourceRepairDateTime(value),
    RM_CONFIG.timeZone,
    'yyyy-MM-dd'
  );
}


function sourceRepairDateTime(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) {
    throw new Error('Repair date must be a real date in RawData.');
  }

  return value;
}


// RepairMonitorClient.gs
// RepairMonitor/Drupal behavior only.
//
// Keep the unusual payload shapes in this file explicit. They mirror
// RepairMonitor's browser behavior and should not be "cleaned up" casually.

function setCookie() {
  const ui = SpreadsheetApp.getUi();

  const answer = ui.prompt(
    'RepairMonitor cookie',
    'Paste SSESS...=... from your browser.',
    ui.ButtonSet.OK_CANCEL
  );

  if (answer.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getUserProperties().setProperty(
      'REPAIR_MONITOR_COOKIE',
      answer.getResponseText().trim().replace(/^Cookie:\s*/i, '')
    );
  }
}


function debugLog(message) {
  if (RM_CONFIG.debug) console.log(message);
}


function taxonomyLookup(url, name) {
  name = cellText(name);
  if (!name) return null;

  const response = UrlFetchApp.fetch(
    url + '?q=' + encodeURIComponent(name),
    {
      headers: { Accept: 'application/json' },
      muteHttpExceptions: true
    }
  );

  const status = response.getResponseCode();

  if (status !== 200) {
    throw new Error(
      'Could not check RepairMonitor taxonomy. HTTP ' + status
    );
  }

  let results;

  try {
    results = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('RepairMonitor taxonomy returned invalid JSON.');
  }

  if (!Array.isArray(results)) {
    throw new Error(
      'RepairMonitor taxonomy returned an unexpected response.'
    );
  }

  const wanted = name.toLowerCase();

  return results.find(item =>
    cellText(item && item.label).toLowerCase() === wanted
  ) || null;
}


function buildRepairFields(repair) {
  const {
    repairer,
    productName,
    brandName,
    model,
    categoryName,
    outcomeName,
    cause
  } = repair;

  if (!productName) {
    throw new Error('Missing product.');
  }

  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, categoryName)) {
    throw new Error('Unknown category: ' + categoryName);
  }

  if (!Object.prototype.hasOwnProperty.call(OUTCOMES, outcomeName)) {
    throw new Error('Unknown outcome: ' + outcomeName);
  }

  const category = CATEGORIES[categoryName];
  const outcome = OUTCOMES[outcomeName];

  // RawData's historical new/existing flags are intentionally ignored.
  // RepairMonitor's current taxonomy is the source of truth.
  const productMatch = taxonomyLookup(
    RM_CONFIG.productAutocompleteUrl,
    productName
  );

  const submittedBrandName = brandName || RM_CONFIG.unknownBrand;

  const brandMatch = taxonomyLookup(
    RM_CONFIG.brandAutocompleteUrl,
    submittedBrandName
  );

  const newProduct = !productMatch;
  const newBrand = !brandMatch;

  if (!brandName && !brandMatch) {
    throw new Error(
      'RepairMonitor fallback brand is missing from taxonomy: ' +
      RM_CONFIG.unknownBrand
    );
  }

  const productValue = productMatch
    ? String(productMatch.value || productMatch.label || productName)
    : 'Add new product';

  const brandValue = brandMatch
    ? String(brandMatch.value || brandMatch.label || submittedBrandName)
    : 'Add new brand';

  debugLog(
    'Product taxonomy: ' + productName + ' → ' +
    (productMatch ? 'existing (' + productValue + ')' : 'new')
  );

  debugLog(
    'Brand taxonomy: ' +
    (brandName || '[blank → ' + RM_CONFIG.unknownBrand + ']') +
    ' → ' +
    (brandMatch ? 'existing (' + brandValue + ')' : 'new')
  );

  return {
    form_id: 'node_repair_form',

    'field_kind_product[0][target_id]': productValue,
    'field_kind_product[0][autocomplete_fill_field]': productValue,
    'field_kind_product[0][kp_other]': newProduct ? productName : '',
    field_categorie: category,

    'field_brand[0][target_id]': brandValue,
    'field_brand[0][autocomplete_fill_field]': brandValue,
    'field_brand[0][other]': newBrand ? submittedBrandName : '',

    'field_product_buildyear[0][value]': '',
    'field_model[0][target_id]': model,
    'field_cause_of_fault[0][value]': cause,
    'field_repairer[0][target_id]': repairer,
    'field_fault[0][value]': '',

    field_product_repaired: outcome,
    'field_solution[0][value]': '',
    field_repair_failed: '_none',
    'field_advice[0][value]': '',
    'field_repair_source[0][value]': '',
    'field_hint[0][value]': '',

    op: 'Complete repair',
    advanced__active_tab: 'edit-revision-information'
  };
}


function postRepair(fields) {
  const datedUrl =
    RM_CONFIG.addRepairUrl +
    '?date=' +
    encodeURIComponent(fields['field_repair_date[0][value]']);

  // Get fresh Drupal tokens before every POST.
  const html = rmRequest(datedUrl);
  const inputs = extractFormInputs(html);

  if (!inputs.form_token || !inputs.form_build_id) {
    throw new Error('Could not read RepairMonitor form tokens.');
  }

  return rmRequest(RM_CONFIG.addRepairUrl, {
    ...fields,
    changed: inputs.changed || '',
    form_token: inputs.form_token,
    form_build_id: inputs.form_build_id
  });
}


function extractFormInputs(html) {
  const inputs = {};

  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    const attributes = {};
    const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;

    while ((match = pattern.exec(tag))) {
      attributes[match[1].toLowerCase()] =
        decodeHtmlEntities(match[2] ?? match[3]);
    }

    if (attributes.name) {
      inputs[attributes.name] = attributes.value || '';
    }
  }

  return inputs;
}


function rmRequest(url, fields) {
  const storedCookie =
    PropertiesService.getUserProperties()
      .getProperty('REPAIR_MONITOR_COOKIE');

  if (!storedCookie) {
    throw new Error('Set your RepairMonitor cookie first.');
  }

  const cookies = {};

  function addCookie(pair) {
    const equals = pair.indexOf('=');

    if (equals > 0) {
      cookies[pair.slice(0, equals).trim()] =
        pair.slice(equals + 1);
    }
  }

  storedCookie.split(/;\s*/).forEach(addCookie);

  for (let attempt = 0; attempt < RM_CONFIG.maxRedirects; attempt++) {
    const cookieHeader = Object.entries(cookies)
      .map(([name, value]) => name + '=' + value)
      .join('; ');

    const options = {
      method: fields ? 'post' : 'get',
      headers: { Cookie: cookieHeader },
      followRedirects: false,
      muteHttpExceptions: true
    };

    if (fields) {
      options.contentType = 'application/x-www-form-urlencoded';
      options.payload = Object.entries(fields)
        .map(([key, value]) =>
          encodeURIComponent(key) + '=' + encodeURIComponent(value)
        )
        .join('&');
    }

    const response = UrlFetchApp.fetch(url, options);
    const status = response.getResponseCode();
    const html = response.getContentText();

    const headers = {};

    Object.entries(response.getAllHeaders())
      .forEach(([key, value]) => {
        headers[key.toLowerCase()] = value;
      });

    if (headers['set-cookie']) {
      [].concat(headers['set-cookie']).forEach(value => {
        addCookie(String(value).split(';')[0]);
      });

      PropertiesService.getUserProperties().setProperty(
        'REPAIR_MONITOR_COOKIE',
        Object.entries(cookies)
          .map(([name, value]) => name + '=' + value)
          .join('; ')
      );
    }

    const location = String(headers.location || '');

    if (
      status === 401 ||
      status === 403 ||
      /\/user\/login(?:[/?#]|$)/i.test(location) ||
      /user-login-form|user_login_form/i.test(html)
    ) {
      throw new Error(
        'Session cookie expired or rejected. Set a fresh cookie.'
      );
    }

    if ([301, 302, 303, 307, 308].includes(status)) {
      debugLog('HTTP ' + status + ' → ' + location);

      if (fields && [307, 308].includes(status)) {
        throw new Error('Unexpected POST redirect: ' + location);
      }

      if (location.startsWith('/') && !location.startsWith('//')) {
        url = RM_CONFIG.origin + location;
      } else if (location.startsWith('?')) {
        url = url.split('?')[0] + location;
      } else {
        url = location;
      }

      if (!url.startsWith(RM_CONFIG.origin + '/')) {
        throw new Error(
          'Unexpected redirect destination: ' + url
        );
      }

      // RepairMonitor's successful POST redirects to a GET page.
      fields = null;
      continue;
    }

    if (status >= 400) {
      console.log('FAILED URL: ' + url);
      console.log('FAILED STATUS: ' + status);
      console.log(
        'FAILED RESPONSE: ' +
        htmlToText(html).slice(0, 1000)
      );

      if (fields) {
        console.log(
          'FAILED FIELDS: ' +
          JSON.stringify(fields, null, 2)
        );
      }

      throw new Error(
        'HTTP ' + status + ': ' +
        htmlToText(html).slice(0, 1000)
      );
    }

    if (/<title[^>]*>\s*Redirecting to/i.test(html)) {
      throw new Error(
        'Received a redirect page with HTTP ' + status +
        ', but no supported HTTP redirect. Location: ' +
        location +
        '; Refresh: ' +
        (headers.refresh || '(none)')
      );
    }

    return html;
  }

  throw new Error(
    'RepairMonitor kept redirecting after ' +
    RM_CONFIG.maxRedirects +
    ' requests.'
  );
}


function findRepair(entry) {
  const url =
    RM_CONFIG.closedRepairsUrl +
    '?field_repair_date_value=' +
    encodeURIComponent(entry.date) +
    '&field_reference_number_value=' +
    encodeURIComponent(entry.reference) +
    '&field_categorie_target_id=All' +
    '&field_product_repaired_value=All';

  const html = rmRequest(url);

  const [year, month, day] = entry.date.split('-');

  const expectedReference =
    RM_CONFIG.repairCafeId +
    '_' + year +
    '_' + month + day +
    '_' + entry.reference;

  const links =
    /<a\b[^>]*href=["'](\/en\/node\/\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = links.exec(html))) {
    const label =
      htmlToText(match[2])
        .split('|')[0]
        .trim();

    if (label === expectedReference) {
      return RM_CONFIG.origin + match[1];
    }
  }

  return '';
}


function htmlToText(html) {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}


function decodeHtmlEntities(text) {
  const entities = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' '
  };

  return String(text).replace(
    /&(amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi,
    (match, entity) => {
      if (entity.startsWith('#')) {
        return String.fromCodePoint(
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10)
        );
      }

      return entities[entity.toLowerCase()];
    }
  );
}


// RepairMonitorUpload.gs
// Main orchestration.
//
// RawData is the queue.
// RepairMonitor is only persistence/recovery state.
//
// For each RawData repair:
//   - if already linked: skip
//   - otherwise create/reuse a stable pending reference
//   - search RepairMonitor first
//   - if an OLD pending reference no longer exists, rotate it
//   - submit if necessary
//   - confirm in Completed repairs
//   - save the link

function submitRepairs() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(1000)) {
    ui.alert('An import is already running.');
    return;
  }

  const started = Date.now();
  let currentId = '';
  let timedOut = false;

  const counts = {
    submitted: 0,
    foundExisting: 0,
    alreadyLinked: 0
  };

  let message = '';

  try {
    if (
      !PropertiesService.getUserProperties()
        .getProperty('REPAIR_MONITOR_COOKIE')
    ) {
      throw new Error('Set your RepairMonitor cookie first.');
    }

    const book = SpreadsheetApp.getActive();

    const sourceSheet =
      getRequiredSheet(book, RM_CONFIG.sourceSheet);

    const repairs =
      loadSourceRepairs(sourceSheet);

    const linkSheet =
      ensureRepairMonitorSheet(book);

    const state =
      loadRepairLinkState(linkSheet);

    for (const repair of repairs) {
      if (Date.now() - started > RM_CONFIG.stopAfterMs) {
        timedOut = true;
        break;
      }

      currentId = repair.id;

      const result =
        syncRepair(repair, linkSheet, state);

      counts[result]++;
    }

    message = runSummary(counts, timedOut);

  } catch (error) {
    message =
      'Stopped' +
      (currentId ? ' at repair ' + currentId : '') +
      ': ' +
      error.message +
      '\n\nThis run: ' +
      countSummary(counts);

  } finally {
    lock.releaseLock();
  }

  ui.alert(message);
}


function syncRepair(repair, linkSheet, state) {
  let entry = state.byId.get(repair.id);

  // Existing before THIS run means the reference may have been used by a
  // previous attempt. A newly-created row has not yet been posted.
  const existedBeforeThisRun = Boolean(entry);

  if (!entry) {
    const reference = nextRepairMonitorReference(
      state.lastReference
    );

    state.lastReference = reference;

    entry = createRepairLinkEntry(
      linkSheet,
      state.columns,
      repair,
      reference
    );

    state.byId.set(repair.id, entry);

    // Durability boundary: persist the reference before making any external
    // request. If Apps Script dies after RepairMonitor accepts the POST, the
    // next run can search for this exact reference instead of double-posting.
    SpreadsheetApp.flush();
  }

  if (entry.link) {
    return 'alreadyLinked';
  }

  // Every pending row is checked before posting. This handles the important
  // case where RepairMonitor saved a previous POST but Apps Script failed
  // before we managed to save the Link.
  let link = findRepair(entry);

  if (link) {
    saveRepairLink(
      linkSheet,
      state.columns,
      entry,
      link
    );

    console.log(
      'Found existing RepairMonitor repair for ' +
      repair.id +
      ': ' +
      link
    );

    return 'foundExisting';
  }

  // If a pending row existed before this execution and its old reference is
  // NOT on RepairMonitor, retire that reference before retrying.
  //
  // This is also safe for blank-link rows created by the OLD uploader before
  // it timed out: their unused old reference is simply replaced once.
  if (existedBeforeThisRun) {
    const reference = nextRepairMonitorReference(
      state.lastReference
    );

    state.lastReference = reference;

    updatePendingRepairEntry(
      linkSheet,
      state.columns,
      entry,
      repair,
      reference
    );

    // Same durability boundary: make the new date/reference persistent before
    // attempting the external POST.
    SpreadsheetApp.flush();

    console.log(
      'Old RM reference not found. Retrying ' +
      repair.id +
      ' with ' +
      reference
    );
  }

  const fields = buildRepairFields(repair);

  fields['field_repair_date[0][value]'] =
    entry.date;

  fields['field_reference_number[0][value]'] =
    String(entry.reference);

  console.log(
    'Submitting repair ' +
    repair.id +
    ' with RM reference ' +
    entry.reference
  );

  debugLog(JSON.stringify(fields, null, 2));

  let sendError;

  try {
    postRepair(fields);
  } catch (error) {
    sendError = error;
  }

  // A failed/odd HTTP response can still mean RepairMonitor saved the repair.
  // The Completed repairs search is the source of truth.
  try {
    link = findRepair(entry);

    if (!link) {
      throw sendError ||
        new Error(
          'The submitted repair was not found in Completed repairs.'
        );
    }

  } catch (error) {
    throw new Error(
      error.message +
      '\n\nCheck RepairMonitor before running again. ' +
      'Keep the RepairMonitor row. The next run will search this reference ' +
      'first, then use a fresh reference only if RepairMonitor does not ' +
      'contain it.'
    );
  }

  saveRepairLink(
    linkSheet,
    state.columns,
    entry,
    link
  );

  console.log(
    'Confirmed RepairMonitor repair for ' +
    repair.id +
    ': ' +
    link
  );

  return 'submitted';
}


function nextRepairMonitorReference(lastReference) {
  const secondsSince2020 =
    Math.floor(
      (Date.now() - Date.UTC(2020, 0, 1)) / 1000
    );

  const reference =
    Math.max(
      secondsSince2020,
      lastReference + 1
    );

  if (reference > RM_CONFIG.maxReference) {
    throw new Error('RM reference is too large.');
  }

  return reference;
}


function countSummary(counts) {
  return [
    counts.submitted + ' submitted',
    counts.foundExisting + ' found already on RepairMonitor',
    counts.alreadyLinked + ' already linked'
  ].join(', ');
}


function runSummary(counts, timedOut) {
  const summary = countSummary(counts);

  if (timedOut) {
    return (
      'Stopped before the Apps Script timeout: ' +
      summary +
      '. Run again to continue.'
    );
  }

  return 'Done: ' + summary + '.';
}
