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
          results.forEach(listing => {
            const building = listing.Building || {};
            const property = listing.Property || {};
            const land = listing.Land || {};

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
              url: `https://www.realtor.ca${listing.RelativeDetailsURL || ''}`
            });
          });
          page++;
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) {
        console.error(`[RealtorTracker] Error fetching ${type} page ${page}:`, e);
        hasMore = false;
      }
    }
  }

  console.log(`[RealtorTracker] Total: ${allListings.length} listings`);
  return allListings;
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
