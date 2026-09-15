// written by an LLM
// registers a volunteer and refreshes

import { googleRequest } from '../lib/google.mjs';

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Use POST', { status: 405 });
  }

  // not sure what catch is doing here
  const body = await request.json().catch(() => null);

  if (!body) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim();

  // crude namem & email validation here
  if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json(
      { error: 'Enter first name, last name, and a valid email' },
      { status: 400 }
    );
  }

  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.VOLUNTEER_SHEET_TAB;

    if (!spreadsheetId || !sheetName) {
      throw new Error('Volunteer sheet settings are missing');
    }

    const name = `${firstName} ${lastName}`;
    const range = `'${sheetName.replace(/'/g, "''")}'!A:E`;

    const url =
      'https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(spreadsheetId) +
      '/values/' + encodeURIComponent(range) +
      ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';

    await googleRequest(url, {
      method: 'POST',
      data: {
        values: [[
          new Date().toISOString(),
          firstName,
          lastName,
          name,
          email
        ]]
      }
    });

    return Response.json({ name });
  } catch (error) {
    console.error('Registration failed:', error.message);

    return Response.json(
      { error: 'Could not confirm registration. Check the sheet before retrying.' },
      { status: 500 }
    );
  }
};