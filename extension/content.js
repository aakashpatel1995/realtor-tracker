// Content script - fetches listings from within realtor.ca context
console.log('[RealtorTracker] Content script loaded on realtor.ca');

// Configuration for fetching
const FETCH_CONFIG = {
  MAX_PAGES_PER_CITY: 25,    // Max pages per city (25 * 200 = 5,000 per city)
  RECORDS_PER_PAGE: 200,
  DELAY_BETWEEN_PAGES: 2000,  // 2 sec delay between pages
  DELAY_BETWEEN_CITIES: 5000  // 5 sec delay between cities
};

// Ontario cities to scrape - add more cities here gradually
const ONTARIO_CITIES = [
  // Start with Cambridge as requested
  'Cambridge, ON',

  // Add more cities over time:
  // 'Kitchener, ON',
  // 'Waterloo, ON',
  // 'Guelph, ON',
  // 'Hamilton, ON',
  // 'Burlington, ON',
  // 'Oakville, ON',
  // 'Mississauga, ON',
  // 'Brampton, ON',
  // 'Toronto, ON',
  // 'Markham, ON',
  // 'Vaughan, ON',
  // 'Richmond Hill, ON',
  // 'Newmarket, ON',
  // 'Aurora, ON',
  // 'Whitby, ON',
  // 'Oshawa, ON',
  // 'Ajax, ON',
  // 'Pickering, ON',
  // 'Scarborough, ON',
  // 'North York, ON',
  // 'Etobicoke, ON',
  // 'London, ON',
  // 'Windsor, ON',
  // 'Ottawa, ON',
  // 'Barrie, ON',
  // 'St. Catharines, ON',
  // 'Niagara Falls, ON',
  // 'Kingston, ON',
  // 'Sudbury, ON',
  // 'Thunder Bay, ON',
];

async function fetchRealtorListings(transactionType = 'sale', page = 1, cityName = null) {
  const transactionTypeId = transactionType === 'sale' ? 2 : 3;
  const params = new URLSearchParams({
    CultureId: '1',
    ApplicationId: '1',
    RecordsPerPage: FETCH_CONFIG.RECORDS_PER_PAGE.toString(),
    PropertySearchTypeId: '1',
    TransactionTypeId: transactionTypeId.toString(),
    CurrentPage: page.toString(),
    Sort: '6-D'  // Sort by date descending (newest first)
  });

  // Add city-based search
  if (cityName) {
    params.append('LocationSearchString', cityName);
  }

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
  return {
    results: data.Results || [],
    totalRecords: data.Paging?.TotalRecords || 0,
    totalPages: data.Paging?.TotalPages || 0
  };
}

async function fetchAllListings() {
  const allListings = [];
  const seenMls = new Set();

  console.log(`[RealtorTracker] === Starting city-by-city fetch ===`);
  console.log(`[RealtorTracker] Cities to scrape: ${ONTARIO_CITIES.join(', ')}`);

  for (const city of ONTARIO_CITIES) {
    console.log(`\n[RealtorTracker] ========== ${city} ==========`);

    for (let type of ['sale', 'rent']) {
      console.log(`[RealtorTracker] Fetching ${city} - ${type.toUpperCase()}...`);
      let page = 1;
      let hasMore = true;
      let retryCount = 0;
      const maxRetries = 3;
      let cityListingsCount = 0;

      while (hasMore && page <= FETCH_CONFIG.MAX_PAGES_PER_CITY) {
        try {
          const { results, totalRecords, totalPages } = await fetchRealtorListings(type, page, city);

          if (page === 1) {
            console.log(`[RealtorTracker] ${city} ${type}: ${totalRecords} total, ${totalPages} pages`);
          }

          if (results.length === 0) {
            hasMore = false;
          } else {
            retryCount = 0;

            let newInPage = 0;
            results.forEach(listing => {
              if (seenMls.has(listing.MlsNumber)) return;
              seenMls.add(listing.MlsNumber);

              const building = listing.Building || {};
              const property = listing.Property || {};
              const land = listing.Land || {};

              const rawDate = listing.InsertedDateUTC || '';
              const postedDate = parseRealtorDate(rawDate);

              const fullAddress = property.Address?.AddressText || '';
              const parsed = parseAddress(fullAddress);

              allListings.push({
                mlsNumber: listing.MlsNumber,
                price: property.Price ? parseInt(property.Price.replace(/[^0-9]/g, '')) : 0,
                address: fullAddress,
                streetAddress: parsed.street,
                city: parsed.city,
                province: parsed.province,
                postalCode: listing.PostalCode || parsed.postalCode,
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
              newInPage++;
            });

            cityListingsCount += newInPage;
            console.log(`[RealtorTracker] ${city} ${type} page ${page}: +${newInPage} new (city total: ${cityListingsCount}, overall: ${allListings.length})`);
            page++;
            await new Promise(r => setTimeout(r, FETCH_CONFIG.DELAY_BETWEEN_PAGES));
          }
        } catch (e) {
          console.error(`[RealtorTracker] Error ${city} ${type} page ${page}:`, e.message);
          retryCount++;

          if (retryCount <= maxRetries) {
            console.log(`[RealtorTracker] Retry ${retryCount}/${maxRetries} in 5 seconds...`);
            await new Promise(r => setTimeout(r, 5000));
          } else {
            console.log(`[RealtorTracker] Max retries, skipping rest of ${city} ${type}`);
            hasMore = false;
          }
        }
      }

      console.log(`[RealtorTracker] ${city} ${type} complete: ${cityListingsCount} listings`);
    }

    // Delay between cities
    console.log(`[RealtorTracker] Waiting before next city...`);
    await new Promise(r => setTimeout(r, FETCH_CONFIG.DELAY_BETWEEN_CITIES));
  }

  console.log(`\n[RealtorTracker] ========== COMPLETE ==========`);
  console.log(`[RealtorTracker] Total unique listings: ${allListings.length}`);
  return allListings;
}

// Parse address like "408 FAIRALL STREET|Ajax (South West), Ontario L1S1R6"
function parseAddress(addressText) {
  const result = {
    street: '',
    city: '',
    province: '',
    postalCode: ''
  };

  if (!addressText) return result;

  // Split by pipe to get street and rest
  const parts = addressText.split('|');
  result.street = parts[0]?.trim() || '';

  if (parts.length > 1) {
    const locationPart = parts[1].trim();

    // Extract postal code (Canadian format: A1A 1A1 or A1A1A1)
    const postalMatch = locationPart.match(/([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i);
    if (postalMatch) {
      result.postalCode = postalMatch[1].replace(/\s/g, '').toUpperCase();
    }

    // Remove postal code from location part for further parsing
    const locationWithoutPostal = locationPart.replace(/[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, '').trim();

    // Match pattern: City (Area), Province
    // or: City, Province
    const cityProvinceMatch = locationWithoutPostal.match(/^([^,]+),\s*(\w+)\s*$/);
    if (cityProvinceMatch) {
      // Extract city name (remove area in parentheses for cleaner filtering)
      let cityFull = cityProvinceMatch[1].trim();
      // Remove area descriptor like "(South West)" for cleaner city name
      const cityClean = cityFull.replace(/\s*\([^)]+\)\s*$/, '').trim();
      result.city = cityClean;
      result.province = cityProvinceMatch[2].trim();
    }
  }

  return result;
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
