# Repair form: direct Google APIs

The browser submits to Netlify, which uploads photos to Google Drive and appends
one row using the Google Sheets API. Apps Script is no longer called.
Autocomplete continues to use the existing static JSON files.

## Deployment

1. In a Google Cloud project, enable Google Sheets API and Google Drive API.
2. Create a service account for this form. It does not need a project IAM role
   or domain-wide delegation. Create a JSON key and keep it outside this repository.
3. Give its client_email edit access to the submission spreadsheet and permission
   to create files in the existing Shared drive photo folder. Workspace sharing
   policy must allow that account.
4. In Netlify, set these server-side environment variables for Functions:
   - GOOGLE_SERVICE_ACCOUNT_JSON: the complete JSON key file contents, marked secret.
   - GOOGLE_SPREADSHEET_ID: 1qQ7RrKcBTBhsxVu9fn28fEnA0Lq6E_CCDBeaMMNUKSI
   - GOOGLE_SHEET_NAME: Repair Form Submissions
   - GOOGLE_PHOTO_FOLDER_ID: 1_E9LxWVdTZOs1h3wtt7WZrOPwylVFW_7
   - REPAIR_TIME_ZONE: America/New_York (change if the old script used another zone).
5. Deploy this repository including package.json and package-lock.json.
   APPS_SCRIPT_URL is no longer used. Keep the old script for rollback.
6. Test a repair without photos and another with before/after photos. Confirm
   the row, photo links and successful form reset.

Official references:
- https://developers.google.com/identity/protocols/oauth2/service-account
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
- https://developers.google.com/workspace/drive/api/guides/manage-uploads

## Submission behavior

Submit sends one request. A successful Google Sheets acknowledgement resets
the form and shows the existing success animation. An error keeps the form
contents and displays an error. There is no polling, status lookup, automatic
retry, or additional button.

Photos remain as usable URLs, one per line. Timestamp is an ISO UTC string;
Date uses REPAIR_TIME_ZONE. RAW writes keep user text from becoming spreadsheet
formulas. Failed uploads or writes may leave uploaded photos in the folder.

Live testing is left to the project owner.
