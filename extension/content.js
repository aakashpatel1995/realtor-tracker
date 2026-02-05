// Content script - fetches listings from within realtor.ca context
console.log('[RealtorTracker] Content script loaded on realtor.ca');

// Configuration for fetching
const FETCH_CONFIG = {
  MAX_PAGES_PER_CITY: 25,    // Max pages per city (25 * 200 = 5,000 per city)
  RECORDS_PER_PAGE: 200,
  DELAY_BETWEEN_PAGES: 2000,  // 2 sec delay between pages
};

// Complete list of Ontario cities/regions to scrape
const ONTARIO_CITIES = [
  // Waterloo Region
  'Cambridge, ON',
  'Kitchener, ON',
  'Waterloo, ON',

  // Wellington County
  'Guelph, ON',
  'Fergus, ON',
  'Elora, ON',

  // Hamilton & Niagara
  'Hamilton, ON',
  'Burlington, ON',
  'St. Catharines, ON',
  'Niagara Falls, ON',
  'Niagara-on-the-Lake, ON',
  'Welland, ON',
  'Fort Erie, ON',
  'Grimsby, ON',
  'Lincoln, ON',

  // Halton Region
  'Oakville, ON',
  'Milton, ON',
  'Halton Hills, ON',
  'Georgetown, ON',

  // Peel Region
  'Mississauga, ON',
  'Brampton, ON',
  'Caledon, ON',

  // Toronto
  'Toronto, ON',
  'North York, ON',
  'Scarborough, ON',
  'Etobicoke, ON',
  'East York, ON',

  // York Region
  'Markham, ON',
  'Vaughan, ON',
  'Richmond Hill, ON',
  'Newmarket, ON',
  'Aurora, ON',
  'King City, ON',
  'Stouffville, ON',
  'Georgina, ON',

  // Durham Region
  'Oshawa, ON',
  'Whitby, ON',
  'Ajax, ON',
  'Pickering, ON',
  'Clarington, ON',
  'Bowmanville, ON',
  'Uxbridge, ON',
  'Port Perry, ON',

  // Simcoe County
  'Barrie, ON',
  'Orillia, ON',
  'Collingwood, ON',
  'Wasaga Beach, ON',
  'Innisfil, ON',
  'Bradford, ON',
  'Alliston, ON',
  'Midland, ON',

  // Southwestern Ontario
  'London, ON',
  'Windsor, ON',
  'Sarnia, ON',
  'Chatham, ON',
  'St. Thomas, ON',
  'Woodstock, ON',
  'Stratford, ON',
  'Brantford, ON',
  'Tillsonburg, ON',
  'Ingersoll, ON',

  // Eastern Ontario
  'Ottawa, ON',
  'Kingston, ON',
  'Belleville, ON',
  'Peterborough, ON',
  'Cobourg, ON',
  'Port Hope, ON',
  'Trenton, ON',
  'Cornwall, ON',
  'Brockville, ON',
  'Smiths Falls, ON',
  'Carleton Place, ON',

  // Muskoka & Cottage Country
  'Muskoka, ON',
  'Huntsville, ON',
  'Bracebridge, ON',
  'Gravenhurst, ON',
  'Parry Sound, ON',

  // Northern Ontario
  'Sudbury, ON',
  'Thunder Bay, ON',
  'Sault Ste. Marie, ON',
  'North Bay, ON',
  'Timmins, ON',
  'Kenora, ON',

  // Other
  'Owen Sound, ON',
  'Orangeville, ON',
  'Shelburne, ON',
  'Tobermory, ON',
  'Kawartha Lakes, ON',
  'Prince Edward County, ON',
];

