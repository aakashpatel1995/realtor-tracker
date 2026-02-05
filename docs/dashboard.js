// Dashboard for Realtor Tracker (Google Sheets version)

const CONFIG = {
  SCRIPT_URL: '',
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000 // 5 minutes
};

let autoRefreshTimer = null;
let listingsData = null;
let currentAgeFilter = 'recent';
let currentSort = 'date-newest';
let currentCityFilter = '';
let currentPostalFilter = '';

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadConfigFromStorage();
  setupEventListeners();
  setupAgeTabs();
});

function loadConfigFromStorage() {
  CONFIG.SCRIPT_URL = localStorage.getItem('sheets_script_url') || '';

  if (CONFIG.SCRIPT_URL) {
    document.getElementById('config-banner').classList.add('hidden');
    document.getElementById('scriptUrl').value = CONFIG.SCRIPT_URL;
    loadAllData();
    startAutoRefresh();
  }
}

function setupEventListeners() {
  // Config modal
  document.getElementById('showConfigBtn').addEventListener('click', showConfigModal);
  document.getElementById('settingsBtn').addEventListener('click', showConfigModal);
  document.getElementById('cancelConfigBtn').addEventListener('click', hideConfigModal);
  document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', manualRefresh);

  // Auto-refresh toggle
  document.getElementById('autoRefresh').addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Close modal on outside click
  document.getElementById('config-modal').addEventListener('click', (e) => {
    if (e.target.id === 'config-modal') {
      hideConfigModal();
    }
  });
}

function showConfigModal() {
  document.getElementById('config-modal').classList.remove('hidden');
}

function hideConfigModal() {
  document.getElementById('config-modal').classList.add('hidden');
}

function saveConfig() {
  const scriptUrl = document.getElementById('scriptUrl').value.trim();

  if (!scriptUrl) {
    showToast('Please enter the Google Apps Script URL', 'error');
    return;
  }

  CONFIG.SCRIPT_URL = scriptUrl;
  localStorage.setItem('sheets_script_url', scriptUrl);

  hideConfigModal();
  document.getElementById('config-banner').classList.add('hidden');

  loadAllData();
  startAutoRefresh();

  showToast('Configuration saved!', 'success');
}

