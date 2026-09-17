function onOpen() {
  const ui = SpreadsheetApp.getUi();

  // repair monitor menu
  ui.createMenu('RCEB')
    .addItem('Log in to RepairMonitor', 'setCookie')
    .addItem('Submit repairs to RepairMonitor', 'submitRepairs')
    .addItem('View repairs in sidebar', 'showRepairViewer')
        .addToUi();

}
 