const photoTools = import('./photos.js');
const MAX_PHOTOS = 4;

var beforePhotos = [];
var afterPhotos = [];
var form = document.querySelector('form');

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
|| (/Macintosh/i.test(navigator.userAgent)
	&& navigator.maxTouchPoints > 1);

if (!isIOS) {
	show('camera-before-non-ios');
	show('camera-after-non-ios');
}

function byId(elementId) {
	return document.getElementById(elementId);
}

function hide(elementId) {
	byId(elementId).style.display = 'none';
}

function show(elementId) {
	byId(elementId).style.display = 'block';
}

function toggleLoading(bool) {
	byId('loading-indicator').style.display = bool ? 'flex' : 'none';
	form.inert = bool;
}

function toggleRequired(elementId, bool) {
	byId(elementId).required = bool;
}

function newVolunteer() {
	show('new-volunteer');
	hide('existing-volunteer');
	toggleRequired('new-volunteer-first-name', true);
	toggleRequired('new-volunteer-last-name', true);
	toggleRequired('new-volunteer-email', true);
	toggleRequired('volunteer-name', false);
}

function cancelNewVolunteer() {
	hide('new-volunteer');
	show('existing-volunteer');
	toggleRequired('new-volunteer-first-name', false);
	toggleRequired('new-volunteer-last-name', false);
	toggleRequired('new-volunteer-email', false);
	toggleRequired('volunteer-name', true)
}

// TODO confirm email by actually emailing
function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkValidEmail(inputId) {
	const input = byId(inputId);
	input.oninput = () => {
		if (!isValidEmail(input.value) && input.value) {
			show('invalid-email')
		} else {
			hide('invalid-email')
		}
	}
}

async function getVolunteers () {
	const response = await fetch('/list-volunteers')
	if (!response.ok) {
		throw new Error("Couldn't get volunteers from Google sheet (check Netlify functions?)")
	}
	return await response.json();
}

async function getProducts() {
	const response = await fetch('/data/products.json');
	if (!response.ok) {
		throw new Error("Couldn't load products.json")
	}
	return await response.json();
}

async function getBrandNames() {
	const response = await fetch('/data/brands.json');
	if (!response.ok) {
		throw new Error("Couldn't load brands.json")
	}
	return await response.json();
}

function showSuggestedVolunteers(input, suggestions, myList) {
	const value = input.value.toLocaleLowerCase().trim();
	suggestions.innerHTML = "";

	if (input.dataset.selectedName === input.value) return;
	if (value == "") return;
	const filtered = myList.filter(
		q => q.toLocaleLowerCase().includes(value));

	for (const el of filtered) {
		const li = document.createElement("li");
		li.textContent = el;
		li.addEventListener("click", () => {
			input.value = el;
			input.dataset.selectedName = el;
			input.setCustomValidity('');
			suggestions.innerHTML = ""
		})
		suggestions.appendChild(li);
	}

	const addNew = document.createElement('li');
	addNew.textContent = '+ Add new';
	addNew.onclick = () => {
		newVolunteer();
		suggestions.innerHTML = '';
	};
	suggestions.appendChild(addNew);
}

function showSuggestedOptions(input, suggestions, myList) {
	const value = input.value.toLocaleLowerCase().trim();
	suggestions.innerHTML = "";

	if (value == "") return;
	const filtered = myList.filter(
		q => q.toLocaleLowerCase().includes(value));

	for (const el of filtered) {
		const li = document.createElement("li");
		li.textContent = el;
		li.addEventListener("click", () => {
			input.value = el;
			suggestions.innerHTML = ""
		})
		suggestions.appendChild(li);
	}
}

function addSuggestedOptions(inputId, suggestionsId, myList) {
	const input = byId(inputId);
	const suggestions = byId(suggestionsId);

	input.oninput = () => showSuggestedOptions(input, suggestions, myList);
	input.onfocus = () => showSuggestedOptions(input, suggestions, myList);
}

function addSuggestedVolunteers(volunteerList) {
	const input = byId('volunteer-name');
	const suggestions = byId('volunteer-name-suggestions');

	function clearSelection() {
		delete input.dataset.selectedName;
		input.setCustomValidity('Choose your name from the dropdown.');
	}

	input.oninput = function () {
		clearSelection();
		showSuggestedVolunteers(input, suggestions, volunteerList);
	};

	input.onfocus = () => showSuggestedVolunteers(input, suggestions, volunteerList);

	clearSelection();
}

async function setSuggestedOptions() {
	await Promise.all([
		getVolunteers().then(list => addSuggestedVolunteers(list)),
		getProducts().then(list =>
			addSuggestedOptions('product', 'product-suggestions', list)
			),
		getBrandNames().then(list =>
			addSuggestedOptions('brand-name', 'brand-name-suggestions', list)
			)
	]);
}

// if we have too many photos we wanna stop the user
// from adding them 
function checkDisableAddPhoto() {
	if (beforePhotos.length >= MAX_PHOTOS) {
		byId('camera-before-button').disabled = true;
		byId('camera-before-non-ios-button').disabled = true;
		show('max-photos-before');
	} else {
		byId('camera-before-button').disabled = false;
		byId('camera-before-non-ios-button').disabled = false;
		hide('max-photos-before');
	}
	if (afterPhotos.length >= MAX_PHOTOS) {
		byId('camera-after-button').disabled = true;
		byId('camera-after-non-ios-button').disabled = true;
		show('max-photos-after');
	} else {
		byId('camera-after-button').disabled = false;
		byId('camera-after-non-ios-button').disabled = false;
		hide('max-photos-after');
	}
}