async function sheetsApi(action) {
  if (!CONFIG.SCRIPT_URL) {
    throw new Error('Google Sheets not configured');
  }

  const url = `${CONFIG.SCRIPT_URL}?action=${action}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

async function loadAllData() {
  try {
    setLoading(true);

    const [stats, dailyStats, listings] = await Promise.all([
      sheetsApi('getStats'),
      sheetsApi('getDailyStats'),
      sheetsApi('getListingsByAge')
    ]);

    updateStats(stats);
    updateBreakdown(stats);
    updateHistory(dailyStats.stats || []);
    updateListingsByAge(listings);
    updateLastUpdated();

  } catch (error) {
    console.error('Error loading data:', error);
    showToast(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

function updateStats(stats) {
  animateNumber('newToday', stats.newToday || 0);
  animateNumber('newLast7Days', stats.newLast7Days || 0);
  animateNumber('newLast7Weeks', stats.newLast7Weeks || 0);
  animateNumber('soldToday', stats.soldToday || 0);
  animateNumber('totalActive', stats.totalActive || 0);
}

function updateBreakdown(stats) {
  const saleCount = stats.saleCount || 0;
  const rentCount = stats.rentCount || 0;
  const total = saleCount + rentCount;

  document.getElementById('saleCount').textContent = saleCount.toLocaleString();
  document.getElementById('rentCount').textContent = rentCount.toLocaleString();

  if (total > 0) {
    document.getElementById('saleFill').style.width = `${(saleCount / total) * 100}%`;
    document.getElementById('rentFill').style.width = `${(rentCount / total) * 100}%`;
  }
}

function updateHistory(dailyStats) {
  const container = document.getElementById('historyTable');

  if (!dailyStats || dailyStats.length === 0) {
    container.innerHTML = '<div class="history-loading">No history data available yet</div>';
    return;
  }

  let html = `
    <div class="history-row header">
      <div>Date</div>
      <div>New</div>
      <div>Sold</div>
      <div>Total</div>
    </div>
  `;

  dailyStats.slice(0, 14).forEach(stat => {
    const date = new Date(stat.Date);
    const formattedDate = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    html += `
      <div class="history-row">
        <div class="history-date">${formattedDate}</div>
        <div class="history-new">+${stat.New_Listings || 0}</div>
        <div class="history-sold">-${stat.Sold_Count || 0}</div>
        <div class="history-total">${(stat.Total_Active || 0).toLocaleString()}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function updateLastUpdated() {
  const now = new Date();
  document.getElementById('lastUpdate').textContent = now.toLocaleTimeString();
}

function animateNumber(elementId, targetValue) {
  const element = document.getElementById(elementId);
  const currentValue = parseInt(element.textContent.replace(/,/g, '')) || 0;
  const duration = 500;
  const steps = 20;
  const increment = (targetValue - currentValue) / steps;
  let current = currentValue;
  let step = 0;

  const timer = setInterval(() => {
    step++;
    current += increment;

    if (step >= steps) {
      element.textContent = targetValue.toLocaleString();
      clearInterval(timer);
    } else {
      element.textContent = Math.round(current).toLocaleString();
    }
  }, duration / steps);
}

async function manualRefresh() {
  const btn = document.getElementById('refreshBtn');
  const text = document.getElementById('refreshText');
  const spinner = document.getElementById('refreshSpinner');

  btn.disabled = true;
  text.textContent = 'Refreshing...';
  spinner.classList.remove('hidden');

  await loadAllData();

  btn.disabled = false;
  text.textContent = 'Refresh Now';
  spinner.classList.add('hidden');

  showToast('Data refreshed!', 'success');
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }

  autoRefreshTimer = setInterval(() => {
    if (CONFIG.SCRIPT_URL) {
      loadAllData();
    }
  }, CONFIG.AUTO_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function setLoading(loading) {
  // Could add loading states here if needed
}

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

function setupAgeTabs() {
  // Age tab click handlers
  document.querySelectorAll('.age-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.age-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentAgeFilter = tab.dataset.age;
      console.log('[Dashboard] Age filter changed to:', currentAgeFilter);

      // Auto-switch sort to "newest first" for Recently Added tab
      if (currentAgeFilter === 'recent') {
        currentSort = 'date-newest';
        const sortSelect = document.getElementById('sortBy');
        if (sortSelect) sortSelect.value = 'date-newest';
      }

      renderListings();
    });
  });

  // Sort dropdown handler
  const sortSelect = document.getElementById('sortBy');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      console.log('[Dashboard] Sort changed to:', currentSort);
      renderListings();
    });
  }

  // City filter handler
  const cityFilter = document.getElementById('cityFilter');
  if (cityFilter) {
    cityFilter.addEventListener('change', (e) => {
      currentCityFilter = e.target.value;
      console.log('[Dashboard] City filter changed to:', currentCityFilter);
      renderListings();
    });
  }

  // Postal code filter handler (with debounce)
  const postalFilter = document.getElementById('postalFilter');
  if (postalFilter) {
    let postalTimeout;
    postalFilter.addEventListener('input', (e) => {
      clearTimeout(postalTimeout);
      postalTimeout = setTimeout(() => {
        currentPostalFilter = e.target.value.toUpperCase().replace(/\s/g, '');
        console.log('[Dashboard] Postal filter changed to:', currentPostalFilter);
        renderListings();
      }, 300);
    });
  }
}

function updateListingsByAge(data) {
  console.log('[Dashboard] Listings by age data:', data);
  console.log('[Dashboard] Counts:', data.counts);
  console.log('[Dashboard] 7 days sample:', data.olderThan7Days?.slice(0, 2));

  listingsData = data;

  // Calculate recent count (all listings from last 7 days by listed date)
  const recentListings = getRecentListings(data);
  const recentCount = recentListings.length;

  // Update counts
  document.getElementById('countRecent').textContent = recentCount;
  document.getElementById('countToday').textContent = data.counts?.today || 0;
  document.getElementById('countSold').textContent = data.counts?.sold || 0;
  document.getElementById('count7').textContent = data.counts?.day7 || 0;
  document.getElementById('count30').textContent = data.counts?.day30 || 0;
  document.getElementById('count90').textContent = data.counts?.day90 || 0;
  document.getElementById('count365').textContent = data.counts?.year || 0;

  // Populate city dropdown from all listings
  populateCityFilter(data);

  renderListings();
}

function populateCityFilter(data) {
  const citySelect = document.getElementById('cityFilter');
  if (!citySelect) return;

  // Collect all unique cities from all age groups
  const cities = new Set();
  const allListings = [
    ...(data.newToday || []),
    ...(data.soldToday || []),
    ...(data.olderThan7Days || []),
    ...(data.olderThan30Days || []),
    ...(data.olderThan90Days || []),
    ...(data.olderThan1Year || [])
  ];

  console.log('[Dashboard] Total listings for city filter:', allListings.length);
  if (allListings.length > 0) {
    console.log('[Dashboard] Sample listing fields:', Object.keys(allListings[0]));
    console.log('[Dashboard] Sample listing City value:', allListings[0].City, '| city:', allListings[0].city);
  }

  allListings.forEach(listing => {
    const city = listing.City || listing.city;
    if (city) {
      cities.add(city);
    }
  });

  console.log('[Dashboard] Found cities:', Array.from(cities));

  // Sort cities alphabetically
  const sortedCities = Array.from(cities).sort();

  // Preserve current selection
  const currentValue = citySelect.value;

  // Rebuild options
  citySelect.innerHTML = '<option value="">All Cities</option>';
  sortedCities.forEach(city => {
    const option = document.createElement('option');
    option.value = city;
    option.textContent = city;
    citySelect.appendChild(option);
  });

  // Restore selection if still valid
  if (currentValue && sortedCities.includes(currentValue)) {
    citySelect.value = currentValue;
  }
}

