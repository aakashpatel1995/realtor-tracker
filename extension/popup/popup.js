// Popup script for Realtor Tracker (Google Sheets version)

document.addEventListener('DOMContentLoaded', async () => {
  const configSection = document.getElementById('config-section');
  const configBtn = document.getElementById('configBtn');
  const saveConfigBtn = document.getElementById('saveConfig');
  const refreshBtn = document.getElementById('refreshBtn');
  const refreshText = document.getElementById('refreshText');
  const refreshSpinner = document.getElementById('refreshSpinner');
  const errorMessage = document.getElementById('error-message');

  // Load existing config
  chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
    if (config.scriptUrl) {
      document.getElementById('scriptUrl').value = config.scriptUrl;
    }

    // Show config section if not configured
    if (!config.scriptUrl) {
      configSection.classList.remove('hidden');
    }
  });

  // Load stats
  loadStats();

  // Toggle config section
  configBtn.addEventListener('click', () => {
    configSection.classList.toggle('hidden');
  });

  // Save config
  saveConfigBtn.addEventListener('click', () => {
    const scriptUrl = document.getElementById('scriptUrl').value.trim();

    if (!scriptUrl) {
      showError('Please enter the Google Apps Script URL');
      return;
    }

    chrome.runtime.sendMessage({
      action: 'saveConfig',
      scriptUrl: scriptUrl
    }, (response) => {
      if (response.success) {
        configSection.classList.add('hidden');
        hideError();
        loadStats();
      }
    });
  });

  // Manual refresh
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshText.textContent = 'Refreshing...';
    refreshSpinner.classList.remove('hidden');
    hideError();

    chrome.runtime.sendMessage({ action: 'manualRefresh' }, (result) => {
      refreshBtn.disabled = false;
      refreshText.textContent = 'Refresh Now';
      refreshSpinner.classList.add('hidden');

      if (result.success) {
        loadStats();
      } else {
        showError(result.error || 'Failed to refresh');
      }
    });
  });

  function loadStats() {
    chrome.runtime.sendMessage({ action: 'getStats' }, (stats) => {
      if (stats.error) {
        showError(stats.error);
        return;
      }

      document.getElementById('newToday').textContent = formatNumber(stats.newToday);
      document.getElementById('newLast7Days').textContent = formatNumber(stats.newLast7Days);
      document.getElementById('newLast7Weeks').textContent = formatNumber(stats.newLast7Weeks);
      document.getElementById('soldToday').textContent = formatNumber(stats.soldToday);
      document.getElementById('totalActive').textContent = formatNumber(stats.totalActive);

      if (stats.lastUpdate) {
        const date = new Date(stats.lastUpdate);
        document.getElementById('lastUpdate').textContent = formatDateTime(date);
      }
    });
  }

  function formatNumber(num) {
    if (num === undefined || num === null) return '-';
    return num.toLocaleString();
  }

  function formatDateTime(date) {
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) {
      return 'Just now';
    } else if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins} min${mins > 1 ? 's' : ''} ago`;
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
  }

  function hideError() {
    errorMessage.classList.add('hidden');
  }
});
