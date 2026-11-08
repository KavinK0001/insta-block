/**
 * InstaBlock - Background Service Worker
 * Manages timer state, alarms, badge updates, and cross-tab synchronization.
 */

const DEFAULT_SETTINGS = {
  sessionDurationMinutes: 5,
  cooldownDurationMinutes: 60,
  sessionStatus: 'idle', // 'idle' | 'active' | 'cooldown'
  sessionEndTime: null,
  sessionRemainingMs: null,
  sessionIsCounting: false,
  sessionLastTickAt: null,
  cooldownEndTime: null,
  sessionStartTime: null
};

const SESSION_HEARTBEAT_TIMEOUT_MS = 10000;

function normalizeDurationMinutes(value, fallback, maximum) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) {
    return fallback;
  }
  return Math.round(Math.min(maximum, Math.max(0.1, minutes)) * 10) / 10;
}

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(null);
  const toSet = {};

  for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
    if (data[key] === undefined) {
      toSet[key] = val;
    }
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  await updateBadge();
});

// Periodic alarm to keep state synchronized and update badges
chrome.alarms.create('INSTABLOCK_TICK', { periodInMinutes: 0.5 }); // tick every 30s
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'INSTABLOCK_TICK') {
    await syncState();
  }
});

/**
 * Checks timestamps and updates sessionStatus if expired.
 */
async function syncState() {
  const data = await chrome.storage.local.get([
    'sessionStatus',
    'sessionEndTime',
    'sessionRemainingMs',
    'sessionIsCounting',
    'sessionLastTickAt',
    'cooldownEndTime',
    'cooldownDurationMinutes',
    'sessionDurationMinutes'
  ]);

  const now = Date.now();
  let status = data.sessionStatus || 'idle';
  let updated = false;

  if (status === 'active') {
    const storedRemainingMs = Number.isFinite(data.sessionRemainingMs)
      ? data.sessionRemainingMs
      : Math.max(0, (data.sessionEndTime || now) - now);
    const elapsedMs = data.sessionIsCounting && data.sessionLastTickAt
      ? Math.min(SESSION_HEARTBEAT_TIMEOUT_MS, Math.max(0, now - data.sessionLastTickAt))
      : 0;
    const remainingMs = Math.max(0, storedRemainingMs - elapsedMs);

    if (remainingMs <= 0) {
      const cooldownMs = normalizeDurationMinutes(
        data.cooldownDurationMinutes,
        DEFAULT_SETTINGS.cooldownDurationMinutes,
        1440
      ) * 60 * 1000;
      data.sessionStatus = 'cooldown';
      data.cooldownEndTime = now + cooldownMs;
      data.sessionEndTime = null;
      data.sessionRemainingMs = null;
      data.sessionIsCounting = false;
      data.sessionLastTickAt = null;
      updated = true;
    } else if (
      data.sessionIsCounting &&
      data.sessionLastTickAt &&
      now - data.sessionLastTickAt > SESSION_HEARTBEAT_TIMEOUT_MS
    ) {
      data.sessionRemainingMs = remainingMs;
      data.sessionIsCounting = false;
      data.sessionLastTickAt = null;
      data.sessionEndTime = null;
      updated = true;
    } else {
      data.sessionRemainingMs = remainingMs;
      data.sessionEndTime = data.sessionIsCounting ? now + remainingMs : null;
    }
  } else if (status === 'cooldown') {
    if (data.cooldownEndTime && now >= data.cooldownEndTime) {
      // Cooldown has expired -> back to idle
      status = 'idle';
      data.sessionStatus = 'idle';
      data.cooldownEndTime = null;
      data.sessionEndTime = null;
      data.sessionStartTime = null;
      data.sessionRemainingMs = null;
      data.sessionIsCounting = false;
      data.sessionLastTickAt = null;
      updated = true;
    }
  }

  if (updated) {
    await chrome.storage.local.set({
      sessionStatus: data.sessionStatus,
      sessionEndTime: data.sessionEndTime,
      sessionRemainingMs: data.sessionRemainingMs,
      sessionIsCounting: data.sessionIsCounting,
      sessionLastTickAt: data.sessionLastTickAt,
      cooldownEndTime: data.cooldownEndTime,
      sessionStartTime: data.sessionStartTime || null
    });
  }

  await updateBadge(data);
  return data;
}

/**
 * Updates browser action badge with current countdown
 */
async function updateBadge(stateData) {
  const data = stateData || await chrome.storage.local.get(['sessionStatus', 'sessionEndTime', 'cooldownEndTime']);
  const now = Date.now();
  const status = data.sessionStatus || 'idle';

  if (status === 'active' && data.sessionEndTime && data.sessionEndTime > now) {
    const minsLeft = Math.max(1, Math.ceil((data.sessionEndTime - now) / 60000));
    await chrome.action.setBadgeText({ text: `${minsLeft}m` });
    await chrome.action.setBadgeBackgroundColor({ color: '#27272a' }); // Dark zinc
  } else if (status === 'cooldown' && data.cooldownEndTime && data.cooldownEndTime > now) {
    const minsLeft = Math.max(1, Math.ceil((data.cooldownEndTime - now) / 60000));
    await chrome.action.setBadgeText({ text: `${minsLeft}m` });
    await chrome.action.setBadgeBackgroundColor({ color: '#991b1b' }); // Muted dark red
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// Listen to storage changes to keep badge synced immediately
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    updateBadge();
  }
});

