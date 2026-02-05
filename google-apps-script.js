/**
 * Google Apps Script for Realtor Tracker
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://sheets.google.com and create a new spreadsheet
 * 2. Rename Sheet1 to "Listings" and create a second sheet called "Daily_Stats"
 * 3. In "Listings" sheet, add headers in row 1:
 *    MLS_Number | Price | Address | Type | First_Seen | Last_Seen | Status | Bedrooms | Bathrooms | Parking | Sqft | LotSize | PropertyType | URL
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
 *
 * To update headers on existing sheet, run testSetup() from Apps Script editor.
 */

const LISTINGS_SHEET = 'Listings';
const STATS_SHEET = 'Daily_Stats';

// Column indexes (0-based) for Listings sheet
const COL = {
  MLS: 0,
  PRICE: 1,
  ADDRESS: 2,
  TYPE: 3,
  FIRST_SEEN: 4,
  LAST_SEEN: 5,
  STATUS: 6,
  BEDROOMS: 7,
  BATHROOMS: 8,
  PARKING: 9,
  SQFT: 10,
  LOT_SIZE: 11,
  PROPERTY_TYPE: 12,
  URL: 13,
  LISTED_DATE: 14
};

function doGet(e) {
  const action = e.parameter.action;

  try {
    switch (action) {
      case 'getListings':
        return jsonResponse(getListings());
      case 'getActiveMlsNumbers':
        return jsonResponse(getActiveMlsNumbers());
      case 'getListingsByAge':
        return jsonResponse(getListingsByAge());
      case 'getStats':
        return jsonResponse(getStats());
      case 'getDailyStats':
        return jsonResponse(getDailyStats());
      case 'syncBatch':
        // Handle batch sync via GET (for Chrome extension compatibility)
        const data = JSON.parse(decodeURIComponent(e.parameter.data));
        return jsonResponse(syncBatch(data.listings, data.isLastBatch, data.totalListings));
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
      case 'syncBatch':
        return jsonResponse(syncBatch(data.listings, data.isLastBatch, data.totalListings));
      case 'syncStatus':
        return jsonResponse(syncStatus(data.activeIds, data.soldIds, data.totalActive));
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
  const listings = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[COL.MLS]) { // Has MLS number
      listings.push({
        MLS_Number: row[COL.MLS],
        Price: row[COL.PRICE],
        Address: row[COL.ADDRESS],
        Type: row[COL.TYPE],
        First_Seen: formatDate(row[COL.FIRST_SEEN]),
        Last_Seen: formatDate(row[COL.LAST_SEEN]),
        Status: row[COL.STATUS],
        Bedrooms: row[COL.BEDROOMS] || '',
        Bathrooms: row[COL.BATHROOMS] || '',
        Parking: row[COL.PARKING] || '',
        Sqft: row[COL.SQFT] || '',
        LotSize: row[COL.LOT_SIZE] || '',
        PropertyType: row[COL.PROPERTY_TYPE] || '',
        URL: row[COL.URL] || '',
        Listed_Date: formatDate(row[COL.LISTED_DATE]) || '',
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

function getListingsByAge() {
  const { listings } = getListings();
  const now = new Date();
  const today = formatDate(now);

  const daysAgo = (days) => formatDate(new Date(now - days * 24 * 60 * 60 * 1000));

  const day7 = daysAgo(7);
  const day30 = daysAgo(30);
  const day90 = daysAgo(90);
  const day365 = daysAgo(365);

  // Helper to get listing date (prefer Listed_Date, fallback to First_Seen)
  const getListingDate = (l) => l.Listed_Date || l.First_Seen;

  // Filter active listings by age using actual listing date
  const activeListings = listings.filter(l => l.Status === 'active');

  const olderThan7Days = activeListings.filter(l => getListingDate(l) && getListingDate(l) <= day7);
  const olderThan30Days = activeListings.filter(l => getListingDate(l) && getListingDate(l) <= day30);
  const olderThan90Days = activeListings.filter(l => getListingDate(l) && getListingDate(l) <= day90);
  const olderThan1Year = activeListings.filter(l => getListingDate(l) && getListingDate(l) <= day365);

  // Sort by listing date (oldest first)
  const sortByAge = (a, b) => getListingDate(a).localeCompare(getListingDate(b));

  return {
    olderThan7Days: olderThan7Days.sort(sortByAge),
    olderThan30Days: olderThan30Days.sort(sortByAge),
    olderThan90Days: olderThan90Days.sort(sortByAge),
    olderThan1Year: olderThan1Year.sort(sortByAge),
    counts: {
      day7: olderThan7Days.length,
      day30: olderThan30Days.length,
      day90: olderThan90Days.length,
      year: olderThan1Year.length
    }
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

// Batch sync - handles incremental syncing from Chrome extension
function syncBatch(listings, isLastBatch, totalListings) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTINGS_SHEET);
  const { listings: existingListings } = getListings();

  const today = formatDate(new Date());
  const existingMap = new Map();
  existingListings.forEach(l => existingMap.set(l.MLS_Number, l));

  let newCount = 0;
  const newRows = [];

  // Process this batch
  listings.forEach(listing => {
    if (existingMap.has(listing.mlsNumber)) {
      const existing = existingMap.get(listing.mlsNumber);

      // Update fields
      sheet.getRange(existing.rowIndex, 2).setValue(listing.price);
      sheet.getRange(existing.rowIndex, 3).setValue(listing.address);
      sheet.getRange(existing.rowIndex, 4).setValue(listing.type);

      sheet.getRange(existing.rowIndex, 6).setValue(today);
      sheet.getRange(existing.rowIndex, 7).setValue('active');

      // Update Details + Listed_Date (Cols 8-15)
      const details = [[
        listing.bedrooms || '',
        listing.bathrooms || '',
        listing.parking || '',
        listing.sqft || '',
        listing.lotSize || '',
        listing.propertyType || '',
        listing.url || '',
        listing.postedDate || '' // Listed_Date
      ]];
      sheet.getRange(existing.rowIndex, 8, 1, 8).setValues(details);

    } else {
      // New listing
      newRows.push([
        listing.mlsNumber,
        listing.price,
        listing.address,
        listing.type,
        today,
        today,
        'active',
        listing.bedrooms || '',
        listing.bathrooms || '',
        listing.parking || '',
        listing.sqft || '',
        listing.lotSize || '',
        listing.propertyType || '',
        listing.url || '',
        listing.postedDate || '' // Listed_Date
      ]);
      newCount++;
    }
  });

  // Add new rows
  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, 15).setValues(newRows);
  }

  let soldCount = 0;

  // Only mark sold on last batch
  if (isLastBatch) {
    // Get fresh data after updates
    const { listings: updatedListings } = getListings();

    // Find listings not seen today (not in the current sync)
    updatedListings.forEach(listing => {
      if (listing.Status === 'active' && listing.Last_Seen !== today) {
        sheet.getRange(listing.rowIndex, 6).setValue(today);  // Update Last_Seen
        sheet.getRange(listing.rowIndex, 7).setValue('sold');  // Update Status
        soldCount++;
      }
    });

    // Update daily stats
    updateDailyStats({
      date: today,
      newListings: newCount,
      soldCount: soldCount,
      totalActive: totalListings
    });
  }

  return {
    success: true,
    newListings: newCount,
    soldListings: soldCount
  };
}

function syncListings(currentListings) {
  return syncBatch(currentListings, true, currentListings.length);
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
  }
  // Update headers to include Listed_Date
  listingsSheet.getRange(1, 1, 1, 15).setValues([[
    'MLS_Number', 'Price', 'Address', 'Type', 'First_Seen', 'Last_Seen', 'Status',
    'Bedrooms', 'Bathrooms', 'Parking', 'Sqft', 'LotSize', 'PropertyType', 'URL', 'Listed_Date'
  ]]);
  Logger.log('Updated Listings sheet headers');

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

function getActiveMlsNumbers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTINGS_SHEET);
  const data = sheet.getDataRange().getValues();
  const activeMls = [];

  // Skip header, assuming first row is header
  for (let i = 1; i < data.length; i++) {
    // Check if Status (index 6) is 'active'
    if (data[i][6] === 'active') {
      activeMls.push(String(data[i][0])); // MLS Number
    }
  }

  return { mlsNumbers: activeMls };
}

function syncStatus(activeIds, soldIds, totalActive) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LISTINGS_SHEET);
  const data = sheet.getDataRange().getValues();
  const today = formatDate(new Date());

  const activeSet = new Set((activeIds || []).map(String));
  const soldSet = new Set((soldIds || []).map(String));

  let updatesCount = 0;

  // Iterate through all rows (skip header)
  for (let i = 1; i < data.length; i++) {
    const mls = String(data[i][0]);

    if (activeSet.has(mls)) {
      // Update Last_Seen (Col 6, index 5) and Status (Col 7, index 6)
      if (data[i][5] !== today || data[i][6] !== 'active') {
        data[i][5] = today;
        data[i][6] = 'active';
        updatesCount++;
      }
    } else if (soldSet.has(mls)) {
      // Update Last_Seen and Mark as Sold
      if (data[i][6] !== 'sold') {
        data[i][5] = today;
        data[i][6] = 'sold';
        updatesCount++;
      }
    }
  }

  // Bulk write updates back to sheet if there were changes
  if (updatesCount > 0) {
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }

  // Calculate newly added count (implied to be handled by syncBatch calls before this?)
  // Actually syncStatus might run alone.
  // We need to update stats.
  // This function assumes new listings are already added or will be added separately.
  // We only track active/sold counts here.

  let currentActive = 0;
  let currentSoldToday = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][6] === 'active') currentActive++;
    if (data[i][6] === 'sold' && data[i][5] === today) currentSoldToday++;
  }

  updateDailyStats({
    date: today,
    newListings: 0, // This endpoint doesn't add new ones. syncBatch does.
    soldCount: currentSoldToday,
    totalActive: currentActive
  });

  return { success: true, updates: updatesCount };
}
