import { googleRequest } from './google-request.mjs';

export function spreadsheetBaseUrl(spreadsheetId) {
  return 'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(spreadsheetId);
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

export async function appendSheetRow(spreadsheetId, sheetName, values) {
  const url = spreadsheetBaseUrl(spreadsheetId) +
    '/values/' +
    encodeURIComponent(sheetRange(sheetName)) +
    ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';

  await googleRequest(url, {
    method: 'POST',
    data: {
      values: [values]
    }
  });
}
