// This function receives the repair form submission.

import { randomBytes } from 'node:crypto';
import { getProductCategory } from '../lib/typesafe-ai.mjs';
import { saveRepair } from '../lib/save-repair.mjs';
import { uploadPhotos } from '../lib/upload-photos-to-drive.mjs';

export default async request => {
  const form = await request.formData();
  if (form.getAll('before-photos').length > 4 || form.getAll('after-photos').length > 4) {
    return Response.json({ error: 'Choose at most 4 photos before and 4 photos after.' }, { status: 400 });
  }

  const repairId = randomBytes(8).toString('base64url');

  const beforeLinks = await uploadPhotos(
    form.getAll('before-photos'),
    repairId,
    'before'
  );

  const afterLinks = await uploadPhotos(
    form.getAll('after-photos'),
    repairId,
    'after'
  );

  let category = 'Other';

  try {
    category = await getProductCategory(form.get('product'), form.get('brand-name'));
  } catch (error) {
    console.error('Could not classify product:', error);
  }

  const repairRecord = {
    RepairID: repairId,
    Date: new Date(),
    'Volunteer name': form.get('volunteer-name'),
    'Guest name': form.get('guest-name'),
    'Product name': form.get('product'),
    Brand: form.get('brand-name') ?? '',
    'Model / serial': form.get('modelInfo') ?? '',
    'RM Category [auto-generated]': category,
    Condition: form.get('condition'),
    Outcome: form.get('outcome'),
    'Guest experience': form.get('experience'),
    'Problem / solution description': form.get('problem-solution'),
    'Guest notes': form.get('guest-reflection') ?? '',
    'Purchase requests': form.get('purchase-requests') ?? ''
  };

  await saveRepair(repairRecord, beforeLinks, afterLinks);
  return Response.json({ ok: true, repairId });
};
