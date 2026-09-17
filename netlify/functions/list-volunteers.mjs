import {
  getSheetHeaders,
  getSheetValues,
  requireHeaders
} from '../lib/google-sheets.mjs';

const FULL_NAME_HEADER = 'Full Name';

async function getVolunteersList() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error('Configure GOOGLE_SPREADSHEET_ID in Netlify.');
  }

  const sheetName = process.env.VOLUNTEER_SHEET_TAB;
  if (!sheetName) {
    throw new Error('Configure VOLUNTEER_SHEET_TAB in Netlify.');
  }

  const headers = await getSheetHeaders(spreadsheetId, sheetName);
  requireHeaders(headers, [FULL_NAME_HEADER], sheetName);

  let fullNameColumn;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] === FULL_NAME_HEADER) {
      fullNameColumn = i;
      break;
    }
  }

  const data = await getSheetValues(spreadsheetId, sheetName);
  const values = data.values ?? [];

  const names = values
    .slice(1)
    .map(row => String(row[fullNameColumn] ?? '').trim())
    .filter(Boolean);

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export default async () => {
  try {
    const volunteers = await getVolunteersList();
    return new Response(
      JSON.stringify(volunteers),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  } catch (error) {
    console.error("Couldn't get list of registered volunteers.", error);
    return new Response(
      JSON.stringify({ error: "Couldn't get list of volunteers." }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  }
};
