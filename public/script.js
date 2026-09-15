const photoTools = import('./photos.js');
let processingPhotos = false;
let submitting = false;

const MAX_PHOTOS = 3;

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

function showLoading() {
	byId('loading-indicator').style.display = 'flex';
}

function makeRequired(elementId) {
	byId(elementId).required = true;
}

function makeNotRequired(elementId) {
	byId(elementId).required = false;
}

// TODO check this
function newVolunteer() {
	show('new-volunteer');
	hide('existing-volunteer');
	makeRequired('new-volunteer-first-name');
	makeRequired('new-volunteer-last-name');
	makeRequired('new-volunteer-email');
	makeNotRequired('volunteer-name')
}

function cancelNewVolunteer() {
	hide('new-volunteer');
	show('existing-volunteer');
	makeNotRequired('new-volunteer-first-name');
	makeNotRequired('new-volunteer-last-name');
	makeNotRequired('new-volunteer-email');
	makeRequired('volunteer-name')
}

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
	const response = await fetch('/.netlify/functions/volunteers')
	if (!response.ok) {
		throw new Error("Couldn't get volunteers from Google sheet (check Netlify functions?)")
	}
	return await response.json();
}

async function getProductTypes() {
	const response = await fetch('/data/products.json');
	if (!response.ok) {
		throw new Error("Couldn't load products.json")
	}
	return await response.json();
}

