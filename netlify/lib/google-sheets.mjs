import { googleRequest } from './google-request.mjs';

const DEFAULT_TIME_ZONE = 'America/New_York';

export function spreadsheetBaseUrl(spreadsheetId) {
  return 'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(spreadsheetId);
}

export function dateCell(date, timeZone = DEFAULT_TIME_ZONE) {
  // Sheets stores datetimes as days since 1899-12-30, with the
  // fractional part representing the time of day.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  const localMilliseconds = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    date.getUTCMilliseconds()
  );

  const sheetsSerial =
    localMilliseconds / (24 * 60 * 60 * 1000) + 25569;

  return {
    userEnteredValue: { numberValue: sheetsSerial },
    userEnteredFormat: {
      numberFormat: {
        type: 'DATE_TIME',
        pattern: 'mmm d, yyyy h:mm:ss.000 AM/PM'
      }
    }
  };
}

export function sheetCell(value) {
  if (value instanceof Date) {
    return dateCell(value);
  }

  return {
    userEnteredValue: {
      stringValue: String(value ?? '')
    }
  };
}

export function sheetRange(sheetName, a1Range) {
  const escapedSheetName = String(sheetName).replace(/'/g, "''");
  const quotedSheetName = `'${escapedSheetName}'`;

  return a1Range
    ? quotedSheetName + '!' + a1Range
    : quotedSheetName;
}

export async function getSheetHeaders(spreadsheetId, sheetName) {
  const url = spreadsheetBaseUrl(spreadsheetId) +
    '/values/' +
    encodeURIComponent(sheetRange(sheetName, '1:1'));

  const data = await googleRequest(url);
  const headers = data.values?.[0] ?? [];

  if (!headers.length) {
    throw new Error('The ' + sheetName + ' sheet has no header row.');
  }

  return headers.map(header => String(header).trim());
}

export async function getSheetValues(spreadsheetId, sheetName) {
  const url = spreadsheetBaseUrl(spreadsheetId) +
    '/values/' +
    encodeURIComponent(sheetRange(sheetName));

  return googleRequest(url);
}

export function requireHeaders(headers, requiredHeaders, sheetName) {
  for (const requiredHeader of requiredHeaders) {
    const matches = [];

    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === requiredHeader) {
        matches.push(i);
      }
    }

    if (matches.length === 0) {
      throw new Error(
        'The ' + sheetName + ' sheet is missing the required header "' +
        requiredHeader + '".'
      );
    }

    if (matches.length > 1) {
      throw new Error(
        'The ' + sheetName + ' sheet has duplicate headers named "' +
        requiredHeader + '".'
      );
    }
  }
}

export async function getSheetInfo(spreadsheetId, sheetName) {
  const baseUrl = spreadsheetBaseUrl(spreadsheetId);
  const spreadsheet = await googleRequest(
    baseUrl + '?fields=sheets(properties(sheetId,title))'
  );

  const sheet = spreadsheet.sheets?.find(
    candidate => candidate.properties.title === sheetName
  );

  if (!sheet) {
    throw new Error('Configured Google Sheet tab was not found: ' + sheetName);
  }

  return {
    baseUrl,
    sheetId: sheet.properties.sheetId
  };
}

export async function appendSheetCells(spreadsheetId, sheetName, cells) {
  const sheet = await getSheetInfo(spreadsheetId, sheetName);

  await googleRequest(sheet.baseUrl + ':batchUpdate', {
    method: 'POST',
    data: {
      requests: [{
        appendCells: {
          sheetId: sheet.sheetId,
          rows: [{ values: cells }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      }]
    }
  });
}
