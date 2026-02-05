// Realtor.ca Listing Tracker - Background Service Worker

const CONFIG = { SCRIPT_URL: '', UPDATE_INTERVAL_MINUTES: 60 };

const GTA_BOUNDS = {
  longitudeMin: -80.0,
  longitudeMax: -78.9,
  latitudeMin: 43.4,
  latitudeMax: 44.0
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('fetchListings', { periodInMinutes: CONFIG.UPDATE_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchListings') fetchAndUpdateListings();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'manualRefresh') {
    fetchAndUpdateListings().then(sendResponse);
    return true;
  }
  if (request.action === 'getStats') {
    getStats(request.forceRefresh || false).then(sendResponse);
    return true;
  }
  if (request.action === 'saveConfig') {
    chrome.storage.local.set({ scriptUrl: request.scriptUrl }, () => sendResponse({ success: true }));
    return true;
  }
  if (request.action === 'getConfig') {
    chrome.storage.local.get(['scriptUrl', 'sessionCaptured', 'sessionCapturedAt'], sendResponse);
    return true;
  }
  if (request.action === 'captureSession') {
    captureSession().then(sendResponse);
    return true;
  }
  if (request.action === 'contentScriptReady') {
    console.log('[RealtorTracker] Content script ready on tab:', sender.tab?.id);
    return false;
  }
});

async function loadConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['scriptUrl'], result => {
      CONFIG.SCRIPT_URL = result.scriptUrl || '';
      resolve();
    });
  });
}

// Capture session from realtor.ca
async function captureSession() {
  try {
    console.log('[RealtorTracker] Capturing session...');

    // Open realtor.ca to establish session
    let tabs = await chrome.tabs.query({ url: 'https://www.realtor.ca/*' });
    let tab;
    let createdTab = false;

    if (tabs.length > 0) {
      tab = tabs[0];
    } else {
      tab = await chrome.tabs.create({ url: 'https://www.realtor.ca/map', active: true });
      createdTab = true;

      // Wait for page to fully load
      await new Promise(resolve => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      // Extra wait for JS to initialize and set cookies
      await new Promise(r => setTimeout(r, 3000));
    }

    // Get all cookies for realtor.ca
    const cookies = await chrome.cookies.getAll({ domain: '.realtor.ca' });
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    console.log('[RealtorTracker] Captured', cookies.length, 'cookies');

    // Store cookies and session info
    await chrome.storage.local.set({
      realtorCookies: cookieString,
      sessionCaptured: true,
      sessionCapturedAt: new Date().toISOString()
    });

    // Close the tab if we created it
    if (createdTab) {
      await chrome.tabs.remove(tab.id);
    }

    return { success: true, cookieCount: cookies.length };
  } catch (error) {
    console.error('[RealtorTracker] Session capture error:', error);
    return { success: false, error: error.message };
  }
}

// Check if we have a valid session (cookies exist for realtor.ca)
async function hasValidSession() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.realtor.ca' });
    return cookies.length > 0;
  } catch (e) {
    return false;
  }
}

// Fetch listings via content script (auto-manages realtor.ca tab)
async function fetchAllListings() {
  // Check if session exists
  const hasSession = await hasValidSession();

  if (!hasSession) {
    console.log('[RealtorTracker] No session cookies found. Capturing session first...');
    const captureResult = await captureSession();
    if (!captureResult.success) {
      throw new Error('Failed to capture session. Please try again.');
    }
  }

  return await fetchViaContentScript();
}

// Fetch via content script (auto-manages realtor.ca tab)
async function fetchViaContentScript() {
  // Find existing realtor.ca tab
  let tabs = await chrome.tabs.query({ url: 'https://www.realtor.ca/*' });
  let tab;
  let createdTab = false;

  if (tabs.length > 0) {
    tab = tabs[0];
    console.log('[RealtorTracker] Found existing realtor.ca tab:', tab.id);
  } else {
    // Open realtor.ca in a new background tab
    console.log('[RealtorTracker] Opening realtor.ca tab in background...');
    tab = await chrome.tabs.create({ url: 'https://www.realtor.ca/map', active: false });
    createdTab = true;

    // Wait for page to load
    await new Promise(resolve => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Give content script time to initialize
    await new Promise(r => setTimeout(r, 2000));
  }

  // Send message to content script to fetch listings
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action: 'fetchListings' }, async response => {
      // Close tab if we created it
      if (createdTab) {
        try {
          await chrome.tabs.remove(tab.id);
          console.log('[RealtorTracker] Closed background tab');
        } catch (e) {
          // Tab might already be closed
        }
      }

      if (chrome.runtime.lastError) {
        console.error('[RealtorTracker] Error sending message:', chrome.runtime.lastError);
        reject(new Error('Could not connect to realtor.ca. Please click Capture Session.'));
        return;
      }

      if (!response) {
        reject(new Error('No response from content script. Try Capture Session.'));
        return;
      }

      if (response.success) {
        resolve(response.listings);
      } else {
        reject(new Error(response.error || 'Failed to fetch listings'));
      }
    });
  });
}

