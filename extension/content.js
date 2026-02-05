// Content script - fetches listings from within realtor.ca context
console.log('[RealtorTracker] Content script loaded on realtor.ca');

const GTA_BOUNDS = {
  longitudeMin: -80.0,
  longitudeMax: -78.9,
  latitudeMin: 43.4,
  latitudeMax: 44.0
};

// Configuration for fetching
const FETCH_CONFIG = {
  MAX_PAGES_PER_TYPE: 100,  // Max pages per transaction type (100 * 200 = 20,000 per type)
  RECORDS_PER_PAGE: 200,
  DELAY_BETWEEN_PAGES: 800,  // ms delay to avoid rate limiting
  DELAY_BETWEEN_AREAS: 2000  // ms delay between geographic areas
};

async function fetchRealtorListings(transactionType = 'sale', page = 1, bounds = GTA_BOUNDS) {
  const transactionTypeId = transactionType === 'sale' ? 2 : 3;
  const params = new URLSearchParams({
    CultureId: '1',
    ApplicationId: '1',
    RecordsPerPage: FETCH_CONFIG.RECORDS_PER_PAGE.toString(),
    PropertySearchTypeId: '1',
    TransactionTypeId: transactionTypeId.toString(),
    LongitudeMin: bounds.longitudeMin.toString(),
    LongitudeMax: bounds.longitudeMax.toString(),
    LatitudeMin: bounds.latitudeMin.toString(),
    LatitudeMax: bounds.latitudeMax.toString(),
    CurrentPage: page.toString(),
    Sort: '6-D'  // Sort by date descending (newest first)
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
  return {
    results: data.Results || [],
    totalRecords: data.Paging?.TotalRecords || 0,
    totalPages: data.Paging?.TotalPages || 0
  };
}

async function fetchAllListings() {
  const allListings = [];
  const seenMls = new Set();  // Avoid duplicates

  // Geographic chunks to cover more area (split GTA into smaller regions)
  const geoChunks = [
    // Toronto core
    { longitudeMin: -79.5, longitudeMax: -79.2, latitudeMin: 43.6, latitudeMax: 43.75, name: 'Toronto Core' },
    // Toronto East
    { longitudeMin: -79.2, longitudeMax: -79.0, latitudeMin: 43.6, latitudeMax: 43.8, name: 'Toronto East' },
    // Toronto West
    { longitudeMin: -79.7, longitudeMax: -79.5, latitudeMin: 43.6, latitudeMax: 43.75, name: 'Toronto West' },
    // North York / Scarborough
    { longitudeMin: -79.5, longitudeMax: -79.1, latitudeMin: 43.75, latitudeMax: 43.85, name: 'North York' },
    // Mississauga / Brampton
    { longitudeMin: -79.9, longitudeMax: -79.5, latitudeMin: 43.5, latitudeMax: 43.75, name: 'Mississauga/Brampton' },
    // Markham / Richmond Hill
    { longitudeMin: -79.5, longitudeMax: -79.2, latitudeMin: 43.85, latitudeMax: 44.0, name: 'Markham/Richmond Hill' },
    // Vaughan
    { longitudeMin: -79.7, longitudeMax: -79.4, latitudeMin: 43.75, latitudeMax: 43.95, name: 'Vaughan' },
    // Pickering / Ajax / Whitby
    { longitudeMin: -79.1, longitudeMax: -78.8, latitudeMin: 43.8, latitudeMax: 44.0, name: 'Durham' },
    // Oakville / Burlington
    { longitudeMin: -79.9, longitudeMax: -79.6, latitudeMin: 43.35, latitudeMax: 43.5, name: 'Oakville/Burlington' },
    // Full GTA fallback (catches anything missed)
    { ...GTA_BOUNDS, name: 'GTA Full' }
  ];

  for (let type of ['sale', 'rent']) {
    console.log(`[RealtorTracker] === Starting ${type.toUpperCase()} listings ===`);

    for (const chunk of geoChunks) {
      let page = 1;
      let hasMore = true;
      let totalInChunk = 0;

      while (hasMore && page <= FETCH_CONFIG.MAX_PAGES_PER_TYPE) {
        try {
          const { results, totalRecords, totalPages } = await fetchRealtorListings(type, page, chunk);

          if (page === 1) {
            console.log(`[RealtorTracker] ${chunk.name} (${type}): ${totalRecords} total records, ${totalPages} pages`);
          }

          if (results.length === 0) {
            hasMore = false;
          } else {
            // DEBUG: Log first listing structure once
            if (!window.hasLoggedListing && type === 'sale') {
              console.log('[RealtorTracker] Sample listing:', JSON.stringify(results[0], null, 2));
              window.hasLoggedListing = true;
            }

            let newInBatch = 0;
            results.forEach(listing => {
              // Skip duplicates
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
              newInBatch++;
            });

            totalInChunk += newInBatch;
            console.log(`[RealtorTracker] ${chunk.name} page ${page}: +${newInBatch} new (${totalInChunk} from chunk, ${allListings.length} total)`);

            // Stop if we're getting mostly duplicates (covered by other chunks)
            if (newInBatch < 10 && page > 5) {
              console.log(`[RealtorTracker] ${chunk.name}: Mostly duplicates, moving to next area`);
              hasMore = false;
            } else {
              page++;
              await new Promise(r => setTimeout(r, FETCH_CONFIG.DELAY_BETWEEN_PAGES));
            }
          }
        } catch (e) {
          console.error(`[RealtorTracker] Error ${chunk.name} ${type} page ${page}:`, e);
          if (page === 1) {
            // Skip this chunk on first page error
            console.log(`[RealtorTracker] Skipping ${chunk.name} due to error`);
          }
          hasMore = false;
        }
      }

      // Delay between areas
      await new Promise(r => setTimeout(r, FETCH_CONFIG.DELAY_BETWEEN_AREAS));
    }
  }

  console.log(`[RealtorTracker] === COMPLETE: ${allListings.length} unique listings ===`);
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
