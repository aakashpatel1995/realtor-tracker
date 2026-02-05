// Popup script for Realtor Tracker (Google Sheets version)

document.addEventListener('DOMContentLoaded', async () => {
  const configSection = document.getElementById('config-section');
  const configBtn = document.getElementById('configBtn');
  const saveConfigBtn = document.getElementById('saveConfig');
  const refreshBtn = document.getElementById('refreshBtn');
  const refreshText = document.getElementById('refreshText');
  const refreshSpinner = document.getElementById('refreshSpinner');
  const fetchCityBtn = document.getElementById('fetchCityBtn');
  const fetchCityText = document.getElementById('fetchCityText');
  const fetchCitySpinner = document.getElementById('fetchCitySpinner');
  const captureBtn = document.getElementById('captureBtn');
  const captureText = document.getElementById('captureText');
  const captureSpinner = document.getElementById('captureSpinner');
  const sessionIndicator = document.getElementById('sessionIndicator');
  const sessionText = document.getElementById('sessionText');
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

    // Update session status
    updateSessionStatus(config.sessionCaptured, config.sessionCapturedAt);

    // Update schedule status
    updateScheduleStatus(config);
  });

  // Load stats
  loadStats();

  // Load schedule status
  loadScheduleStatus();

  // Load city dropdown
  loadCityDropdown();

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

  // Fetch city (next or selected)
  fetchCityBtn.addEventListener('click', async () => {
    const citySelect = document.getElementById('citySelect');
    const selectedCity = citySelect.value;

    fetchCityBtn.disabled = true;
    fetchCityText.textContent = 'Fetching...';
    fetchCitySpinner.classList.remove('hidden');
    hideError();

    // Determine which action to use
    const action = selectedCity ? 'fetchSpecificCity' : 'fetchNextCity';
    const message = selectedCity ? { action, city: selectedCity } : { action };

    chrome.runtime.sendMessage(message, (result) => {
      fetchCityBtn.disabled = false;
      fetchCityText.textContent = 'Fetch City';
      fetchCitySpinner.classList.add('hidden');

      if (result.success) {
        loadStats();
        loadScheduleStatus();
        // Show which city was fetched
        fetchCityText.textContent = `Done: ${result.city}`;
        setTimeout(() => {
          fetchCityText.textContent = 'Fetch City';
        }, 3000);
      } else {
        showError(result.error || 'Failed to fetch city');
      }
    });
  });

  // Manual refresh (legacy)
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshText.textContent = 'Refreshing...';
    refreshSpinner.classList.remove('hidden');
    hideError();

    chrome.runtime.sendMessage({ action: 'manualRefresh' }, (result) => {
      refreshBtn.disabled = false;
      refreshText.textContent = 'Full Refresh (Legacy)';
      refreshSpinner.classList.add('hidden');

      if (result.success) {
        loadStats();
        // Refresh session status
        chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
          updateSessionStatus(config.sessionCaptured, config.sessionCapturedAt);
        });
      } else {
        showError(result.error || 'Failed to refresh');
      }
    });
  });

  // Capture session
  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    captureText.textContent = 'Capturing...';
    captureSpinner.classList.remove('hidden');
    hideError();

    chrome.runtime.sendMessage({ action: 'captureSession' }, (result) => {
      captureBtn.disabled = false;
      captureText.textContent = 'Capture Session';
      captureSpinner.classList.add('hidden');

      if (result.success) {
        updateSessionStatus(true, new Date().toISOString());
        // Show success briefly
        sessionText.textContent = `Captured ${result.cookieCount} cookies!`;
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'getConfig' }, (config) => {
            updateSessionStatus(config.sessionCaptured, config.sessionCapturedAt);
          });
        }, 2000);
      } else {
        showError(result.error || 'Failed to capture session');
      }
    });
  });

  function updateSessionStatus(captured, capturedAt) {
    if (captured && capturedAt) {
      sessionIndicator.classList.remove('inactive');
      sessionIndicator.classList.add('active');
      const date = new Date(capturedAt);
      const timeAgo = formatTimeAgo(date);
      sessionText.textContent = `Session active (${timeAgo})`;
    } else {
      sessionIndicator.classList.remove('active');
      sessionIndicator.classList.add('inactive');
      sessionText.textContent = 'No session - click Capture';
    }
  }

  function formatTimeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return 'just now';
  }

  function loadStats(forceRefresh = false) {
    chrome.runtime.sendMessage({ action: 'getStats', forceRefresh }, (stats) => {
      console.log('[RealtorTracker] Stats received:', stats);

      if (!stats) {
        showError('No response from background script');
        return;
      }

      if (stats.error) {
        showError(stats.error);
        return;
      }

      displayStats(stats);

      // If we got cached data, refresh in background
      if (stats.fromCache && !forceRefresh) {
        console.log('[RealtorTracker] Got cached data, refreshing in background...');
        chrome.runtime.sendMessage({ action: 'getStats', forceRefresh: true }, (freshStats) => {
          if (freshStats && !freshStats.error) {
            console.log('[RealtorTracker] Fresh stats received');
            displayStats(freshStats);
          }
        });
      }
    });
  }

  function displayStats(stats) {
    document.getElementById('newToday').textContent = formatNumber(stats.newToday);
    document.getElementById('newLast7Days').textContent = formatNumber(stats.newLast7Days);
    document.getElementById('newLast7Weeks').textContent = formatNumber(stats.newLast7Weeks);
    document.getElementById('soldToday').textContent = formatNumber(stats.soldToday);
    document.getElementById('totalActive').textContent = formatNumber(stats.totalActive);

    if (stats.lastUpdate) {
      const date = new Date(stats.lastUpdate);
      document.getElementById('lastUpdate').textContent = formatDateTime(date);
    }
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
    // Check if it's a connection error that needs realtor.ca to be open
    if (message.includes('realtor.ca') || message.includes('content script')) {
      errorMessage.innerHTML = `
        ${message}<br><br>
        <a href="https://www.realtor.ca/map" target="_blank" style="color: #667eea;">
          Click here to open realtor.ca
        </a>, then try again.
      `;
    } else {
      errorMessage.textContent = message;
    }
    errorMessage.classList.remove('hidden');
  }

  function hideError() {
    errorMessage.classList.add('hidden');
  }

  function loadScheduleStatus() {
    chrome.runtime.sendMessage({ action: 'getScheduleStatus' }, (status) => {
      if (status) {
        updateScheduleDisplay(status);
      }
    });
  }

  function loadCityDropdown() {
    chrome.runtime.sendMessage({ action: 'getCities' }, (response) => {
      if (response && response.cities) {
        const citySelect = document.getElementById('citySelect');
        citySelect.innerHTML = '<option value="">-- Next in queue --</option>';

        response.cities.forEach(city => {
          const option = document.createElement('option');
          option.value = city;
          option.textContent = city;
          citySelect.appendChild(option);
        });
      }
    });
  }

  function updateScheduleStatus(config) {
    // Basic update from config
    if (config.currentCityIndex !== undefined) {
      document.getElementById('cityProgress').textContent = `${config.currentCityIndex}/?`;
    }
    if (config.lastCityFetched) {
      document.getElementById('lastCityFetched').textContent = config.lastCityFetched;
    }
  }

  function updateScheduleDisplay(status) {
    document.getElementById('cityProgress').textContent = `${status.currentCityIndex}/${status.totalCities}`;
    document.getElementById('currentCity').textContent = status.currentCity || '-';
    document.getElementById('lastCityFetched').textContent = status.lastCityFetched || 'None';
  }

  // Listen for progress updates from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchProgress' || message.action === 'cityFetchProgress') {
      updateProgressDisplay(message);
    }
  });

  function updateProgressDisplay(data) {
    const progressSection = document.getElementById('fetch-progress');
    const progressCity = document.getElementById('progressCity');
    const progressCount = document.getElementById('progressCount');
    const progressBar = document.getElementById('progressBar');
    const progressType = document.getElementById('progressType');
    const progressPage = document.getElementById('progressPage');
    const progressNew = document.getElementById('progressNew');

    if (data.type === 'starting') {
      // Show progress section when fetch starts
      progressSection.classList.remove('hidden');
      progressCity.textContent = `Fetching: ${data.city}`;
      progressCount.textContent = '0';
      progressBar.style.width = '0%';
      progressType.textContent = 'starting';
      progressPage.textContent = '1';
      progressNew.textContent = '+0 new';
    } else if (data.type === 'complete') {
      // Update final count and show completion
      progressCity.textContent = `Done: ${data.city}`;
      progressCount.textContent = data.count.toLocaleString();
      progressBar.style.width = '100%';
      progressType.textContent = 'complete';
      progressNew.textContent = `${data.count.toLocaleString()} total`;

      // Hide progress section after 3 seconds
      setTimeout(() => {
        progressSection.classList.add('hidden');
        loadScheduleStatus();
      }, 3000);
    } else {
      // In-progress update (sale or rent)
      progressSection.classList.remove('hidden');
      progressCity.textContent = `Fetching: ${data.city}`;
      progressCount.textContent = data.count.toLocaleString();
      progressType.textContent = data.type;
      progressPage.textContent = data.page || '1';
      progressNew.textContent = `+${data.newInPage || 0} new`;

      // Calculate progress bar percentage
      if (data.totalPages && data.totalPages > 0) {
        const typeOffset = data.type === 'rent' ? 50 : 0;
        const pageProgress = (data.page / data.totalPages) * 50;
        progressBar.style.width = `${typeOffset + pageProgress}%`;
      }
    }
  }
});
