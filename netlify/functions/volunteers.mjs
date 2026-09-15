// written by an LLM
// gets the volunteer names from the registered volunteers list

import { googleRequest } from '../lib/google.mjs';

export default async () => {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    const sheetName = process.env.VOLUNTEER_SHEET_TAB;

    if (!spreadsheetId) {
      throw new Error('Configure GOOGLE_SPREADSHEET_ID in Netlify.');
    }
    if (!sheetName) {
      throw new Error('Configure VOLUNTEER_SHEET_TAB in Netlify.');
    }
    // A         / B          / C         / D          / E 
    // timestamp / first name / last name / full name  / email
    // 1972-1-1  / Mark       / Smith     / Mark Smith / mark@smith.com
    const escapedSheetName = sheetName.replace(/'/g, "''");
    const range = `'${escapedSheetName}'!D2:D`;

    const url =
      'https://sheets.googleapis.com/v4/spreadsheets/' +
      `${encodeURIComponent(spreadsheetId)}/values/` +
      encodeURIComponent(range);

    const data = await googleRequest(url);

    // TODO 
    const volunteers = [
      ...new Set(
        (data.values || [])
          .flat()
          .map(name => String(name).trim())
          .filter(Boolean) // not sure what this does
      )
    ].sort((a, b) => a.localeCompare(b)); // alphabetical order

    return new Response(JSON.stringify(volunteers), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
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
