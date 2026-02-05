#!/usr/bin/env node
/**
 * Realtor.ca Listing Tracker - Puppeteer Sync Script
 * Intercepts API responses from the actual website
 */

const puppeteer = require('puppeteer');

const SCRIPT_URL = process.env.SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxqo5y9joe8rr5_cnsZzwHRLNvwItYzJF3pUyL6qhmrTk0V_DRk1xLH1agtP7Z31fg/exec';

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
  const allListings = [];
  let capturedResponses = 0;

  try {
    console.log('Launching browser (visible for debugging)...');
    browser = await puppeteer.launch({
      headless: false,  // Show browser for debugging
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1280,800']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Intercept API responses
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('PropertySearch_Post')) {
        try {
          const json = await response.json();
          if (json.Results && json.Results.length > 0) {
            capturedResponses++;
            console.log(`  Captured ${json.Results.length} listings from API response #${capturedResponses}`);
            json.Results.forEach(listing => {
              allListings.push({
                mlsNumber: listing.MlsNumber,
                price: listing.Property?.Price ? parseInt(listing.Property.Price.replace(/[^0-9]/g, '')) : 0,
                address: listing.Property?.Address?.AddressText || '',
                type: url.includes('TransactionTypeId=3') ? 'rent' : 'sale'
              });
            });
          }
        } catch (e) {
          // Not JSON or error parsing
        }
      }
    });

    console.log('Loading realtor.ca search page (For Sale)...');
    await page.goto('https://www.realtor.ca/map#ZoomLevel=9&Center=43.717899%2C-79.518890&LatitudeMax=44.00248&LongitudeMax=-78.90564&LatitudeMin=43.43139&LongitudeMin=-80.13214&view=list&Sort=6-D&PropertyTypeGroupID=1&TransactionTypeId=2&PropertySearchTypeId=1&Currency=CAD', {
      waitUntil: 'networkidle2',
      timeout: 90000
    });

    console.log('Waiting for listings to load...');
    await new Promise(r => setTimeout(r, 8000));

    // Take screenshot for debugging
    await page.screenshot({ path: '/tmp/realtor-debug.png' });
    console.log('Screenshot saved to /tmp/realtor-debug.png');

    // Scroll to load more
    console.log('Scrolling to load more...');
    for (let i = 0; i < 3; i++) {
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } catch (e) {
        console.log('  Scroll error, continuing...');
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log('\nLoading rental listings...');
    await page.goto('https://www.realtor.ca/map#ZoomLevel=9&Center=43.717899%2C-79.518890&LatitudeMax=44.00248&LongitudeMax=-78.90564&LatitudeMin=43.43139&LongitudeMin=-80.13214&view=list&Sort=6-D&PropertyTypeGroupID=1&TransactionTypeId=3&PropertySearchTypeId=1&Currency=CAD', {
      waitUntil: 'networkidle2',
      timeout: 90000
    });

    await new Promise(r => setTimeout(r, 8000));

    // Scroll to load more rentals
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 3000));
    }

    await browser.close();
    browser = null;

    // Deduplicate by MLS number
    const uniqueListings = [...new Map(allListings.map(l => [l.mlsNumber, l])).values()];
    console.log(`\nTotal unique listings captured: ${uniqueListings.length}`);

    if (uniqueListings.length === 0) {
      console.error('No listings captured. The site may be blocking automated access.');
      process.exit(1);
    }

    console.log('\nSyncing to Google Sheets...\n');
    const result = await syncToSheets(uniqueListings);

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
