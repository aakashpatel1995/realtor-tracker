// Dashboard for Realtor Tracker (Google Sheets version)

const CONFIG = {
  SCRIPT_URL: '',
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000 // 5 minutes
};

let autoRefreshTimer = null;
let listingsData = null;
let currentAgeFilter = '7';

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
  document.querySelectorAll('.age-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.age-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentAgeFilter = tab.dataset.age;
      renderListings();
    });
  });
}

function updateListingsByAge(data) {
  listingsData = data;

  // Update counts
  document.getElementById('count7').textContent = data.counts?.day7 || 0;
  document.getElementById('count30').textContent = data.counts?.day30 || 0;
  document.getElementById('count90').textContent = data.counts?.day90 || 0;
  document.getElementById('count365').textContent = data.counts?.year || 0;

  renderListings();
}

function renderListings() {
  const container = document.getElementById('listingsContainer');

  if (!listingsData) {
    container.innerHTML = '<div class="listings-loading">Loading listings...</div>';
    return;
  }

  let listings;
  switch (currentAgeFilter) {
    case '7': listings = listingsData.olderThan7Days; break;
    case '30': listings = listingsData.olderThan30Days; break;
    case '90': listings = listingsData.olderThan90Days; break;
    case '365': listings = listingsData.olderThan1Year; break;
    default: listings = [];
  }

  if (!listings || listings.length === 0) {
    container.innerHTML = '<div class="listings-empty">No listings found in this category</div>';
    return;
  }

  let html = `
    <div class="listings-header">
      <div class="col-mls">MLS #</div>
      <div class="col-address">Address</div>
      <div class="col-price">Price</div>
      <div class="col-details">Details</div>
      <div class="col-age">Days</div>
      <div class="col-action">Link</div>
    </div>
  `;

  listings.forEach(listing => {
    const daysListed = getDaysListed(listing.First_Seen);
    const price = formatPrice(listing.Price);
    const details = formatDetails(listing);
    const url = listing.URL || '#';
    const hasUrl = listing.URL && listing.URL !== '#' && listing.URL.includes('realtor.ca');

    html += `
      <div class="listing-row ${listing.Type}">
        <div class="col-mls">${listing.MLS_Number || 'N/A'}</div>
        <div class="col-address">
          <div class="listing-address">${listing.Address || 'N/A'}</div>
          <div class="listing-type">${listing.PropertyType || listing.Type}</div>
        </div>
        <div class="col-price">${price}</div>
        <div class="col-details">${details}</div>
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

function getDaysListed(firstSeen) {
  if (!firstSeen) return 0;
  const first = new Date(firstSeen);
  const now = new Date();
  return Math.floor((now - first) / (1000 * 60 * 60 * 24));
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
