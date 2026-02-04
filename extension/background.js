// Realtor.ca Listing Tracker - Background Service Worker

// Configuration - User needs to set these
const CONFIG = {
  AIRTABLE_API_KEY: '', // Set via extension storage
  AIRTABLE_BASE_ID: '', // Set via extension storage
  LISTINGS_TABLE: 'Listings',
  STATS_TABLE: 'Daily_Stats',
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
    return true; // Keep channel open for async response
  }
  if (request.action === 'getStats') {
    getStats().then(stats => {
      sendResponse(stats);
    });
    return true;
  }
  if (request.action === 'saveConfig') {
    chrome.storage.local.set({
      airtableApiKey: request.apiKey,
      airtableBaseId: request.baseId
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (request.action === 'getConfig') {
    chrome.storage.local.get(['airtableApiKey', 'airtableBaseId'], (result) => {
      sendResponse(result);
    });
    return true;
  }
});

// Load config from storage
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['airtableApiKey', 'airtableBaseId'], (result) => {
      CONFIG.AIRTABLE_API_KEY = result.airtableApiKey || '';
      CONFIG.AIRTABLE_BASE_ID = result.airtableBaseId || '';
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
  while (hasMore && page <= 10) { // Limit to 10 pages (2000 listings) to avoid rate limiting
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
      await delay(200); // Rate limiting
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
      await delay(200); // Rate limiting
    }
  }

  return allListings;
}

