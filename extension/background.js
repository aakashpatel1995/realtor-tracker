// Realtor.ca Listing Tracker - Background Service Worker (Google Sheets version)

// Configuration
const CONFIG = {
  SCRIPT_URL: '', // Google Apps Script Web App URL
  UPDATE_INTERVAL_MINUTES: 60
};

// GTA Bounding Box coordinates
const GTA_BOUNDS = {
  longitudeMin: -80.0,
  longitudeMax: -78.9,
  latitudeMin: 43.4,
  latitudeMax: 44.0
};

// Initialize alarm for periodic updates
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('fetchListings', {
    periodInMinutes: CONFIG.UPDATE_INTERVAL_MINUTES
  });
  console.log('Realtor Tracker: Alarm set for periodic updates');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchListings') {
    fetchAndUpdateListings();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'manualRefresh') {
    fetchAndUpdateListings().then(result => {
      sendResponse(result);
    });
    return true;
  }
  if (request.action === 'getStats') {
    getStats().then(stats => {
      sendResponse(stats);
    });
    return true;
  }
  if (request.action === 'saveConfig') {
    chrome.storage.local.set({
      scriptUrl: request.scriptUrl
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (request.action === 'getConfig') {
    chrome.storage.local.get(['scriptUrl'], (result) => {
      sendResponse(result);
    });
    return true;
  }
});

// Load config from storage
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['scriptUrl'], (result) => {
      CONFIG.SCRIPT_URL = result.scriptUrl || '';
      resolve();
    });
  });
}

// Fetch listings from realtor.ca API
async function fetchRealtorListings(transactionType = 'sale', page = 1) {
  const transactionTypeId = transactionType === 'sale' ? 2 : 3;

  const params = new URLSearchParams({
    CultureId: '1',
    ApplicationId: '1',
    RecordsPerPage: '200',
    MaximumResults: '200',
    PropertySearchTypeId: '1',
    TransactionTypeId: transactionTypeId.toString(),
    LongitudeMin: GTA_BOUNDS.longitudeMin.toString(),
    LongitudeMax: GTA_BOUNDS.longitudeMax.toString(),
    LatitudeMin: GTA_BOUNDS.latitudeMin.toString(),
    LatitudeMax: GTA_BOUNDS.latitudeMax.toString(),
    CurrentPage: page.toString()
  });

  try {
    const response = await fetch('https://api2.realtor.ca/Listing.svc/PropertySearch_Post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.realtor.ca',
        'Referer': 'https://www.realtor.ca/'
      },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.Results || [];
  } catch (error) {
    console.error('Error fetching from realtor.ca:', error);
    return [];
  }
}

// Fetch all GTA listings (both sale and rent)
async function fetchAllListings() {
  const allListings = [];

  // Fetch sale listings (paginate through all)
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 10) {
    const saleListings = await fetchRealtorListings('sale', page);
    if (saleListings.length === 0) {
      hasMore = false;
    } else {
      saleListings.forEach(listing => {
        allListings.push({
          mlsNumber: listing.MlsNumber,
          price: listing.Property?.Price ? parseInt(listing.Property.Price.replace(/[^0-9]/g, '')) : 0,
          address: listing.Property?.Address?.AddressText || '',
          type: 'sale'
        });
      });
      page++;
      await delay(200);
    }
  }

  // Fetch rent listings
  page = 1;
  hasMore = true;
  while (hasMore && page <= 10) {
    const rentListings = await fetchRealtorListings('rent', page);
    if (rentListings.length === 0) {
      hasMore = false;
    } else {
      rentListings.forEach(listing => {
        allListings.push({
          mlsNumber: listing.MlsNumber,
          price: listing.Property?.Price ? parseInt(listing.Property.Price.replace(/[^0-9]/g, '')) : 0,
          address: listing.Property?.Address?.AddressText || '',
          type: 'rent'
        });
      });
      page++;
      await delay(200);
    }
  }

  return allListings;
}

// Google Sheets API helper
async function sheetsApi(action, data = null) {
  await loadConfig();

  if (!CONFIG.SCRIPT_URL) {
    throw new Error('Google Sheets not configured');
  }

  const url = data
    ? CONFIG.SCRIPT_URL
    : `${CONFIG.SCRIPT_URL}?action=${action}`;

  const options = data
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      }
    : { method: 'GET' };

  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Sheets API error: ${response.status}`);
  }

  return response.json();
}

// Main function to fetch and update listings
async function fetchAndUpdateListings() {
  try {
    await loadConfig();

    if (!CONFIG.SCRIPT_URL) {
      return { success: false, error: 'Google Sheets not configured' };
    }

    console.log('Fetching listings from realtor.ca...');
    const currentListings = await fetchAllListings();
    console.log(`Found ${currentListings.length} listings on realtor.ca`);

    console.log('Syncing with Google Sheets...');
    const result = await sheetsApi('syncListings', { listings: currentListings });

    // Store last update time
    chrome.storage.local.set({ lastUpdate: new Date().toISOString() });

    console.log('Sync complete:', result);
    return result;
  } catch (error) {
    console.error('Error updating listings:', error);
    return { success: false, error: error.message };
  }
}

// Get statistics for display
async function getStats() {
  try {
    await loadConfig();

    if (!CONFIG.SCRIPT_URL) {
      return { error: 'Google Sheets not configured' };
    }

    const data = await sheetsApi('getStats');

    // Get last update time from storage
    const storage = await chrome.storage.local.get(['lastUpdate']);
    data.lastUpdate = storage.lastUpdate || null;

    return data;
  } catch (error) {
    console.error('Error getting stats:', error);
    return { error: error.message };
  }
}

// Utility function for delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
