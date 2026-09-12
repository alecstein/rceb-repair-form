const MAX_PHOTOS = 5;
const MAX_IMAGE_DIMENSION = 1800;
const MAX_IMAGE_BYTES = 325 * 1024;
const JPEG_QUALITY = 0.82;
const AUTOCOMPLETE_DELAY = 300;
const byId = id => document.getElementById(id);
const form = byId('repairForm');
let submitting = false;

// Storage is optional: privacy settings must not prevent use of the form.
function readSaved(key) {
  try { return localStorage.getItem(key) || ''; }
  catch { return ''; }
}

function saveSetting(key, value) {
  try { localStorage.setItem(key, value); }
  catch { /* Continue without remembering this setting. */ }
}

const deviceId = readSaved('repairCafeDeviceId') || `device-${
  window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}`;
saveSetting('repairCafeDeviceId', deviceId);
byId('deviceId').value = deviceId;
byId('volunteerName').value = readSaved('repairCafeVolunteerName');
byId('volunteerName').addEventListener('input', event => {
  saveSetting('repairCafeVolunteerName', event.target.value);
});

const TAXONOMY_CACHE_KEY = 'repairCafeTaxonomiesV1';
const TAXONOMY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const taxonomyData = { products: [], brands: [] };

const autocomplete = {
  itemType: {
    input: byId('itemType'), list: 'products',
    message: 'Choose an item type from the list.'
  },
  brand: {
    input: byId('brand'), list: 'brands',
    message: 'Choose a brand from the list or add this brand.'
  }
};

function readTaxonomyCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(TAXONOMY_CACHE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.products) || !Array.isArray(cached.brands)) return null;
    return cached;
  } catch {
    return null;
  }
}

function saveTaxonomyCache(products, brands) {
  try {
    localStorage.setItem(TAXONOMY_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      products,
      brands
    }));
  } catch {
    // The form still works for this visit if persistent storage is unavailable.
  }
}

async function fetchTaxonomies() {
  const [productsResponse, brandsResponse] = await Promise.all([
    fetch('/data/products.json', { cache: 'no-cache' }),
    fetch('/data/brands.json', { cache: 'no-cache' })
  ]);
  if (!productsResponse.ok || !brandsResponse.ok) {
    throw new Error('Could not load autocomplete lists.');
  }
  const [products, brands] = await Promise.all([
    productsResponse.json(),
    brandsResponse.json()
  ]);
  if (!Array.isArray(products) || !Array.isArray(brands)) {
    throw new Error('Autocomplete lists are invalid.');
  }
  taxonomyData.products = products;
  taxonomyData.brands = brands;
  saveTaxonomyCache(products, brands);
}

const cachedTaxonomies = readTaxonomyCache();
if (cachedTaxonomies) {
  taxonomyData.products = cachedTaxonomies.products;
  taxonomyData.brands = cachedTaxonomies.brands;
}

const taxonomyReady = (async () => {
  if (!cachedTaxonomies || Date.now() - Number(cachedTaxonomies.savedAt || 0) > TAXONOMY_MAX_AGE) {
    try {
      await fetchTaxonomies();
    } catch (error) {
      if (!cachedTaxonomies) throw error;
      console.warn('Using cached autocomplete lists because refresh failed.', error);
    }
  }
})();

for (const [kind, state] of Object.entries(autocomplete)) {
  Object.assign(state, {
    control: byId(`${kind}Control`), menu: byId(`${kind}Menu`),
    selected: false, requestId: 0, timer: null
  });
  state.input.addEventListener('input', () => {
    state.selected = false;
    state.input.setCustomValidity(state.input.value.trim() ? state.message : '');
    if (kind === 'brand') byId('brandStatus').value = '';
    cancelAutocomplete(state);
    const query = state.input.value.trim();
    if (query.length >= 2) {
      state.timer = setTimeout(() => loadAutocomplete(kind, query), AUTOCOMPLETE_DELAY);
    }
  });
}

function cancelAutocomplete(state) {
  clearTimeout(state.timer);
  state.requestId++;
  state.control.classList.remove('loading');
  state.menu.classList.remove('open');
}

function localMatches(values, query, limit = 20) {
  const q = query.toLocaleLowerCase();
  const starts = [];
  const contains = [];

  for (const value of values) {
    const lower = value.toLocaleLowerCase();
    if (lower.startsWith(q)) {
      starts.push(value);
    } else if (lower.includes(q)) {
      contains.push(value);
    }
  }

  return starts.concat(contains)
    .slice(0, limit)
    .map(value => ({ value, label: value }));
}

async function loadAutocomplete(kind, query) {
  const state = autocomplete[kind];
  const requestId = ++state.requestId;
  const isCurrent = () => requestId === state.requestId && state.input.value.trim() === query;

  state.control.classList.add('loading');

  try {
    await taxonomyReady;
    if (!isCurrent()) return;

    const results = localMatches(taxonomyData[state.list], query);
    state.control.classList.remove('loading');
    renderAutocomplete(kind, results, query);
  } catch (error) {
    if (!isCurrent()) return;
    state.control.classList.remove('loading');
    showAutocompleteMessage(state, 'Could not load choices. Reload the page and try again.');
  }
}