// Airtable API helpers
async function airtableFetch(endpoint, options = {}) {
  await loadConfig();

  if (!CONFIG.AIRTABLE_API_KEY || !CONFIG.AIRTABLE_BASE_ID) {
    throw new Error('Airtable not configured');
  }

  const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airtable error: ${error}`);
  }

  return response.json();
}

// Get existing listings from Airtable
async function getExistingListings() {
  const listings = new Map();
  let offset = null;

  do {
    const params = new URLSearchParams();
    if (offset) params.set('offset', offset);

    const data = await airtableFetch(`${CONFIG.LISTINGS_TABLE}?${params.toString()}`);

    data.records.forEach(record => {
      listings.set(record.fields.MLS_Number, {
        id: record.id,
        ...record.fields
      });
    });

    offset = data.offset;
    await delay(200); // Rate limiting for Airtable
  } while (offset);

  return listings;
}

// Create new listing in Airtable
async function createListing(listing) {
  const today = new Date().toISOString().split('T')[0];

  return airtableFetch(CONFIG.LISTINGS_TABLE, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          MLS_Number: listing.mlsNumber,
          Price: listing.price,
          Address: listing.address,
          Type: listing.type,
          First_Seen: today,
          Last_Seen: today,
          Status: 'active'
        }
      }]
    })
  });
}

// Update listing in Airtable
async function updateListing(recordId, fields) {
  return airtableFetch(CONFIG.LISTINGS_TABLE, {
    method: 'PATCH',
    body: JSON.stringify({
      records: [{
        id: recordId,
        fields: fields
      }]
    })
  });
}

// Batch create listings (up to 10 at a time)
async function batchCreateListings(listings) {
  const batches = [];
  for (let i = 0; i < listings.length; i += 10) {
    batches.push(listings.slice(i, i + 10));
  }

  const today = new Date().toISOString().split('T')[0];

  for (const batch of batches) {
    await airtableFetch(CONFIG.LISTINGS_TABLE, {
      method: 'POST',
      body: JSON.stringify({
        records: batch.map(listing => ({
          fields: {
            MLS_Number: listing.mlsNumber,
            Price: listing.price,
            Address: listing.address,
            Type: listing.type,
            First_Seen: today,
            Last_Seen: today,
            Status: 'active'
          }
        }))
      })
    });
    await delay(200); // Rate limiting
  }
}

// Batch update listings (up to 10 at a time)
async function batchUpdateListings(updates) {
  const batches = [];
  for (let i = 0; i < updates.length; i += 10) {
    batches.push(updates.slice(i, i + 10));
  }

  for (const batch of batches) {
    await airtableFetch(CONFIG.LISTINGS_TABLE, {
      method: 'PATCH',
      body: JSON.stringify({
        records: batch.map(update => ({
          id: update.id,
          fields: update.fields
        }))
      })
    });
    await delay(200); // Rate limiting
  }
}

// Update daily stats
async function updateDailyStats(newCount, soldCount, totalActive) {
  const today = new Date().toISOString().split('T')[0];

  // Check if today's record exists
  const params = new URLSearchParams({
    filterByFormula: `{Date}='${today}'`
  });

  const existing = await airtableFetch(`${CONFIG.STATS_TABLE}?${params.toString()}`);

  if (existing.records.length > 0) {
    // Update existing record
    await airtableFetch(CONFIG.STATS_TABLE, {
      method: 'PATCH',
      body: JSON.stringify({
        records: [{
          id: existing.records[0].id,
          fields: {
            New_Listings: newCount,
            Sold_Count: soldCount,
            Total_Active: totalActive
          }
        }]
      })
    });
  } else {
    // Create new record
    await airtableFetch(CONFIG.STATS_TABLE, {
      method: 'POST',
      body: JSON.stringify({
        records: [{
          fields: {
            Date: today,
            New_Listings: newCount,
            Sold_Count: soldCount,
            Total_Active: totalActive
          }
        }]
      })
    });
  }
}

// Main function to fetch and update listings
async function fetchAndUpdateListings() {
  try {
    await loadConfig();

    if (!CONFIG.AIRTABLE_API_KEY || !CONFIG.AIRTABLE_BASE_ID) {
      return { success: false, error: 'Airtable not configured' };
    }

    console.log('Fetching listings from realtor.ca...');
    const currentListings = await fetchAllListings();
    console.log(`Found ${currentListings.length} listings on realtor.ca`);

    console.log('Fetching existing listings from Airtable...');
    const existingListings = await getExistingListings();
    console.log(`Found ${existingListings.size} listings in Airtable`);

    const today = new Date().toISOString().split('T')[0];
    const currentMlsNumbers = new Set(currentListings.map(l => l.mlsNumber));

    // Find new listings
    const newListings = currentListings.filter(l => !existingListings.has(l.mlsNumber));
    console.log(`Found ${newListings.length} new listings`);

    // Find listings to update (still active)
    const toUpdate = [];
    currentListings.forEach(listing => {
      if (existingListings.has(listing.mlsNumber)) {
        const existing = existingListings.get(listing.mlsNumber);
        if (existing.Status === 'active') {
          toUpdate.push({
            id: existing.id,
            fields: { Last_Seen: today }
          });
        } else {
          // Relisted
          toUpdate.push({
            id: existing.id,
            fields: { Last_Seen: today, Status: 'active' }
          });
        }
      }
    });

    // Find sold/delisted listings
    const soldListings = [];
    existingListings.forEach((listing, mlsNumber) => {
      if (listing.Status === 'active' && !currentMlsNumbers.has(mlsNumber)) {
        soldListings.push({
          id: listing.id,
          fields: { Status: 'sold' }
        });
      }
    });
    console.log(`Found ${soldListings.length} sold/delisted listings`);

    // Apply updates to Airtable
    if (newListings.length > 0) {
      console.log('Creating new listings in Airtable...');
      await batchCreateListings(newListings);
    }

    if (toUpdate.length > 0) {
      console.log('Updating existing listings in Airtable...');
      await batchUpdateListings(toUpdate);
    }

    if (soldListings.length > 0) {
      console.log('Marking sold listings in Airtable...');
      await batchUpdateListings(soldListings);
    }

    // Update daily stats
    const totalActive = currentListings.length;
    await updateDailyStats(newListings.length, soldListings.length, totalActive);

    // Store last update time
    chrome.storage.local.set({ lastUpdate: new Date().toISOString() });

    return {
      success: true,
      newListings: newListings.length,
      soldListings: soldListings.length,
      totalActive: totalActive
    };
  } catch (error) {
    console.error('Error updating listings:', error);
    return { success: false, error: error.message };
  }
}

// Get statistics for display
async function getStats() {
  try {
    await loadConfig();

    if (!CONFIG.AIRTABLE_API_KEY || !CONFIG.AIRTABLE_BASE_ID) {
      return { error: 'Airtable not configured' };
    }

    const existingListings = await getExistingListings();

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sevenWeeksAgo = new Date(now - 49 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let newToday = 0;
    let newLast7Days = 0;
    let newLast7Weeks = 0;
    let soldToday = 0;
    let totalActive = 0;

    existingListings.forEach(listing => {
      const firstSeen = listing.First_Seen;
      const lastSeen = listing.Last_Seen;

      if (listing.Status === 'active') {
        totalActive++;
      }

      if (firstSeen === today) {
        newToday++;
      }

      if (firstSeen >= sevenDaysAgo) {
        newLast7Days++;
      }

      if (firstSeen >= sevenWeeksAgo) {
        newLast7Weeks++;
      }

      // Sold today: status is sold and last_seen is today or yesterday
      if (listing.Status === 'sold' && lastSeen === today) {
        soldToday++;
      }
    });

    // Get last update time
    const storage = await chrome.storage.local.get(['lastUpdate']);

    return {
      newToday,
      newLast7Days,
      newLast7Weeks,
      soldToday,
      totalActive,
      lastUpdate: storage.lastUpdate || null
    };
  } catch (error) {
    console.error('Error getting stats:', error);
    return { error: error.message };
  }
}

// Utility function for delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
