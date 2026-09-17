import { randomUUID } from 'node:crypto';

import { googleRequest } from './google-request.mjs';

async function uploadPhoto(photo, name) {
  const folderId = process.env.GOOGLE_PHOTO_FOLDER_ID;
  const boundary = 'photo_' + randomUUID();

  const metadata = JSON.stringify({
    name: name,
    parents: [folderId],
    mimeType: photo.type
  });

  // Drive expects this multipart structure:
  // --- metadata ---
  // --- header ---
  // --- photo bytes ---
  // --- end bytes ---
  // The \r\n characters are required.
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

export async function uploadPhotos(photos, repairId, stage) {
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