async function fetchRealtorListings(transactionType = 'sale', page = 1, cityName = null, retryAttempt = 0) {
  const transactionTypeId = transactionType === 'sale' ? 2 : 3;
  const params = new URLSearchParams({
    CultureId: '1',
    ApplicationId: '1',
    Version: '7.0',
    RecordsPerPage: FETCH_CONFIG.RECORDS_PER_PAGE.toString(),
    PropertySearchTypeId: '0',
    PropertyTypeGroupID: '1',
    TransactionTypeId: transactionTypeId.toString(),
    CurrentPage: page.toString(),
    Sort: '6-D',
    Currency: 'CAD',
    IncludeHiddenListings: 'false'
  });

  // Add city-based search
  if (cityName) {
    params.append('LocationSearchString', cityName);
  }

  try {
    const response = await fetch('https://api2.realtor.ca/Listing.svc/PropertySearch_Post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': '*/*',
        'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8'
      },
      body: params.toString(),
      credentials: 'include',
      mode: 'cors',
      referrer: 'https://www.realtor.ca/',
      referrerPolicy: 'strict-origin-when-cross-origin'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return {
      results: data.Results || [],
      totalRecords: data.Paging?.TotalRecords || 0,
      totalPages: data.Paging?.TotalPages || 0
    };
  } catch (error) {
    console.error(`[RealtorTracker] Fetch error details:`, error.name, error.message, error);
    // Retry up to 2 times with delay
    if (retryAttempt < 2) {
      console.log(`[RealtorTracker] Fetch failed, retrying in 3s (attempt ${retryAttempt + 1}/2)...`);
      await new Promise(r => setTimeout(r, 3000));
      return fetchRealtorListings(transactionType, page, cityName, retryAttempt + 1);
    }
    throw error;
  }
}

// Send progress update to background script
function sendProgress(city, count, page, type, newInPage = 0, totalPages = 0) {
  try {
    chrome.runtime.sendMessage({
      action: 'cityFetchProgress',
      city: city,
      count: count,
      page: page,
      type: type,
      newInPage: newInPage,
      totalPages: totalPages
    });
  } catch (e) {
    // Background might not be listening
  }
}

// Fetch listings for a single city
async function fetchCityListings(city) {
  const listings = [];
  const seenMls = new Set();

  console.log(`\n[RealtorTracker] ========== Fetching: ${city} ==========`);
  sendProgress(city, 0, 0, 'starting');

  for (let type of ['sale', 'rent']) {
    console.log(`[RealtorTracker] ${city} - ${type.toUpperCase()}...`);
    let page = 1;
    let hasMore = true;
    let retryCount = 0;
    const maxRetries = 3;
    let typeCount = 0;

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

            listings.push({
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
            typeCount++;
            newInPage++;
          });

          // Send progress update after each page
          sendProgress(city, listings.length, page, type, newInPage, totalPages);

          console.log(`[RealtorTracker] ${city} ${type} page ${page}: +${newInPage} (total: ${listings.length})`);
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
          console.log(`[RealtorTracker] Max retries, stopping ${type}`);
          hasMore = false;
        }
      }
    }
  }

  console.log(`[RealtorTracker] ${city} COMPLETE: ${listings.length} listings`);
  sendProgress(city, listings.length, 0, 'complete');
  return listings;
}

// Get the list of all cities
function getOntarioCities() {
  return ONTARIO_CITIES;
}

// Legacy function for backward compatibility
async function fetchAllListings() {
  // If no specific city requested, fetch first city only
  return await fetchCityListings(ONTARIO_CITIES[0]);
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
    // Legacy: fetch first city
    console.log('[RealtorTracker] Received fetch request (legacy)');
    fetchAllListings()
      .then(listings => {
        console.log(`[RealtorTracker] Sending ${listings.length} listings to background`);
        sendResponse({ success: true, listings });
      })
      .catch(error => {
        console.error('[RealtorTracker] Fetch error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'fetchCity') {
    // Fetch specific city
    const city = request.city;
    console.log(`[RealtorTracker] Received fetch request for: ${city}`);
    fetchCityListings(city)
      .then(listings => {
        console.log(`[RealtorTracker] ${city}: Sending ${listings.length} listings`);
        sendResponse({ success: true, listings, city });
      })
      .catch(error => {
        console.error(`[RealtorTracker] ${city} fetch error:`, error);
        sendResponse({ success: false, error: error.message, city });
      });
    return true;
  }

  if (request.action === 'getCities') {
    // Return list of all cities
    sendResponse({ cities: getOntarioCities() });
    return false;
  }
});

// Notify background script that content script is ready
chrome.runtime.sendMessage({ action: 'contentScriptReady' });