async function isForegroundTab(sender) {
  if (!sender.tab || !Number.isInteger(sender.tab.id) || !sender.tab.active) {
    return false;
  }

  const focusedWindow = await chrome.windows.getLastFocused();
  return focusedWindow.id === sender.tab.windowId;
}

async function reportActivity(sender, message) {
  const state = await syncState();
  if (state.sessionStatus !== 'active') {
    return state;
  }

  if (!await isForegroundTab(sender)) {
    return state;
  }

  const isCounting = Boolean(message.isMonitored && message.isVisible);
  const now = Date.now();
  const activityState = {
    sessionIsCounting: isCounting,
    sessionLastTickAt: isCounting ? now : null,
    sessionRemainingMs: state.sessionRemainingMs,
    sessionEndTime: isCounting ? now + state.sessionRemainingMs : null
  };
  await chrome.storage.local.set(activityState);
  return { ...state, ...activityState };
}

async function requestFocusedTabActivity(windowId) {
  const state = await syncState();
  if (state.sessionStatus === 'active') {
    await chrome.storage.local.set({
      sessionRemainingMs: state.sessionRemainingMs,
      sessionIsCounting: false,
      sessionLastTickAt: null,
      sessionEndTime: null
    });
  }

  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (activeTab) {
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'CHECK_ACTIVITY' });
    } catch (error) {
      // The focused tab may not have an InstaBlock content script.
    }
  }
}

chrome.tabs.onActivated.addListener(({ windowId }) => {
  requestFocusedTabActivity(windowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  requestFocusedTabActivity(windowId);
});

// Message handler for content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'START_SESSION') {
        const state = await syncState();
        const now = Date.now();

        // If currently in cooldown, cannot start session!
        if (state.sessionStatus === 'cooldown' && state.cooldownEndTime && state.cooldownEndTime > now) {
          sendResponse({
            success: false,
            reason: 'cooldown_active',
            state
          });
          return;
        }

        // If already active, return current state
        if (state.sessionStatus === 'active') {
          sendResponse({
            success: true,
            alreadyActive: true,
            state
          });
          return;
        }

        // Start new session
        const sessionMins = state.sessionDurationMinutes || DEFAULT_SETTINGS.sessionDurationMinutes;
        const newState = {
          sessionStatus: 'active',
          sessionStartTime: now,
          sessionEndTime: null,
          sessionRemainingMs: sessionMins * 60 * 1000,
          sessionIsCounting: false,
          sessionLastTickAt: null,
          cooldownEndTime: null
        };

        await chrome.storage.local.set(newState);
        const startedState = await reportActivity(sender, message);
        await updateBadge(startedState);

        sendResponse({
          success: true,
          alreadyActive: false,
          state: { ...state, ...newState, ...startedState }
        });
      } else if (message.type === 'REPORT_ACTIVITY') {
        const activityState = await reportActivity(sender, message);
        sendResponse({ success: true, state: activityState });
      } else if (message.type === 'GET_STATE') {
        const state = await syncState();
        sendResponse({ success: true, state });
      } else if (message.type === 'END_SESSION_NOW') {
        const state = await syncState();
        sendResponse({ success: true, state });
      } else if (message.type === 'UPDATE_SETTINGS') {
        const state = await syncState();
        // Disallow changing settings if currently in active session or waiting for cooldown
        if (state.sessionStatus === 'active' || state.sessionStatus === 'cooldown') {
          sendResponse({
            success: false,
            reason: 'settings_locked',
            message: 'Settings cannot be modified during an active scroll session or while waiting for cooldown.'
          });
          return;
        }

        const sessionMins = normalizeDurationMinutes(
          message.sessionDurationMinutes,
          DEFAULT_SETTINGS.sessionDurationMinutes,
          60
        );
        const cooldownMins = normalizeDurationMinutes(
          message.cooldownDurationMinutes,
          DEFAULT_SETTINGS.cooldownDurationMinutes,
          1440
        );

        await chrome.storage.local.set({
          sessionDurationMinutes: sessionMins,
          cooldownDurationMinutes: cooldownMins
        });

        sendResponse({
          success: true,
          sessionDurationMinutes: sessionMins,
          cooldownDurationMinutes: cooldownMins
        });
      } else if (message.type === 'RESET_ALL') {
        const state = await syncState();
        // Disallow resetting timer while in active session or waiting for cooldown
        if (state.sessionStatus === 'active' || state.sessionStatus === 'cooldown') {
          sendResponse({
            success: false,
            reason: 'reset_locked',
            message: 'Reset is disabled while a session or cooldown is active.'
          });
          return;
        }

        const resetState = {
          sessionDurationMinutes: DEFAULT_SETTINGS.sessionDurationMinutes,
          cooldownDurationMinutes: DEFAULT_SETTINGS.cooldownDurationMinutes,
          sessionStatus: 'idle',
          sessionStartTime: null,
          sessionEndTime: null,
          sessionRemainingMs: null,
          sessionIsCounting: false,
          sessionLastTickAt: null,
          cooldownEndTime: null
        };
        await chrome.storage.local.set(resetState);
        await updateBadge(resetState);
        sendResponse({ success: true, state: resetState });
      } else {
        sendResponse({ success: false, reason: 'unknown_message_type' });
      }
    } catch (err) {
      console.error('[InstaBlock Service Worker] Error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});

// Notify content scripts when the tab URL changes (for SPA route detection)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes('instagram.com')) {
    chrome.tabs.sendMessage(tabId, { type: 'ROUTE_CHANGED', url: changeInfo.url }).catch(() => {
      // Tab might not have content script ready yet, ignore
    });
  }
});
