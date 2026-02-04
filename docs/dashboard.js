// Dashboard for Realtor Tracker (Google Sheets version)

const CONFIG = {
  SCRIPT_URL: '',
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000 // 5 minutes
};

let autoRefreshTimer = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadConfigFromStorage();
  setupEventListeners();
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

    const [stats, dailyStats] = await Promise.all([
      sheetsApi('getStats'),
      sheetsApi('getDailyStats')
    ]);

    updateStats(stats);
    updateBreakdown(stats);
    updateHistory(dailyStats.stats || []);
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
