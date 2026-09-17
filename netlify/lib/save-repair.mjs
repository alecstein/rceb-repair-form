import { googleRequest } from './google-request.mjs';
import {
  getSheetHeaders,
  getSheetInfo,
  requireHeaders
} from './google-sheets.mjs';

const TIME_ZONE = 'America/New_York';

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

function dateCell(date) {
  // Sheets stores datetimes as days since 1899-12-30, with the
  // fractional part representing the time of day.
  //
  // Convert the instant to New York wall-clock time first so the
  // displayed value is the local Repair Cafe time, including DST.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
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

function ordinaryCell(value) {
  if (value instanceof Date) {
    return dateCell(value);
  }

  return {
    userEnteredValue: {
      stringValue: String(value ?? '')
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
    const photoCell = photoCells[header];

    if (photoCell !== undefined) {
      return photoCell;
    }

    return ordinaryCell(repairRecord[header]);
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
