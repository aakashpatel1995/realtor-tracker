#!/usr/bin/env node
/**
 * Realtor.ca Listing Tracker - Local Sync Script
 *
 * Usage: node sync-script.js
 *
 * Set your Google Apps Script URL below or via environment variable:
 * SCRIPT_URL=https://script.google.com/... node sync-script.js
 */

const SCRIPT_URL = process.env.SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxqo5y9joe8rr5_cnsZzwHRLNvwItYzJF3pUyL6qhmrTk0V_DRk1xLH1agtP7Z31fg/exec';

const GTA_BOUNDS = {
  longitudeMin: -80.0,
  longitudeMax: -78.9,
  latitudeMin: 43.4,
  latitudeMax: 44.0
};

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

  const response = await fetch('https://api2.realtor.ca/Listing.svc/PropertySearch_Post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://www.realtor.ca',
      'Referer': 'https://www.realtor.ca/'
    },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.Results || [];
}

async function fetchAllListings() {
  const allListings = [];

  for (const type of ['sale', 'rent']) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) {
      console.log(`Fetching ${type} page ${page}...`);
      try {
        const results = await fetchRealtorListings(type, page);
        if (results.length === 0) {
          hasMore = false;
        } else {
          results.forEach(listing => {
            allListings.push({
              mlsNumber: listing.MlsNumber,
              price: listing.Property?.Price ? parseInt(listing.Property.Price.replace(/[^0-9]/g, '')) : 0,
              address: listing.Property?.Address?.AddressText || '',
              type: type
            });
          });
          page++;
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) {
        console.error(`Error fetching ${type} page ${page}:`, e.message);
        hasMore = false;
      }
    }
  }

  console.log(`Total: ${allListings.length} listings`);
  return allListings;
}

async function syncToSheets(listings) {
  const batchSize = 20;
  let totalNew = 0, totalSold = 0;

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    const isLastBatch = (i + batchSize) >= listings.length;
    console.log(`Syncing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(listings.length/batchSize)}...`);

    const data = encodeURIComponent(JSON.stringify({
      listings: batch,
      isLastBatch: isLastBatch,
      totalListings: listings.length
    }));

    const response = await fetch(`${SCRIPT_URL}?action=syncBatch&data=${data}`);
    const text = await response.text();

    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.error('Invalid response:', text.substring(0, 200));
      throw new Error('Invalid response from Google Sheets');
    }

    if (result.error) throw new Error(result.error);
    totalNew += result.newListings || 0;
    totalSold += result.soldListings || 0;

    await new Promise(r => setTimeout(r, 800));
  }

  return { newListings: totalNew, soldListings: totalSold, totalActive: listings.length };
}

async function main() {
  console.log('=== Realtor.ca Listing Tracker ===\n');

  if (!SCRIPT_URL) {
    console.error('Error: SCRIPT_URL not set');
    console.error('Set it in the script or via: SCRIPT_URL=... node sync-script.js');
    process.exit(1);
  }

  try {
    console.log('Fetching listings from realtor.ca...\n');
    const listings = await fetchAllListings();

    if (listings.length === 0) {
      console.error('\nNo listings found. The API may be blocking requests.');
      process.exit(1);
    }

    console.log('\nSyncing to Google Sheets...\n');
    const result = await syncToSheets(listings);

    console.log('\n=== Sync Complete ===');
    console.log(`New listings: ${result.newListings}`);
    console.log(`Sold/delisted: ${result.soldListings}`);
    console.log(`Total active: ${result.totalActive}`);

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();
