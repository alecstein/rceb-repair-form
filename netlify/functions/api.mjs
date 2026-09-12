import { randomUUID } from 'node:crypto';
import { googleRequest } from '../lib/google.mjs';

export const HEADERS = [
  'Timestamp', 'Date', 'Device ID', 'Volunteer name', 'Guest name', 'Item type',
  'Brand', 'Brand status', 'Model / type / serial', 'Photos before',
  'Condition on arrival', 'Repair outcome', 'Guest experience',
  'Problem / solution description', 'Guest notes', 'Tool purchase request(s)',
  'Photos after', 'Submission ID'
];
const validId = id => /^[A-Za-z0-9_-]{4,64}$/.test(id);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
function invalid(message) { throw Object.assign(new Error(message), { validation: true }); }

export function validate(form) {
  const values = {};
  for (const name of ['deviceId', 'volunteerName', 'guestName', 'itemType', 'brand',
    'brandStatus', 'modelInfo', 'condition', 'outcome', 'guestExperience',
    'problemSolution', 'guestReflection', 'toolPurchaseRequests', 'debugId']) {
    const value = form.get(name) ?? '';
    if (typeof value !== 'string' || value.length > 10000) invalid('Invalid ' + name);
    values[name] = value.trim();
  }
  if (!validId(values.debugId)) invalid('Missing submission ID.');
  for (const name of ['volunteerName', 'guestName', 'itemType']) {
    if (!values[name]) invalid('Volunteer name, guest name, and item type are required.');
  }
  const choices = {
    condition: ['Good', 'Okay', 'Broken'],
    outcome: ['Success', 'Some improvement', 'Advice given', "Couldn't help"],
    guestExperience: ['Great', 'Good', 'Neutral', 'Bad']
  };
  for (const [name, allowed] of Object.entries(choices)) {
    if (!allowed.includes(values[name])) invalid('Choose a valid ' + name);
  }
  if (values.brand && !['existing', 'new'].includes(values.brandStatus)) invalid('Choose or add a brand.');
  if (!values.brand) values.brandStatus = '';
  values.photos = [];
  for (const stage of ['Before', 'After']) {
    const count = Number(form.get('photo' + stage + 'Count') || 0);
    if (!Number.isInteger(count) || count < 0 || count > 5) invalid('Choose up to five photos per section.');
    for (let i = 1; i <= count; i++) {
      const file = form.get('photo' + stage + i);
      if (!file || typeof file === 'string' || file.type !== 'image/jpeg' ||
          !file.size || file.size > 400 * 1024) invalid('A photo is invalid or too large.');
      values.photos.push({ file, stage, index: i });
    }
  }
  return values;
}

export default async request => {
  const env = process.env;
  const started = Date.now();
  const signal = AbortSignal.timeout(25000);
  const api = (url, options = {}) => googleRequest(url, { ...options, signal });
  let id = randomUUID();
  let writeStarted = false;
  try {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    const sheetId = env.GOOGLE_SPREADSHEET_ID;
    if (!sheetId) throw new Error('Configure GOOGLE_SPREADSHEET_ID in Netlify.');
    const name = "'" + (env.GOOGLE_SHEET_NAME || 'Repair Form Submissions').replaceAll("'", "''") + "'";
    const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId) + '/values/';
    const read = range => api(base + encodeURIComponent(name + '!' + range));
    const values = validate(await request.formData());
    id = values.debugId;
    // A single deadline covers authentication, photos and the sheet write.
    // A timed-out append is uncertain, never automatically repeated.
    const headers = await read('A1:R1');
    if (HEADERS.some((header, i) => headers.values?.[0]?.[i] !== header)) {
      throw new Error('Spreadsheet headers do not match the repair form.');
    }
    const photos = { Before: [], After: [] };
    if (values.photos.length) {
      const folderId = env.GOOGLE_PHOTO_FOLDER_ID;
      if (!folderId) throw new Error('Configure GOOGLE_PHOTO_FOLDER_ID in Netlify.');
      const folder = await api('https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(folderId) + '?supportsAllDrives=true&fields=mimeType,driveId,trashed,capabilities(canAddChildren)');
      if (folder.trashed || !folder.driveId || folder.mimeType !== 'application/vnd.google-apps.folder' ||
          !folder.capabilities?.canAddChildren) throw new Error('Photo folder must be a writable Shared drive folder.');
      for (const photo of values.photos) {
        const boundary = 'repair_' + randomUUID();
        const metadata = JSON.stringify({
          name: id + '_' + photo.stage.toLowerCase() + '_' + photo.index + '.jpg',
          parents: [folderId], mimeType: 'image/jpeg'
        });
        const body = Buffer.concat([
          Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata +
            '\r\n--' + boundary + '\r\nContent-Type: image/jpeg\r\n\r\n'),
          Buffer.from(await photo.file.arrayBuffer()),
          Buffer.from('\r\n--' + boundary + '--\r\n')
        ]);
        const uploaded = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
          method: 'POST', headers: { 'content-type': 'multipart/related; boundary=' + boundary }, data: body
        });
        if (!uploaded.id) throw new Error('Photo upload could not be confirmed.');
        photos[photo.stage].push(uploaded.webViewLink || 'https://drive.google.com/file/d/' + uploaded.id + '/view');
      }
    }
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: env.REPAIR_TIME_ZONE || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    const row = [
      now.toISOString(), date, values.deviceId, values.volunteerName, values.guestName,
      values.itemType, values.brand, values.brandStatus, values.modelInfo, photos.Before.join('\n'),
      values.condition, values.outcome, values.guestExperience, values.problemSolution,
      values.guestReflection, values.toolPurchaseRequests, photos.After.join('\n'), id
    ];
    writeStarted = true;
    const result = await api(base + encodeURIComponent(name + '!A:R') +
      ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
      method: 'POST', data: { values: [row] }
    });
    if (result.updates?.updatedRows !== 1) throw new Error('Write acknowledgement was incomplete.');
    console.log('Repair saved', { submissionId: id, elapsedMs: Date.now() - started });
    return json({ ok: true, submissionId: id });
  } catch (error) {
    console.error('Repair request failed', {
      submissionId: id, elapsedMs: Date.now() - started,
      writeStarted, status: error.response?.status, validation: !!error.validation
    });
    return json({
      ok: false, submissionId: id,
      error: error.validation ? error.message : writeStarted
        ? 'Could not confirm the save.'
        : 'Could not save. Check the Google API configuration or try again.'
    }, error.validation ? 400 : 502);
  }
};
