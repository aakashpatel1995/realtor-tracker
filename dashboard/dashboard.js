// Dashboard for Realtor Tracker

const CONFIG = {
  AIRTABLE_API_KEY: '',
  AIRTABLE_BASE_ID: '',
  LISTINGS_TABLE: 'Listings',
  STATS_TABLE: 'Daily_Stats',
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000 // 5 minutes
};

let autoRefreshTimer = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadConfigFromStorage();
  setupEventListeners();
});

function loadConfigFromStorage() {
  CONFIG.AIRTABLE_API_KEY = localStorage.getItem('airtable_api_key') || '';
  CONFIG.AIRTABLE_BASE_ID = localStorage.getItem('airtable_base_id') || '';

  if (CONFIG.AIRTABLE_API_KEY && CONFIG.AIRTABLE_BASE_ID) {
    document.getElementById('config-banner').classList.add('hidden');
    document.getElementById('apiKey').value = CONFIG.AIRTABLE_API_KEY;
    document.getElementById('baseId').value = CONFIG.AIRTABLE_BASE_ID;
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
  const apiKey = document.getElementById('apiKey').value.trim();
  const baseId = document.getElementById('baseId').value.trim();

  if (!apiKey || !baseId) {
    showToast('Please enter both API key and Base ID', 'error');
    return;
  }

  CONFIG.AIRTABLE_API_KEY = apiKey;
  CONFIG.AIRTABLE_BASE_ID = baseId;

  localStorage.setItem('airtable_api_key', apiKey);
  localStorage.setItem('airtable_base_id', baseId);

  hideConfigModal();
  document.getElementById('config-banner').classList.add('hidden');

  loadAllData();
  startAutoRefresh();

  showToast('Configuration saved!', 'success');
}

async function airtableFetch(endpoint) {
  if (!CONFIG.AIRTABLE_API_KEY || !CONFIG.AIRTABLE_BASE_ID) {
    throw new Error('Airtable not configured');
  }

  const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airtable error: ${error}`);
  }

  return response.json();
}

async function getAllListings() {
  const listings = [];
  let offset = null;

  do {
    const params = new URLSearchParams();
    if (offset) params.set('offset', offset);

    const data = await airtableFetch(`${CONFIG.LISTINGS_TABLE}?${params.toString()}`);
    listings.push(...data.records.map(r => r.fields));
    offset = data.offset;
  } while (offset);

  return listings;
}

async function getDailyStats() {
  const params = new URLSearchParams({
    sort: JSON.stringify([{ field: 'Date', direction: 'desc' }]),
    maxRecords: '30'
  });

  const data = await airtableFetch(`${CONFIG.STATS_TABLE}?${params.toString()}`);
  return data.records.map(r => r.fields);
}

async function loadAllData() {
  try {
    setLoading(true);

    const [listings, dailyStats] = await Promise.all([
      getAllListings(),
      getDailyStats()
    ]);

    updateStats(listings);
    updateBreakdown(listings);
    updateHistory(dailyStats);
    updateLastUpdated();

  } catch (error) {
    console.error('Error loading data:', error);
    showToast(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

function updateStats(listings) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenWeeksAgo = new Date(now - 49 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let newToday = 0;
  let newLast7Days = 0;
  let newLast7Weeks = 0;
  let soldToday = 0;
  let totalActive = 0;

  listings.forEach(listing => {
    const firstSeen = listing.First_Seen;
    const lastSeen = listing.Last_Seen;

    if (listing.Status === 'active') {
      totalActive++;
    }

    if (firstSeen === today) {
      newToday++;
    }

    if (firstSeen >= sevenDaysAgo) {
      newLast7Days++;
    }

    if (firstSeen >= sevenWeeksAgo) {
      newLast7Weeks++;
    }

    if (listing.Status === 'sold' && lastSeen === today) {
      soldToday++;
    }
  });

  animateNumber('newToday', newToday);
  animateNumber('newLast7Days', newLast7Days);
  animateNumber('newLast7Weeks', newLast7Weeks);
  animateNumber('soldToday', soldToday);
  animateNumber('totalActive', totalActive);
}

function updateBreakdown(listings) {
  const activeListings = listings.filter(l => l.Status === 'active');
  const saleCount = activeListings.filter(l => l.Type === 'sale').length;
  const rentCount = activeListings.filter(l => l.Type === 'rent').length;
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

  if (dailyStats.length === 0) {
    container.innerHTML = '<div class="history-loading">No history data available</div>';
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
    if (CONFIG.AIRTABLE_API_KEY && CONFIG.AIRTABLE_BASE_ID) {
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
