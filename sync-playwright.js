#!/usr/bin/env node
/**
 * Realtor.ca Listing Tracker - Playwright Sync Script
 */

const { chromium } = require('playwright');

const SCRIPT_URL = process.env.SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxqo5y9joe8rr5_cnsZzwHRLNvwItYzJF3pUyL6qhmrTk0V_DRk1xLH1agtP7Z31fg/exec';

const GTA_BOUNDS = {
  longitudeMin: -80.0,
  longitudeMax: -78.9,
  latitudeMin: 43.4,
  latitudeMax: 44.0
};

async function fetchListingsFromPage(page, transactionType, pageNum) {
  const transactionTypeId = transactionType === 'sale' ? 2 : 3;

  return await page.evaluate(async ({ bounds, typeId, pageNum }) => {
    const params = new URLSearchParams({
      CultureId: '1',
      ApplicationId: '1',
      RecordsPerPage: '200',
      MaximumResults: '200',
      PropertySearchTypeId: '1',
      TransactionTypeId: typeId.toString(),
      LongitudeMin: bounds.longitudeMin.toString(),
      LongitudeMax: bounds.longitudeMax.toString(),
      LatitudeMin: bounds.latitudeMin.toString(),
      LatitudeMax: bounds.latitudeMax.toString(),
      CurrentPage: pageNum.toString()
    });

    try {
      const response = await fetch('https://api2.realtor.ca/Listing.svc/PropertySearch_Post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        credentials: 'include'
      });

      if (!response.ok) {
        const text = await response.text();
        return { error: `HTTP ${response.status}: ${text.substring(0, 100)}` };
      }

      const data = await response.json();
      return { results: data.Results || [] };
    } catch (e) {
      return { error: `${e.name}: ${e.message}` };
    }
  }, { bounds: GTA_BOUNDS, typeId: transactionTypeId, pageNum });
}

async function fetchAllListings(page) {
  const allListings = [];

  for (const type of ['sale', 'rent']) {
    let pageNum = 1;
    let hasMore = true;

    while (hasMore && pageNum <= 5) {
      console.log(`Fetching ${type} page ${pageNum}...`);

      const result = await fetchListingsFromPage(page, type, pageNum);

      if (result.error) {
        console.error(`Error: ${result.error}`);
        hasMore = false;
      } else if (result.results.length === 0) {
        hasMore = false;
      } else {
        result.results.forEach(listing => {
          allListings.push({
            mlsNumber: listing.MlsNumber,
            price: listing.Property?.Price ? parseInt(listing.Property.Price.replace(/[^0-9]/g, '')) : 0,
            address: listing.Property?.Address?.AddressText || '',
            type: type
          });
        });
        pageNum++;
        await new Promise(r => setTimeout(r, 1000));
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

  let browser;
  try {
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: false,  // Visible browser to pass any challenges
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    console.log('Visiting realtor.ca...');
    await page.goto('https://www.realtor.ca/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for page to fully load and pass any Incapsula challenge
    console.log('Waiting for page to stabilize...');
    await page.waitForTimeout(5000);

    // Check page status
    const title = await page.title();
    const url = page.url();
    console.log(`URL: ${url}`);
    console.log(`Page title: ${title}`);

    // Take screenshot for debugging
    await page.screenshot({ path: '/tmp/realtor-debug.png' });
    console.log('Screenshot saved to /tmp/realtor-debug.png');

    // If title is empty, we might be on a challenge page - wait more
    if (!title) {
      console.log('Waiting longer for challenge to complete...');
      await page.waitForTimeout(10000);
      const newTitle = await page.title();
      console.log(`New title: ${newTitle}`);
    }

    console.log('Fetching listings...\n');
    const listings = await fetchAllListings(page);

    await browser.close();
    browser = null;

    if (listings.length === 0) {
      console.error('\nNo listings found.');
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
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
