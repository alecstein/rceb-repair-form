// mostly written by an LLM
// this function sends the form details to Netlify and sends
// which then updates the google sheet

import { randomBytes, randomUUID } from 'node:crypto';
import { googleRequest } from '../lib/google.mjs';

const TIME_ZONE = 'America/New_York';

async function uploadPhoto(photo, name) {
  const folderId = process.env.GOOGLE_PHOTO_FOLDER_ID;
  const boundary = 'photo_' + randomUUID();

  const metadata = JSON.stringify({
    name: name,
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

async function uploadPhotos(photos, repairId, stage) {
  const links = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];

    const extensionMatch = photo.name.match(/\.[^.]+$/);
    const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '';

    const name = `${repairId}_${stage}_${i + 1}${extension}`;
    const link = await uploadPhoto(photo, name);

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
      text += ' ';
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

async function productCategory(product) {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      state: product,
      model: 'jev-latest',
      questions: {
        category: {
          type: 'choice',
          instructions: 'This object best fits which category?',
          criteria: {
            'Bicycles': 'Bicycles',
            'Clocks / alarm clocks': 'Clocks / alarm clocks',
            'Computer equipment / phones': 'Computer equipment / phones',
            'Display and sound equipment': 'Display and sound equipment',
            'Furniture': 'Furniture',
            'Household appliances electric': 'Household appliances electric',
            'Household appliances non-electric': 'Household appliances non-electric',
            'Jewelry': 'Jewelry',
            'Other': 'Other',
            'Textile': 'Textile',
            'Tools electric': 'Tools electric',
            'Tools non-electric': 'Tools non-electric',
            'Toys electric': 'Toys electric',
            'Toys non-electric': 'Toys non-electric'
          }
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`TypeSafe failed: ${response.status}`);
  }

  const result = await response.json();

  return result.answers.category.choice;
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

  for (let i = 0; i < 4; i++) {
    cells[16 + i] = photoLinkCell(beforeLinks.slice(i, i + 1));
    cells[20 + i] = photoLinkCell(afterLinks.slice(i, i + 1));
  }

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
  if (form.getAll('beforePhotos').length > 4 || form.getAll('afterPhotos').length > 4) {
    return Response.json({ error: 'Choose at most 4 photos before and 4 photos after.' }, { status: 400 });
  }
  // Generate once so the row and every photo label share the same repair ID.
  // Nine random bytes produce 12 URL-safe characters (72 bits of randomness).
  const repairId = randomBytes(8).toString('base64url');

  const beforeLinks = await uploadPhotos(
    form.getAll('beforePhotos'),
    repairId,
    'before'
    );

  const afterLinks = await uploadPhotos(
    form.getAll('afterPhotos'),
    repairId,
    'after'
    );

  let category = 'Other';

  try {
    category = await productCategory(form.get('product-type'));
  } catch (error) {
    console.error('Could not classify product:', error);
  }

  const row = [
    repairId,
    new Date(),
    form.get('volunteer-name'),
    form.get('guest-name'),
    form.get('product-type'),
    form.get('product-status'),
    form.get('brand-name'),
    form.get('brand-status'),
    form.get('modelInfo'),
    category,
    form.get('condition'),
    form.get('outcome'),
    form.get('experience'),
    form.get('problemSolution'),
    form.get('guestReflection'),
    form.get('purchaseRequests')
  ];

  await saveRepair(row, beforeLinks, afterLinks);
  return Response.json({ ok: true, repairId });
};
