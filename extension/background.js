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

    // Give content script more time to initialize
    await new Promise(r => setTimeout(r, 5000));
  }

  // Try sending message with retries
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[RealtorTracker] Sending message to content script (attempt ${attempt}/${maxRetries})...`);

      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'fetchListings' }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Connection failed'));
            return;
          }
          resolve(response);
        });
      });

      if (!response) {
        throw new Error('No response from content script');
      }

      if (response.success) {
        // Close tab after successful fetch
        if (createdTab) {
          try {
            await chrome.tabs.remove(tab.id);
            console.log('[RealtorTracker] Closed background tab');
          } catch (e) {
            // Tab might already be closed
          }
        }
        return response.listings;
      } else {
        throw new Error(response.error || 'Failed to fetch listings');
      }
    } catch (error) {
      lastError = error;
      console.log(`[RealtorTracker] Attempt ${attempt} failed:`, error.message);

      if (attempt < maxRetries) {
        // Wait before retry
        await new Promise(r => setTimeout(r, 3000));

        // Attempt to recover: Reload the tab or open a new one
        try {
          await chrome.tabs.get(tab.id);
          console.log('[RealtorTracker] Reloading tab to fix connection/session...');

          await chrome.tabs.reload(tab.id);

          // Wait for reload to complete
          await new Promise(resolve => {
            const listener = (tabId, info) => {
              if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            // Fallback timeout 15s
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
          });

          // Give content script time to init
          await new Promise(r => setTimeout(r, 5000));

        } catch (e) {
          console.log('[RealtorTracker] Tab was closed, reopening...');
          tab = await chrome.tabs.create({ url: 'https://www.realtor.ca/map', active: false });
          createdTab = true;

          await new Promise(resolve => {
            const listener = (tabId, info) => {
              if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });

          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }
  }

  // All retries failed, close tab if we created it
  if (createdTab) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) { }
  }

  throw new Error(lastError?.message || 'Could not connect to realtor.ca. Please click Capture Session.');
}

async function syncToSheets(currentListings) {
  try {
    // 1. Get Active IDs from Server to determine what to send
    console.log('[RealtorTracker] Fetching existing active MLS numbers from Sheets...');

    let activeMlsSet = null;

    try {
      const serverCheck = await fetch(`${CONFIG.SCRIPT_URL}?action=getActiveMlsNumbers`);
      if (serverCheck.ok) {
        const serverCheckText = await serverCheck.text();
        // Safety check for HTML response (auth error or generic error page)
        if (!serverCheckText.includes('<!DOCTYPE') && !serverCheckText.includes('<html')) {
          const responseJson = JSON.parse(serverCheckText);
          if (responseJson.mlsNumbers) {
            activeMlsSet = new Set(responseJson.mlsNumbers);
          }
        }
      }
    } catch (e) {
      console.warn('[RealtorTracker] Smart Sync unavailable (Script not updated?), falling back to full sync.', e);
    }

    // 2. Compute Deltas
    const currentMap = new Map();
    currentListings.forEach(l => currentMap.set(String(l.mlsNumber), l));

    const toInsert = [];
    const toTouch = []; // IDs to update 'Active' timestamp
    const toMarkSold = []; // IDs to update to 'Sold'

    if (activeMlsSet) {
      // Smart Sync Logic
      const currentMlsSet = new Set(currentMap.keys());

      // Identify New & Touched
      for (const [mls, listing] of currentMap) {
        if (activeMlsSet.has(mls)) {
          toTouch.push(mls);
        } else {
          toInsert.push(listing);
        }
      }

      // Identify Sold (In server active set, but not in current fetch)
      for (const mls of activeMlsSet) {
        if (!currentMlsSet.has(mls)) {
          toMarkSold.push(mls);
        }
      }
      console.log(`[RealtorTracker] Smart Sync Analysis:
        - New Listings (to insert): ${toInsert.length}
        - Still Active (to touch): ${toTouch.length}
        - Sold/Removed (to mark): ${toMarkSold.length}`);
    } else {
      // Fallback: Treat everything as "toInsert" (New/Update)
      // The server-side 'syncBatch' handles existing items by updating them, so this is safe.
      // We won't be able to mark items as Sold efficiently here without the active set,
      // but syncBatch marks items sold on the 'isLastBatch' call based on logic there?
      // Wait, syncBatch only marks sold if we send EVERYTHING?
      // Yes, syncBatch logic: "Find listings not seen today (not in the current sync)".
      // So if we send all current listings, it works perfectly.
      console.log('[RealtorTracker] Performing full sync (Smart Sync skipped)...');
      currentListings.forEach(l => toInsert.push(l));
    }

    // 3. Send Bulk Status Update (Touch + Sold)
    if (toTouch.length > 0 || toMarkSold.length > 0) {
      console.log('[RealtorTracker] Sending bulk status update...');
      const statusPayload = {
        action: 'syncStatus',
        activeIds: toTouch,
        soldIds: toMarkSold,
        totalActive: currentListings.length
      };

      const statusResp = await fetch(CONFIG.SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statusPayload),
        redirect: 'follow', credentials: 'omit'
      });

      if (!statusResp.ok) throw new Error('Failed to update status');
    }

    // 4. Send New Listings (Batched)
    if (toInsert.length > 0) {
      const batchSize = 50;
      console.log(`[RealtorTracker] inserting ${toInsert.length} new listings...`);

      for (let i = 0; i < toInsert.length; i += batchSize) {
        chrome.alarms.create('keepAlive', { when: Date.now() + 30000 });

        const batch = toInsert.slice(i, i + batchSize);
        const isLastBatch = (i + batchSize) >= toInsert.length;
        const batchLabel = `${Math.floor(i / batchSize) + 1}/${Math.ceil(toInsert.length / batchSize)}`;

        console.log(`[RealtorTracker] Syncing new batch ${batchLabel}...`);

        // We use syncBatch for inserts. Note: isLastBatch param used to trigger daily stats update
        // We should set isLastBatch=true only on the very last op.
        // Actually syncStatus already updated stats. But we have new listings now.
        // syncBatch adds new listings and updates stats. 

        const payload = {
          action: 'syncBatch',
          listings: batch,
          isLastBatch: isLastBatch,
          totalListings: currentListings.length
        };

        await fetch(CONFIG.SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'omit'
        });

        await new Promise(r => setTimeout(r, 500));
      }
    }

    return { success: true, newListings: toInsert.length, soldListings: toMarkSold.length, totalActive: currentListings.length };

  } catch (error) {
    console.error('[RealtorTracker] Sync failed:', error);
    return { success: false, error: error.message };
  }
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
