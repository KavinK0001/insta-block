/**
 * InstaBlock - Popup Logic
 * Handles real-time status monitoring, countdown timer display,
 * and user settings configuration.
 */

document.addEventListener('DOMContentLoaded', () => {
  const statusPill = document.getElementById('status-pill');
  const stateText = document.getElementById('state-text');
  const timerLabel = document.getElementById('timer-label');
  const timerValue = document.getElementById('timer-value');
  const progressFill = document.getElementById('status-progress-fill');
  const statusHint = document.getElementById('status-hint');

  const sessionDurationInput = document.getElementById('session-duration');
  const cooldownDurationInput = document.getElementById('cooldown-duration');
  const saveBtn = document.getElementById('save-btn');
  const saveToast = document.getElementById('save-toast');
  const resetBtn = document.getElementById('reset-btn');
  const resetLockedHint = document.getElementById('reset-locked-hint');
  const settingsLockedBadge = document.getElementById('settings-locked-badge');
  const settingsLockedText = document.getElementById('settings-locked-text');

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

  /**
   * Format seconds to MM:SS or HH:MM:SS
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
   * Update the UI based on current state & timestamps
   */
  function updateUI() {
    const now = Date.now();
    const status = currentState.sessionStatus || 'idle';
    const sessionMins = currentState.sessionDurationMinutes || 5;
    const cooldownMins = currentState.cooldownDurationMinutes || 60;

    statusPill.className = 'status-pill';

    if (status === 'cooldown' && currentState.cooldownEndTime && currentState.cooldownEndTime > now) {
      const remainingSecs = Math.ceil((currentState.cooldownEndTime - now) / 1000);
      const totalSecs = cooldownMins * 60;
      const elapsed = Math.max(0, totalSecs - remainingSecs);
      const pct = Math.min(100, Math.max(0, (elapsed / totalSecs) * 100));

      statusPill.classList.add('status-cooldown');
      statusPill.textContent = 'Cooldown';
      stateText.textContent = 'Instagram Scrolling Locked';
      timerLabel.textContent = 'UNLOCKS IN';
      timerValue.textContent = formatTime(remainingSecs);
      timerValue.style.color = '#f87171';
      progressFill.style.width = `${pct}%`;
      progressFill.style.background = '#f87171';
      statusHint.textContent = `Feed, Stories, Reels, and profiles unlock at ${formatUnlockTime(currentState.cooldownEndTime)}. Direct Messages remain available.`;
    } else if (status === 'active') {
      const elapsedMs = currentState.sessionIsCounting && currentState.sessionLastTickAt
        ? Math.max(0, now - currentState.sessionLastTickAt)
        : 0;
      const remainingSecs = Number.isFinite(currentState.sessionRemainingMs)
        ? Math.ceil(Math.max(0, currentState.sessionRemainingMs - elapsedMs) / 1000)
        : Math.ceil(Math.max(0, (currentState.sessionEndTime || now) - now) / 1000);
      const totalSecs = sessionMins * 60;
      const elapsed = Math.max(0, totalSecs - remainingSecs);
      const pct = Math.min(100, Math.max(0, 100 - (elapsed / totalSecs) * 100));

      statusPill.classList.add('status-active');
      statusPill.textContent = currentState.sessionIsCounting ? 'Active' : 'Paused';
      stateText.textContent = currentState.sessionIsCounting ? 'Browsing Session Active' : 'Session Paused';
      timerLabel.textContent = 'TIME REMAINING';
      timerValue.textContent = formatTime(remainingSecs);
      timerValue.style.color = remainingSecs <= 30 ? '#f87171' : (remainingSecs <= 60 ? '#fbbf24' : '#fafafa');
      progressFill.style.width = `${pct}%`;
      progressFill.style.background = remainingSecs <= 30 ? '#f87171' : (remainingSecs <= 60 ? '#fbbf24' : '#fafafa');
      statusHint.textContent = currentState.sessionIsCounting
        ? `Your ${sessionMins}-min limit counts down on Feed, Stories, Reels, and profiles.`
        : 'Timer pauses outside Feed, Stories, Reels, and profiles. Direct Messages stay available.';
    } else {
      // Idle / Ready state
      statusPill.classList.add('status-idle');
      statusPill.textContent = 'Ready';
      stateText.textContent = 'Ready to Browse';
      timerLabel.textContent = 'NEXT SESSION LIMIT';
      timerValue.textContent = formatTime(Math.ceil(sessionMins * 60));
      timerValue.style.color = '#fafafa';
      progressFill.style.width = '100%';
      progressFill.style.background = '#fafafa';
      statusHint.textContent = `Visit Instagram Feed, Stories, Reels, or a profile to begin your ${sessionMins}-minute session.`;
    }

    // Manage locked state of settings and reset button during active session or cooldown
    const isLocked = status === 'active' || status === 'cooldown';
    sessionDurationInput.disabled = isLocked;
    cooldownDurationInput.disabled = isLocked;
    saveBtn.disabled = isLocked;
    resetBtn.disabled = isLocked;

    if (resetLockedHint) {
      if (isLocked) {
        resetLockedHint.classList.remove('hidden');
      } else {
        resetLockedHint.classList.add('hidden');
      }
    }

    if (isLocked) {
      settingsLockedBadge.classList.remove('hidden');
      if (settingsLockedText) {
        settingsLockedText.textContent = status === 'active' 
          ? 'Locked (Session Active)' 
          : 'Locked (Cooldown Active)';
      }
      // Revert input values to current saved settings while locked
      if (document.activeElement !== sessionDurationInput) {
        sessionDurationInput.value = sessionMins;
      }
      if (document.activeElement !== cooldownDurationInput) {
        cooldownDurationInput.value = cooldownMins;
      }
    } else {
      settingsLockedBadge.classList.add('hidden');
    }
  }

  /**
   * Fetch latest state from background service worker
   */
  async function fetchState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (response && response.success && response.state) {
        currentState = { ...currentState, ...response.state };
        updateUI();
      }
    } catch (e) {
      const data = await chrome.storage.local.get(null);
      currentState = { ...currentState, ...data };
      updateUI();
    }
  }

  /**
   * Load stored settings into input fields
   */
  async function loadSettings() {
    const data = await chrome.storage.local.get(['sessionDurationMinutes', 'cooldownDurationMinutes']);
    if (data.sessionDurationMinutes !== undefined) {
      sessionDurationInput.value = data.sessionDurationMinutes;
      currentState.sessionDurationMinutes = data.sessionDurationMinutes;
    }
    if (data.cooldownDurationMinutes !== undefined) {
      cooldownDurationInput.value = data.cooldownDurationMinutes;
      currentState.cooldownDurationMinutes = data.cooldownDurationMinutes;
    }
    updateUI();
  }

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    // Prevent updating settings while in session or cooldown
    if (currentState.sessionStatus === 'active' || currentState.sessionStatus === 'cooldown') {
      saveToast.textContent = '🔒 Settings cannot be changed during active session or cooldown!';
      saveToast.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      saveToast.style.color = '#f87171';
      saveToast.classList.remove('hidden');
      setTimeout(() => {
        saveToast.classList.add('hidden');
        saveToast.style.borderColor = '';
        saveToast.style.color = '';
      }, 2500);
      return;
    }

    let sessionMins = Number(sessionDurationInput.value);
    let cooldownMins = Number(cooldownDurationInput.value);

    if (!Number.isFinite(sessionMins) || sessionMins < 0.1) sessionMins = 5;
    if (!Number.isFinite(cooldownMins) || cooldownMins < 0.1) cooldownMins = 60;
    sessionMins = Math.round(Math.min(60, sessionMins) * 10) / 10;
    cooldownMins = Math.round(Math.min(1440, cooldownMins) * 10) / 10;

    sessionDurationInput.value = sessionMins;
    cooldownDurationInput.value = cooldownMins;

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        sessionDurationMinutes: sessionMins,
        cooldownDurationMinutes: cooldownMins
      });

      if (res && res.success) {
        currentState.sessionDurationMinutes = sessionMins;
        currentState.cooldownDurationMinutes = cooldownMins;
        updateUI();

        saveToast.textContent = '✓ Settings saved successfully';
        saveToast.classList.remove('hidden');
        setTimeout(() => {
          saveToast.classList.add('hidden');
        }, 2000);
      } else {
        saveToast.textContent = res.message || '⚠️ Unable to update settings.';
        saveToast.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        saveToast.style.color = '#f87171';
        saveToast.classList.remove('hidden');
        setTimeout(() => {
          saveToast.classList.add('hidden');
          saveToast.style.borderColor = '';
          saveToast.style.color = '';
        }, 2500);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  });

  // Reset Action (Allowed only when idle)
  resetBtn.addEventListener('click', async () => {
    if (currentState.sessionStatus === 'active' || currentState.sessionStatus === 'cooldown') {
      alert('Reset is disabled while a session or cooldown is active.');
      return;
    }

    const confirmed = confirm('Reset session duration to 5 minutes and cooldown period to 60 minutes?');
    if (!confirmed) return;

    try {
      const res = await chrome.runtime.sendMessage({ type: 'RESET_ALL' });
      if (res && res.success && res.state) {
        currentState = { ...currentState, ...res.state };
        sessionDurationInput.value = currentState.sessionDurationMinutes;
        cooldownDurationInput.value = currentState.cooldownDurationMinutes;
        updateUI();
      } else if (res && !res.success) {
        alert(res.message || 'Cannot reset timer at this time.');
      }
    } catch (e) {
      console.warn('Failed to reset:', e);
    }
  });

  // Support Me link click handler
  const supportBtn = document.getElementById('support-btn');
  if (supportBtn) {
    supportBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: supportBtn.href });
    });
  }

  // Initialize
  loadSettings();
  fetchState();

  // Tick UI every second while popup is open
  const timer = setInterval(() => {
    fetchState();
  }, 1000);

  window.addEventListener('unload', () => {
    clearInterval(timer);
  });
});
