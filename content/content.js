/**
 * InstaBlock - Content Script
 * Injected on Instagram. Manages Reels detection, scroll session initiation,
 * floating countdown HUD, and the full-screen cooldown lockout overlay.
 */

(function () {
  'use strict';

  // SVG Icons
  const CLOCK_ICON_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.1.8-1.3-4.5-2.7V7z"/></svg>`;
  const LOCK_ICON_SVG = `<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
  const MIN_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>`;
  const FEED_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`;
  const DM_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

  let currentState = {
    sessionStatus: 'idle',
    sessionStartTime: null,
    sessionEndTime: null,
    sessionRemainingMs: null,
    sessionIsCounting: false,
    sessionLastTickAt: null,
    cooldownEndTime: null,
    sessionDurationMinutes: 5,
    cooldownDurationMinutes: 60
  };

  let hudElement = null;
  let overlayElement = null;
  let tickerInterval = null;
  let currentPath = window.location.pathname;
  let isDraggingHud = false;
  let dragOffset = { x: 0, y: 0 };
  let sessionInitiatedForCurrentVisit = false;
  let activityReportErrorLogged = false;

  function clearSessionVisitState() {
    sessionInitiatedForCurrentVisit = false;
  }

  /**
   * Check if current page is within monitored feed, story, reel, or profile sections.
   */
  function isMonitoredSection() {
    const path = window.location.pathname;
    const segments = path.split('/').filter(Boolean);

    if (path === '/' || path === '') {
      return true;
    }

    if (
      path.startsWith('/explore') ||
      path.startsWith('/p/') ||
      path.startsWith('/reels') ||
      path.startsWith('/reel/') ||
      path.startsWith('/stories')
    ) {
      return true;
    }

    const reservedRoutes = new Set([
      'accounts', 'about', 'api', 'create', 'direct', 'emails', 'explore', 'help',
      'legal', 'notifications', 'p', 'reel', 'reels', 'search', 'settings',
      'stories', 'web', 'your_activity'
    ]);
    const profileName = segments[0];

    if (!profileName || reservedRoutes.has(profileName.toLowerCase())) {
      return false;
    }

    return /^[A-Za-z0-9._]+$/.test(profileName);
  }

  function getSessionRemainingSeconds(now = Date.now()) {
    if (Number.isFinite(currentState.sessionRemainingMs)) {
      const elapsedMs = currentState.sessionIsCounting && currentState.sessionLastTickAt
        ? Math.max(0, now - currentState.sessionLastTickAt)
        : 0;
      return Math.ceil(Math.max(0, currentState.sessionRemainingMs - elapsedMs) / 1000);
    }
    return currentState.sessionEndTime
      ? Math.ceil(Math.max(0, currentState.sessionEndTime - now) / 1000)
      : 0;
  }

  /**
   * Format seconds to mm:ss or hh:mm:ss
   */
  function formatTime(totalSeconds) {
    if (totalSeconds < 0) totalSeconds = 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatUnlockTime(timestamp) {
    const unlockDate = new Date(timestamp);
    const options = { hour: 'numeric', minute: '2-digit' };
    if (unlockDate.toDateString() !== new Date().toDateString()) {
      options.month = 'short';
      options.day = 'numeric';
    }
    return unlockDate.toLocaleString(undefined, options);
  }

  /**
   * Pause and mute all video and audio elements on the page
   */
  function pauseVideos() {
    const media = document.querySelectorAll('video, audio');
    media.forEach((item) => {
      try {
        if (!item.paused) {
          item.pause();
        }
        item.muted = true;
      } catch (err) {
        // Ignore playback suppression errors
      }
    });
  }

  /**
   * Prevent scroll and navigation keystrokes during cooldown
   */
  function setupScrollBlocking() {
    const blockKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Space', 'Home', 'End'];

    const handleBlockedEvent = (e) => {
      if (isMonitoredSection() && currentState.sessionStatus === 'cooldown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        pauseVideos();
        return false;
      }
    };

    window.addEventListener('wheel', handleBlockedEvent, { passive: false, capture: true });
    window.addEventListener('touchmove', handleBlockedEvent, { passive: false, capture: true });
    window.addEventListener('keydown', (e) => {
      if (blockKeys.includes(e.code) || blockKeys.includes(e.key)) {
        handleBlockedEvent(e);
      }
    }, { capture: true });
  }

  /**
   * Helper to check if extension context is still valid
   */
  function isExtensionValid() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  }

  /**
   * Fetch current state from storage or service worker
   */
  async function refreshState() {
    if (!isExtensionValid()) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (response && response.success && response.state) {
        currentState = { ...currentState, ...response.state };
        if (currentState.sessionStatus !== 'active') {
          clearSessionVisitState();
        }
        handleStateChange();
      }
    } catch (e) {
      if (!isExtensionValid() || !chrome.storage || !chrome.storage.local) return;
      try {
        const data = await chrome.storage.local.get(null);
        currentState = { ...currentState, ...data };
        if (currentState.sessionStatus !== 'active') {
          clearSessionVisitState();
        }
        handleStateChange();
      } catch (err) {}
    }
  }

  async function reportActivity() {
    if (!isExtensionValid()) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REPORT_ACTIVITY',
        isMonitored: isMonitoredSection(),
        isVisible: document.visibilityState === 'visible'
      });
      if (response && response.success && response.state) {
        currentState = { ...currentState, ...response.state };
        activityReportErrorLogged = false;
        handleStateChange();
      }
    } catch (err) {
      if (!activityReportErrorLogged) {
        console.warn('[InstaBlock] Activity report failed; it will retry.', err);
        activityReportErrorLogged = true;
      }
    }
  }

  /**
   * Start a shared browsing session
   */
  async function initiateScrollSession() {
    if (sessionInitiatedForCurrentVisit) return;
    if (!isExtensionValid()) return;
    sessionInitiatedForCurrentVisit = true;

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'START_SESSION',
        isMonitored: isMonitoredSection(),
        isVisible: document.visibilityState === 'visible'
      });
      if (res && res.state) {
        currentState = { ...currentState, ...res.state };
        if (currentState.sessionStatus !== 'active') {
          clearSessionVisitState();
        }
        handleStateChange();
      } else {
        clearSessionVisitState();
      }
    } catch (err) {
      clearSessionVisitState();
      // Extension was reloaded or context became invalid
    }
  }

  /**
   * Create or update the Floating Timer HUD
   */
  function renderHud(secondsRemaining) {
    if (!document.body) return;

    if (!hudElement) {
      hudElement = document.createElement('div');
      hudElement.id = 'instablock-hud';
      hudElement.innerHTML = `
        <div class="instablock-hud-icon">${CLOCK_ICON_SVG}</div>
        <div class="instablock-hud-content">
          <span class="instablock-hud-label">Time remaining</span>
          <span class="instablock-hud-time" id="instablock-time-text">--:--</span>
        </div>
        <button class="instablock-hud-min-btn" id="instablock-min-btn" title="Toggle Compact View" aria-label="Minimize">
          ${MIN_ICON_SVG}
        </button>
      `;

      // Draggable HUD functionality
      const onMouseDown = (e) => {
        if (e.target.closest('#instablock-min-btn')) return;
        isDraggingHud = true;
        const rect = hudElement.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        hudElement.style.transition = 'none';
        e.preventDefault();
      };

      const onMouseMove = (e) => {
        if (!isDraggingHud) return;
        const x = Math.max(10, Math.min(window.innerWidth - hudElement.offsetWidth - 10, e.clientX - dragOffset.x));
        const y = Math.max(10, Math.min(window.innerHeight - hudElement.offsetHeight - 10, e.clientY - dragOffset.y));
        hudElement.style.left = `${x}px`;
        hudElement.style.top = `${y}px`;
        hudElement.style.right = 'auto';
      };

      const onMouseUp = () => {
        if (isDraggingHud) {
          isDraggingHud = false;
          hudElement.style.transition = '';
        }
      };

      hudElement.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      // Touch support for drag
      hudElement.addEventListener('touchstart', (e) => {
        if (e.target.closest('#instablock-min-btn')) return;
        isDraggingHud = true;
        const touch = e.touches[0];
        const rect = hudElement.getBoundingClientRect();
        dragOffset.x = touch.clientX - rect.left;
        dragOffset.y = touch.clientY - rect.top;
      }, { passive: true });

      window.addEventListener('touchmove', (e) => {
        if (!isDraggingHud) return;
        const touch = e.touches[0];
        const x = Math.max(10, Math.min(window.innerWidth - hudElement.offsetWidth - 10, touch.clientX - dragOffset.x));
        const y = Math.max(10, Math.min(window.innerHeight - hudElement.offsetHeight - 10, touch.clientY - dragOffset.y));
        hudElement.style.left = `${x}px`;
        hudElement.style.top = `${y}px`;
        hudElement.style.right = 'auto';
      }, { passive: true });

      window.addEventListener('touchend', () => {
        isDraggingHud = false;
      });

      // Minimize button handler
      const minBtn = hudElement.querySelector('#instablock-min-btn');
      minBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hudElement.classList.toggle('minimized');
      });

      document.body.appendChild(hudElement);
    }

    const timeText = hudElement.querySelector('#instablock-time-text');
    if (timeText) {
      timeText.textContent = formatTime(secondsRemaining);
    }

    // Visual indicators based on time left
    hudElement.classList.remove('hud-warning', 'hud-danger');
    if (secondsRemaining <= 30) {
      hudElement.classList.add('hud-danger');
    } else if (secondsRemaining <= 90) {
      hudElement.classList.add('hud-warning');
    }
  }

  function removeHud() {
    if (hudElement) {
      hudElement.remove();
      hudElement = null;
    }
  }

  /**
   * Create or update the Fullscreen Cooldown Lockout Overlay
   */
  function renderOverlay(secondsRemaining, totalCooldownSeconds) {
    if (!document.body) return;

    pauseVideos();
    document.body.classList.add('instablock-locked');

    if (!overlayElement) {
      overlayElement = document.createElement('div');
      overlayElement.id = 'instablock-overlay';
      overlayElement.innerHTML = `
        <div class="instablock-card">
          <div class="instablock-badge-icon">
            ${LOCK_ICON_SVG}
          </div>
          <h1 class="instablock-title">Time Limit Reached</h1>
          <p class="instablock-subtitle">
            Feed, Stories, Reels, and profiles are locked until your break ends. Direct Messages remain available.
          </p>

          <div class="instablock-timer-box">
            <span class="instablock-timer-label">Unlocks In</span>
            <span class="instablock-timer-display" id="instablock-overlay-countdown">--:--</span>
            <span class="instablock-unlock-at" id="instablock-overlay-unlock-at"></span>
            <div class="instablock-progress-bar">
              <div class="instablock-progress-fill" id="instablock-overlay-progress"></div>
            </div>
          </div>

          <div class="instablock-actions">
            <button type="button" class="instablock-btn-primary" id="instablock-btn-dms">
              ${DM_ICON_SVG}
              <span>Open Direct Messages</span>
            </button>
          </div>

          <p class="instablock-tip">
            Tip: Stand up, stretch, or check your direct messages!
          </p>
        </div>
      `;

      // Prevent events escaping overlay
      overlayElement.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true });
      overlayElement.addEventListener('touchmove', (e) => e.stopPropagation(), { capture: true });

      // Handle DMs button click cleanly
      const dmBtn = overlayElement.querySelector('#instablock-btn-dms');
      if (dmBtn) {
        dmBtn.addEventListener('click', (e) => {
          e.preventDefault();
          window.location.href = 'https://www.instagram.com/direct/inbox/';
        });
      }

      document.body.appendChild(overlayElement);
    }

    const countdownText = overlayElement.querySelector('#instablock-overlay-countdown');
    if (countdownText) {
      countdownText.textContent = formatTime(secondsRemaining);
    }

    const unlockAtText = overlayElement.querySelector('#instablock-overlay-unlock-at');
    if (unlockAtText && currentState.cooldownEndTime) {
      unlockAtText.textContent = `Available again at ${formatUnlockTime(currentState.cooldownEndTime)}`;
    }

    const progressFill = overlayElement.querySelector('#instablock-overlay-progress');
    if (progressFill && totalCooldownSeconds > 0) {
      const elapsed = Math.max(0, totalCooldownSeconds - secondsRemaining);
      const percentage = Math.min(100, Math.max(0, (elapsed / totalCooldownSeconds) * 100));
      progressFill.style.width = `${percentage}%`;
    }
  }

  function removeOverlay() {
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
    }
    document.body.classList.remove('instablock-locked');
  }

  /**
   * Main ticker loop runs every second to update HUD or Lockout
   */
  function startTicker() {
    if (tickerInterval) clearInterval(tickerInterval);

    tickerInterval = setInterval(async () => {
      if (!isExtensionValid()) {
        clearInterval(tickerInterval);
        return;
      }
      await reportActivity();
      const onMonitored = isMonitoredSection();
      const now = Date.now();

      if (!onMonitored) {
        // The timer pauses elsewhere; keep the HUD limited to monitored sections.
        removeOverlay();
        removeHud();
        return;
      }

      // If in cooldown
      if (currentState.sessionStatus === 'cooldown') {
        removeHud();
        if (currentState.cooldownEndTime && currentState.cooldownEndTime > now) {
          const secondsLeft = Math.ceil((currentState.cooldownEndTime - now) / 1000);
          const totalCooldownSecs = (currentState.cooldownDurationMinutes || 60) * 60;
          renderOverlay(secondsLeft, totalCooldownSecs);
          pauseVideos();
        } else {
          // Cooldown finished!
          removeOverlay();
          await refreshState();
        }
        return;
      }

      // If active session
      if (currentState.sessionStatus === 'active') {
        removeOverlay();
        const secondsLeft = getSessionRemainingSeconds(now);
        if (secondsLeft > 0) {
          renderHud(secondsLeft);
        } else {
          removeHud();
          await refreshState();
        }
        return;
      }

      // If idle on monitored section
      if (currentState.sessionStatus === 'idle') {
        removeOverlay();
        removeHud();
      }
    }, 1000);
  }

  /**
   * Reacts to state changes
   */
  function handleStateChange() {
    const onMonitored = isMonitoredSection();
    const now = Date.now();

    if (!onMonitored) {
      clearSessionVisitState();
      removeOverlay();
      removeHud();
      return;
    }

    if (currentState.sessionStatus !== 'active') {
      clearSessionVisitState();
    }

    if (currentState.sessionStatus === 'cooldown') {
      removeHud();
      if (currentState.cooldownEndTime && currentState.cooldownEndTime > now) {
        const secondsLeft = Math.ceil((currentState.cooldownEndTime - now) / 1000);
        const totalSecs = (currentState.cooldownDurationMinutes || 60) * 60;
        renderOverlay(secondsLeft, totalSecs);
        pauseVideos();
      } else {
        removeOverlay();
      }
    } else if (currentState.sessionStatus === 'active') {
      removeOverlay();
      renderHud(getSessionRemainingSeconds(now));
    } else if (currentState.sessionStatus === 'idle') {
      removeOverlay();
      removeHud();
    }
  }

  /**
   * Listen for user interactions that initiate a scroll session
   */
  function setupInteractionListeners() {
    const onUserInteraction = () => {
      if (isMonitoredSection() && currentState.sessionStatus === 'idle') {
        initiateScrollSession();
      }
    };

    // User scrolls wheel, drags touch, or presses arrow keys
    window.addEventListener('wheel', onUserInteraction, { passive: true });
    window.addEventListener('touchstart', onUserInteraction, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Space'].includes(e.code)) {
        onUserInteraction();
      }
    }, { passive: true });

    // Also initiate if user visits monitored section and dwells for 1.2s
    let dwellTimeout = null;
    const checkDwell = () => {
      if (dwellTimeout) clearTimeout(dwellTimeout);
      if (isMonitoredSection() && currentState.sessionStatus === 'idle') {
        dwellTimeout = setTimeout(() => {
          if (isMonitoredSection() && currentState.sessionStatus === 'idle') {
            initiateScrollSession();
          }
        }, 1200);
      }
    };

    checkDwell();
    return checkDwell;
  }

  /**
   * Handle SPA route changes
   */
  function setupRouteObserver(checkDwell) {
    const onUrlChange = () => {
      const newPath = window.location.pathname;
      if (newPath !== currentPath) {
        currentPath = newPath;
        clearSessionVisitState();
        refreshState();
        reportActivity();
        if (checkDwell) checkDwell();
      }
    };

    // Poll location pathname for changes
    setInterval(onUrlChange, 350);

    // Listen to history events
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

    // Listen to background service worker route messages
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'ROUTE_CHANGED') {
        onUrlChange();
      } else if (msg.type === 'CHECK_ACTIVITY') {
        reportActivity();
      }
    });
  }

  /**
   * Ensure overlay isn't removed by Instagram's React DOM updates during cooldown
   */
  function setupAntiTamperObserver() {
    const observer = new MutationObserver(() => {
      if (isMonitoredSection() && currentState.sessionStatus === 'cooldown' && !document.getElementById('instablock-overlay')) {
        const now = Date.now();
        if (currentState.cooldownEndTime && currentState.cooldownEndTime > now) {
          overlayElement = null; // reset reference so it recreates
          const secondsLeft = Math.ceil((currentState.cooldownEndTime - now) / 1000);
          const totalSecs = (currentState.cooldownDurationMinutes || 60) * 60;
          renderOverlay(secondsLeft, totalSecs);
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true });
      });
    }
  }

  /**
   * Listen to storage changes across all tabs
   */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      for (const [key, change] of Object.entries(changes)) {
        currentState[key] = change.newValue;
      }

      if (currentState.sessionStatus !== 'active') {
        clearSessionVisitState();
      }

      handleStateChange();
    }
  });

  /**
   * Main Initialization
   */
  async function init() {
    setupScrollBlocking();
    const checkDwell = setupInteractionListeners();
    setupRouteObserver(checkDwell);
    setupAntiTamperObserver();
    document.addEventListener('visibilitychange', reportActivity);
    startTicker();
    await refreshState();
    await reportActivity();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