function renderAutocomplete(kind, results, query) {
  const state = autocomplete[kind];
  state.menu.replaceChildren();
  for (const result of results) {
    addAutocompleteOption(kind, result.label || result.value, result.value, 'existing');
  }
  const exactMatch = results.some(result => String(result.value).trim().toLowerCase() === query.toLowerCase());
  if (kind === 'brand' && !exactMatch) {
    addAutocompleteOption(kind, `+ Add brand “${query}”`, query, 'new');
  }
  if (!state.menu.children.length) {
    showAutocompleteMessage(state, 'No matches.');
  } else {
    state.menu.classList.add('open');
  }
}

function addAutocompleteOption(kind, label, value, status) {
  const state = autocomplete[kind];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `autocomplete-option${status === 'new' ? ' add' : ''}`;
  button.textContent = label;
  button.addEventListener('click', () => {
    cancelAutocomplete(state);
    state.selected = true;
    state.input.value = value;
    state.input.setCustomValidity('');
    if (kind === 'brand') byId('brandStatus').value = status;
  });
  state.menu.appendChild(button);
}

function showAutocompleteMessage(state, message) {
  const row = document.createElement('div');
  row.className = 'autocomplete-empty';
  row.textContent = message;
  state.menu.replaceChildren(row);
  state.menu.classList.add('open');
}

function resetAutocompletes() {
  for (const state of Object.values(autocomplete)) {
    cancelAutocomplete(state);
    state.selected = false;
    state.input.setCustomValidity('');
  }
  byId('brandStatus').value = '';
}

document.addEventListener('click', event => {
  for (const state of Object.values(autocomplete)) {
    if (!state.control.contains(event.target)) cancelAutocomplete(state);
  }
});

// Photos are resized locally, then sent as file inputs for Apps Script.
function newPhotoState() {
  return { nextIndex: 1, pending: null, processing: false, items: {} };
}

const photoState = { before: newPhotoState(), after: newPhotoState() };
const photoPrefix = stage => stage === 'before' ? 'photoBefore' : 'photoAfter';

byId('beforePhotoButton').addEventListener('click', () => addPhoto('before'));
byId('afterPhotoButton').addEventListener('click', () => addPhoto('after'));

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read image.'));
    image.src = url;
  });
}

async function optimizePhoto(file) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const initialScale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
    let height = Math.max(1, Math.round(image.naturalHeight * initialScale));
    let quality = JPEG_QUALITY;
    let blob = null;

    for (let attempt = 0; attempt < 12; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is unavailable.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not resize image.')),
          'image/jpeg', quality);
      });
      if (blob.size <= MAX_IMAGE_BYTES) break;

      if (quality > 0.58) {
        quality = Math.max(0.58, quality - 0.08);
      } else if (Math.max(width, height) > 900) {
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(height * 0.82));
        quality = 0.72;
      } else {
        quality = Math.max(0.45, quality - 0.05);
      }
    }

    if (!blob || blob.size > MAX_IMAGE_BYTES * 1.15) {
      throw new Error('Photo is too large to upload.');
    }
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function addPhoto(stage) {
  const state = photoState[stage];
  if (submitting || state.processing || Object.keys(state.items).length >= MAX_PHOTOS) return;
  if (state.pending) return state.pending.click();
  const index = state.nextIndex;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.name = photoPrefix(stage) + index;
  byId(`${stage}PhotoInputs`).appendChild(input);
  state.pending = input;
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    state.processing = true;
    updatePhotoButton(stage);
    try {
      const file = await optimizePhoto(input.files[0]);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      showPhotoPreview(stage, index, input, file);
      state.nextIndex++;
      state.pending = null;
    } catch (error) {
      input.remove();
      state.pending = null;
      console.error(error);
      alert('Could not prepare that photo. Please try a JPEG or PNG image.');
    } finally {
      state.processing = false;
      updatePhotoButton(stage);
    }
  });
  input.click();
}

function showPhotoPreview(stage, index, input, file) {
  const wrapper = document.createElement('div');
  const image = document.createElement('img');
  const button = document.createElement('button');
  const objectUrl = URL.createObjectURL(file);
  wrapper.className = 'photo-preview';
  image.src = objectUrl;
  image.alt = 'Selected photo';
  button.type = 'button';
  button.className = 'photo-delete';
  button.textContent = '×';
  button.setAttribute('aria-label', 'Delete photo');
  button.addEventListener('click', () => {
    if (submitting) return;
    URL.revokeObjectURL(objectUrl);
    input.remove();
    wrapper.remove();
    delete photoState[stage].items[index];
    updatePhotoButton(stage);
  });
  wrapper.append(image, button);
  byId(`${stage}PhotoPreviews`).appendChild(wrapper);
  photoState[stage].items[index] = { input, objectUrl };
}