// Get all listings from last 7 days by listed date (newest first)
function getRecentListings(data) {
  if (!data) return [];

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  const seen = new Set();

  // Collect all active listings
  const allListings = [
    ...(data.newToday || []),
    ...(data.olderThan7Days || []),
    ...(data.olderThan30Days || []),
    ...(data.olderThan90Days || []),
    ...(data.olderThan1Year || [])
  ];

  // Filter to last 7 days by listed date and dedupe
  const recentListings = allListings.filter(listing => {
    const mls = listing.MLS_Number;
    if (seen.has(mls)) return false;
    seen.add(mls);

    const listedDate = listing.Listed_Date || listing.First_Seen;
    if (!listedDate) return false;

    const date = new Date(listedDate);
    return date >= sevenDaysAgo;
  });

  // Sort by listed date descending (newest first)
  recentListings.sort((a, b) => {
    const dateA = a.Listed_Date || a.First_Seen || '';
    const dateB = b.Listed_Date || b.First_Seen || '';
    return dateB.localeCompare(dateA);
  });

  return recentListings;
}

function renderListings() {
  const container = document.getElementById('listingsContainer');

  if (!listingsData) {
    container.innerHTML = '<div class="listings-loading">Loading listings...</div>';
    return;
  }

  let listings;
  switch (currentAgeFilter) {
    case 'recent': listings = getRecentListings(listingsData); break;
    case 'today': listings = listingsData.newToday ? [...listingsData.newToday] : []; break;
    case 'sold': listings = listingsData.soldToday ? [...listingsData.soldToday] : []; break;
    case '7': listings = listingsData.olderThan7Days ? [...listingsData.olderThan7Days] : []; break;
    case '30': listings = listingsData.olderThan30Days ? [...listingsData.olderThan30Days] : []; break;
    case '90': listings = listingsData.olderThan90Days ? [...listingsData.olderThan90Days] : []; break;
    case '365': listings = listingsData.olderThan1Year ? [...listingsData.olderThan1Year] : []; break;
    default: listings = [];
  }

  if (!listings || listings.length === 0) {
    container.innerHTML = '<div class="listings-empty">No listings found in this category</div>';
    return;
  }

  // Apply city filter
  if (currentCityFilter) {
    listings = listings.filter(l => (l.City || l.city) === currentCityFilter);
  }

  // Apply postal code filter
  if (currentPostalFilter) {
    listings = listings.filter(l => {
      const postal = (l.PostalCode || l.postalCode || '').toUpperCase().replace(/\s/g, '');
      return postal.startsWith(currentPostalFilter);
    });
  }

  // Check if any listings after filtering
  if (listings.length === 0) {
    container.innerHTML = '<div class="listings-empty">No listings found matching your filters</div>';
    return;
  }

  // Apply sorting
  listings = sortListings(listings, currentSort);

  let html = `
    <div class="listings-header">
      <div class="col-mls">MLS #</div>
      <div class="col-address">Address</div>
      <div class="col-price">Price</div>
      <div class="col-details">Details</div>
      <div class="col-listed">Listed</div>
      <div class="col-age">Days</div>
      <div class="col-action">Link</div>
    </div>
  `;

  listings.forEach(listing => {
    const daysListed = getDaysListed(listing);
    const price = formatPrice(listing.Price);
    const details = formatDetails(listing);

    // Generate URL from MLS number if not available
    let url = listing.URL;
    if (!url || url === '#' || !url.includes('realtor.ca')) {
      // Realtor.ca search URL by MLS number
      url = `https://www.realtor.ca/map#ZoomLevel=11&Center=43.7,-79.4&LatitudeMax=44.0&LongitudeMax=-78.9&LatitudeMin=43.4&LongitudeMin=-80.0&view=list&Sort=6-D&PropertySearchTypeId=1&TransactionTypeId=2&MlsNumber=${listing.MLS_Number}`;
    }
    const hasUrl = listing.MLS_Number ? true : false;

    const listedDate = listing.Listed_Date || listing.First_Seen || '';
    const formattedDate = listedDate ? formatListedDate(listedDate) : 'N/A';

    html += `
      <div class="listing-row ${listing.Type}">
        <div class="col-mls">${listing.MLS_Number || 'N/A'}</div>
        <div class="col-address">
          <div class="listing-address">${listing.Address || 'N/A'}</div>
          <div class="listing-meta">
            <span class="listing-type">${listing.PropertyType || listing.Type}</span>
            ${(listing.City || listing.city) ? `<span class="listing-city">${listing.City || listing.city}</span>` : ''}
            ${(listing.PostalCode || listing.postalCode) ? `<span class="listing-postal">${listing.PostalCode || listing.postalCode}</span>` : ''}
          </div>
        </div>
        <div class="col-price">${price}</div>
        <div class="col-details">${details}</div>
        <div class="col-listed">${formattedDate}</div>
        <div class="col-age">
          <span class="days-badge ${getDaysClass(daysListed)}">${daysListed}</span>
        </div>
        <div class="col-action">
          ${hasUrl ? `<a href="${url}" target="_blank" class="view-btn">View</a>` : '<span class="no-link">-</span>'}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function getDaysListed(listing) {
  // Use Listed_Date if available, otherwise fall back to First_Seen
  const dateStr = listing.Listed_Date || listing.First_Seen;
  if (!dateStr) return 0;
  const listDate = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - listDate) / (1000 * 60 * 60 * 24));
}

function getDaysClass(days) {
  if (days >= 365) return 'days-year';
  if (days >= 90) return 'days-90';
  if (days >= 30) return 'days-30';
  return 'days-7';
}

function formatPrice(price) {
  if (!price) return 'N/A';
  if (typeof price === 'string') {
    price = parseInt(price.replace(/[^0-9]/g, ''));
  }
  if (price >= 1000000) {
    return '$' + (price / 1000000).toFixed(2) + 'M';
  }
  return '$' + price.toLocaleString();
}

function formatDetails(listing) {
  const parts = [];

  if (listing.Bedrooms) parts.push(`${listing.Bedrooms} bed`);
  if (listing.Bathrooms) parts.push(`${listing.Bathrooms} bath`);
  if (listing.Parking) parts.push(`${listing.Parking} park`);
  if (listing.Sqft) parts.push(listing.Sqft);
  if (listing.LotSize) parts.push(`Lot: ${listing.LotSize}`);

  return parts.length > 0 ? parts.join(' · ') : 'Details N/A';
}

function formatListedDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function sortListings(listings, sortBy) {
  const sorted = [...listings];

  switch (sortBy) {
    case 'date-oldest':
      // Oldest first (longest on market)
      sorted.sort((a, b) => {
        const dateA = a.Listed_Date || a.First_Seen || '';
        const dateB = b.Listed_Date || b.First_Seen || '';
        return dateA.localeCompare(dateB);
      });
      break;
    case 'date-newest':
      // Newest first (most recently listed)
      sorted.sort((a, b) => {
        const dateA = a.Listed_Date || a.First_Seen || '';
        const dateB = b.Listed_Date || b.First_Seen || '';
        return dateB.localeCompare(dateA);
      });
      break;
    case 'price-low':
      // Price low to high
      sorted.sort((a, b) => {
        const priceA = parsePrice(a.Price);
        const priceB = parsePrice(b.Price);
        return priceA - priceB;
      });
      break;
    case 'price-high':
      // Price high to low
      sorted.sort((a, b) => {
        const priceA = parsePrice(a.Price);
        const priceB = parsePrice(b.Price);
        return priceB - priceA;
      });
      break;
    case 'city':
      // City A-Z
      sorted.sort((a, b) => {
        const cityA = (a.City || a.city || '').toLowerCase();
        const cityB = (b.City || b.city || '').toLowerCase();
        if (!cityA && !cityB) return 0;
        if (!cityA) return 1;
        if (!cityB) return -1;
        return cityA.localeCompare(cityB);
      });
      break;
    case 'postal':
      // Postal code - sort by FSA (first 3 chars) then full code
      sorted.sort((a, b) => {
        const postalA = (a.PostalCode || a.postalCode || '').toUpperCase();
        const postalB = (b.PostalCode || b.postalCode || '').toUpperCase();
        if (!postalA && !postalB) return 0;
        if (!postalA) return 1;
        if (!postalB) return -1;
        return postalA.localeCompare(postalB);
      });
      console.log('[Dashboard] Sorted by postal, first 3:', sorted.slice(0, 3).map(l => l.PostalCode || l.postalCode));
      break;
  }

  return sorted;
}

function parsePrice(price) {
  if (!price) return 0;
  if (typeof price === 'number') return price;
  return parseInt(String(price).replace(/[^0-9]/g, '')) || 0;
}
