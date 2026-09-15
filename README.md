# Repair form
## Basic structure

There are three pieces here: 

* the form (the part you see on your computer, i.e. the code in this repo)
* Netlify
* Google Sheets

The form sends a POST request to Netlify. Netlify then does some things to update the Google spreadsheets. I picked Netlify because they're free. GitHub pages would only work for a static site, which this is not.

## What does Netlify do?

Netlify uploads the user's photos to our Google Drive and adds rows to the Google Sheets. There are two relevant sheets: our volunteer list, and our repair form submissions. 

## What do I need to get started on Netlify?

You need to set up these environment variables:

   - GOOGLE_SERVICE_ACCOUNT_JSON
   - GOOGLE_SPREADSHEET_ID: 1qQ7RrKcBTBhsxVu9fn28fEnA0Lq6E_CCDBeaMMNUKSI
   - GOOGLE_SHEET_NAME: Repair Form Submissions or Volunteers
   - GOOGLE_PHOTO_FOLDER_ID: 1_E9LxWVdTZOs1h3wtt7WZrOPwylVFW_7
   - REPAIR_TIME_ZONE: America/New_York

## RepairMonitor

Why is this sheet designed the way it is? Largely because of RepairMonitor, the database of Repair Cafe International... I think.

Anyway, we want our repairs to go on there so we need to follow their schema. They make the user choose the product type, the brand name, the category, and so we make the user do that as well.