function createImage(file) {
	const image = document.createElement('img');
	image.src = URL.createObjectURL(file);
	image.alt = file.name;
	return image;
}

function createThumbnail(image) {
	const thumbnail = document.createElement('div');
	thumbnail.append(image);
	return thumbnail;
}

function createDeletePhoto(thumbnail, image, file, photoList) {
	const deletePhoto = document.createElement('button');
	deletePhoto.type = 'button';
	deletePhoto.textContent = '×';
	deletePhoto.setAttribute('aria-label', `Delete`);
	deletePhoto.onclick = () => {
		photoList.splice(photoList.indexOf(file), 1);
		URL.revokeObjectURL(image.src);
		thumbnail.remove();
		checkDisableAddPhoto();
	};
	return deletePhoto;
}

async function addPhoto(source, photoList, thumbnailsId) {
	const { optimizePhoto, PHOTO_OPTIONS } = await photoTools;
	const file = await optimizePhoto(source, PHOTO_OPTIONS);
	photoList.push(file);
	const image = createImage(file)
	const thumbnail = createThumbnail(image);
	const deletePhoto = createDeletePhoto(thumbnail, image, file, photoList)
	thumbnail.append(deletePhoto);
	byId(thumbnailsId).appendChild(thumbnail);
}
async function addPhotos(input, photoList, thumbnailsId) {
	const files = Array.from(input.files);
	input.value = '';

	toggleLoading(true);
	try {
		for (const source of files) {
			if (photoList.length >= MAX_PHOTOS) break;
			try {
				await addPhoto(source, photoList, thumbnailsId);
			} catch (error) {
				alert(`${source.name}: ${error.message}`);
			}
		}
	} finally {
		toggleLoading(false);
		checkDisableAddPhoto();
	}
}

function openPhotosBefore(inputId) {
	const input = byId(inputId);
	input.onchange = () => {
		addPhotos(input, beforePhotos, 'before-thumbnails')
	}
	input.click();
}

function openPhotosAfter(inputId) {
	const input = byId(inputId);
	input.onchange = () => {
		addPhotos(input, afterPhotos, 'after-thumbnails')
	}
	input.click()
}

async function updateVolunteerSheet() {
	const response = await fetch('/register-volunteer', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			firstName: byId('new-volunteer-first-name').value.trim(),
			lastName: byId('new-volunteer-last-name').value.trim(),
			email: byId('new-volunteer-email').value.trim()
		})
	});

	const newVolunteer = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error('Registration failed')
	};
	const newVolunteerList = await getVolunteers();
	if (!newVolunteerList.includes(newVolunteer.name)) {
		throw new Error("Registration didn't go through.");
	}
	return { newVolunteer, newVolunteerList };
}

async function registerVolunteer() {
	toggleLoading(true)
	try {
		const { newVolunteer, newVolunteerList } = await updateVolunteerSheet();
		addSuggestedVolunteers(newVolunteerList);
		const input = byId('volunteer-name');
		input.value = newVolunteer.name;
		input.dataset.selectedName = newVolunteer.name;
		input.setCustomValidity('');
		cancelNewVolunteer();
	} catch (error) {
		alert(error.message);
	} finally {
		toggleLoading(false)
	}
}

// stolen from codepen
function celebrate() {
	if (typeof window.confetti !== 'function') return;

	window.confetti({
		count: 1000,
		spread: 80,
		ticks: 600,
		startVelocity: 55,
		position: { x: 50, y: 95 },
		disableForReducedMotion: true
	}).catch(console.error);
}

checkValidEmail('new-volunteer-email')
setSuggestedOptions();

form.addEventListener('submit', async event => {
	event.preventDefault();
	if (!form.reportValidity()) return;
	toggleLoading(true);
	const formData = new FormData(form);

	// we don't need to check whether the brand exists or not
	for (const photo of beforePhotos) {
		formData.append('before-photos', photo)
	};
	for (const photo of afterPhotos) {
		formData.append('after-photos', photo)
	};
	try {
		const response = await fetch('/submit', {
			method: 'POST',
			body: formData
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
		if (!result.ok) throw new Error(result.error || 'Error from server.');

		// reset but keep volunteer name
		for (const image of document.querySelectorAll('.thumbnails img')) {
			URL.revokeObjectURL(image.src);
		}
		beforePhotos = [];
		afterPhotos = [];
		byId('before-thumbnails').innerHTML = '';
		byId('after-thumbnails').innerHTML = '';
		// save the volunteer name before resetting
		const volunteerName = byId('volunteer-name').value;
		form.reset();
		// then insert back into the DOM
		byId('volunteer-name').value = volunteerName;
		window.scrollTo({top: 0, behavior: 'smooth'});
		celebrate();
	} catch (error) {
		alert(error.message);
	} finally {
		toggleLoading(false);
		checkDisableAddPhoto();
	}
})
