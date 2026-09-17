// written by an LLM

const REVIEW_SHEET = 'FormOverview';
const HEADER_ROW = 1;
const FIRST_DATA_ROW = 2;

function showRepairViewer() {
  const html = HtmlService
    .createHtmlOutputFromFile('RepairViewer')
    .setTitle('Repair viewer');

  SpreadsheetApp.getUi().showSidebar(html);
}

function getCurrentReview() {
  let row = SpreadsheetApp
    .getActiveRange()
    .getRow();

  if (row < FIRST_DATA_ROW) {
    row = FIRST_DATA_ROW;
  }

  return getReviewRow_(row);
}

function getReviewRow(row) {
  const sheet = SpreadsheetApp
    .getActive()
    .getSheetByName(REVIEW_SHEET);

  row = Math.max(
    FIRST_DATA_ROW,
    Number(row)
  );

  row = Math.min(
    sheet.getLastRow(),
    row
  );

  return getReviewRow_(row);
}

function getReviewRow_(row) {
  const sheet = SpreadsheetApp
    .getActive()
    .getSheetByName(REVIEW_SHEET);

  const lastColumn =
    sheet.getLastColumn();

  const headers = sheet
    .getRange(
      HEADER_ROW,
      1,
      1,
      lastColumn
    )
    .getDisplayValues()[0];

  const range = sheet.getRange(
    row,
    1,
    1,
    lastColumn
  );

  const values =
    range.getDisplayValues()[0];

  const richText =
    range.getRichTextValues()[0];

  const formulas =
    range.getFormulas()[0];


  /*
   * Map:
   *
   * "guest name" -> column number
   * "before 1"   -> column number
   * etc.
   */
  const indexes = {};

  headers.forEach((header, i) => {
    indexes[
      String(header)
        .trim()
        .toLowerCase()
    ] = i;
  });

  function value(name) {
    const i =
      indexes[name.toLowerCase()];

    if (i === undefined) {
      return '';
    }

    return values[i];
  }

  function valueAny(...names) {
    for (const name of names) {
      const result = value(name);

      if (result !== '') {
        return result;
      }
    }

    return '';
  }

  function photoId(name) {
    const i =
      indexes[name.toLowerCase()];

    if (i === undefined) {
      return null;
    }

    let url = null;

    if (richText[i]) {
      url =
        richText[i].getLinkUrl();

      if (!url) {
        const runs =
          richText[i].getRuns();

        for (const run of runs) {
          const runUrl =
            run.getLinkUrl();

          if (runUrl) {
            url = runUrl;
            break;
          }
        }
      }
    }

    if (!url && formulas[i]) {
      const match =
        formulas[i].match(
          /HYPERLINK\(\s*"([^"]+)"/i
        );

      if (match) {
        url = match[1];
      }
    }

    if (
      !url &&
      /^https?:\/\//i.test(values[i])
    ) {
      url = values[i];
    }


    return getDriveFileId_(url);
  }

  return {
    row: row,

    date:
      value('Date'),

    volunteer:
      value('Volunteer name'),

    guest:
      value('Guest name'),

    product:
      value('Product name'),

    category:
      value('RM Category [auto-generated]'),

    brand:
      value('Brand'),

    model:
      valueAny(
        'Model / serial',
        'Model/serial',
        'Model / serial number'
      ),

    outcome:
      valueAny(
        'Outcome',
        'Repair outcome'
      ),

    experience:
      value('Guest experience'),

    problem:
      value('Problem / solution description'),

    notes:
      value('Guest notes'),


    before: [
      photoId('Photo before 1'),
      photoId('Photo before 2'),
      photoId('Photo before 3'),
      photoId('Photo before 4')
    ].filter(Boolean),


    after: [
      photoId('Photo after 1'),
      photoId('Photo after 2'),
      photoId('Photo after 3'),
      photoId('Photo after 4')
    ].filter(Boolean)
  };
}

function getDriveFileId_(url) {
  if (!url) {
    return null;
  }

  const text = String(url);

  let match = text.match(
    /\/d\/([a-zA-Z0-9_-]+)/
  );

  if (match) {
    return match[1];
  }

  match = text.match(
    /[?&]id=([a-zA-Z0-9_-]+)/
  );

  if (match) {
    return match[1];
  }

  match = text.match(
    /[a-zA-Z0-9_-]{25,}/
  );

  return match
    ? match[0]
    : null;
}

function getDriveImages(fileIds) {
  return fileIds.map(fileId => {
    try {
      const file =
        DriveApp.getFileById(fileId);

      const blob =
        file.getBlob();

      const base64 =
        Utilities.base64Encode(
          blob.getBytes()
        );

      return {
        fileId: fileId,

        src:
          'data:' +
          blob.getContentType() +
          ';base64,' +
          base64
      };

    } catch (error) {
      return {
        fileId: fileId,
        error: error.message
      };
    }
  });
}
