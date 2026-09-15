// var volunteerList = [];
// var productTypeList = [];
// var brandNameList = [];

var beforePhotos = [];
var afterPhotos = [];

function id(elementId) {
	return document.getElementById(elementId);
}

function hide(elementId) {
	id(elementId).style.display = 'none';
}

function show(elementId) {
	id(elementId).style.display = 'block';
}

function makeRequired(elementId) {
	id(elementId).required = true;
}

function makeNotRequired(elementId) {
	id(elementId).required = false;
}

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
|| (/Macintosh/i.test(navigator.userAgent)
	&& navigator.maxTouchPoints > 1);

if (!isIOS) {
	show('camera-button-before-other');
	show('camera-button-after-other');
}

async function getProductTypes() {
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

async function getVolunteers () {
	const response = await fetch('/.netlify/functions/volunteers')
	if (!response.ok) {
		throw new Error("Couldn't get volunteers from Google sheet (check Netlify functions?)")
	}
	return await response.json();
}

function addSuggestedOptions(inputId, suggestionsId, myList, addNewFunction) {
	const input = document.getElementById(inputId);
	const suggestions = document.getElementById(suggestionsId);

	input.oninput = () => showSuggestedOptions(input, suggestions, myList, addNewFunction);
	input.onfocus = () => showSuggestedOptions(input, suggestions, myList, addNewFunction);
}

async function setSuggestedOptions() {
	const volunteerList = await getVolunteers();
	addSuggestedOptions("volunteer-name", "volunteer-name-suggestions", volunteerList, addNewVolunteer)

	const productTypeList = await getProductTypes();
	addSuggestedOptions("product-type", "product-type-suggestions", productTypeList, addNewProductType)

	const brandNameList = await getBrandNames();
	addSuggestedOptions("brand-name", "brand-name-suggestions", brandNameList, addNewBrandName)
}


function showSuggestedOptions(input, suggestions, myList, addNewFunction) {
	const value = input.value.toLocaleLowerCase().trim();

	// clear all the suggestions
	suggestions.innerHTML = "";

	if (value == "") return;

	const filtered = myList.filter(
		q => q.toLocaleLowerCase().includes(value)
		);

	for (const el of filtered) {
		const li = document.createElement("li");
		li.textContent = el;
		li.addEventListener("click", () => {
			input.value = el;
			suggestions.innerHTML = ""
		})
		suggestions.appendChild(li);
	}

	// if the options isn't available,
	// we want to able to add a new item
	const addNew = document.createElement("li");
	addNew.textContent = "+ Add new";
	addNew.addEventListener("click", ()=>{
		addNewFunction();
		suggestions.innerHTML = '';
	})
	suggestions.appendChild(addNew);
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

document.getElementById('add-volunteer-cancel').addEventListener("click", () => {
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
})

// if we have too many photos we wanna stop the user
// from adding them 
function checkPhotoLimit() {
	for (const button of document.querySelectorAll(
		'#camera-button-before-ios button, #camera-button-before-other button'
		)) {
		button.disabled = beforePhotos.length >= 5;
}

for (const button of document.querySelectorAll(
	'#camera-button-after-ios button, #camera-button-after-other button'
	)) {
	button.disabled = afterPhotos.length >= 5;
}
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
		id(thumbnailsId).appendChild(thumbnail);
	}

	input.value = '';

	checkPhotoLimit();
}

function openPhotosBefore(inputId) {
	const input = id(inputId);
	input.onchange = () => {
		addPhotos(input, beforePhotos, 'before-thumbnails')
	}
	input.click();
}

function openPhotosAfter(inputId) {
	const input = id(inputId);
	input.onchange = () => {
		addPhotos(input, afterPhotos, 'after-thumbnails')
	}
	input.click()
}

setSuggestedOptions();

async function registerVolunteer() {
  // 1. Send the new volunteer to Netlify
	show('loading-indicator')
	const response = await fetch('/.netlify/functions/register-volunteer', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			firstName: id('add-volunteer-first-name').value.trim(),
			lastName: id('add-volunteer-last-name').value.trim(),
			email: id('add-volunteer-email').value.trim()
		})
	});

	if (!response.ok) {
		throw new Error('Could not register volunteer');
	}

	const volunteer = await response.json();

	// 3. Reload the sheet
	const volunteerList = await getVolunteers();

	addSuggestedOptions(
		'volunteer-name',
		'volunteer-name-suggestions',
		volunteerList,
		addNewVolunteer
		);

  // 4. Check that their name came back
	if (!volunteerList.includes(volunteer.name)) {
		throw new Error('Registered, but could not refresh their name');
	}

  // 5. Return to the normal field and fill it
	id('add-volunteer-cancel').click();
	id('volunteer-name').value = volunteer.name;

	hide('loading-indicator')
}

function addNewProductType () {};
function addNewBrandName () {};