async function syncToSheets(listings) {
  const batchSize = 50;
  let totalNew = 0, totalSold = 0;

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    const isLastBatch = (i + batchSize) >= listings.length;
    console.log(`[RealtorTracker] Syncing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(listings.length/batchSize)}...`);

    const payload = {
      action: 'syncBatch',
      listings: batch,
      isLastBatch: isLastBatch,
      totalListings: listings.length
    };

    // Use POST to avoid URL length limits
    const response = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      credentials: 'omit'
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.error('[RealtorTracker] Invalid response:', text.substring(0, 500));
      // Check common issues
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error('Google Sheets returned HTML - script may need reauthorization. Redeploy the Apps Script.');
      }
      if (text.includes('Authorization')) {
        throw new Error('Google Sheets authorization error. Redeploy the Apps Script.');
      }
      throw new Error('Invalid response from Google Sheets: ' + text.substring(0, 100));
    }

    if (result.error) throw new Error(result.error);
    totalNew += result.newListings || 0;
    totalSold += result.soldListings || 0;

    await new Promise(r => setTimeout(r, 1000));
  }

  return { success: true, newListings: totalNew, soldListings: totalSold, totalActive: listings.length };
}

async function fetchAndUpdateListings() {
  try {
    await loadConfig();
    if (!CONFIG.SCRIPT_URL) {
      return { success: false, error: 'Google Sheets not configured' };
    }

    console.log('[RealtorTracker] Starting fetch...');
    const listings = await fetchAllListings();

    if (listings.length === 0) {
      return { success: false, error: 'No listings found - API may be blocked' };
    }

    console.log('[RealtorTracker] Syncing to Google Sheets...');
    const result = await syncToSheets(listings);

    if (result.success) {
      await chrome.storage.local.set({ lastUpdate: new Date().toISOString() });
      // Refresh stats cache after sync
      await getStats(true);
    }

    return result;
  } catch (error) {
    console.error('[RealtorTracker] Error:', error);
    return { success: false, error: error.message };
  }
}

async function getStats(forceRefresh = false) {
  try {
    await loadConfig();

    // Return cached stats if available and not forcing refresh
    if (!forceRefresh) {
      const cached = await chrome.storage.local.get(['cachedStats', 'statsCachedAt']);
      if (cached.cachedStats && cached.statsCachedAt) {
        const cacheAge = Date.now() - cached.statsCachedAt;
        // Use cache if less than 5 minutes old
        if (cacheAge < 5 * 60 * 1000) {
          console.log('[RealtorTracker] Returning cached stats');
          return { ...cached.cachedStats, fromCache: true };
        }
      }
    }

    if (!CONFIG.SCRIPT_URL) return { error: 'Google Sheets not configured' };

    const url = `${CONFIG.SCRIPT_URL}?action=getStats`;
    console.log('[RealtorTracker] Fetching fresh stats...');

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit'
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON response');
    }

    const storage = await chrome.storage.local.get(['lastUpdate']);
    result.lastUpdate = storage.lastUpdate || null;

    // Cache the stats
    await chrome.storage.local.set({
      cachedStats: result,
      statsCachedAt: Date.now()
    });

    console.log('[RealtorTracker] Stats cached');
    return result;
  } catch (error) {
    console.error('[RealtorTracker] getStats error:', error);

    // On error, try to return cached stats even if stale
    const cached = await chrome.storage.local.get(['cachedStats']);
    if (cached.cachedStats) {
      console.log('[RealtorTracker] Returning stale cache due to error');
      return { ...cached.cachedStats, fromCache: true, stale: true };
    }

    return { error: error.message };
  }
}
