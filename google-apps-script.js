/**
 * Google Apps Script for Realtor Tracker
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://sheets.google.com and create a new spreadsheet
 * 2. Rename Sheet1 to "Listings" and create a second sheet called "Daily_Stats"
 * 3. In "Listings" sheet, add headers in row 1:
 *    MLS_Number | Price | Address | Type | First_Seen | Last_Seen | Status
 * 4. In "Daily_Stats" sheet, add headers in row 1:
 *    Date | New_Listings | Sold_Count | Total_Active
 * 5. Go to Extensions > Apps Script
 * 6. Delete any code and paste this entire file
 * 7. Click Deploy > New deployment
 * 8. Select type: Web app
 * 9. Set "Execute as" to "Me"
 * 10. Set "Who has access" to "Anyone"
 * 11. Click Deploy and authorize when prompted
 * 12. Copy the Web app URL - this is your API endpoint
 */

const LISTINGS_SHEET = 'Listings';
const STATS_SHEET = 'Daily_Stats';

function doGet(e) {
  const action = e.parameter.action;

  try {
    switch (action) {
      case 'getListings':
        return jsonResponse(getListings());
      case 'getStats':
        return jsonResponse(getStats());
      case 'getDailyStats':
        return jsonResponse(getDailyStats());
      default:
        return jsonResponse({ error: 'Unknown action' });
    }
  } catch (error) {
    return jsonResponse({ error: error.toString() });
  }
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;

  try {
    switch (action) {
      case 'syncListings':
        return jsonResponse(syncListings(data.listings));
      case 'updateDailyStats':
        return jsonResponse(updateDailyStats(data.stats));
      default:
        return jsonResponse({ error: 'Unknown action' });
    }
  } catch (error) {
    return jsonResponse({ error: error.toString() });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getListings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTINGS_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const listings = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0]) { // Has MLS number
      listings.push({
        MLS_Number: row[0],
        Price: row[1],
        Address: row[2],
        Type: row[3],
        First_Seen: formatDate(row[4]),
        Last_Seen: formatDate(row[5]),
        Status: row[6],
        rowIndex: i + 1
      });
    }
  }

  return { listings };
}

function getStats() {
  const { listings } = getListings();

  const now = new Date();
  const today = formatDate(now);
  const sevenDaysAgo = formatDate(new Date(now - 7 * 24 * 60 * 60 * 1000));
  const sevenWeeksAgo = formatDate(new Date(now - 49 * 24 * 60 * 60 * 1000));

  let newToday = 0;
  let newLast7Days = 0;
  let newLast7Weeks = 0;
  let soldToday = 0;
  let totalActive = 0;
  let saleCount = 0;
  let rentCount = 0;

  listings.forEach(listing => {
    const firstSeen = listing.First_Seen;
    const lastSeen = listing.Last_Seen;

    if (listing.Status === 'active') {
      totalActive++;
      if (listing.Type === 'sale') saleCount++;
      if (listing.Type === 'rent') rentCount++;
    }

    if (firstSeen === today) newToday++;
    if (firstSeen >= sevenDaysAgo) newLast7Days++;
    if (firstSeen >= sevenWeeksAgo) newLast7Weeks++;
    if (listing.Status === 'sold' && lastSeen === today) soldToday++;
  });

  return {
    newToday,
    newLast7Days,
    newLast7Weeks,
    soldToday,
    totalActive,
    saleCount,
    rentCount,
    lastUpdate: new Date().toISOString()
  };
}

function getDailyStats() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATS_SHEET);
  const data = sheet.getDataRange().getValues();
  const stats = [];

  for (let i = 1; i < data.length && i <= 30; i++) {
    const row = data[i];
    if (row[0]) {
      stats.push({
        Date: formatDate(row[0]),
        New_Listings: row[1] || 0,
        Sold_Count: row[2] || 0,
        Total_Active: row[3] || 0
      });
    }
  }

  // Sort by date descending
  stats.sort((a, b) => b.Date.localeCompare(a.Date));

  return { stats };
}

function syncListings(currentListings) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTINGS_SHEET);
  const { listings: existingListings } = getListings();

  const today = formatDate(new Date());
  const existingMap = new Map();
  existingListings.forEach(l => existingMap.set(l.MLS_Number, l));

  const currentMlsNumbers = new Set(currentListings.map(l => l.mlsNumber));

  let newCount = 0;
  let soldCount = 0;
  const updates = [];
  const newRows = [];

  // Find new listings and updates
  currentListings.forEach(listing => {
    if (existingMap.has(listing.mlsNumber)) {
      const existing = existingMap.get(listing.mlsNumber);
      // Update Last_Seen and reactivate if needed
      updates.push({
        rowIndex: existing.rowIndex,
        lastSeen: today,
        status: 'active'
      });
    } else {
      // New listing
      newRows.push([
        listing.mlsNumber,
        listing.price,
        listing.address,
        listing.type,
        today,
        today,
        'active'
      ]);
      newCount++;
    }
  });

  // Find sold/delisted listings
  existingListings.forEach(listing => {
    if (listing.Status === 'active' && !currentMlsNumbers.has(listing.MLS_Number)) {
      updates.push({
        rowIndex: listing.rowIndex,
        lastSeen: today,
        status: 'sold'
      });
      soldCount++;
    }
  });

  // Apply updates
  updates.forEach(update => {
    sheet.getRange(update.rowIndex, 6).setValue(update.lastSeen); // Last_Seen
    sheet.getRange(update.rowIndex, 7).setValue(update.status);   // Status
  });

  // Add new rows
  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, 7).setValues(newRows);
  }

  // Update daily stats
  updateDailyStats({
    date: today,
    newListings: newCount,
    soldCount: soldCount,
    totalActive: currentListings.length
  });

  return {
    success: true,
    newListings: newCount,
    soldListings: soldCount,
    totalActive: currentListings.length
  };
}

function updateDailyStats(stats) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATS_SHEET);
  const data = sheet.getDataRange().getValues();
  const today = stats.date || formatDate(new Date());

  // Find if today's row exists
  let todayRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (formatDate(data[i][0]) === today) {
      todayRow = i + 1;
      break;
    }
  }

  if (todayRow > 0) {
    // Update existing row
    sheet.getRange(todayRow, 2).setValue(stats.newListings);
    sheet.getRange(todayRow, 3).setValue(stats.soldCount);
    sheet.getRange(todayRow, 4).setValue(stats.totalActive);
  } else {
    // Add new row
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, 1, 4).setValues([[
      today,
      stats.newListings,
      stats.soldCount,
      stats.totalActive
    ]]);
  }

  return { success: true };
}

function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') return date.split('T')[0];
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Test function - run this to verify setup
function testSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Check Listings sheet
  let listingsSheet = ss.getSheetByName(LISTINGS_SHEET);
  if (!listingsSheet) {
    listingsSheet = ss.insertSheet(LISTINGS_SHEET);
    listingsSheet.getRange(1, 1, 1, 7).setValues([[
      'MLS_Number', 'Price', 'Address', 'Type', 'First_Seen', 'Last_Seen', 'Status'
    ]]);
    Logger.log('Created Listings sheet with headers');
  }

  // Check Daily_Stats sheet
  let statsSheet = ss.getSheetByName(STATS_SHEET);
  if (!statsSheet) {
    statsSheet = ss.insertSheet(STATS_SHEET);
    statsSheet.getRange(1, 1, 1, 4).setValues([[
      'Date', 'New_Listings', 'Sold_Count', 'Total_Active'
    ]]);
    Logger.log('Created Daily_Stats sheet with headers');
  }

  Logger.log('Setup complete! You can now deploy as web app.');
}
