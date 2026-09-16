// mostly written by an LLM
// this function sends the form details to Netlify and sends
// which then updates the google sheet

import { randomBytes, randomUUID } from 'node:crypto';
import { googleRequest } from '../lib/google.mjs';

const TIME_ZONE = 'America/New_York';

async function uploadPhoto(photo) {
  const folderId = process.env.GOOGLE_PHOTO_FOLDER_ID;
  const boundary = 'photo_' + randomUUID();

  const metadata = JSON.stringify({
    name: photo.name,
    parents: [folderId],
    mimeType: photo.type
  });

  // drive expects ths photo structure:
  // --- metadata ---
  // --- header ---
  // --- photo bytes ---
  // --- end bytes ---
  // the \r\n are apparently required
  const metadataPart =
`--${boundary}\r\n` +
'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
metadata + '\r\n';

const photoHeader =
`--${boundary}\r\n` +
`Content-Type: ${photo.type}\r\n\r\n`;

const photoBytes = Buffer.from(await photo.arrayBuffer());
const ending = `\r\n--${boundary}--\r\n`;

const body = Buffer.concat([
  Buffer.from(metadataPart),
  Buffer.from(photoHeader),
  photoBytes,
  Buffer.from(ending)
]);

const url =
'https://www.googleapis.com/upload/drive/v3/files' +
'?uploadType=multipart&supportsAllDrives=true&fields=id';

const result = await googleRequest(url, {
  method: 'POST',
  headers: {
    'content-type': `multipart/related; boundary=${boundary}`
  },
  data: body
});

return `https://drive.google.com/file/d/${result.id}/view`;
}

async function uploadPhotos(photos) {
  const links = [];

  for (const photo of photos) {
    const link = await uploadPhoto(photo);
    links.push(link);
  }
  return links;
}

function photoLinkCell(links) {
  let text = '';
  const textFormatRuns = [];

  links.forEach((uri, index) => {
    if (index > 0) {
      textFormatRuns.push({ startIndex: text.length, format: {} });
      text += '\n';
    }

    textFormatRuns.push({
      startIndex: text.length,
      format: {
        link: { uri },
        underline: true,
        foregroundColorStyle: { rgbColor: { red: 0.1, green: 0.3, blue: 0.8 } }
      }
    });

    text += 'photo';
  });

  return {
    userEnteredValue: { stringValue: text },
    textFormatRuns,
    userEnteredFormat: { wrapStrategy: 'WRAP' }
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

async function saveRepair(row, beforeLinks, afterLinks) {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(spreadsheetId);

  // rich text requests use the tab's numeric ID rather than its name.
  const spreadsheet = await googleRequest(
    baseUrl + '?fields=sheets(properties(sheetId,title))'
  );
  const sheet = spreadsheet.sheets.find(
    sheet => sheet.properties.title === process.env.GOOGLE_SHEET_NAME
  );
  if (!sheet) throw new Error('Configured Google Sheet tab was not found.');

  const cells = row.map(value => {
    if (value instanceof Date) {
      return dateCell(value);
    }

    return {
      userEnteredValue: { stringValue: String(value ?? '') }
    };
  });

cells[16] = photoLinkCell(beforeLinks); // column q
cells[17] = photoLinkCell(afterLinks); // column r

  // append the values and their links together in one write.
  await googleRequest(baseUrl + ':batchUpdate', {
    method: 'POST',
    data: {
      requests: [{
        appendCells: {
          sheetId: sheet.properties.sheetId,
          rows: [{ values: cells }],
          fields: 'userEnteredValue,textFormatRuns,userEnteredFormat'
        }
      }]
    }
  });
}

export default async request => {
  const form = await request.formData();
  // Generate once so the row and every photo label share the same repair ID.
  // Nine random bytes produce 12 URL-safe characters (72 bits of randomness).
  const repairId = randomBytes(8).toString('base64url');

  const beforeLinks = await uploadPhotos(form.getAll('beforePhotos'));
  const afterLinks = await uploadPhotos(form.getAll('afterPhotos'));


  const row = [
    repairId,
    new Date(),
    form.get('volunteer-name'),
    form.get('guest-name'),
    form.get('product-type'),
    form.get('product-status'),
    form.get('category'),
    form.get('brand-name'),
    form.get('brand-status'),
    form.get('modelInfo'),
    form.get('condition'),
    form.get('outcome'),
    form.get('experience'),
    form.get('problemSolution'),
    form.get('guestReflection'),
    form.get('purchaseRequests'),
    beforeLinks.join('\n'),
    afterLinks.join('\n')
  ];

  await saveRepair(row, beforeLinks, afterLinks);
  return Response.json({ ok: true, repairId });
};