async function getCategories() {
	const response = await fetch('/data/categories.json');
	if (!response.ok) {
		throw new Error("Couldn't load categories.json")
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

async function setCategories() {
	const categories = await getCategories();
	const select = byId('category');

	for (const category of categories) {
		const option = document.createElement('option');
		option.value = category;
		option.textContent = category;
		select.appendChild(option);
	}
}

function showSuggestedOptions(input, suggestions, myList) {
	const value = input.value.toLocaleLowerCase().trim();

	suggestions.innerHTML = "";

	// if the user's name exactly equals one of the 
	// choices, don't show "add new"
	if (
		input.id === 'volunteer-name' &&
		input.dataset.selectedName === input.value
		) return;

		if (value == "") return;
	const filtered = myList.filter(
		q => q.toLocaleLowerCase().includes(value));

	for (const el of filtered) {
		const li = document.createElement("li");
		li.textContent = el;
		li.addEventListener("click", () => {
			input.value = el;

			if (input.id === 'volunteer-name') {
				input.dataset.selectedName = el;
				input.setCustomValidity('');
			}

			suggestions.innerHTML = ""
		})
		suggestions.appendChild(li);
	}

	// special suggestion for volunteers to add a volunteer
	if (input.id === 'volunteer-name') {
		const addNew = document.createElement('li');
		addNew.textContent = '+ Add new';
		addNew.onclick = () => {
			newVolunteer();
			suggestions.innerHTML = '';
		};
		suggestions.appendChild(addNew);
	}
}

function addSuggestedOptions(inputId, suggestionsId, myList) {
	const input = byId(inputId);
	const suggestions = byId(suggestionsId);

	input.oninput = () => showSuggestedOptions(input, suggestions, myList);
	input.onfocus = () => showSuggestedOptions(input, suggestions, myList);
}

function addVolunteerSuggestedOptions(volunteerList) {
    const input = byId('volunteer-name');
    const suggestions = byId('volunteer-name-suggestions');

    function clearSelection() {
        delete input.dataset.selectedName;
        input.setCustomValidity('Choose your name from the dropdown.');
    }

    input.oninput = function () {
        clearSelection();
        showSuggestedOptions(input, suggestions, volunteerList);
    };

    input.onfocus = () => showSuggestedOptions(input, suggestions, volunteerList);

    clearSelection();
}

async function setSuggestedOptions() {
    await Promise.all([
        getVolunteers().then(list =>
            addVolunteerSuggestedOptions(list)
        ),
        getProductTypes().then(list =>
            addSuggestedOptions('product-type', 'product-type-suggestions', list)
        ),
        getBrandNames().then(list =>
            addSuggestedOptions('brand-name', 'brand-name-suggestions', list)
        )
    ]);
}

// if we have too many photos we wanna stop the user
// from adding them 
function checkPhotoLimit() {
	const beforeButtons = [byId('camera-before-button'), byId('camera-before-non-ios-button')]
	const afterButtons = [byId('camera-after-button'), byId('camera-after-non-ios-button')]

	for (const button of beforeButtons) {
		if (beforePhotos.length >= MAX_PHOTOS) {
			button.disabled = true;
			show('max-photos-before');
		} else {
			button.disabled = processingPhotos || submitting;
			hide('max-photos-before')
		}
	}

	for (const button of afterButtons) {
		if (afterPhotos.length >= MAX_PHOTOS) {
			button.disabled = true;
			show('max-photos-after');
		} else {
			button.disabled = processingPhotos || submitting;
			hide('max-photos-after')
		}
	}
	byId('submitButton').disabled = processingPhotos || submitting;
}

// A single guard covers both selections; files are processed sequentially.
async function addPhotos(input, photos, thumbnailsId) {
	const files = Array.from(input.files);
	input.value = '';
	if (processingPhotos || submitting) return;
	processingPhotos = true;
	checkPhotoLimit();
	try {
		for (const source of files) {
			if (photos.length >= MAX_PHOTOS) break;
			const thumbnail = document.createElement('div');
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.textContent = '×';
			remove.setAttribute('aria-label', `Remove ${source.name}`);
			try {
				const { optimizePhoto, PHOTO_OPTIONS } = await photoTools;
				const file = await optimizePhoto(source, PHOTO_OPTIONS);
				const image = document.createElement('img');
				image.src = URL.createObjectURL(file);
				image.alt = file.name;
				photos.push(file);
				thumbnail.append(image);
				remove.onclick = () => {
					if (submitting) return;
					photos.splice(photos.indexOf(file), 1);
					URL.revokeObjectURL(image.src);
					thumbnail.remove();
					checkPhotoLimit();
				};
			} catch (error) {
				const message = document.createElement('p');
				message.setAttribute('role', 'alert');
				message.textContent = `${source.name}: ${error.message}`;
				thumbnail.append(message);
				remove.onclick = () => thumbnail.remove();
			}
			thumbnail.append(remove);
			byId(thumbnailsId).appendChild(thumbnail);
		}
	} finally {
		processingPhotos = false;
		checkPhotoLimit();
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

async function registerVolunteer() {

	showLoading()

	const response = await fetch('/.netlify/functions/register-volunteer', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			firstName: byId('new-volunteer-first-name').value.trim(),
			lastName: byId('new-volunteer-last-name').value.trim(),
			email: byId('new-volunteer-email').value.trim()
		})
	});

	if (!response.ok) {
		throw new Error('Could not register volunteer');
	}

	const volunteer = await response.json();
	const volunteerList = await getVolunteers();

	addSuggestedOptions(
		'volunteer-name',
		'volunteer-name-suggestions',
		volunteerList,
		newVolunteer
		);

	if (!volunteerList.includes(volunteer.name)) {
		throw new Error('Registered, but could not refresh their name');
	}

	byId('new-volunteer-cancel').click();
	byId('volunteer-name').value = volunteer.name;

	hide('loading-indicator')
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

form.addEventListener('submit', async event => {
	event.preventDefault();

	if (processingPhotos || submitting || !form.reportValidity()) return;
	submitting = true;
	checkPhotoLimit();

	showLoading();

	try {
		const formData = new FormData(form);

		const products = await getProductTypes();
		const brands = await getBrandNames();

		const product = formData.get('product-type').trim().toLowerCase();
		const brand = formData.get('brand-name').trim().toLowerCase();

		const productExists = products.some(name => name.trim().toLowerCase() === product);
		const brandExists = brands.some(name => name.trim().toLowerCase() === brand);

		formData.set('product-status', productExists ? 'existing' : 'new');
		formData.set('brand-status', brand ? (brandExists ? 'existing' : 'new') : '');

		for (const photo of beforePhotos) formData.append('beforePhotos', photo);
		for (const photo of afterPhotos) formData.append('afterPhotos', photo);

		const response = await fetch('/api', {
			method: 'POST',
			body: formData
		});

		const result = await response.json();

		if (!response.ok || !result.ok) {
			throw new Error(result.error || 'Could not submit repair');
		}

		const volunteerName = byId('volunteer-name').value;

		form.reset();
		byId('volunteer-name').value = volunteerName;

		for (const image of document.querySelectorAll('.thumbnails img')) {
			URL.revokeObjectURL(image.src);
		}
		beforePhotos = [];
		afterPhotos = [];
		checkPhotoLimit();
		byId('before-thumbnails').innerHTML = '';
		byId('after-thumbnails').innerHTML = '';

		window.scrollTo({
			top: 0,
			behavior: 'smooth'
		});
		celebrate();
	} catch (error) {
		alert(error.message);
	} finally {
		submitting = false;
		checkPhotoLimit();
		hide('loading-indicator');
	}
});

checkValidEmail('new-volunteer-email')
setCategories();
setSuggestedOptions();
