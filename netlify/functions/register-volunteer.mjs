import {
  appendSheetRow,
  getSheetHeaders,
  requireHeaders
} from '../lib/google-sheets.mjs';

const VOLUNTEER_COLUMNS = {
  date: 'Date',
  firstName: 'First Name',
  lastName: 'Last Name',
  fullName: 'Full Name',
  email: 'Email'
};

const VOLUNTEER_HEADERS = Object.values(VOLUNTEER_COLUMNS);

export default async request => {
  if (request.method !== 'POST') {
    return new Response('Use POST', { status: 405 });
  }

  const body = await request.json().catch(() => null);

  if (!body) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim();

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
    const headers = await getSheetHeaders(spreadsheetId, sheetName);
    requireHeaders(headers, VOLUNTEER_HEADERS, sheetName);

    const volunteerRecord = {
      [VOLUNTEER_COLUMNS.date]: new Date().toISOString(),
      [VOLUNTEER_COLUMNS.firstName]: firstName,
      [VOLUNTEER_COLUMNS.lastName]: lastName,
      [VOLUNTEER_COLUMNS.fullName]: name,
      [VOLUNTEER_COLUMNS.email]: email
    };

    const values = headers.map(header => volunteerRecord[header] ?? '');

    await appendSheetRow(spreadsheetId, sheetName, values);

    return Response.json({ name });
  } catch (error) {
    console.error('Registration failed:', error.message);

    return Response.json(
      { error: 'Could not confirm registration. Check the sheet before retrying.' },
      { status: 500 }
      );
  }
};
