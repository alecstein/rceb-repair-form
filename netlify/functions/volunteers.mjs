import { googleRequest } from '../lib/google.mjs';

export default async () => {
  try {
    const spreadsheetId = process.env.VOLUNTEER_SHEET_ID;
    const sheetName = process.env.VOLUNTEER_SHEET_TAB;

    if (!spreadsheetId) {
      throw new Error('Configure VOLUNTEER_SHEET_ID in Netlify.');
    }

    if (!sheetName) {
      throw new Error('Configure VOLUNTEER_SHEET_TAB in Netlify.');
    }

    // Full Name is column D, starting below the header row.
    const escapedSheetName = sheetName.replace(/'/g, "''");
    const range = `'${escapedSheetName}'!D2:D`;

    const url =
      'https://sheets.googleapis.com/v4/spreadsheets/' +
      `${encodeURIComponent(spreadsheetId)}/values/` +
      encodeURIComponent(range);

    const data = await googleRequest(url);

    const volunteers = [
      ...new Set(
        (data.values || [])
          .flat()
          .map(name => String(name).trim())
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));

    return new Response(JSON.stringify(volunteers), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60'
      }
    });
  } catch (error) {
    console.error('Could not load volunteers:', error);

    return new Response(
      JSON.stringify({ error: 'Could not load volunteers.' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  }
};