function updatePhotoButton(stage) {
  const state = photoState[stage];
  const count = Object.keys(state.items).length;
  const button = byId(`${stage}PhotoButton`);
  setButtonLoading(button, state.processing);
  button.disabled = state.processing || count >= MAX_PHOTOS;
  button.querySelector('.camera-button-main').textContent = count >= MAX_PHOTOS
    ? 'Maximum photos added' : count ? '📷 Add another photo' : '📷 Add photo';
  button.querySelector('.camera-button-sub').textContent = count >= MAX_PHOTOS
    ? `${MAX_PHOTOS} photos` : `up to ${MAX_PHOTOS} photos`;
  byId('submitButton').disabled = submitting || Object.values(photoState).some(state => state.processing);
}

function resetPhotoArea(stage) {
  Object.values(photoState[stage].items).forEach(item => URL.revokeObjectURL(item.objectUrl));
  photoState[stage] = newPhotoState();
  byId(`${stage}PhotoInputs`).replaceChildren();
  byId(`${stage}PhotoPreviews`).replaceChildren();
  byId(`${photoPrefix(stage)}Count`).value = '0';
  updatePhotoButton(stage);
}

function preparePhotosForSubmission() {
  // Renumber surviving photos after deletions so counts stay bounded at five.
  for (const [stage, state] of Object.entries(photoState)) {
    state.pending?.remove();
    state.pending = null;
    const items = Object.values(state.items);
    items.forEach((item, i) => { item.input.name = photoPrefix(stage) + (i + 1); });
    byId(`${photoPrefix(stage)}Count`).value = items.length;
  }
}

function setButtonLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', String(loading));
}

function setSubmitting(value) {
  submitting = value;
  setButtonLoading(byId('submitButton'), value);
  form.classList.toggle('is-submitting', value);
  form.querySelector('.form-content').inert = value;
  form.setAttribute('aria-busy', String(value));
}

function makeSubmissionId() {
  return (
    window.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8) ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  ).toUpperCase();
}

function handleSubmitSuccess() {
  const savedName = byId('volunteerName').value;
  form.reset();
  byId('deviceId').value = deviceId;
  byId('volunteerName').value = savedName;
  resetAutocompletes();
  resetPhotoArea('before');
  resetPhotoArea('after');
  setSubmitting(false);
  byId('message').textContent = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  celebrate();
}

function handleSubmitFailure(error) {
  setSubmitting(false);
  byId('message').textContent = `Error: ${error?.message || 'Submission failed. Please try again.'}`;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || Object.values(photoState).some(state => state.processing)) return;

  for (const state of Object.values(autocomplete)) {
    if (state.input.value.trim() && !state.selected) {
      state.input.setCustomValidity(state.message);
    }
  }

  if (!form.reportValidity()) return;

  preparePhotosForSubmission();
  byId('message').textContent = '';
  setSubmitting(true);

  const submissionId = makeSubmissionId();
  const formData = new FormData(form);
  formData.append('debugId', submissionId);

  try {
    const response = await fetch('/api', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(28000)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not confirm the save.');
    handleSubmitSuccess();
  } catch (error) {
    handleSubmitFailure(new Error(
      `[${submissionId}] ${error.message || 'Could not confirm the save.'} Check the sheet before submitting again.`
    ));
  } finally {
    setSubmitting(false);
  }
});

function celebrate() {
  const toast = byId('savedToast');

  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1200);

  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    typeof window.confetti !== 'function'
  ) {
    return;
  }

  // tsParticles-style cannon: fast launch, broad spread, then realistic
  // rolling / tilting / wobbling confetti as the pieces fall.
  const colors = [
    '#26ccff', '#a25afd', '#ff5e7e',
    '#88ff5a', '#fcff42', '#ffa62d', '#ff36ff'
  ];

  void window.confetti({
    count: 300,
    angle: 90,
    spread: 70,
    startVelocity: 58,
    decay: 0.91,
    gravity: 0.9,
    ticks: 1000,
    position: { x: 50, y: 96 },
    colors,
    shapes: ['square', 'circle'],
    scalar: 1.05,
    zIndex: 1000,
    disableForReducedMotion: true
  });

  // A smaller, wider second burst makes the cannon feel less uniform.
  setTimeout(() => {
    if (typeof window.confetti !== 'function') return;
    void window.confetti({
      count: 200,
      angle: 90,
      spread: 110,
      startVelocity: 42,
      decay: 0.92,
      gravity: 0.85,
      ticks: 1000,
      position: { x: 50, y: 96 },
      colors,
      shapes: ['square', 'circle'],
      scalar: 0.85,
      zIndex: 1000,
      disableForReducedMotion: true
    });
  }, 90);
}
