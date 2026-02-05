// Content script - fetches listings from within realtor.ca context
console.log('[RealtorTracker] Content script loaded on realtor.ca');

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
      'Accept': 'application/json'
    },
    body: params.toString(),
    credentials: 'include'
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.Results || [];
}

async function fetchAllListings() {
  const allListings = [];

  for (let type of ['sale', 'rent']) {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) {
      console.log(`[RealtorTracker] Fetching ${type} page ${page}...`);
      try {
        const results = await fetchRealtorListings(type, page);
        if (results.length === 0) {
          hasMore = false;
        } else {
          // DEBUG: Log the first listing to check available fields
          if (page === 1 && type === 'sale' && !window.hasLoggedListing) {
            console.log('[RealtorTracker] === FIRST LISTING FULL STRUCTURE ===');
            console.log(JSON.stringify(results[0], null, 2));
            console.log('[RealtorTracker] === DATE FIELDS CHECK ===');
            console.log('InsertedDateUTC:', results[0].InsertedDateUTC);
            console.log('TimeOnRealtor:', results[0].TimeOnRealtor);
            console.log('Property.TimeOnRealtor:', results[0].Property?.TimeOnRealtor);
            console.log('Property.OwnershipType:', results[0].Property?.OwnershipType);
            console.log('PostalCode:', results[0].PostalCode);
            // Log all top-level keys to find date fields
            console.log('[RealtorTracker] All top-level keys:', Object.keys(results[0]));
            // Test date parsing
            const testDate = parseRealtorDate(results[0].InsertedDateUTC);
            console.log('[RealtorTracker] Parsed InsertedDateUTC:', results[0].InsertedDateUTC, '→', testDate);
            window.hasLoggedListing = true;
          }

          results.forEach(listing => {
            const building = listing.Building || {};
            const property = listing.Property || {};
            const land = listing.Land || {};

            // Get listing date from InsertedDateUTC (.NET ticks format)
            const rawDate = listing.InsertedDateUTC || '';
            const postedDate = parseRealtorDate(rawDate);

            allListings.push({
              mlsNumber: listing.MlsNumber,
              price: property.Price ? parseInt(property.Price.replace(/[^0-9]/g, '')) : 0,
              address: property.Address?.AddressText || '',
              type: type,
              bedrooms: building.Bedrooms || '',
              bathrooms: building.BathroomTotal || '',
              parking: property.ParkingSpaceTotal || '',
              sqft: building.SizeInterior || '',
              lotSize: land.SizeTotal || '',
              propertyType: property.Type || '',
              url: `https://www.realtor.ca${listing.RelativeDetailsURL || ''}`,
              postedDate: postedDate
            });
          });
          page++;
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) {
        console.error(`[RealtorTracker] Error fetching ${type} page ${page}:`, e);
        if (page === 1) throw e; // Propagate error on first page to trigger retry logic
        hasMore = false;
      }
    }
  }

  console.log(`[RealtorTracker] Total: ${allListings.length} listings`);
  return allListings;
}

function parseRealtorDate(dateStr) {
  if (!dateStr) return '';

  // Handle .NET ticks format (large number like 638424016691530000)
  // .NET ticks are 100-nanosecond intervals since January 1, 0001
  // Convert to JavaScript timestamp (milliseconds since January 1, 1970)
  if (/^\d{17,}$/.test(String(dateStr))) {
    const ticks = BigInt(dateStr);
    const ticksToUnixEpoch = BigInt('621355968000000000'); // Ticks from year 1 to 1970
    const ticksSinceUnix = ticks - ticksToUnixEpoch;
    const milliseconds = Number(ticksSinceUnix / BigInt(10000));
    const date = new Date(milliseconds);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }

  // Handle /Date(1234567890)/ or /Date(1234567890-0400)/ format
  const match = String(dateStr).match(/\/Date\((-?\d+)/);
  if (match) {
    return new Date(parseInt(match[1])).toISOString().split('T')[0];
  }

  return '';
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchListings') {
    console.log('[RealtorTracker] Received fetch request from background');
    fetchAllListings()
      .then(listings => {
        console.log(`[RealtorTracker] Sending ${listings.length} listings to background`);
        sendResponse({ success: true, listings });
      })
      .catch(error => {
        console.error('[RealtorTracker] Fetch error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

// Notify background script that content script is ready
chrome.runtime.sendMessage({ action: 'contentScriptReady' });
