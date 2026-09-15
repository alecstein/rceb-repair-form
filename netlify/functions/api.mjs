import { randomUUID } from 'node:crypto';
import { googleRequest } from '../lib/google.mjs';

async function uploadPhoto(photo) {
  const folderId = process.env.GOOGLE_PHOTO_FOLDER_ID;
  const boundary = 'photo_' + randomUUID();

  const metadata = JSON.stringify({
    name: photo.name,
    parents: [folderId],
    mimeType: photo.type
  });

  // Drive expects two parts: file details, then the actual image bytes.
  // The boundary separates them; \r\n supplies the required line endings.
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

async function saveRepair(row) {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME.replaceAll("'", "''");
  const range = `'${sheetName}'!A:Q`;

  const url =
  'https://sheets.googleapis.com/v4/spreadsheets/' +
  encodeURIComponent(spreadsheetId) +
  '/values/' + encodeURIComponent(range) +
  ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';

  await googleRequest(url, {
    method: 'POST',
    data: { values: [row] }
  });
}

export default async request => {
  const form = await request.formData();

  const beforeLinks = await uploadPhotos(form.getAll('beforePhotos'));
  const afterLinks = await uploadPhotos(form.getAll('afterPhotos'));

  // Values are written left to right into spreadsheet columns A through Q.
  const row = [
    new Date().toISOString(),
    form.get('volunteer-name'),
    form.get('guest-name'),
    form.get('product-type'),
    form.get('product-status')
    form.get('category'),
    form.get('brand-name'),
    form.get('brand-status'),
    form.get('modelInfo'),
    beforeLinks.join('\n'),
    form.get('condition'),
    form.get('outcome'),
    form.get('experience'),
    form.get('problemSolution'),
    form.get('guestReflection'),
    form.get('toolPurchaseRequests'),
    afterLinks.join('\n')
  ];

  await saveRepair(row);

  return Response.json({ ok: true });
};
