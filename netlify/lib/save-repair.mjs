import { googleRequest } from './google-request.mjs';
import {
  getSheetHeaders,
  getSheetInfo,
  requireHeaders,
  sheetCell
} from './google-sheets.mjs';

const REQUIRED_REPAIR_HEADERS = [
  'RepairID',
  'Date',
  'Volunteer name',
  'Guest name',
  'Product name',
  'Brand',
  'Model / serial',
  'RM Category [auto-generated]',
  'Condition',
  'Outcome',
  'Guest experience',
  'Problem / solution description',
  'Guest notes',
  'Purchase requests',
  'Photo before 1',
  'Photo before 2',
  'Photo before 3',
  'Photo before 4',
  'Photo after 1',
  'Photo after 2',
  'Photo after 3',
  'Photo after 4'
];

function photoLinkCell(uri) {
  if (!uri) {
    return {
      userEnteredValue: {
        stringValue: ''
      }
    };
  }

  const escapedUri = String(uri).replace(/"/g, '""');

  return {
    userEnteredValue: {
      formulaValue: `=HYPERLINK("${escapedUri}","photo")`
    }
  };
}

export async function saveRepair(repairRecord, beforeLinks, afterLinks) {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME;
  const sheet = await getSheetInfo(spreadsheetId, sheetName);
  const headers = await getSheetHeaders(spreadsheetId, sheetName);

  requireHeaders(headers, REQUIRED_REPAIR_HEADERS, sheetName);

  const photoCells = {
    'Photo before 1': photoLinkCell(beforeLinks[0]),
    'Photo before 2': photoLinkCell(beforeLinks[1]),
    'Photo before 3': photoLinkCell(beforeLinks[2]),
    'Photo before 4': photoLinkCell(beforeLinks[3]),
    'Photo after 1': photoLinkCell(afterLinks[0]),
    'Photo after 2': photoLinkCell(afterLinks[1]),
    'Photo after 3': photoLinkCell(afterLinks[2]),
    'Photo after 4': photoLinkCell(afterLinks[3])
  };

  const cells = headers.map(header => {
    if (Object.hasOwn(photoCells, header)) {
      return photoCells[header];
    }

    if (
      !Object.hasOwn(repairRecord, header) ||
      repairRecord[header] == null
    ) {
      throw new Error(
        'No value configured for repair sheet header "' +
        header +
        '".'
      );
    }

    return sheetCell(repairRecord[header]);
  });

  // Append the values and their links together in one write.
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
