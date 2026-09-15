// Fixed per-photo budget: six photos use at most 3.9 MB before multipart overhead.
export const PHOTO_OPTIONS = Object.freeze({
	maxBytes: 650_000,
	maxDimension: 2400,
	qualities: Object.freeze([0.85, 0.80, 0.75]),
});

/** Return one upload-ready File. No form state, thumbnails, or alerts belong here. */
export async function optimizePhoto(file, options = PHOTO_OPTIONS) {
	const { maxBytes, maxDimension, qualities } = { ...PHOTO_OPTIONS, ...options };
	if (!(file instanceof File)) throw new TypeError('Choose a photo file.');
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
		!Number.isSafeInteger(maxDimension) || maxDimension < 1 ||
		!Array.isArray(qualities) || !qualities.length || qualities.length > 10 ||
		qualities.some(q => !Number.isFinite(q) || q <= 0 || q > 1)) {
		throw new TypeError('Invalid photo byte budget, dimension limit, or JPEG qualities.');
	}

	const image = new Image();
	const url = URL.createObjectURL(file);
	let canvas;
	try {
		image.src = url;
		try {
			await image.decode();
		} catch {
			throw new Error('This image cannot be read. Try exporting it as JPEG or PNG.');
		}
		const width = image.naturalWidth;
		const height = image.naturalHeight;
		if (!width || !height) throw new Error('This image has no usable dimensions.');
		const longest = Math.max(width, height);
		const supported = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
		if (supported && file.size <= maxBytes && longest <= maxDimension) return file;

		canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Your browser could not prepare this photo.');

		const initialDimension = Math.min(longest, maxDimension);
		// At most five sizes; never reduce below 1200px on the long edge,
		// or below the initial size when the source/configuration is smaller.
		const minimumDimension = Math.min(initialDimension, 1200);
		let dimension = initialDimension;
		for (let attempt = 0; attempt < 5; attempt++) {
			const scale = dimension / longest;
			canvas.width = Math.max(1, Math.round(width * scale));
			canvas.height = Math.max(1, Math.round(height * scale));
			context.fillStyle = 'white';
			context.fillRect(0, 0, canvas.width, canvas.height);
			// Always draw the original decoded image, never a previous JPEG.
			context.drawImage(image, 0, 0, canvas.width, canvas.height);
			for (const quality of qualities) {
				const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
				if (!blob || blob.type !== 'image/jpeg') {
					throw new Error('Your browser could not encode this photo as JPEG.');
				}
				if (blob.size <= maxBytes) {
					return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
						type: 'image/jpeg', lastModified: file.lastModified,
					});
				}
			}
			if (dimension <= minimumDimension) break;
			dimension = Math.max(minimumDimension, Math.floor(dimension * 0.85));
		}
		throw new Error(`Could not fit this photo within ${maxBytes.toLocaleString()} bytes while preserving useful detail. Try a closer crop or another photo.`);
	} finally {
		URL.revokeObjectURL(url);
		image.removeAttribute('src');
		if (canvas) canvas.width = canvas.height = 0;
	}
}
