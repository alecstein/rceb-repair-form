// var volunteerList = [];
// var productTypeList = [];
// var brandNameList = [];

var beforePhotos = [];
var afterPhotos = [];
var form = document.querySelector('form');

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

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
|| (/Macintosh/i.test(navigator.userAgent)
	&& navigator.maxTouchPoints > 1);

if (!isIOS) {
	show('camera-button-before-other');
	show('camera-button-after-other');
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
	// clear all the suggestions
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

async function setSuggestedOptions() {
	const volunteerList = await getVolunteers();
	addSuggestedOptions("volunteer-name", "volunteer-name-suggestions", volunteerList)

	// we do something special for the volunteer field
	// this is bad practice but whatever
	volunteerSuggestions = byId('volunteer-name-suggestions');
	const addNew = document.createElement("li");
	addNew.textContent = "+ Add new";
	addNew.addEventListener("click", ()=>{
		addNewVolunteer();
		volunteerSuggestions.innerHTML = '';
	})
	volunteerSuggestions.appendChild(addNew);

	const productTypeList = await getProductTypes();
	addSuggestedOptions("product-type", "product-type-suggestions", productTypeList)

	const brandNameList = await getBrandNames();
	addSuggestedOptions("brand-name", "brand-name-suggestions", brandNameList)
}

function addNewVolunteer() {
	// on submission, this gets added to our google sheet
	// a successful submission involves talking to both sheets
	// but maybe we can put this list on the same sheet? different page?
	show('new-volunteer-title');
	hide('volunteer-name-title');

	show('add-volunteer-first-name');
	makeRequired('add-volunteer-first-name');

	show('add-volunteer-last-name');
	makeRequired('add-volunteer-last-name');

	show('add-volunteer-email')
	makeRequired('add-volunteer-email');

	hide('volunteer-name')
	makeNotRequired('volunteer-name')

	show('add-volunteer-cancel')
	show('register')
}

function cancelAddNewVolunteer() {
	hide('new-volunteer-title');
	show('volunteer-name-title');

	hide('add-volunteer-first-name');
	makeNotRequired('add-volunteer-first-name');

	hide('add-volunteer-last-name');
	makeNotRequired('add-volunteer-last-name');

	hide('add-volunteer-email')
	makeNotRequired('add-volunteer-email');

	show('volunteer-name')
	makeRequired('volunteer-name')

	hide('add-volunteer-cancel')
	hide('register')
}

byId('add-volunteer-cancel').addEventListener("click", () => cancelAddNewVolunteer())

// if we have too many photos we wanna stop the user
// from adding them 
function checkPhotoLimit() {
	for (const button of document.querySelectorAll(
		'#camera-button-before-ios button, #camera-button-before-other button'
		)) {button.disabled = beforePhotos.length >= 5;}

		for (const button of document.querySelectorAll(
			'#camera-button-after-ios button, #camera-button-after-other button'
			)) {button.disabled = afterPhotos.length >= 5;}
	}

// basically
// 1. checks if there are too many photos uploaded, 
// stops after the first 5
// 2. adds thumbnails with buttons that will remove 
// those thumbnails (and thumbnail removal buttons)
function addPhotos(input, photos, thumbnailsId) {
	for (const file of input.files) {
		if (photos.length >= 5) break;

		photos.push(file);

		const thumbnail = document.createElement('div');
		const image = document.createElement('img');
		const remove = document.createElement('button');

		image.src = URL.createObjectURL(file);
		image.alt = file.name;

		remove.type = 'button';
		remove.textContent = '×';
		remove.setAttribute('aria-label', 'Remove photo');
		remove.onclick = () => {
			photos.splice(photos.indexOf(file), 1);
			URL.revokeObjectURL(image.src);
			thumbnail.remove();
			checkPhotoLimit();
		};

		thumbnail.append(image, remove);
		byId(thumbnailsId).appendChild(thumbnail);
	}

	input.value = '';

	checkPhotoLimit();
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
			firstName: byId('add-volunteer-first-name').value.trim(),
			lastName: byId('add-volunteer-last-name').value.trim(),
			email: byId('add-volunteer-email').value.trim()
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
		addNewVolunteer
		);

	if (!volunteerList.includes(volunteer.name)) {
		throw new Error('Registered, but could not refresh their name');
	}

	byId('add-volunteer-cancel').click();
	byId('volunteer-name').value = volunteer.name;

	hide('loading-indicator')
}

form.addEventListener('submit', async event => {
	event.preventDefault();

	if (!form.reportValidity()) return;

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

			beforePhotos = [];
			afterPhotos = [];
			checkPhotoLimit();
			byId('before-thumbnails').innerHTML = '';
			byId('after-thumbnails').innerHTML = '';

		} catch (error) {
			alert(error.message);
		} finally {
			hide('loading-indicator');
		}
	});


setCategories();
setSuggestedOptions();
