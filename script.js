'use strict';

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CAPPER SPORTS CLUB â€” script.js
   Enhanced UI: Tab system + Voice + Reports
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const STORAGE_KEYS = {
  apiBase: 'capper-api-base',
  token: 'capper-token',
  cooldowns: 'capper-attendance-cooldowns',
  sessionTimers: 'capper-session-timers',
};
const DEFAULT_API_BASE = 'https://caper-club-backend-production.up.railway.app';
const LIVE_SCAN_INTERVAL = 850;
const FACE_SCAN_DEBOUNCE_MS = 3000;
const ATTENDANCE_COOLDOWN_MS = 5 * 60 * 1000;
const MIN_EXIT_BEFORE_CHECKOUT_MS = 5 * 60 * 1000;
const COOLDOWN_VOICE_THROTTLE_MS = 30000;
const CAMERA_SEARCH_PREVIEW_ZOOM = 1.08;
const MAX_PREVIEW_ZOOM = 2.6;
const ENROLLMENT_ZOOM_STEP = 0.2;
const DEFAULT_CAMERA_FOCUS_X = 0.5;
const DEFAULT_CAMERA_FOCUS_Y = 0.46;
const ACTIVE_SESSIONS_RENDER_INTERVAL_MS = 5000;
const CAMERA_CONSTRAINT_SETS = Object.freeze([
  {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 24, max: 30 },
    },
  },
  {
    audio: false,
    video: {
      facingMode: { ideal: 'user' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 24, max: 30 },
    },
  },
  {
    audio: false,
    video: {
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 24, max: 30 },
    },
  },
  {
    audio: false,
    video: true,
  },
]);

const TONE_MAP = {
  green:'tone-green', valid:'tone-green', granted:'tone-green', active:'tone-green', paid:'tone-green', user:'tone-green',
  blue:'tone-blue', admin:'tone-blue',
  purple:'tone-purple', violet:'tone-purple',
  red:'tone-red', denied:'tone-red', error:'tone-red', expired:'tone-red', unknown:'tone-red',
  amber:'tone-amber', warning:'tone-amber', pending:'tone-amber', duplicate:'tone-amber', retry:'tone-amber', cooldown:'tone-amber', ended:'tone-amber',
};

/* ── SPORT MEMBERSHIP LEVELS (from club database) ── */
const SPORT_LEVELS = {
  Swimming: [
    { value: 'Swimming Month',      label: 'Swimming Monthly (1M)',          days: 30  },
    { value: 'Swimming 2 Month',    label: 'Swimming 2 Month (2M)',           days: 60  },
    { value: 'Swimming Qty',        label: 'Swimming Quarterly (3M)',         days: 90  },
    { value: 'Swimming HY',         label: 'Swimming Half-Yearly (6M)',       days: 180 },
    { value: 'Swimming Y',          label: 'Swimming Yearly (12M)',           days: 365 },
    { value: 'Swimming Qty 3days',  label: 'Swimming Quarterly (3 days/wk)', days: 90  },
  ],
  Cricket: [
    { value: 'Cricket Month',  label: 'Cricket Monthly (1M)',      days: 30  },
    { value: 'Cricket Qty',    label: 'Cricket Quarterly (3M)',     days: 90  },
    { value: 'Cricket HY',     label: 'Cricket Half-Yearly (6M)',   days: 180 },
    { value: 'Cricket Y',      label: 'Cricket Yearly (12M)',       days: 365 },
  ],
  Tennis: [
    { value: 'Tennis Month',   label: 'Tennis Monthly (1M)',        days: 30  },
    { value: 'Tennis 2 Month', label: 'Tennis 2 Month (2M)',         days: 60  },
    { value: 'Tennis Qty',     label: 'Tennis Quarterly (3M)',       days: 90  },
    { value: 'Tennis HY',      label: 'Tennis Half-Yearly (6M)',     days: 180 },
    { value: 'Tennis Y',       label: 'Tennis Yearly (12M)',         days: 365 },
  ],
  Zumba: [
    { value: 'Zumba Month',    label: 'Zumba Monthly (1M)',          days: 30  },
    { value: 'Zumba Qty',      label: 'Zumba Quarterly (3M)',         days: 90  },
  ],
  Skating: [
    { value: 'Skating Month',  label: 'Skating Monthly (1M)',        days: 30  },
    { value: 'Skating Qty',    label: 'Skating Quarterly (3M)',       days: 90  },
  ],
  General: [
    { value: 'Monthly',        label: 'Monthly (30 days)',            days: 30  },
    { value: 'Quarterly',      label: 'Quarterly (90 days)',          days: 90  },
    { value: 'Half-Yearly',    label: 'Half-Yearly (180 days)',       days: 180 },
    { value: 'Yearly',         label: 'Yearly (365 days)',            days: 365 },
  ],
};

/* â”€â”€ STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const S = {
  apiBase: norm(localStorage.getItem(STORAGE_KEYS.apiBase) || DEFAULT_API_BASE),
  token: sessionStorage.getItem(STORAGE_KEYS.token) || '',
  activeTab: 'liveOpsTab',
  currentUser: null, healthOk: false,
  dashboard: null, users: [], slots: [], sessions: [],
  announcements: [], reports: null,
  memberDashboard: null, memberProfile: null,
  memberHistory: [], memberPayments: [], memberNotifications: [],
  scanImage: '', scanResult: null,
  isScanning: false, scanLoopTimer: null, scanInFlight: false,
  cameraRequested: false, cameraRestarting: false,
  liveDetection: null, cameraZoom: 1,
  faceModelsReady: false, faceModelsLoading: false, faceModelsError: '',
  faceUsers: [], recognitionThreshold: window.FaceAi?.DEFAULT_THRESHOLD || 0.56,
  scanState: 'idle', scanPill: 'Idle',
  scanStatusText: 'Live scanner is offline',
  scanStatusDetail: 'Enable Live Scan to start face recognition.',
  cooldowns: loadCooldownStore(),
  cooldownVoiceAt: {},
  activeSessions: {},        // { userId: { sessionId, startTime, deadlineTime, duration, name, announced5, announcedEnd } }
  activeSessionsRenderKey: '',
  sessionTimerLoop: null,
  enrollmentImages: [],
  enrollmentZoom: 1,
  stream: null, refreshTimer: null, healthTimer: null, toastTimer: null,
  audioUrl: '', audioContext: null, audioUnlocked: false,
  ttsMode: 'ready', ttsStatusText: 'Preparing the browser voice assistant.',
  scanMissStreak: 0,
  userFilters: { search: '', sport: '', plan: '', status: '', role: '' },
  reportFilter: { search: '', status: '', date: '' },
  membershipFilter: 'all',
};

const scannedUsers = new Map();
const MOJIBAKE_TEXT_REPLACEMENTS = Object.freeze([
  ['â€¦', '...'],
  ['â€”', ' - '],
  ['â€“', '-'],
  ['â€¢', ' | '],
  ['Â·', ' | '],
  ['â‚¹', 'Rs. '],
  ['Â©', '(c)'],
  ['â— ', ''],
  ['â–¶ ', ''],
  ['âœ… ', ''],
  ['âœ…', 'OK'],
  ['âœ“', 'OK'],
  ['âœ•', 'Close'],
  ['âœ—', 'X'],
  ['âš  ', ''],
  ['âš ', ''],
  ['âš¡ ', ''],
  ['âš¡', ''],
  ['âš™ ', ''],
  ['âš™', ''],
  ['â° ', ''],
  ['â°', ''],
  ['â˜€ ', ''],
  ['â˜€', ''],
  ['â¬‡ ', ''],
  ['â¬‡', ''],
  ['ðŸŽ¤ ', ''],
  ['ðŸŽ¤', ''],
  ['ðŸ”Š ', ''],
  ['ðŸ”Š', ''],
  ['ðŸƒ ', ''],
  ['ðŸƒ', ''],
  ['ðŸ” ', ''],
  ['ðŸ”', ''],
  ['ðŸ”— ', ''],
  ['ðŸ”—', ''],
  ['ðŸ“¸ ', ''],
  ['ðŸ“¸', ''],
  ['ðŸ“· ', ''],
  ['ðŸ“·', ''],
  ['ðŸ“¤ ', ''],
  ['ðŸ“¤', ''],
  ['ðŸ‘¥ ', ''],
  ['ðŸ‘¥', ''],
  ['ðŸ”‘ ', ''],
  ['ðŸ”‘', ''],
  ['ðŸ§¾ ', ''],
  ['ðŸ§¾', ''],
  ['ðŸ“ˆ ', ''],
  ['ðŸ“ˆ', ''],
  ['ðŸ•’ ', ''],
  ['ðŸ•’', ''],
  ['ðŸ’° ', ''],
  ['ðŸ’°', ''],
  ['ðŸ”„ ', ''],
  ['ðŸ”„', ''],
  ['ðŸ”´ ', ''],
  ['ðŸ”´', ''],
  ['ðŸ§® ', ''],
  ['ðŸ§®', ''],
  ['ðŸŸ¢ ', ''],
  ['ðŸŸ¢', ''],
  ['ðŸŸ¡ ', ''],
  ['ðŸŸ¡', ''],
  ['ðŸ’³ ', ''],
  ['ðŸ’³', ''],
  ['âž• ', ''],
  ['âž•', ''],
  ['ðŸ’¸ ', ''],
  ['ðŸ’¸', ''],
  ['ðŸš« ', ''],
  ['ðŸš«', ''],
  ['ðŸ“£ ', ''],
  ['ðŸ“£', ''],
  ['ðŸ‘¤ ', ''],
  ['ðŸ‘¤', ''],
  ['ðŸ“‚ ', ''],
  ['ðŸ“‚', ''],
  ['ðŸ“Š ', ''],
  ['ðŸ“Š', ''],
  ['ðŸŒ… ', ''],
  ['ðŸŒ…', ''],
  ['ðŸŒ™ ', ''],
  ['ðŸŒ™', ''],
]);

let visibleTextSanitizerObserver = null;
let isSanitizingVisibleText = false;
const pendingSanitizeRoots = new Set();
let sanitizeVisibleDomFrame = 0;

function sanitizeDisplayText(value) {
  let text = String(value ?? '');
  if (!text) return text;

  MOJIBAKE_TEXT_REPLACEMENTS.forEach(([bad, good]) => {
    if (text.includes(bad)) text = text.split(bad).join(good);
  });

  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

function sanitizeTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const original = node.nodeValue || '';
  const sanitized = sanitizeDisplayText(original);
  if (sanitized !== original) node.nodeValue = sanitized;
}

function sanitizeElementTextAttrs(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
  ['placeholder', 'title', 'aria-label'].forEach(attr => {
    const original = element.getAttribute(attr);
    if (original == null) return;
    const sanitized = sanitizeDisplayText(original);
    if (sanitized !== original) element.setAttribute(attr, sanitized);
  });
}

function sanitizeVisibleDom(root = document.body) {
  if (!root || isSanitizingVisibleText) return;
  isSanitizingVisibleText = true;
  try {
    if (root.nodeType === Node.TEXT_NODE) {
      sanitizeTextNode(root);
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root !== document.body) return;

    const element = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    sanitizeElementTextAttrs(element);

    const elementWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    while (elementWalker.nextNode()) sanitizeElementTextAttrs(elementWalker.currentNode);

    const textWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) sanitizeTextNode(textWalker.currentNode);
  } finally {
    isSanitizingVisibleText = false;
  }
}

function queueVisibleDomSanitize(root = document.body) {
  if (!root) return;
  if (root !== document.body && root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.TEXT_NODE) return;
  pendingSanitizeRoots.add(root);
  if (sanitizeVisibleDomFrame) return;
  sanitizeVisibleDomFrame = requestAnimationFrame(() => {
    sanitizeVisibleDomFrame = 0;
    const roots = Array.from(pendingSanitizeRoots);
    pendingSanitizeRoots.clear();
    roots.forEach(node => sanitizeVisibleDom(node));
  });
}

function startVisibleTextSanitizer() {
  sanitizeVisibleDom(document.body);
  if (visibleTextSanitizerObserver) visibleTextSanitizerObserver.disconnect();

  visibleTextSanitizerObserver = new MutationObserver(mutations => {
    if (isSanitizingVisibleText) return;
    mutations.forEach(mutation => {
      if (mutation.type === 'characterData') {
        queueVisibleDomSanitize(mutation.target);
        return;
      }
      if (mutation.type === 'attributes') {
        queueVisibleDomSanitize(mutation.target);
        return;
      }
      mutation.addedNodes.forEach(node => queueVisibleDomSanitize(node));
    });
  });

  visibleTextSanitizerObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'title', 'aria-label'],
  });
}

/* â”€â”€ BOOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
document.addEventListener('DOMContentLoaded', () => {
  startVisibleTextSanitizer();
  initUi();
  bindEvents();
  bootstrapFaceRecognition();
  restoreSession();
  startSubtitleLoop();
  initParticles();
});

function initUi() {
  updateApiBaseUi();
  registerMediaUnlock();
  relocateFaceEnrollmentUi();
  const apiConfigForm = $('apiConfigForm');
  if (apiConfigForm?.closest('.panel-card')) {
    apiConfigForm.closest('.panel-card').hidden = true;
  }
  $('scanAreaInput').value = 'Capper Sports Club Entry';
  if ($('sessionAreaInput')) $('sessionAreaInput').value = 'Capper Sports Club Floor';
  if ($('sessionConfidenceInput') && $('sessionConfidenceValue')) {
    $('sessionConfidenceValue').textContent = Number($('sessionConfidenceInput').value).toFixed(2);
  }

  const today = isoDate(new Date());
  $('userStartInput').value = today;
  $('userExpiryInput').value = isoDate(addDays(new Date(), 30));
  $('membershipStartInput').value = today;
  $('membershipExpiryInput').value = isoDate(addDays(new Date(), 30));

  resetUserForm(); resetSlotForm();
  startClock();
  renderAll();
  // Set default tab
  openTab('liveOpsTab');
  restoreSessionTimers();
  initReportsModule();
}

function relocateFaceEnrollmentUi() {
  const faceTab = $('faceEnrollmentTab');
  if (!faceTab) return;

  let layout = faceTab.querySelector('.single-col-layout');
  if (!layout) {
    layout = document.createElement('div');
    layout.className = 'single-col-layout';
    faceTab.appendChild(layout);
  }

  const captureCard = $('captureEnrollmentBtn')?.closest('.panel-card');
  const uploadCard = $('faceUploadForm')?.closest('.panel-card');

  [captureCard, uploadCard].forEach(card => {
    if (card && card.parentElement !== layout) {
      layout.appendChild(card);
    }
  });
}

function bindEvents() {
  // Tab nav
  document.querySelectorAll('.nav-tab').forEach(btn =>
    btn.addEventListener('click', () => openTab(btn.dataset.tab))
  );

  // Backend
  if ($('apiConfigForm')) $('apiConfigForm').addEventListener('submit', handleApiSave);
  if ($('refreshAllBtn')) $('refreshAllBtn').addEventListener('click', () => refreshAll({ toast: true }));

  // Auth
  $('loginForm').addEventListener('submit', handleLogin);
  $('logoutBtn').addEventListener('click', logout);
  $('loadMeBtn').addEventListener('click', () => refreshAll({ toast: true }));

  // Users
  $('userRoleInput').addEventListener('change', () => {
    syncSlotField();
    syncUserMemberIdField();
  });
  if ($('userSportInput')) {
    $('userSportInput').addEventListener('change', () => {
      syncUserPlanDates();
      syncUserMemberIdField();
    });
  }
  $('userPlanInput').addEventListener('change', syncUserPlanDates);
  $('userStartInput').addEventListener('input', syncUserPlanDates);
  $('userForm').addEventListener('submit', handleUserSubmit);
  $('userResetBtn').addEventListener('click', resetUserForm);
  if ($('usersTableBody')) $('usersTableBody').addEventListener('click', handleUsersClick);
  if ($('userFilterInput')) $('userFilterInput').addEventListener('input', e => {
    S.userFilters.search = e.target.value;
    renderUsers();
  });
  if ($('userSportFilterInput')) $('userSportFilterInput').addEventListener('change', e => {
    S.userFilters.sport = e.target.value;
    renderUsers();
  });
  if ($('userPlanFilterInput')) $('userPlanFilterInput').addEventListener('change', e => {
    S.userFilters.plan = e.target.value;
    renderUsers();
  });
  if ($('userStatusFilterInput')) $('userStatusFilterInput').addEventListener('change', e => {
    S.userFilters.status = e.target.value;
    renderUsers();
  });
  if ($('userRoleFilterInput')) $('userRoleFilterInput').addEventListener('change', e => {
    S.userFilters.role = e.target.value;
    renderUsers();
  });
  if ($('allMembersClearFilters')) $('allMembersClearFilters').addEventListener('click', resetAllMemberFilters);
  if ($('allMemberReportClose')) $('allMemberReportClose').addEventListener('click', closeAllMemberReport);

  // Reports filter
  if ($('reportSearchInput')) $('reportSearchInput').addEventListener('input', e => { S.reportFilter.search = e.target.value; renderReportTable(); });
  if ($('reportFilterStatus')) $('reportFilterStatus').addEventListener('change', e => { S.reportFilter.status = e.target.value; renderReportTable(); });
  if ($('reportFilterDate')) $('reportFilterDate').addEventListener('change', e => { S.reportFilter.date = e.target.value; renderReportTable(); });
  if ($('reportClearBtn')) $('reportClearBtn').addEventListener('click', () => {
    S.reportFilter = { search: '', status: '', date: '' };
    if ($('reportSearchInput')) $('reportSearchInput').value = '';
    if ($('reportFilterStatus')) $('reportFilterStatus').value = '';
    if ($('reportFilterDate')) $('reportFilterDate').value = '';
    renderReportTable();
  });
  if ($('reportDetailClose')) $('reportDetailClose').addEventListener('click', () => { $('reportUserDetail').hidden = true; });
  if ($('reportTableBody')) $('reportTableBody').addEventListener('click', handleReportRowClick);

  // Membership filters
  document.querySelectorAll('.filter-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.membershipFilter = btn.dataset.mfilter;
      renderMembershipList();
    })
  );

  // Slots
  $('slotForm').addEventListener('submit', handleSlotSubmit);
  $('slotResetBtn').addEventListener('click', resetSlotForm);
  $('slotsTableBody').addEventListener('click', handleSlotsClick);

  // Membership
  $('membershipForm').addEventListener('submit', handleMembershipSubmit);
  if ($('membershipUserSearchInput')) $('membershipUserSearchInput').addEventListener('input', () => applyMembershipUserSearch());

  // Sessions
  if ($('sessionConfidenceInput') && $('sessionConfidenceValue')) {
    $('sessionConfidenceInput').addEventListener('input', () => {
      $('sessionConfidenceValue').textContent = Number($('sessionConfidenceInput').value).toFixed(2);
    });
  }
  if ($('sessionStartForm')) $('sessionStartForm').addEventListener('submit', handleSessionStart);
  if ($('sessionsTableBody')) $('sessionsTableBody').addEventListener('click', handleSessionsClick);

  // Announcements
  $('announcementForm').addEventListener('submit', handleAnnouncementSubmit);

  // Camera/Scan
  $('enableCameraInput').addEventListener('change', handleLiveScanToggle);
  $('captureScanBtn').addEventListener('click', captureScanFrame);
  $('scanFileInput').addEventListener('change', handleScanFileInput);
  $('runScanBtn').addEventListener('click', handleManualScan);

  // Enrollment
  if ($('enrollmentZoomOutBtn')) $('enrollmentZoomOutBtn').addEventListener('click', () => adjustEnrollmentZoom(-1));
  if ($('enrollmentZoomInBtn')) $('enrollmentZoomInBtn').addEventListener('click', () => adjustEnrollmentZoom(1));
  $('captureEnrollmentBtn').addEventListener('click', captureEnrollFrame);
  $('clearEnrollmentBtn').addEventListener('click', clearEnrollmentImages);
  $('enrollmentFilesInput').addEventListener('change', handleEnrollFiles);
  $('faceUploadForm').addEventListener('submit', handleFaceUpload);
  if ($('enrollmentUserSearchBtn')) {
    $('enrollmentUserSearchBtn').addEventListener('click', () => applyEnrollmentMemberSearch({ toastOnEmpty: true }));
  }
  if ($('enrollmentUserSearchInput')) {
    $('enrollmentUserSearchInput').addEventListener('input', e => {
      applyEnrollmentMemberSearch({ query: e.target.value, toastOnEmpty: false });
    });
    $('enrollmentUserSearchInput').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      applyEnrollmentMemberSearch({ toastOnEmpty: true });
    });
  }

  // TTS
  $('ttsForm').addEventListener('submit', handleTts);
}

async function bootstrapFaceRecognition() {
  await ensureFaceModelsLoaded();
  renderAll();
}

async function ensureFaceModelsLoaded() {
  if (S.faceModelsReady) return true;
  if (S.faceModelsLoading) return false;
  if (!window.FaceAi) {
    S.faceModelsError = 'face-api.js failed to load.';
    return false;
  }

  S.faceModelsLoading = true;
  S.faceModelsError = '';
  renderAll();

  try {
    await window.FaceAi.loadModels('models');
    S.faceModelsReady = true;
    return true;
  } catch (err) {
    S.faceModelsReady = false;
    S.faceModelsError = err?.message || 'Unable to load local AI models.';
    return false;
  } finally {
    S.faceModelsLoading = false;
    renderAll();
  }
}

async function loadRecognitionEmbeddings() {
  if (!S.currentUser || !isAdmin()) { S.faceUsers = []; return []; }
  try {
    S.faceUsers = toArr(await api('/users/embeddings'));
  } catch (err) {
    S.faceUsers = [];
    throw err;
  }
  return S.faceUsers;
}

async function ensureRecognitionReady() {
  if (!ensureAdmin()) return false;
  const modelsReady = await ensureFaceModelsLoaded();
  if (!modelsReady) {
    toast(S.faceModelsError || 'AI models are not ready.', 'error');
    return false;
  }
  if (!S.faceUsers.length) {
    try {
      await loadRecognitionEmbeddings();
    } catch (err) {
      toast(err?.message || 'Unable to load enrolled face descriptors.', 'error');
      return false;
    }
  }
  if (!S.faceUsers.length) {
    toast('No enrolled face embeddings found.', 'error');
    return false;
  }
  return true;
}

/* â”€â”€ SESSION RESTORE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function restoreSession() {
  await ensureBackendConnection();
  startHealthPoll();
  if (!S.token) { setAuth(null); return; }
  try {
    const user = await api('/auth/me');
    S.currentUser = user;
    setAuth(user);
    await refreshAll();
  } catch (err) { handleErr(err, { toast: true, logout: true }); }
}

/* â”€â”€ API CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handleApiSave(e) {
  e.preventDefault();
  setApiBase($('apiBaseInput')?.value || DEFAULT_API_BASE);
  const ok = await pingHealth();
  if (S.currentUser && ok) await refreshAll({ toast: true });
  else if (ok) toast('Backend URL saved.', 'success');
  else toast('Backend URL saved, but the health check failed.', 'warning');
}

/* â”€â”€ AUTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handleLogin(e) {
  e.preventDefault();
  try {
    const payload = await api('/login', { method: 'POST', body: { email: $('loginEmail').value.trim(), password: $('loginPassword').value }});
    S.token = payload.accessToken || '';
    S.currentUser = payload.user || null;
    sessionStorage.setItem(STORAGE_KEYS.token, S.token);
    setAuth(S.currentUser);
    $('loginPassword').value = '';
    toast('Signed in.', 'success');
    await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}

function setAuth(user) {
  const ok = Boolean(user && S.token);
  const cameraAccess = ok && isAdmin();
  $('authDot').className = `status-dot ${ok ? 'online' : 'alert'}`;
  $('authText').textContent = ok ? `${user.role?.toUpperCase()} â€¢ ${user.name}` : 'Signed out';

  // Login form vs account display
  $('loginForm').hidden = ok;
  const accSummary = $('accountSummary');
  const accActions = $('accountActions');
  if (ok) {
    accSummary.hidden = false; accActions.hidden = false;
    accSummary.innerHTML = `
      <div class="account-block">
        <div class="account-name">${esc(user.name)}</div>
        <div class="account-meta">${esc(user.email)}</div>
        <div class="account-meta-row">
          ${chip(user.role, user.role)}
          ${chip(user.membershipStatus||'blue', user.membershipPlan||'Member')}
        </div>
      </div>`;
  } else {
    accSummary.hidden = true; accActions.hidden = true;
  }

  // Scanner controls
  $('enableCameraInput').disabled = !cameraAccess;
  $('captureScanBtn').disabled = !cameraAccess;
  $('captureEnrollmentBtn').disabled = !cameraAccess;
}

function logout() { clearSess(); toast('Signed out.', 'success'); }

/* â”€â”€ REFRESH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function refreshAll(opts = {}) {
  await pingHealth();
  if (!S.currentUser || !S.token) { renderAll(); return; }
  const timerSnapshot = snapshotActiveSessions();
  try {
    await Promise.all(isAdmin() ? [loadAdmin(), loadMember()] : [loadMember()]);
    restoreMissingActiveSessions(timerSnapshot);
    persistSessionTimers();
    ensureSessionTimerLoop();
    if ($('lastSyncText')) $('lastSyncText').textContent = fmtDT(new Date().toISOString());
    renderAll();
    if (opts.toast) toast('Data refreshed.', 'success');
    startDataPoll();
  } catch (err) { handleErr(err, { toast: opts.toast, logout: true }); }
}

async function loadAdmin() {
  const [dash, users, slots, sessions, reports, ann, embeddings] = await Promise.all([
    api('/admin/dashboard'), api('/admin/users'), api('/admin/slots'),
    api('/admin/sessions'), api('/admin/reports'), api('/admin/announcements'),
    api('/users/embeddings'),
  ]);
  S.dashboard = dash || null; S.users = toArr(users); S.slots = toArr(slots);
  S.sessions = toArr(sessions); S.reports = reports || null; S.announcements = toArr(ann);
  S.faceUsers = toArr(embeddings);
  syncCooldownStoreFromUsers(S.users);
  syncUserMemberIdField();
  syncActiveSessionsFromBackend();
}

async function loadMember() {
  const [dash, profile, history, payments, notifs] = await Promise.all([
    api('/user/dashboard'), api('/user/profile'), api('/user/history'),
    api('/user/payments'), api('/user/notifications'),
  ]);
  S.memberDashboard = dash || null; S.memberProfile = profile || null;
  S.memberHistory = toArr(history); S.memberPayments = toArr(payments); S.memberNotifications = toArr(notifs);
}

/* â”€â”€ HEALTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function pingHealth() {
  S.healthOk = await probeHealth(S.apiBase);
  updateHealthUi();
  return S.healthOk;
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   RENDER ALL
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function renderAll() {
  setAuth(S.currentUser);
  populateSelects();
  renderActiveTabContent();
  updateAlertBadge();
}

function renderLiveOpsContent() {
  renderSystemStatus();
  renderLiveFeed();
  renderActiveSessionsPanel();
  renderReports();
  renderScannerStatus();
  renderConsole();
  renderTts();
  renderScanResult();
}

function renderActiveTabContent() {
  switch (S.activeTab) {
    case 'liveOpsTab':
      renderLiveOpsContent();
      break;
    case 'faceEnrollmentTab':
      renderEnrollGallery();
      renderEnrollmentZoomControls();
      renderEnrollmentCameraBadge();
      break;
    case 'reportsTab':
      renderReportsAll();
      break;
    case 'allMembersTab':
      populateAllMemberFilters();
      renderUsers();
      break;
    case 'membershipTab':
      renderMembershipList();
      break;
    case 'alertsTab':
      renderAlerts();
      renderAnnouncements();
      break;
    case 'settingsTab':
      renderSlots();
      renderMember();
      break;
    default:
      break;
  }
}

/* â”€â”€ TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function openTab(id) {
  S.activeTab = id;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === id));
  syncIdleCameraPreview();
  if (id === 'faceEnrollmentTab') {
    loadFaceEnrollmentStatus();
    ensureEnrollmentLivePreview().catch(console.error);
  }
  renderActiveTabContent();
}


/* â”€â”€ CONSOLE STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderConsole() {
  const live = S.isScanning;
  const cameraReady = streamHasActiveVideo(S.stream);
  const cameraAccess = Boolean(S.currentUser && S.token && isAdmin());
  const activeSession = S.sessions?.find(s => s.status === 'active');
  const buttonCooldown = { remainingMs: 0 };
  const cooldownActive = false;
  const zoomLabel = S.cameraZoom > 1.05 ? ` | ${formatZoomLabel(S.cameraZoom)}` : '';

  $('camStatusPrimary').textContent = live ? 'Live scan active' : (cameraReady ? 'Camera ready' : 'Scanner ready');
  $('camDetect').textContent = live ? `Scanning...${zoomLabel}` : (S.scanResult ? `Result: ${S.scanResult.status?.toUpperCase()}` : 'No scan yet');
  $('camLastAction').textContent = S.scanResult?.message || 'Waiting';
  $('camSource').textContent = cameraReady ? 'Live camera' : (S.scanImage ? 'Image upload' : 'Camera / Upload');
  $('camArea').textContent = $('scanAreaInput').value || 'Club Entry';

  const timerBadge = $('sessionTimerBadge');
  if (activeSession && timerBadge) {
    const min = activeSession.remainingMinutes || 0;
    timerBadge.textContent = `â— ${Math.floor(min/60).toString().padStart(2,'0')}:${(min%60).toString().padStart(2,'0')}`;
    timerBadge.hidden = false;
  } else if (timerBadge) { timerBadge.hidden = true; }

  $('enableCameraInput').checked = live;
  $('liveScanStateText').textContent = live ? 'ON' : 'OFF';
  if (live) $('liveScanStateText').classList.add('active');
  else      $('liveScanStateText').classList.remove('active');

  $('captureScanBtn').disabled = !cameraAccess;
  $('captureEnrollmentBtn').disabled = !cameraAccess;
  $('runScanBtn').disabled = S.scanInFlight;
  $('runScanBtn').textContent = S.scanInFlight
    ? 'Scanning...'
    : (cooldownActive ? `Wait ${formatCountdown(buttonCooldown.remainingMs)}` : 'Run Scan');
  renderEnrollmentZoomControls();
  renderEnrollmentCameraBadge();
}

/* â”€â”€ SCANNER STATUS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function setScanState(mode, title, detail = '', pill = '') {
  S.scanState = mode;
  S.scanPill = pill || { loading:'Scanningâ€¦', granted:'Granted âœ“', denied:'Denied âœ—', detected:'Face Found' }[mode] || 'Idle';
  S.scanStatusText = title;
  S.scanStatusDetail = detail;
  renderScannerStatus();
}

function renderScannerStatus() {
  const panel = $('scannerStatusPanel');
  panel.dataset.scanState = S.scanState;
  $('scannerStatusPill').textContent = S.scanPill;
  $('scanStatusText').textContent = S.scanStatusText;
  $('scanStatusDetail').textContent = S.scanStatusDetail;
  $('scannerStatusLoader').hidden = S.scanState !== 'loading';
  updateFaceBoxOverlay(S.liveDetection?.faceBox || S.scanResult?.faceBox || null);

  const shell = $('cameraShell');
  shell.classList.remove('is-scanning','is-granted','is-denied','is-detected');
  if (S.scanState === 'loading')   { shell.classList.add('is-scanning'); $('faceDetectLabel').textContent = 'Scanningâ€¦'; }
  else if (S.scanState === 'granted') { shell.classList.add('is-granted'); $('faceDetectLabel').textContent = 'GRANTED'; }
  else if (S.scanState === 'denied')  { shell.classList.add('is-denied');  $('faceDetectLabel').textContent = 'DENIED'; }
  else if (S.scanState === 'detected'){ shell.classList.add('is-detected'); $('faceDetectLabel').textContent = 'FACE FOUND'; }
  renderCameraAssistBadge();
}

function updateFaceBoxOverlay(faceBox) {
  const box = $('faceDetectBox');
  if (!box) return;

  if (!faceBox) {
    box.style.top = '50%';
    box.style.left = '50%';
    box.style.width = '100px';
    box.style.height = '120px';
    box.style.transform = 'translate(-50%,-50%)';
    return;
  }

  box.style.top = `${clamp(Number(faceBox.top || 0), 0, 0.98) * 100}%`;
  box.style.left = `${clamp(Number(faceBox.left || 0), 0, 0.98) * 100}%`;
  box.style.width = `${clamp(Number(faceBox.width || 0.2), 0.08, 0.9) * 100}%`;
  box.style.height = `${clamp(Number(faceBox.height || 0.2), 0.1, 0.9) * 100}%`;
  box.style.transform = 'none';
}

function formatZoomLabel(zoom) {
  return `${Number(zoom || 1).toFixed(1)}x`;
}

function formatHintLabel(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildDetectionAssistDetail(detection) {
  if (!detection) {
    return S.isScanning
      ? 'Long-range scan is searching the center lane.'
      : 'Ready to scan.';
  }

  const rangeLabel = formatHintLabel(detection.distanceHint, 'Face');
  const captureMode = formatHintLabel(detection.captureMode, 'Full Frame');
  const zoomLabel = formatZoomLabel(detection.recommendedZoom || 1);
  return `${rangeLabel} face lock | ${captureMode} assist | ${zoomLabel}`;
}

function applyPreviewFocus(zoom = 1, faceBox = null) {
  const scale = clamp(Number(zoom || 1), 1, MAX_PREVIEW_ZOOM);
  const centerX = faceBox
    ? clamp(Number(faceBox.left || 0) + (Number(faceBox.width || 0) / 2), 0.18, 0.82)
    : DEFAULT_CAMERA_FOCUS_X;
  const centerY = faceBox
    ? clamp(Number(faceBox.top || 0) + (Number(faceBox.height || 0) / 2), 0.18, 0.78)
    : DEFAULT_CAMERA_FOCUS_Y;

  getCameraPreviewTargets().forEach(({ preview, shell }) => {
    preview.style.setProperty('--camera-scale', scale.toFixed(3));
    preview.style.setProperty('--camera-focus-x', `${(centerX * 100).toFixed(1)}%`);
    preview.style.setProperty('--camera-focus-y', `${(centerY * 100).toFixed(1)}%`);
    shell.classList.toggle('has-face-lock', Boolean(faceBox));
  });
  S.cameraZoom = scale;
}

function getCameraPreviewTargets() {
  return [
    { preview: $('cameraPreview'), shell: $('cameraShell') },
    { preview: $('enrollmentCameraPreview'), shell: $('enrollmentCameraShell') },
  ].filter(target => target.preview && target.shell);
}

function syncCameraPreviewStreams() {
  const hasStream = streamHasActiveVideo(S.stream);
  getCameraPreviewTargets().forEach(({ preview, shell }) => {
    preview.srcObject = hasStream ? S.stream : null;
    shell.classList.toggle('has-stream', hasStream);
    if (hasStream) preview.play().catch(() => {});
  });
}

function renderCameraAssistBadge() {
  const badge = $('cameraAssistBadge');
  if (!badge) return;

  if (!streamHasActiveVideo(S.stream)) {
    badge.textContent = 'Search mode | 1.0x';
    return;
  }

  if (!S.liveDetection?.faceBox) {
    badge.textContent = `${S.isScanning ? 'Search mode' : 'Camera ready'} | ${formatZoomLabel(S.cameraZoom)}`;
    return;
  }

  const prefix = S.liveDetection.distanceHint === 'long-range'
    ? 'Long range lock'
    : (S.liveDetection.distanceHint === 'mid-range' ? 'Mid range lock' : 'Face lock');
  badge.textContent = `${prefix} | ${formatZoomLabel(S.cameraZoom)}`;
}

function renderEnrollmentCameraBadge() {
  const badge = $('enrollmentCameraBadge');
  if (!badge) return;

  if (!streamHasActiveVideo(S.stream)) {
    badge.textContent = 'Preview offline | 1.0x';
    return;
  }

  const modeLabel = S.isScanning ? 'Shared live camera' : 'Live preview';
  badge.textContent = `${modeLabel} | ${formatZoomLabel(getEnrollmentZoom())}`;
}

function getEnrollmentZoom() {
  return clamp(Number(S.enrollmentZoom || 1), 1, MAX_PREVIEW_ZOOM);
}

function syncIdleCameraPreview() {
  if (S.isScanning || S.liveDetection?.faceBox) return;
  applyPreviewFocus(S.activeTab === 'faceEnrollmentTab' ? getEnrollmentZoom() : 1, null);
  renderCameraAssistBadge();
  renderEnrollmentCameraBadge();
}

function renderEnrollmentZoomControls() {
  const valueEl = $('enrollmentZoomValue');
  const zoomOutBtn = $('enrollmentZoomOutBtn');
  const zoomInBtn = $('enrollmentZoomInBtn');
  if (!valueEl && !zoomOutBtn && !zoomInBtn) return;

  const zoom = getEnrollmentZoom();
  const cameraAccess = Boolean(S.currentUser && S.token && isAdmin());
  const controlsLocked = !cameraAccess || S.isScanning;

  if (valueEl) valueEl.textContent = formatZoomLabel(zoom);
  if (zoomOutBtn) zoomOutBtn.disabled = controlsLocked || zoom <= 1.001;
  if (zoomInBtn) zoomInBtn.disabled = controlsLocked || zoom >= (MAX_PREVIEW_ZOOM - 0.001);
}

async function adjustEnrollmentZoom(direction) {
  if (!ensureAdmin()) return;
  if (S.isScanning) {
    toast('Turn off Live Scan before adjusting face enrollment zoom.', 'warning');
    return;
  }

  const currentZoom = getEnrollmentZoom();
  const nextZoom = clamp(currentZoom + (direction * ENROLLMENT_ZOOM_STEP), 1, MAX_PREVIEW_ZOOM);
  if (Math.abs(nextZoom - currentZoom) < 0.001) {
    renderEnrollmentZoomControls();
    return;
  }

  const ready = await ensureCameraReadyForCapture();
  if (!ready) return;

  S.enrollmentZoom = nextZoom;
  syncIdleCameraPreview();
  renderEnrollmentZoomControls();
}

async function ensureEnrollmentLivePreview() {
  if (S.activeTab !== 'faceEnrollmentTab') return;
  if (!S.currentUser || !S.token || !isAdmin()) {
    renderEnrollmentCameraBadge();
    return;
  }
  if (streamHasActiveVideo(S.stream)) {
    syncCameraPreviewStreams();
    syncIdleCameraPreview();
    return;
  }
  await startCamera();
}

function setLiveDetection(detection, opts = {}) {
  if (!detection) {
    S.liveDetection = null;
    applyPreviewFocus(opts.keepSearchZoom && S.isScanning ? CAMERA_SEARCH_PREVIEW_ZOOM : 1, null);
    renderCameraAssistBadge();
    return;
  }

  const normalizedDetection = {
    ...detection,
    recommendedZoom: clamp(Number(detection.recommendedZoom || 1), 1, MAX_PREVIEW_ZOOM),
  };
  S.liveDetection = normalizedDetection;
  applyPreviewFocus(normalizedDetection.recommendedZoom, normalizedDetection.faceBox || null);
  renderCameraAssistBadge();
}

/* â”€â”€ CLOCK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function startClock() { updateClock(); setInterval(updateClock, 1000); }
function updateClock() {
  const d = new Date(), pad = n => String(n).padStart(2,'0');
  $('liveTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const mons = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  $('liveDate').textContent = `${days[d.getDay()]} ${pad(d.getDate())} ${mons[d.getMonth()]} ${d.getFullYear()}`;
  refreshCooldownUi();
}

/* â”€â”€ SUBTITLE LOOP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function startSubtitleLoop() {
  const lines = ['AI attendance & access control','Browser AI + fast attendance API','Live member & session management','Smart club operations â€” all in one'];
  const el = $('typingSubtitle'); let ti = 0, ci = 0, del = false;
  function tick() {
    const t = lines[ti];
    if (!del) { el.textContent = t.slice(0, ++ci); if (ci === t.length) { del = true; setTimeout(tick, 1600); return; } }
    else       { el.textContent = t.slice(0, --ci); if (ci === 0) { del = false; ti = (ti+1) % lines.length; } }
    setTimeout(tick, del ? 26 : 50);
  }
  setTimeout(tick, 800);
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   RENDER SECTIONS
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function renderSystemStatus() {
  const members = S.users.filter(u => u.role === 'user').length;
  const activeSessions = S.sessions.filter(s => s.status === 'active').length;
  const cards = [
    { label:'Members', value: members, sub:'Registered', tone:'blue', progress: Math.min(100, members*8) },
    { label:'Active', value: activeSessions, sub:'Sessions now', tone:'green', progress: Math.min(100, activeSessions*20) },
    {
      label:'AI Models',
      value: S.faceModelsReady ? 'Ready' : (S.faceModelsLoading ? 'Loading' : 'Offline'),
      sub: S.faceModelsError || 'Browser recognition stack',
      tone: S.faceModelsReady ? 'green' : (S.faceModelsLoading ? 'amber' : 'red'),
      progress: S.faceModelsReady ? 100 : (S.faceModelsLoading ? 55 : 12),
    },
    {
      label:'Embeddings',
      value: S.faceUsers.length,
      sub:'Users cached in browser',
      tone:'violet',
      progress: Math.min(100, S.faceUsers.length * 12),
    },
  ];
  $('statsGrid').innerHTML = cards.map(statMiniCard).join('');
}

function renderLiveFeed() {
  renderList($('liveFeedList'), S.dashboard?.liveFeed || [], feedItemTpl, 'No live events yet.');
  $('feedCount').textContent = (S.dashboard?.liveFeed || []).length;
}

function renderUsers() {
  const tableBody = $('usersTableBody');
  if (!tableBody) return;

  const filters = S.userFilters || { search: '', sport: '', plan: '', status: '', role: '' };
  const search = String(filters.search || '').trim().toLowerCase();
  const filtered = S.users.filter(u => {
    const statusValue = getUserStatusValue(u);
    const searchHaystack = [
      u.name, u.email, u.memberId, u.role, u.sport, u.membershipLevel,
      u.membershipPlan, u.paymentStatus, u.mobileNumber || u.mobile_number, statusValue,
    ].join(' ').toLowerCase();

    if (search && !searchHaystack.includes(search)) return false;
    if (filters.sport && String(u.sport || '') !== filters.sport) return false;
    if (filters.plan && String(u.membershipPlan || '') !== filters.plan) return false;
    if (filters.status && statusValue !== String(filters.status).toLowerCase()) return false;
    if (filters.role && String(u.role || '').toLowerCase() !== String(filters.role).toLowerCase()) return false;
    return true;
  });
  if ($('allMembersCount')) $('allMembersCount').textContent = String(filtered.length);

  const members = filtered.filter(u => u.role === 'user');
  const faceEnrolledCount = members.filter(u => getFaceCount(u) > 0).length;
  const facePendingCount = members.filter(u => getFaceCount(u) === 0).length;
  renderFaceEnrollSummary(faceEnrolledCount, facePendingCount, members.length);

  tableBody.innerHTML = filtered.length
    ? filtered.map(u => {
        const fc = getFaceCount(u);
        const faceChip = fc > 0
          ? `<span class="face-enroll-chip enrolled" title="${fc} face image${fc > 1 ? 's' : ''} enrolled">&#10004; Enrolled (${fc})</span>`
          : `<span class="face-enroll-chip pending" title="No face images enrolled">&#10008; Not Enrolled</span>`;
        return `<tr data-user-row="${u.id}">
          <td>
            <div class="t-primary">${esc(u.name)}</div>
            <div class="t-secondary">${esc(u.email)}</div>
          </td>
          <td>
            <div class="t-primary">${esc(u.sport||'-')}</div>
            <div class="t-secondary">${esc([
              u.membershipLevel || u.membershipPlan || '-',
              Number(u.dueAmount || 0) > 0 ? `Due ${fmtMoney(u.dueAmount || 0)}` : '',
            ].filter(Boolean).join(' | '))}</div>
          </td>
          <td>${renderUserStatusChip(u)}</td>
          <td>${faceChip}</td>
          <td><div class="table-actions">
            <button class="mini-btn" data-user-report="${u.id}">Report</button>
            <button class="mini-btn" data-user-edit="${u.id}">Edit</button>
            <button class="mini-btn del" data-user-delete="${u.id}">Del</button>
          </div></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="5"><div class="empty-hint">No members found.</div></td></tr>`;
}

function populateAllMemberFilters() {
  const filters = S.userFilters || { search: '', sport: '', plan: '', status: '', role: '' };
  const sportValues = uniqueSortedValues(S.users.map(user => user?.sport));
  const planValues = uniqueSortedValues(S.users.map(user => user?.membershipPlan));
  const statusValues = uniqueSortedValues(S.users.map(getUserStatusValue));
  const roleValues = uniqueSortedValues(S.users.map(user => String(user?.role || '').toLowerCase()));

  if ($('userFilterInput')) $('userFilterInput').value = filters.search || '';
  fillValueSelect($('userSportFilterInput'), sportValues, { blankLabel: 'All Sports', value: filters.sport });
  fillValueSelect($('userPlanFilterInput'), planValues, { blankLabel: 'All Plans', value: filters.plan });
  fillValueSelect($('userStatusFilterInput'), statusValues, { blankLabel: 'All Statuses', value: filters.status, label: formatUserStatusLabel });
  fillValueSelect($('userRoleFilterInput'), roleValues, { blankLabel: 'All Roles', value: filters.role, label: formatUserStatusLabel });
}

function resetAllMemberFilters() {
  S.userFilters = { search: '', sport: '', plan: '', status: '', role: '' };
  populateAllMemberFilters();
  renderUsers();
}

function fillValueSelect(sel, values, opts = {}) {
  if (!sel) return;
  const uniqueValues = uniqueSortedValues(values);
  const html = [`<option value="">${esc(opts.blankLabel || 'All')}</option>`];
  uniqueValues.forEach(value => {
    const label = opts.label ? opts.label(value) : value;
    html.push(`<option value="${esc(value)}">${esc(label)}</option>`);
  });
  sel.innerHTML = html.join('');
  sel.value = uniqueValues.includes(opts.value) ? opts.value : '';
}

function uniqueSortedValues(values) {
  return Array.from(new Set(toArr(values).map(value => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function getUserStatusValue(user) {
  if (String(user?.role || '').toLowerCase() === 'admin') return 'admin';
  return String(user?.membershipStatus || user?.paymentStatus || 'unknown').toLowerCase();
}

function getFaceCount(user) {
  if (user.faceImageCount != null) return Number(user.faceImageCount || 0);
  const entry = S.faceUsers.find(f => String(f.id) === String(user.id));
  if (entry?.descriptors?.length) return entry.descriptors.length;
  if (entry?.embeddings?.length) return entry.embeddings.length;
  return 0;
}

function renderFaceEnrollSummary(enrolled, pending, total) {
  let bar = $('faceEnrollSummaryBar');
  if (!bar) {
    const panel = document.querySelector('.all-members-panel');
    if (!panel) return;
    bar = document.createElement('div');
    bar.id = 'faceEnrollSummaryBar';
    bar.className = 'face-enroll-summary-bar';
    const tableScroll = panel.querySelector('.table-scroll');
    if (tableScroll) panel.insertBefore(bar, tableScroll);
    else panel.appendChild(bar);
  }
  const pct = total > 0 ? Math.round((enrolled / total) * 100) : 0;
  bar.innerHTML = `
    <div class="face-enroll-stat enrolled">
      <span class="face-enroll-dot"></span>
      <span><strong>${enrolled}</strong> Face Enrolled</span>
    </div>
    <div class="face-enroll-progress-wrap">
      <div class="face-enroll-progress-track">
        <div class="face-enroll-progress-fill" style="width:${pct}%"></div>
      </div>
      <span class="face-enroll-pct">${pct}%</span>
    </div>
    <div class="face-enroll-stat pending">
      <span class="face-enroll-dot"></span>
      <span><strong>${pending}</strong> Not Enrolled</span>
    </div>`;
}

function formatUserStatusLabel(value) {
  return String(value || '-')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderUserStatusChip(user) {
  const statusValue = getUserStatusValue(user);
  return chip(statusValue, formatUserStatusLabel(statusValue));
}

function renderSlots() {
  $('slotsTableBody').innerHTML = S.slots.length
    ? S.slots.map(s => `<tr>
        <td>${esc(s.name)}</td>
        <td class="t-secondary">${esc(s.startTime||'-')} â€“ ${esc(s.endTime||'-')}</td>
        <td><div class="table-actions">
          <button class="mini-btn" data-slot-edit="${s.id}">Edit</button>
          <button class="mini-btn del" data-slot-delete="${s.id}">Del</button>
        </div></td>
      </tr>`).join('')
    : `<tr><td colspan="3"><div class="empty-hint">No slots yet.</div></td></tr>`;
}

function renderSessions() {
  const tableBody = $('sessionsTableBody');
  if (!tableBody) return;
  tableBody.innerHTML = S.sessions.length
    ? S.sessions.map(s => `<tr>
        <td><div class="t-primary">${esc(s.name||'Unknown')}</div><div class="t-secondary">${esc(s.area||'-')}</div></td>
        <td>${chip(s.status, s.status)}</td>
        <td>${esc(fmtDur(s.durationMinutes))}</td>
        <td>${s.status==='active' ? `<button class="mini-btn" data-session-end="${s.id}">End</button>` : 'â€”'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4"><div class="empty-hint">No sessions yet.</div></td></tr>`;
}

function renderAnnouncements() {
  renderList($('announcementsList'), S.announcements, a => `
    <div class="alert-item alert-info">
      <div class="alert-top"><span class="alert-name">${esc(a.title||'Announcement')}</span>${chip(a.tone||'blue', a.tone||'info')}</div>
      <p class="alert-msg">${esc(a.message||'')}</p>
      <span class="alert-time">${esc(fmtDT(a.createdAt||a.time))}</span>
    </div>`, 'No announcements yet.');
}

/* â”€â”€ REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderReports() {
  if ($('admissionTableBody')) {
    renderReportsAll();
    return;
  }

  renderReportTable();

  const attendanceBars = $('attendanceBars');
  if (!attendanceBars) return;

  const bars = S.reports?.attendanceBars || [];
  const maxV = Math.max(...bars.map(b => Number(b.count||0)), 1);
  attendanceBars.innerHTML = bars.length
    ? bars.map(b => {
        const h = Math.max(5, Math.round((Number(b.count||0)/maxV)*100));
        return `<div class="mini-bar-col">
          <div class="mini-bar-rail"><div class="mini-bar-fill" style="height:${h}%"></div></div>
          <span class="mini-bar-label">${esc(b.label||'-')}</span>
        </div>`;
      }).join('')
    : '<div class="empty-hint">No chart data.</div>';
}

function renderReportTable() {
  const reportCountChip = $('reportCountChip');
  const reportTableBody = $('reportTableBody');
  if (!reportCountChip || !reportTableBody) return;

  // Combine sessions + recent activity as attendance records
  let records = S.sessions.map(s => ({
    name: s.name || 'Unknown',
    time: s.startedAt,
    status: s.status,
    confidence: s.confidence || 0,
    id: s.userId || s.id,
    area: s.area,
  }));

  // Apply filters
  if (S.reportFilter.search) {
    const q = S.reportFilter.search.toLowerCase();
    records = records.filter(r => r.name.toLowerCase().includes(q));
  }
  if (S.reportFilter.status) {
    records = records.filter(r => r.status?.toLowerCase() === S.reportFilter.status.toLowerCase());
  }
  if (S.reportFilter.date) {
    records = records.filter(r => r.time && r.time.startsWith(S.reportFilter.date));
  }

  reportCountChip.textContent = records.length;
  reportTableBody.innerHTML = records.length
    ? records.map(r => `<tr data-report-user="${esc(r.id)}" data-report-name="${esc(r.name)}">
        <td><div class="t-primary">${esc(r.name)}</div><div class="t-secondary">${esc(r.area||'-')}</div></td>
        <td class="t-secondary">${esc(fmtDT(r.time))}</td>
        <td>${chip(r.status||'slate', r.status||'-')}</td>
        <td class="t-secondary">${r.confidence ? `${Math.round(Number(r.confidence)*100)}%` : 'â€“'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4"><div class="empty-hint">No records found.</div></td></tr>`;
}

async function handleReportRowClick(e) {
  const row = e.target.closest('tr[data-report-user]');
  if (!row) return;
  const userId = row.dataset.reportUser;
  const name = row.dataset.reportName;
  if (!userId || !isAdmin()) return;
  try {
    const report = await api(`/admin/user/${userId}/report`);
    showReportDetail(name, report);
  } catch { /* silently fail */ }
}

function showReportDetail(name, report) {
  const detailName = $('reportDetailName');
  const detailContent = $('reportDetailContent');
  const detailDrawer = $('reportUserDetail');
  if (!detailName || !detailContent || !detailDrawer) return;
  const profile = report?.profile || {};
  const membershipVisitsUsed = String(profile.membershipVisitsUsed ?? profile.visits ?? 0);
  const membershipVisitsAllowed = String(profile.membershipVisitsAllowed ?? 0);
  const membershipVisitsRemaining = String(profile.membershipVisitsRemaining ?? 0);

  detailName.textContent = `ðŸ“Š ${name}`;
  detailContent.innerHTML = `
    <div class="meta-grid" style="margin-bottom:8px;">
      <div class="meta-item"><span class="meta-label">Visits Used</span><span class="meta-value">${esc(membershipVisitsUsed)}</span></div>
      <div class="meta-item"><span class="meta-label">Visit Limit</span><span class="meta-value">${esc(membershipVisitsAllowed)}</span></div>
      <div class="meta-item"><span class="meta-label">Visits Left</span><span class="meta-value">${esc(membershipVisitsRemaining)}</span></div>
      <div class="meta-item"><span class="meta-label">Sessions</span><span class="meta-value">${toArr(report?.sessions).length}</span></div>
      <div class="meta-item"><span class="meta-label">Faces</span><span class="meta-value">${esc(String(profile.faceImageCount||0))}</span></div>
    </div>
    <div class="table-scroll" style="max-height:120px;">
      <table class="report-table">
        <thead><tr><th>Status</th><th>Area</th><th>Time</th><th>Duration</th></tr></thead>
        <tbody>${toArr(report?.sessions).slice(0,8).map(s=>`<tr>
          <td>${chip(s.status,s.status)}</td>
          <td class="t-secondary">${esc(s.area||'-')}</td>
          <td class="t-secondary">${esc(fmtDT(s.startedAt))}</td>
          <td class="t-secondary">${esc(fmtDur(s.durationMinutes))}</td>
        </tr>`).join('') || `<tr><td colspan="4"><div class="empty-hint">No sessions.</div></td></tr>`}
        </tbody>
      </table>
    </div>`;
  detailDrawer.hidden = false;
}

/* â”€â”€ MEMBERSHIP LIST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderMembershipList() {
  let members = S.users.filter(u => u.role === 'user');
  const now = new Date();

  const getStatus = u => {
    if (!u.membershipExpiry) return 'unknown';
    const exp = new Date(u.membershipExpiry);
    if (exp < now) return 'expired';
    const daysLeft = (exp - now) / 86400000;
    if (daysLeft <= 7) return 'expiring';
    return 'active';
  };

  if (S.membershipFilter !== 'all') {
    members = members.filter(u => getStatus(u) === S.membershipFilter);
  }

  $('membershipCountChip').textContent = members.length;
  $('membershipList').innerHTML = members.length
    ? members.map(u => {
        const status = getStatus(u);
        const statusColor = { active: '#059669', expiring: '#d97706', expired: '#e11d48', unknown: '#94a3b8' }[status];
        return `<div class="membership-item ${status === 'expiring' ? 'expiring' : status === 'expired' ? 'expired' : ''}">
          <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};flex-shrink:0;box-shadow:0 0 0 3px ${statusColor}22;"></div>
          <div class="mem-info">
            <div class="mem-name">${esc(u.name)}</div>
            <div class="mem-plan">${esc(u.membershipPlan||'Unknown plan')} â€¢ ${esc(u.memberId||'-')}</div>
            <div class="mem-dates">Expires: ${esc(u.membershipExpiry||'Unknown')}</div>
          </div>
          ${chip(status, status)}
        </div>`;
      }).join('')
    : '<div class="empty-hint">No members found.</div>';
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   REPORTS MODULE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const RPT = {
  search: '', plan: '', payment: '', date: '', mode: '',
  renewalTab: 'expiring',
  quickFilter: 'all',
};

function initReportsModule() {
  // Search & filters
  $('rptSearch').addEventListener('input', e => { RPT.search = e.target.value; renderReportsAll(); });
  $('rptFilterPlan').addEventListener('change', e => { RPT.plan = e.target.value; renderReportsAll(); });
  $('rptFilterPayment').addEventListener('change', e => { RPT.payment = e.target.value; renderReportsAll(); });
  $('rptFilterMode') && $('rptFilterMode').addEventListener('change', e => { RPT.mode = e.target.value; renderReportsAll(); });
  $('rptFilterDate').addEventListener('change', e => { RPT.date = e.target.value; renderReportsAll(); });
  $('rptClearFilters').addEventListener('click', clearRptFilters);
  $('rptDetailClose').addEventListener('click', () => { $('rptDetailDrawer').hidden = true; });
  $('admissionTable').addEventListener('click', handleAdmissionRowClick);
  $('rptExportBtn').addEventListener('click', exportReportCSV);

  // Renewal tabs â€” single registration
  document.querySelectorAll('.rpt-rtab').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rpt-rtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      RPT.renewalTab = btn.dataset.rtab;
      renderRenewalList();
    })
  );

  // Quick filter cards â€” single registration on card grid only
  document.querySelectorAll('.rpt-quick-card[data-qfilter]').forEach(card =>
    card.addEventListener('click', () => {
      setActiveQuickFilter(card.dataset.qfilter || 'all');
      applyQuickFilter(RPT.quickFilter);
      renderReportsAll();
    })
  );

  // Plan calculator
  $('planCalcType').addEventListener('change', calcPlanExpiry);
  $('planCalcStart').addEventListener('input', calcPlanExpiry);
  $('planCalcDays').addEventListener('input', calcPlanExpiry);
  $('planCalcStart').value = isoDate(new Date());
  calcPlanExpiry();
}

function clearRptFilters() {
  RPT.search = ''; RPT.plan = ''; RPT.payment = ''; RPT.date = ''; RPT.mode = '';
  $('rptSearch').value = ''; $('rptFilterPlan').value = '';
  $('rptFilterPayment').value = ''; $('rptFilterDate').value = '';
  $('rptFilterMode') && ($('rptFilterMode').value = '');
  setActiveQuickFilter('all');
  renderReportsAll();
}

function setActiveQuickFilter(filter) {
  RPT.quickFilter = filter || 'all';
  document.querySelectorAll('[data-qfilter]').forEach(control => {
    control.classList.toggle('active', control.dataset.qfilter === RPT.quickFilter);
  });
}

function applyQuickFilter(filter) {
  RPT.search = ''; RPT.plan = ''; RPT.payment = ''; RPT.date = ''; RPT.mode = '';
  $('rptSearch').value = '';
  $('rptFilterPlan').value = '';
  $('rptFilterPayment').value = '';
  $('rptFilterDate').value = '';
  $('rptFilterMode') && ($('rptFilterMode').value = '');

  const today = isoDate(new Date());
  switch (filter) {
    case 'today-admissions':
    case 'today-checkins':
      RPT.date = today;
      break;
    case 'today-renewals':
      RPT.date = today;
      RPT.payment = 'Paid';
      break;
    case 'cash':
      RPT.mode = 'Cash';
      RPT.date = today;
      break;
    case 'upi':
      RPT.mode = 'UPI';
      RPT.date = today;
      break;
    case 'card':
      RPT.mode = 'Card';
      RPT.date = today;
      break;
    default:
      break;
  }

  if ($('rptFilterDate')) $('rptFilterDate').value = RPT.date;
  if ($('rptFilterPayment')) $('rptFilterPayment').value = RPT.payment;
  if ($('rptFilterMode')) $('rptFilterMode').value = RPT.mode;
}

function getReportPayments() {
  const payments = toArr(S.reports?.payments);
  if (payments.length) return payments;

  return S.users
    .filter(user => user.role === 'user' && (
      Number(user.paymentAmount || 0) > 0 ||
      user.paymentStatus ||
      user.membershipStart
    ))
    .map(user => ({
      id: `user-${user.id}`,
      userId: user.id,
      userName: user.name,
      memberId: user.memberId,
      plan: user.membershipPlan,
      amount: Number(user.paymentAmount || 0),
      paymentMode: user.paymentMode,
      paymentStatus: user.paymentStatus,
      membershipStart: user.membershipStart,
      membershipExpiry: user.membershipExpiry,
      source: 'Admin onboarding',
      createdAt: user.membershipStart,
    }));
}

function getPaidReportPayments() {
  return getReportPayments().filter(payment => String(payment?.paymentStatus || '').toLowerCase() === 'paid');
}

function getTodayPaidReportPayments() {
  const today = isoDate(new Date());
  return getPaidReportPayments().filter(payment => localDateKey(payment.createdAt) === today);
}

function isAdmissionPayment(payment) {
  const source = String(payment?.source || '').toLowerCase();
  return source.includes('onboarding') || source.includes('admission');
}

function sumPaymentAmounts(payments) {
  return toArr(payments).reduce((sum, payment) => sum + Number(payment?.amount || 0), 0);
}

function renderReportsAll() {
  renderSummaryCards();
  renderQuickFilterCards();
  renderAdmissionTable();
  renderPaymentSummary();
  renderRenewalList();
  renderAttendanceAnalytics();
  renderSlotEngagement();
}

function renderQuickFilterCards() {
  const today = isoDate(new Date());
  const todaySessions = S.sessions.filter(s => localDateKey(s.startedAt) === today);
  const todayPayments = getTodayPaidReportPayments();
  const todayAdmissions = todayPayments.filter(isAdmissionPayment);
  const todayRenewals = todayPayments.filter(p => !isAdmissionPayment(p));
  const cashToday = todayPayments.filter(p => p.paymentMode === 'Cash');
  const upiToday = todayPayments.filter(p => p.paymentMode === 'UPI');
  const cardToday = todayPayments.filter(p => p.paymentMode === 'Card');
  const totalRevenue = sumPaymentAmounts(getPaidReportPayments());

  if ($('qcardAll')) $('qcardAll').textContent = String(S.sessions.length);
  if ($('qcardTodayAdmissions')) $('qcardTodayAdmissions').textContent = String(todayAdmissions.length || todaySessions.length);
  if ($('qcardTodayRenewals')) $('qcardTodayRenewals').textContent = String(todayRenewals.length);
  if ($('qcardTodayCheckins')) $('qcardTodayCheckins').textContent = String(todaySessions.length);
  if ($('qcardCash')) $('qcardCash').textContent = fmtMoney(sumPaymentAmounts(cashToday));
  if ($('qcardUpi')) $('qcardUpi').textContent = fmtMoney(sumPaymentAmounts(upiToday));
  if ($('qcardCard')) $('qcardCard').textContent = fmtMoney(sumPaymentAmounts(cardToday));
  if ($('qcardTotalRevenue')) $('qcardTotalRevenue').textContent = fmtMoney(totalRevenue);
}

function renderSummaryCards() {
  const users = S.users.filter(u => u.role === 'user');
  const now = new Date();
  const active = users.filter(u => u.membershipExpiry && new Date(u.membershipExpiry) >= now);
  const expiring = users.filter(u => {
    if (!u.membershipExpiry) return false;
    const days = (new Date(u.membershipExpiry) - now) / 86400000;
    return days >= 0 && days <= 7;
  });
  const todaySessions = S.sessions.filter(s => localDateKey(s.startedAt) === localDateKey());
  const todayRevenue = sumPaymentAmounts(getTodayPaidReportPayments());

  $('rptTotalMembersVal').textContent = users.length;
  $('rptActiveMembersVal').textContent = active.length;
  $('rptExpiringSoonVal').textContent = expiring.length;
  $('rptTodayRevenueVal').textContent = fmtMoney(todayRevenue);
  $('rptTodayCheckinsVal').textContent = todaySessions.length;
  $('rptAdmissionCount').textContent = getFilteredAdmissions().length;
}

function getFilteredAdmissions() {
  const todayPaymentsByUser = new Map();
  getTodayPaidReportPayments().forEach(payment => {
    const userId = String(payment.userId || '');
    if (!userId) return;
    const existing = todayPaymentsByUser.get(userId) || [];
    existing.push(payment);
    todayPaymentsByUser.set(userId, existing);
  });

  return S.sessions.filter(s => {
    const user = S.users.find(u => u.id === s.userId);
    if (!user) return false;
    const userTodayPayments = todayPaymentsByUser.get(String(user.id)) || [];
    if (RPT.search) {
      const q = RPT.search.toLowerCase();
      if (!(user.name||'').toLowerCase().includes(q) &&
          !(user.memberId||'').toLowerCase().includes(q)) return false;
    }
    if (RPT.plan && user.membershipPlan !== RPT.plan) return false;
    if (RPT.payment && user.paymentStatus !== RPT.payment) return false;
    if (RPT.mode && user.paymentMode !== RPT.mode) return false;
    if (RPT.date && !localDateKey(s.startedAt).startsWith(RPT.date)) return false;
    if (RPT.quickFilter === 'today-admissions' && !userTodayPayments.some(isAdmissionPayment)) return false;
    if (RPT.quickFilter === 'today-renewals' && !userTodayPayments.some(payment => !isAdmissionPayment(payment))) return false;
    if (RPT.quickFilter === 'cash' && !userTodayPayments.some(payment => payment.paymentMode === 'Cash')) return false;
    if (RPT.quickFilter === 'upi' && !userTodayPayments.some(payment => payment.paymentMode === 'UPI')) return false;
    if (RPT.quickFilter === 'card' && !userTodayPayments.some(payment => payment.paymentMode === 'Card')) return false;
    return true;
  });
}

function hasActualCheckout(session) {
  return String(session?.status || '').toLowerCase() === 'ended' && Boolean(session?.endedAt);
}

function renderAdmissionTable() {
  const records = getFilteredAdmissions();
  const tableWrap = document.querySelector('.rpt-table-wrap');
  if (tableWrap) {
    const isFiltered = Boolean(RPT.search || RPT.plan || RPT.payment || RPT.date || RPT.mode || RPT.quickFilter !== 'all');
    tableWrap.classList.toggle('is-filtered', isFiltered);
  }
  $('rptAdmissionCount').textContent = records.length;
  $('admissionTableBody').innerHTML = records.length
    ? records.map(s => {
        const user = S.users.find(u => u.id === s.userId) || {};
        const now = new Date();
        const exp = user.membershipExpiry ? new Date(user.membershipExpiry) : null;
        const daysLeft = exp ? Math.ceil((exp - now) / 86400000) : null;
        const renewalStatus = !exp ? 'Unknown'
          : daysLeft < 0 ? 'Expired'
          : daysLeft <= 7 ? 'Expiring'
          : 'Active';
        const renewTone = renewalStatus === 'Expired' ? 'tone-red'
          : renewalStatus === 'Expiring' ? 'tone-amber' : 'tone-green';
        return `<tr class="rpt-row" data-session-id="${esc(s.id)}" data-user-id="${esc(s.userId)}">
          <td>
            <div class="t-primary">${esc(user.name||'Unknown')}</div>
            <div class="t-secondary">${esc(user.memberId||'-')}</div>
          </td>
          <td class="t-secondary">${esc(fmtDT(s.startedAt))}</td>
          <td class="t-secondary">${hasActualCheckout(s) ? esc(fmtDT(s.endedAt)) : (String(s.status || '').toLowerCase() === 'active' ? '<span class="status-chip tone-green">Active</span>' : 'â€“')}</td>
          <td>${chip(user.membershipPlan||'slate', user.membershipPlan||'-')}</td>
<td class="t-secondary">${esc(user.paymentMode||'-')}</td>
<td>${chip(user.paymentStatus||'slate', user.paymentStatus||'-')}</td>
          <td class="t-secondary">${fmtMoney(user.paymentAmount||0)}</td>
          <td><span class="status-chip ${renewTone}">${renewalStatus}</span></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="8"><div class="empty-hint">No records match the filters.</div></td></tr>`;
}

function handleAdmissionRowClick(e) {
  const row = e.target.closest('tr[data-user-id]');
  if (!row) return;
  const userId = row.dataset.userId;
  const user = S.users.find(u => u.id === userId);
  if (!user) return;
  const userSessions = S.sessions.filter(s => s.userId === userId);
  const now = new Date();
  const exp = user.membershipExpiry ? new Date(user.membershipExpiry) : null;
  const daysLeft = exp ? Math.ceil((exp - now) / 86400000) : null;

  $('rptDetailTitle').textContent = `ðŸ“Š ${user.name}`;
  $('rptDetailBody').innerHTML = `
    <div class="meta-grid" style="margin-bottom:10px;">
      ${meta('Member ID', user.memberId)} ${meta('Plan', user.membershipPlan)}
      ${meta('Payment', user.paymentStatus)} ${meta('Amount', fmtMoney(user.paymentAmount||0))}
      ${meta('Expires', user.membershipExpiry||'-')} ${meta('Days Left', daysLeft !== null ? String(daysLeft) : '-')}
      ${meta('Slot', user.slotName||'-')} ${meta('Mobile', user.mobileNumber||'-')}
    </div>
    <div class="card-sub-head">Session History</div>
    <div class="table-scroll" style="max-height:140px;">
      <table class="report-table">
        <thead><tr><th>Check-in</th><th>Check-out</th><th>Duration</th><th>Status</th></tr></thead>
        <tbody>${userSessions.slice(0,8).map(s=>`<tr>
          <td class="t-secondary">${esc(fmtDT(s.startedAt))}</td>
          <td class="t-secondary">${hasActualCheckout(s) ? esc(fmtDT(s.endedAt)) : '–'}</td>
          <td class="t-secondary">${esc(fmtDur(s.durationMinutes))}</td>
          <td>${chip(s.status, s.status)}</td>
        </tr>`).join('') || `<tr><td colspan="4"><div class="empty-hint">No sessions.</div></td></tr>`}
        </tbody>
      </table>
    </div>`;
  $('rptDetailDrawer').hidden = false;
}

function renderPaymentSummary() {
  const now = new Date();
  const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek  = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const reportPayments = getReportPayments();
  const paidPayments = getPaidReportPayments();
  const calc = (from) => sumPaymentAmounts(
    paidPayments.filter(payment => {
      const createdAt = new Date(payment.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= from;
    })
  );

  $('payDaily').textContent   = fmtMoney(calc(startOfDay));
  $('payWeekly').textContent  = fmtMoney(calc(startOfWeek));
  $('payMonthly').textContent = fmtMoney(calc(startOfMonth));
  $('payPending').textContent = fmtMoney(
    sumPaymentAmounts(
      reportPayments.filter(payment => String(payment.paymentStatus || '').toLowerCase() === 'pending')
    )
  );

  const payRows = reportPayments.filter(payment => Number(payment.amount || 0) > 0);
  $('payHistoryBody').innerHTML = payRows.length
    ? payRows.map(payment => `<tr>
        <td>
          <div class="t-primary">${esc(payment.userName || 'Unknown')}</div>
          <div class="t-secondary">${esc(payment.memberId || '-')}</div>
        </td>
        <td>${esc(payment.plan||'-')}</td>
        <td>${fmtMoney(payment.amount||0)}</td>
        <td>${esc(payment.paymentMode||'-')}</td>
        <td>${chip(payment.paymentStatus||'slate', payment.paymentStatus||'-')}</td>
        <td class="t-secondary">${esc(fmtDT(payment.createdAt))}</td>
      </tr>`).join('')
    : `<tr><td colspan="6"><div class="empty-hint">No payment records.</div></td></tr>`;
}

function renderRenewalList() {
  const now = new Date();
  const users = S.users.filter(u => u.role === 'user');
  let list = [];

  if (RPT.renewalTab === 'expiring') {
    list = users.filter(u => {
      if (!u.membershipExpiry) return false;
      const d = (new Date(u.membershipExpiry) - now) / 86400000;
      return d >= 0 && d <= 7;
    });
  } else if (RPT.renewalTab === 'expired') {
    list = users.filter(u => u.membershipExpiry && new Date(u.membershipExpiry) < now);
  } else {
    list = users.filter(u => {
      if (!u.membershipStart) return false;
      const d = (now - new Date(u.membershipStart)) / 864e5;
      return d <= 30;
    });
  }

  $('renewalList').innerHTML = list.length
    ? list.map(u => {
        const exp = u.membershipExpiry ? new Date(u.membershipExpiry) : null;
        const daysLeft = exp ? Math.ceil((exp - now) / 86400000) : null;
        const tone = RPT.renewalTab === 'expired' ? 'alert-error'
          : RPT.renewalTab === 'expiring' ? 'alert-warn' : 'alert-info';
        return `<div class="alert-item ${tone}">
          <div class="alert-top">
            <span class="alert-name">${esc(u.name)}</span>
            ${chip(u.membershipPlan||'slate', u.membershipPlan||'-')}
          </div>
          <p class="alert-msg">${esc(u.memberId||'-')} Â· ${fmtMoney(u.paymentAmount||0)}</p>
          <span class="alert-time">
            Expires: ${esc(u.membershipExpiry||'Unknown')}
            ${daysLeft !== null ? ` Â· ${daysLeft < 0 ? Math.abs(daysLeft)+' days ago' : daysLeft+' days left'}` : ''}
          </span>
        </div>`;
      }).join('')
    : `<div class="empty-hint">No ${RPT.renewalTab} memberships.</div>`;
}

function renderAttendanceAnalytics() {
  const sessions = S.sessions;
  const checkins  = sessions.filter(s => s.startedAt).length;
  const checkouts = sessions.filter(s => s.endedAt).length;
  const active    = sessions.filter(s => s.status === 'active').length;

  // Peak slot from startedAt hours
  const hourCount = {};
  sessions.forEach(s => {
    if (!s.startedAt) return;
    const h = new Date(s.startedAt).getHours();
    const slot = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
    hourCount[slot] = (hourCount[slot] || 0) + 1;
  });
  const peak = Object.entries(hourCount).sort((a,b) => b[1]-a[1])[0]?.[0] || 'â€“';

  $('anaCheckins').textContent  = checkins;
  $('anaCheckouts').textContent = checkouts;
  $('anaActive').textContent    = active;
  $('anaPeak').textContent      = peak;

  // Weekly bar chart
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const counts = Array(7).fill(0);
  sessions.forEach(s => {
    if (!s.startedAt) return;
    counts[new Date(s.startedAt).getDay()]++;
  });

  if (window._weeklyChart) { window._weeklyChart.destroy(); }
  const ctx = document.getElementById('weeklyAttendanceChart');
  if (!ctx) return;
  window._weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        label: 'Check-ins',
        data: counts,
        backgroundColor: 'rgba(99,102,241,0.7)',
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } }
      }
    }
  });
}

function renderSlotEngagement() {
  const slotMap = { Morning: 0, Afternoon: 0, Evening: 0 };
  S.sessions.forEach(s => {
    if (!s.startedAt) return;
    const h = new Date(s.startedAt).getHours();
    if (h < 12) slotMap.Morning++;
    else if (h < 17) slotMap.Afternoon++;
    else slotMap.Evening++;
  });

  const maxVal = Math.max(...Object.values(slotMap), 1);
  const colors = { Morning: '#f59e0b', Afternoon: '#6366f1', Evening: '#10b981' };
  const icons  = { Morning: 'ðŸŒ…', Afternoon: 'â˜€', Evening: 'ðŸŒ™' };

  $('slotEngagementBars').innerHTML = Object.entries(slotMap).map(([slot, count]) => {
    const pct = Math.round((count / maxVal) * 100);
    return `<div class="slot-bar-row">
      <div class="slot-bar-label">${icons[slot]} ${slot}</div>
      <div class="slot-bar-track">
        <div class="slot-bar-fill" style="width:${pct}%;background:${colors[slot]};"></div>
      </div>
      <div class="slot-bar-count">${count}</div>
    </div>`;
  }).join('');
}

function exportReportCSV() {
  const records = getFilteredAdmissions();
  if (!records.length) { toast('No data to export.', 'warning'); return; }
  const headers = ['Name','Member ID','Check-in','Check-out','Plan','Payment','Amount'];
  const rows = records.map(s => {
    const u = S.users.find(x => x.id === s.userId) || {};
    return [
      u.name||'', u.memberId||'', fmtDT(s.startedAt),
      hasActualCheckout(s) ? fmtDT(s.endedAt) : '',
      u.membershipPlan||'', u.paymentStatus||'', u.paymentAmount||0
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `capper-report-${isoDate(new Date())}.csv`;
  a.click();
  toast('Report exported!', 'success');
}

/* â”€â”€ PLAN CALCULATOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function calcPlanExpiry() {
  const type = $('planCalcType').value;
  const isCustom = type === 'Custom';
  $('planCalcCustomWrap').hidden = !isCustom;

  const startVal = $('planCalcStart').value;
  if (!startVal) return;

  const start = new Date(startVal);
  const daysMap = { Monthly: 30, Quarterly: 90, 'Half-Yearly': 180, Yearly: 365 };
  const days = isCustom
    ? Math.min(29, Math.max(1, Number($('planCalcDays').value) || 7))
    : daysMap[type] || 30;

  const expiry = addDays(start, days);
  $('planCalcExpiry').value = isoDate(expiry);

  const result = $('planCalcResult');
  result.hidden = false;
  $('planCalcBadge').textContent = `${days} days`;
  $('planCalcText').textContent = `${type} plan Â· Expires on ${isoDate(expiry)}`;

  // Sync with membership form
  $('membershipStartInput').value = startVal;
  $('membershipExpiryInput').value = isoDate(expiry);
  $('membershipPlanInput').value = type;
}


/* â”€â”€ ALERTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderAlerts() {
  const now = new Date();
  const users = S.users.filter(u => u.role === 'user');

  const expiring = users.filter(u => {
    if (!u.membershipExpiry) return false;
    const exp = new Date(u.membershipExpiry);
    const days = (exp - now) / 86400000;
    return days > 0 && days <= 7;
  });
  const expired = users.filter(u => u.membershipExpiry && new Date(u.membershipExpiry) < now);
  const pending = users.filter(u => u.paymentStatus === 'Pending');
  const defaulters = toArr(S.reports?.defaulters);

  $('expiringCount').textContent = expiring.length;
  $('expiredCount').textContent = expired.length;
  $('pendingPayCount').textContent = pending.length;

  const alertTpl = (u, type) => {
    const cls = type === 'expired' ? 'alert-error' : type === 'expiring' ? 'alert-warn' : 'alert-info';
    return `<div class="alert-item ${cls}">
      <div class="alert-top"><span class="alert-name">${esc(u.name)}</span>${chip(type,type)}</div>
      <p class="alert-msg">Plan: ${esc(u.membershipPlan||'-')} â€¢ ${esc(u.memberId||'-')}</p>
      <span class="alert-time">Expires: ${esc(u.membershipExpiry||'Unknown')}</span>
    </div>`;
  };

  $('expiringList').innerHTML = expiring.length ? expiring.map(u => alertTpl(u,'expiring')).join('') : '<div class="empty-hint">None expiring soon.</div>';
  $('expiredList').innerHTML  = expired.length  ? expired.map(u => alertTpl(u,'expired')).join('') : '<div class="empty-hint">No expired memberships.</div>';
  $('pendingPayList').innerHTML = pending.length ? pending.map(u => alertTpl(u,'pending')).join('') : '<div class="empty-hint">No pending payments.</div>';
  $('defaultersList').innerHTML = defaulters.length
    ? defaulters.map(d => `<div class="alert-item alert-error">
        <div class="alert-top"><span class="alert-name">${esc(d.name||'Unknown')}</span>${chip('red', d.issue||'default')}</div>
        <p class="alert-msg">${esc(d.detail||'')}</p>
      </div>`).join('')
    : '<div class="empty-hint">No defaulters.</div>';
}

function updateAlertBadge() {
  const now = new Date();
  const users = S.users.filter(u => u.role === 'user');
  const count = users.filter(u => {
    if (!u.membershipExpiry) return false;
    const exp = new Date(u.membershipExpiry);
    const days = (exp - now) / 86400000;
    return days <= 7;
  }).length + users.filter(u => u.paymentStatus === 'Pending').length;

  const badge = $('alertBadge');
  if (count > 0) { badge.textContent = count; badge.hidden = false; }
  else badge.hidden = true;
}

/* â”€â”€ SCAN RESULT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderScanResult() {
  const el = $('scanResult');
  if (!S.scanResult) { el.innerHTML = '<div class="empty-hint">Scan results appear here</div>'; return; }
  const r = S.scanResult;
  const actionLabel = actionLabelFor(r.attendanceAction);
  const waitText = r.cooldownRemainingSeconds ? `Wait ${formatCountdown(r.cooldownRemainingSeconds * 1000)}` : '';
  const zoomText = r.zoomFactor > 1 ? `Zoom: ${formatZoomLabel(r.zoomFactor)}` : '';
  const rangeText = r.distanceHint ? formatHintLabel(r.distanceHint) : '';
  const modeText = r.captureMode ? formatHintLabel(r.captureMode) : '';
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;">
      <strong style="font-family:var(--font-display);font-size:.86rem;">${esc(r.name||'Unknown face')}</strong>
      ${chip(r.status||'slate', r.status||'result')}
    </div>
    <div style="font-size:.72rem;color:var(--text2);margin-bottom:4px;">${esc(r.message||'Scan completed.')}</div>
    <div style="display:flex;gap:10px;font-family:var(--font-mono);font-size:.65rem;color:var(--text3);">
      <span>Conf: ${Math.round(Number(r.confidence||0)*100)}%</span>
      <span>Action: ${esc(actionLabel||'Scan')}</span>
      ${waitText ? `<span>${esc(waitText)}</span>` : ''}
      ${rangeText ? `<span>${esc(rangeText)}</span>` : ''}
      ${modeText ? `<span>${esc(modeText)}</span>` : ''}
      ${zoomText ? `<span>${esc(zoomText)}</span>` : ''}
      <span>${esc(fmtDT(r.scannedAt))}</span>
    </div>`;
  el.classList.remove('result-pop');
  requestAnimationFrame(() => el.classList.add('result-pop'));
}

/* â”€â”€ ENROLLMENT GALLERY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderEnrollGallery() {
  const count = S.enrollmentImages.length;
  const progress = Math.min(100, (count / 5) * 100);
  const enrollProgress = $('enrollProgress');
  if (enrollProgress) enrollProgress.style.width = progress + '%';
  const countChip = $('enrollCountChip');
  if (countChip) countChip.textContent = `${count}/5`;

  const gallery = $('enrollmentGallery');
  gallery.innerHTML = count
    ? S.enrollmentImages.map((img, i) => `
        <div class="thumb-item">
          <img src="${img}" alt="Face ${i+1}">
          <span class="thumb-num">${i+1}</span>
        </div>`).join('')
    : '<div class="empty-hint">Capture 3â€“5 clear face images</div>';
}

/* â”€â”€ MEMBER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderMember() {
  const profile = S.memberProfile || S.memberDashboard?.profile;
  if (!profile) return;
  const membershipVisitsUsed = String(profile.membershipVisitsUsed ?? profile.visits ?? 0);
  const membershipVisitsAllowed = String(profile.membershipVisitsAllowed ?? 0);
  const membershipVisitsRemaining = String(profile.membershipVisitsRemaining ?? 0);

  const myAcc = $('myAccountSection');
  const myRec = $('myRecordsSection');
  if (myAcc) myAcc.hidden = false;
  if (myRec) myRec.hidden = false;

  $('memberSummaryGrid').innerHTML = `
    <div class="meta-grid" style="margin-bottom:8px;">
      ${meta('Plan', profile.membershipPlan||'-')}
      ${meta('Status', profile.membershipStatus||'-')}
      ${meta('Slot', profile.slotName||'None')}
      ${meta('Visit Limit', membershipVisitsAllowed)}
      ${meta('Visits Used', membershipVisitsUsed)}
      ${meta('Visits Left', membershipVisitsRemaining)}
    </div>`;

  $('memberProfileCard').innerHTML = `<div class="detail-grid">
    ${dRow('Name', profile.name)} ${dRow('Email', profile.email)}
    ${dRow('Member ID', profile.memberId)} ${dRow('Plan', profile.membershipPlan)}
    ${dRow('Visit Limit', membershipVisitsAllowed)} ${dRow('Visits Used', membershipVisitsUsed)}
    ${dRow('Visits Left', membershipVisitsRemaining)} ${dRow('Expires', profile.membershipExpiry||'-')}
    ${dRow('Payment', profile.paymentStatus||'-')} ${dRow('Total Visits', String(profile.visits ?? 0))}
  </div>`;

  renderList($('memberHistoryList'), S.memberHistory, h => `
    <div class="alert-item">
      <div class="alert-top"><span class="alert-name">${esc(h.eventType||'Attendance')}</span>${chip(h.eventType||'blue', h.eventType||'event')}</div>
      <span class="alert-time">${esc(h.area||'-')} â€¢ ${esc(fmtDT(h.occurredAt))}</span>
    </div>`, 'No history.');

  renderList($('memberPaymentsList'), S.memberPayments, p => `
    <div class="alert-item">
      <div class="alert-top"><span class="alert-name">${esc(p.plan||'Payment')}</span>${chip(p.paymentStatus||'blue', p.paymentStatus||'-')}</div>
      <p class="alert-msg">${fmtMoney(p.amount||0)} via ${esc(p.paymentMode||'?')}</p>
    </div>`, 'No payments.');

  renderList($('memberNotificationsList'), S.memberNotifications, n => `
    <div class="alert-item">
      <div class="alert-top"><span class="alert-name">${esc(n.title||'Notification')}</span>${chip(n.tone||'blue', n.tone||'note')}</div>
      <p class="alert-msg">${esc(n.message||'')}</p>
    </div>`, 'No notifications.');
}

/* â”€â”€ TTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderTts() {
  const map = {
    ready:{label:'READY',cls:'chip-blue'},
    queued:{label:'QUEUED',cls:'chip-amber'},
    speaking:{label:'SPEAKING',cls:'chip-green'},
    browser:{label:'VOICE',cls:'chip-green'},
    error:{label:'ERROR',cls:'chip-rose'},
  };
  const s = map[S.ttsMode] || map.ready;
  $('ttsModeChip').className = `badge-chip ${s.cls}`;
  $('ttsModeChip').textContent = s.label;
  $('ttsStatusText').textContent = S.ttsStatusText;
  $('ttsAudio').hidden = true;
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CRUD
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

async function handleUserSubmit(e) {
  e.preventDefault();
  if (!ensureAdmin()) return;
  const editId = $('userIdInput').value.trim();
  const password = $('userPasswordInput').value.trim();
  const isEditMode = Boolean(editId);
  let createdUserId = '';
  const payload = {
    name: $('userNameInput').value.trim(),
    memberId: isEditMode ? $('userMemberIdInput').value.trim() || null : null,
    sport: $('userSportInput')?.value || 'General',
    membershipLevel: $('userLevelInput')?.value || '',
    email: $('userEmailInput').value.trim(),
    password: password || null,
    mobileNumber: $('userMobileInput')?.value?.trim() || null,
    role: $('userRoleInput').value,
    slotId: $('userSlotInput').value || null,
    membershipPlan: $('userPlanInput').value,
    membershipStart: $('userStartInput').value,
    membershipExpiry: $('userExpiryInput').value,
    visitLimit: parseOptionalNonNegativeInt($('userVisitLimitInput')?.value),
    paymentAmount: Number($('userAmountInput').value||0),
    dueAmount: Number($('userDueAmountInput')?.value||0),
    paymentMode: $('userPaymentModeInput').value,
    paymentStatus: $('userPaymentStatusInput').value,
    note: $('userNoteInput').value.trim(),
  };
  try {
    if (editId) {
      await api(`/admin/update-user/${editId}`, { method:'PUT', body: payload });
      toast('Member updated.', 'success');
    } else {
      const createdUser = await api('/users', { method:'POST', body: payload });
      createdUserId = String(createdUser?.id || '');
      toast('Member created!', 'success');
      showFormSuccess('userFormSuccess');
    }
    resetUserForm(); await refreshAll();
    if (createdUserId) focusFaceEnrollmentUser(createdUserId);
  } catch (err) { handleErr(err, { toast: true }); }
}

function focusFaceEnrollmentUser(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return;

  if ($('enrollmentUserSearchInput')) $('enrollmentUserSearchInput').value = '';
  applyEnrollmentMemberSearch({ query: '' });
  if ($('enrollmentUserInput')) $('enrollmentUserInput').value = normalizedUserId;
  openTab('faceEnrollmentTab');
}

function showFormSuccess(id) {
  const el = $(id); if (!el) return;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2000);
}

async function handleUsersClick(e) {
  if (e.target.dataset.userReport) await openAllMemberReport(e.target.dataset.userReport);
  if (e.target.dataset.userEdit)   beginUserEdit(e.target.dataset.userEdit);
  if (e.target.dataset.userDelete) deleteUser(e.target.dataset.userDelete);
}

async function openAllMemberReport(id) {
  if (!ensureAdmin()) return;

  const reportDrawer = $('allMemberReportDrawer');
  const reportTitle = $('allMemberReportTitle');
  const reportSubtitle = $('allMemberReportSubtitle');
  const reportBody = $('allMemberReportBody');
  const user = S.users.find(x => x.id === id) || {};

  if (!reportDrawer || !reportTitle || !reportSubtitle || !reportBody) return;

  reportTitle.textContent = `${user.name || 'Member'} Report`;
  reportSubtitle.textContent = 'Loading full member report...';
  reportBody.innerHTML = '<div class="empty-hint">Loading report...</div>';
  reportDrawer.hidden = false;

  try {
    const report = await api(`/admin/user/${id}/report`);
    renderAllMemberReport(report, user);
    reportDrawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    reportSubtitle.textContent = 'Unable to load the member report.';
    reportBody.innerHTML = '<div class="empty-hint">Report could not be loaded right now.</div>';
    handleErr(err, { toast: true });
  }
}

function closeAllMemberReport() {
  if ($('allMemberReportDrawer')) $('allMemberReportDrawer').hidden = true;
}

function renderAllMemberReport(report, fallbackUser = {}) {
  const reportDrawer = $('allMemberReportDrawer');
  const reportTitle = $('allMemberReportTitle');
  const reportSubtitle = $('allMemberReportSubtitle');
  const reportBody = $('allMemberReportBody');
  if (!reportDrawer || !reportTitle || !reportSubtitle || !reportBody) return;

  const profile = report?.profile || fallbackUser || {};
  const sessions = toArr(report?.sessions);
  const timelines = toArr(report?.timelines);
  const payments = toArr(report?.payments);
  const totalPaid = sumPaymentAmounts(payments);
  const note = profile.adminNote || profile.note || '';
  const lastAction = [
    profile.lastAction ? String(profile.lastAction).toUpperCase() : '',
    profile.lastActionAt ? fmtDT(profile.lastActionAt) : '',
  ].filter(Boolean).join(' | ');
  const membershipVisitsUsed = String(profile.membershipVisitsUsed ?? profile.visits ?? 0);
  const membershipVisitsAllowed = String(profile.membershipVisitsAllowed ?? 0);
  const membershipVisitsRemaining = String(profile.membershipVisitsRemaining ?? 0);

  reportTitle.textContent = `${profile.name || 'Member'} Report`;
  reportSubtitle.textContent = [
    profile.memberId || '',
    profile.email || '',
    profile.sport || '',
  ].filter(Boolean).join(' | ') || 'Full member report';

  reportBody.innerHTML = `
    <div class="meta-grid">
      ${meta('Member ID', profile.memberId)}
      ${meta('Role', profile.role)}
      ${meta('Sport', profile.sport)}
      ${meta('Level', profile.membershipLevel)}
      ${meta('Plan', profile.membershipPlan)}
      ${meta('Status', profile.membershipStatus || profile.status)}
      ${meta('Payment', profile.paymentStatus)}
      ${meta('Due Amount', fmtMoney(profile.dueAmount || 0))}
      ${meta('Paid Total', fmtMoney(totalPaid))}
      ${meta('Visit Limit', membershipVisitsAllowed)}
      ${meta('Visits Used', membershipVisitsUsed)}
      ${meta('Visits Left', membershipVisitsRemaining)}
      ${meta('Total Visits', String(profile.visits ?? 0))}
      ${meta('Face Images', String(profile.faceImageCount || profile.imageCount || 0))}
      ${meta('Slot', profile.slotName)}
      ${meta('Mobile', profile.mobileNumber || profile.mobile_number)}
      ${meta('Start', profile.membershipStart || profile.startDate)}
      ${meta('Expiry', profile.membershipExpiry || profile.expiry)}
      ${meta('Days Left', profile.daysLeft !== undefined && profile.daysLeft !== null ? String(profile.daysLeft) : '-')}
      ${meta('Last Action', lastAction || '-')}
    </div>
    ${note ? `<div class="all-member-report-note">${esc(note)}</div>` : ''}
    <div class="all-member-report-section">
      <div class="card-sub-head">Session History</div>
      <div class="table-scroll">
        <table class="report-table">
          <thead><tr><th>Check-in</th><th>Check-out</th><th>Area</th><th>Status</th><th>Duration</th></tr></thead>
          <tbody>${sessions.length ? sessions.map(s => `<tr>
            <td class="t-secondary">${esc(fmtDT(s.startedAt))}</td>
            <td class="t-secondary">${hasActualCheckout(s) ? esc(fmtDT(s.endedAt)) : '-'}</td>
            <td class="t-secondary">${esc(s.area || '-')}</td>
            <td>${chip(s.status || 'unknown', s.status || '-')}</td>
            <td class="t-secondary">${esc(fmtDur(s.durationMinutes))}</td>
          </tr>`).join('') : `<tr><td colspan="5"><div class="empty-hint">No session history.</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="all-member-report-section">
      <div class="card-sub-head">Attendance Timeline</div>
      <div class="table-scroll">
        <table class="report-table">
          <thead><tr><th>Event</th><th>Area</th><th>Time</th><th>Total</th><th>Note</th></tr></thead>
          <tbody>${timelines.length ? timelines.map(item => `<tr>
            <td>${chip(item.eventType || 'blue', formatTimelineEvent(item.eventType))}</td>
            <td class="t-secondary">${esc(item.area || '-')}</td>
            <td class="t-secondary">${esc(fmtDT(item.occurredAt))}</td>
            <td class="t-secondary">${esc(item.totalMinutes ? fmtDur(item.totalMinutes) : '-')}</td>
            <td class="t-secondary">${esc(item.note || '-')}</td>
          </tr>`).join('') : `<tr><td colspan="5"><div class="empty-hint">No attendance timeline.</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="all-member-report-section">
      <div class="card-sub-head">Payment History</div>
      <div class="table-scroll">
        <table class="report-table">
          <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Mode</th><th>Status</th><th>Period</th><th>Source</th></tr></thead>
          <tbody>${payments.length ? payments.map(payment => `<tr>
            <td class="t-secondary">${esc(fmtDT(payment.createdAt))}</td>
            <td class="t-secondary">${esc(payment.plan || '-')}</td>
            <td class="t-secondary">${fmtMoney(payment.amount || 0)}</td>
            <td class="t-secondary">${esc(payment.paymentMode || '-')}</td>
            <td>${chip(payment.paymentStatus || 'unknown', payment.paymentStatus || '-')}</td>
            <td class="t-secondary">${esc([
              payment.membershipStart || '-',
              payment.membershipExpiry || '-',
            ].join(' to '))}</td>
            <td class="t-secondary">${esc(payment.source || '-')}</td>
          </tr>`).join('') : `<tr><td colspan="7"><div class="empty-hint">No payment history.</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  reportDrawer.hidden = false;
}

function formatTimelineEvent(value) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function beginUserEdit(id) {
  const u = S.users.find(x => x.id === id);
  if (!u) { toast('User not found.', 'error'); return; }
  openTab('newUserTab');
  $('userIdInput').value = u.id;
  $('userNameInput').value = u.name||'';
  $('userMemberIdInput').value = u.memberId||'';
  $('userEmailInput').value = u.email||'';
  if ($('userMobileInput')) $('userMobileInput').value = u.mobileNumber||u.mobile_number||'';
  if ($('userSportInput')) $('userSportInput').value = u.sport || 'General';
  if ($('userLevelInput')) $('userLevelInput').value = u.membershipLevel || '';
  $('userRoleInput').value = u.role||'user';
  $('userSlotInput').value = u.slotId||'';
  $('userPlanInput').value = u.membershipPlan||'Monthly';
  $('userStartInput').value = u.membershipStart||isoDate(new Date());
  $('userExpiryInput').value = u.membershipExpiry||isoDate(addDays(new Date(),30));
  $('userMemberIdInput').readOnly = false;
  $('userMemberIdInput').required = true;
  $('userAmountInput').value = String(u.paymentAmount||0);
  if ($('userDueAmountInput')) $('userDueAmountInput').value = String(u.dueAmount||0);
  if ($('userVisitLimitInput')) $('userVisitLimitInput').value = u.visitLimit != null ? String(u.visitLimit) : '';
  $('userPaymentModeInput').value = u.paymentMode||'Cash';
  $('userPaymentStatusInput').value = u.paymentStatus||'Pending';
  $('userNoteInput').value = u.adminNote||u.note||'';
  $('userPasswordInput').value = '';
  $('userPasswordInput').required = false;
  $('userPasswordInput').placeholder = 'Leave blank to keep';
  $('userFormTitle').textContent = `âœ Edit ${u.name}`;
  $('userSubmitBtn').textContent = 'Update Member';
  syncSlotField();
  syncUserPlanDates();
}

async function deleteUser(id) {
  if (!ensureAdmin()) return;
  const u = S.users.find(x => x.id === id);
  if (!u || !confirm(`Delete ${u.name}?`)) return;
  try { await api(`/admin/delete-user/${id}`, { method:'DELETE' }); toast('Deleted.','success'); await refreshAll(); }
  catch (err) { handleErr(err, { toast: true }); }
}

function resetUserForm() {
  $('userForm').reset();
  $('userIdInput').value = '';
  $('userFormTitle').textContent = 'âž• Create Member';
  $('userSubmitBtn').textContent = 'Create Member';
  $('userRoleInput').value = 'user';
  $('userPlanInput').value = 'Monthly';
  $('userPaymentModeInput').value = 'Cash';
  $('userPaymentStatusInput').value = 'Pending';
  $('userStartInput').value = isoDate(new Date());
  $('userExpiryInput').value = isoDate(addDays(new Date(), 30));
  $('userAmountInput').value = '0';
  if ($('userDueAmountInput')) $('userDueAmountInput').value = '0';
  if ($('userVisitLimitInput')) $('userVisitLimitInput').value = '';
  if ($('userLevelInput')) $('userLevelInput').value = '';
  $('userPasswordInput').required = true;
  $('userPasswordInput').placeholder = 'Min 8 characters';
  $('userMemberIdInput').placeholder = 'Auto-generated';
  syncSlotField();
  syncUserPlanDates();
  syncUserMemberIdField();
}

function syncSlotField() {
  $('userSlotInput').disabled = $('userRoleInput').value !== 'user';
}

function generateNextMemberId(role = 'user') {
  const sport = $('userSportInput')?.value || 'General';
  const prefixMap = {
    Swimming: 'CAP/SW',
    Cricket:  'CAP/CR',
    Tennis:   'CAP/TN',
    Zumba:    'CAP/ZU',
    Skating:  'CAP/SK',
    General:  'CSC',
  };
  const prefix = role === 'admin' ? 'ADMIN' : (prefixMap[sport] || 'CSC');
  let highest = 0;

  toArr(S.users).forEach(user => {
    const memberId = String(user?.memberId || '').trim().toUpperCase();
    const slashMatch = memberId.match(new RegExp(`^${prefix.replace(/\//g, '\\/').toUpperCase()}\/(\\d+)$`));
    const dashMatch  = memberId.match(new RegExp(`^${prefix.toUpperCase()}-(\\d+)$`));
    const num = slashMatch ? Number(slashMatch[1]) : dashMatch ? Number(dashMatch[1]) : 0;
    if (num > highest) highest = num;
  });

  const pad = prefix.includes('/') ? 2 : 3;
  const sep = prefix.includes('/') ? '/' : '-';
  return `${prefix}${sep}${String(highest + 1).padStart(pad, '0')}`;
}

function syncUserMemberIdField() {
  const memberIdInput = $('userMemberIdInput');
  if (!memberIdInput) return;

  const isEditMode = Boolean($('userIdInput').value.trim());
  if (isEditMode) {
    memberIdInput.readOnly = false;
    memberIdInput.required = true;
    return;
  }

  memberIdInput.readOnly = true;
  memberIdInput.required = false;
  memberIdInput.value = '';
}

function syncUserPlanDates() {
  const startValue = $('userStartInput').value;
  const expiryInput = $('userExpiryInput');
  if (!expiryInput || !startValue) return;

  const days = getSportLevelDays();
  expiryInput.readOnly = Boolean(days);
  if (!days) return;

  expiryInput.value = isoDate(addDays(new Date(startValue), days));
}

function getSportLevelDays() {
  const planSel  = $('userPlanInput');
  const planDays = {
    Monthly: 30,
    '2 Month': 60,
    Quarterly: 90,
    'Half-Yearly': 180,
    Yearly: 365,
  };
  return planDays[planSel?.value] || null;
}

/* â”€â”€ SLOTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handleSlotSubmit(e) {
  e.preventDefault();
  if (!ensureAdmin()) return;
  const editId = $('slotIdInput').value.trim();
  const payload = { name: $('slotNameInput').value.trim(), startTime: $('slotStartInput').value, endTime: $('slotEndInput').value };
  try {
    if (editId) { await api(`/admin/slots/${editId}`, { method:'PUT', body: payload }); toast('Slot updated.','success'); }
    else        { await api('/admin/slots', { method:'POST', body: payload }); toast('Slot created.','success'); }
    resetSlotForm(); await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}
function handleSlotsClick(e) {
  if (e.target.dataset.slotEdit)   beginSlotEdit(e.target.dataset.slotEdit);
  if (e.target.dataset.slotDelete) deleteSlot(e.target.dataset.slotDelete);
}
function beginSlotEdit(id) {
  const s = S.slots.find(x => x.id === id); if (!s) return;
  openTab('settingsTab');
  $('slotIdInput').value = s.id; $('slotNameInput').value = s.name||'';
  $('slotStartInput').value = s.startTime||''; $('slotEndInput').value = s.endTime||'';
  $('slotSubmitBtn').textContent = 'Update Slot';
}
async function deleteSlot(id) {
  if (!ensureAdmin()) return;
  const s = S.slots.find(x => x.id === id);
  if (!s || !confirm(`Delete slot ${s.name}?`)) return;
  try { await api(`/admin/slots/${id}`, { method:'DELETE' }); toast('Deleted.','success'); await refreshAll(); }
  catch (err) { handleErr(err, { toast: true }); }
}
function resetSlotForm() {
  $('slotForm').reset(); $('slotIdInput').value = '';
  $('slotSubmitBtn').textContent = 'Create Slot';
}

/* â”€â”€ MEMBERSHIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handleMembershipSubmit(e) {
  e.preventDefault();
  if (!ensureAdmin()) return;
  try {
    await api('/admin/create-membership', { method:'POST', body: {
      userId: $('membershipUserInput').value, plan: $('membershipPlanInput').value,
      startDate: $('membershipStartInput').value, expiryDate: $('membershipExpiryInput').value,
      visitLimit: parseOptionalNonNegativeInt($('membershipVisitLimitInput')?.value),
      paymentAmount: Number($('membershipAmountInput').value||0),
      paymentMode: $('membershipModeInput').value, paymentStatus: $('membershipStatusInput').value,
      source: $('membershipSourceInput').value.trim(),
    }});
    if ($('membershipVisitLimitInput')) $('membershipVisitLimitInput').value = '';
    toast('Membership created.','success'); await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}

/* â”€â”€ SESSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handleSessionStart(e) {
  e.preventDefault();
  if (!ensureAdmin()) return;
  try {
    await api('/session/start', { method:'POST', body: {
      userId: $('sessionUserInput').value, area: $('sessionAreaInput').value.trim(),
      confidence: Number($('sessionConfidenceInput').value),
    }});
    toast('Session started.','success'); await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}
function handleSessionsClick(e) {
  if (e.target.dataset.sessionEnd) endSession(e.target.dataset.sessionEnd);
}
async function endSession(id) {
  if (!ensureAdmin()) return;
  try {
    const session = toArr(S.sessions).find(item => String(item.id) === String(id));
    await api('/session/end', { method:'POST', body: { sessionId: id } });
    if (session?.userId) stopSessionTimer(session.userId);
    toast('Session ended.','success');
    await refreshAll();
  }
  catch (err) { handleErr(err, { toast: true }); }
}

/* â”€â”€ ANNOUNCEMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function handleAnnouncementSubmit(e) {
  e.preventDefault();
  if (!ensureAdmin()) return;
  try {
    await api('/admin/announcements', { method:'POST', body: {
      title: $('announcementTitleInput').value.trim(),
      message: $('announcementMessageInput').value.trim(),
      tone: $('announcementToneInput').value,
      userId: $('announcementUserInput').value || null,
    }});
    $('announcementForm').reset(); toast('Published.','success'); await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   FACE RECOGNITION / LIVE SCAN
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function handleLiveScanToggle(e) {
  if (e.target.checked) await startLiveScan({ toast: true });
  else stopLiveScan({ toast: true });
}

async function startLiveScan(opts = {}) {
  if (!await ensureRecognitionReady()) { $('enableCameraInput').checked = false; return false; }
  if (S.isScanning) return true;
  S.cameraRequested = true;
  S.scanMissStreak = 0;
  const ok = await startCamera();
  if (!ok) { S.cameraRequested = false; $('enableCameraInput').checked = false; return false; }
  S.isScanning = true;
  setLiveDetection(null, { keepSearchZoom: true });
  document.querySelector('.scanner-panel')?.classList.add('is-live');
  clearInterval(S.scanLoopTimer);
  S.scanLoopTimer = setInterval(() => runLiveCycle().catch(console.error), LIVE_SCAN_INTERVAL);
  renderConsole();
  setScanState('loading','Scanning...','Matching in browser and validating membership.');
  if (opts.toast) toast('Live scan started.','success');
  await runLiveCycle();
  return true;
}

function stopLiveScan(opts = {}) {
  clearInterval(S.scanLoopTimer); S.scanLoopTimer = null;
  S.cameraRequested = false;
  S.cameraRestarting = false;
  S.isScanning = false; S.scanInFlight = false;
  S.scanMissStreak = 0;
  setLiveDetection(null);
  document.querySelector('.scanner-panel')?.classList.remove('is-live');
  stopCamera();
  setScanState('idle','Live scanner is offline','Enable Live Scan to start.');
  renderConsole();
  if (opts.toast) toast('Live scan stopped.');
}

async function requestPreferredCameraStream() {
  let lastError = null;

  for (const constraints of CAMERA_CONSTRAINT_SETS) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const blocked = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      if (blocked) break;
    }
  }

  throw lastError || new Error('Cannot start camera.');
}

async function startCamera() {
  const preview = $('cameraPreview');
  if (streamHasActiveVideo(S.stream)) {
    syncCameraPreviewStreams();
    await preview.play().catch(()=>{});
    const ready = await waitVideoReady(preview);
    if (!ready) {
      toast('Camera connected, but the preview is not ready yet. Retry in a moment.','warning');
      renderConsole();
      return false;
    }
    setLiveDetection(null, { keepSearchZoom: S.isScanning || S.cameraRequested });
    syncIdleCameraPreview();
    renderConsole();
    return true;
  }
  stopCamera({ preserveRequest: true, silent: true });
  if (!navigator.mediaDevices?.getUserMedia) {
    toast(
      window.isSecureContext
        ? 'Camera is not supported in this browser.'
        : 'Camera access requires HTTPS or localhost. Open the app on https:// or http://localhost.',
      'error',
    );
    return false;
  }
  try {
    S.stream = await requestPreferredCameraStream();
    syncCameraPreviewStreams();
    S.stream.getVideoTracks().forEach(track => {
      track.addEventListener('ended', handleCameraTrackEnded, { once: true });
    });
    await preview.play().catch(()=>{});
    const ready = await waitVideoReady(preview);
    if (!ready) throw new Error('Camera preview did not become ready.');
    setLiveDetection(null, { keepSearchZoom: S.isScanning || S.cameraRequested });
    syncIdleCameraPreview();
    renderConsole(); return true;
  } catch (err) { toast(getCameraErrorMessage(err),'error'); renderConsole(); return false; }
}

function stopCamera(opts = {}) {
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  syncCameraPreviewStreams();
  setLiveDetection(null);
  if (!opts.preserveRequest) S.cameraRequested = false;
  if (!opts.silent) S.cameraRestarting = false;
  renderConsole();
}

async function handleCameraTrackEnded() {
  if (!S.cameraRequested || S.cameraRestarting) return;
  S.cameraRestarting = true;
  stopCamera({ preserveRequest: true, silent: true });
  setScanState('loading','Camera reconnecting...','Restoring the live preview.');
  const ok = await startCamera();
  S.cameraRestarting = false;
  if (!ok) {
    stopLiveScan();
    $('enableCameraInput').checked = false;
    toast('Camera disconnected.','error');
  }
}

function waitVideoReady(video, ms = 3000) {
  if (video.videoWidth && video.videoHeight) return Promise.resolve(true);
  return new Promise(res => {
    const t = setTimeout(() => { cleanup(); res(false); }, ms);
    function cleanup() { clearTimeout(t); video.removeEventListener('loadeddata', h); video.removeEventListener('playing', h); }
    function h() { if (video.videoWidth && video.videoHeight) { cleanup(); res(true); } }
    video.addEventListener('loadeddata', h); video.addEventListener('playing', h);
  });
}

function getCameraErrorMessage(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was blocked. Allow camera access in the browser and retry.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is busy in another app or browser tab.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'The selected camera mode is not available on this device.';
  }
  if (err?.message === 'Camera preview did not become ready.') {
    return 'Camera access was granted, but the preview never became ready.';
  }
  return err?.message || 'Cannot start camera.';
}

async function runLiveCycle() {
  if (!S.isScanning || S.scanInFlight) return;
  if (!S.stream) { const ok = await startCamera(); if (!ok) { stopLiveScan(); return; } }
  await runScan({ source: 'camera', showToast: false });
}

function grabFrame(opts = {}) {
  const v = $('cameraPreview');
  if (!v.videoWidth || !v.videoHeight) return '';
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  const zoom = clamp(Number(opts.zoom || 1), 1, MAX_PREVIEW_ZOOM);
  if (zoom > 1.001) {
    const focusX = clamp(Number(opts.focusX ?? DEFAULT_CAMERA_FOCUS_X), 0.1, 0.9);
    const focusY = clamp(Number(opts.focusY ?? DEFAULT_CAMERA_FOCUS_Y), 0.1, 0.9);
    const cropWidth = v.videoWidth / zoom;
    const cropHeight = v.videoHeight / zoom;
    const sourceX = clamp((focusX * v.videoWidth) - (cropWidth / 2), 0, v.videoWidth - cropWidth);
    const sourceY = clamp((focusY * v.videoHeight) - (cropHeight / 2), 0, v.videoHeight - cropHeight);
    ctx.drawImage(v, sourceX, sourceY, cropWidth, cropHeight, 0, 0, c.width, c.height);
  } else {
    ctx.drawImage(v, 0, 0);
  }
  return c.toDataURL('image/jpeg', 0.92);
}

async function ensureCameraReadyForCapture() {
  if (!ensureAdmin()) return false;
  if (!streamHasActiveVideo(S.stream) || !$('cameraPreview').videoWidth || !$('cameraPreview').videoHeight) {
    const ok = await startCamera();
    if (!ok) return false;
  }
  if (!$('cameraPreview').videoWidth || !$('cameraPreview').videoHeight) {
    toast('Camera preview is not ready yet. Wait a moment and retry.','warning');
    return false;
  }
  return true;
}

async function captureScanFrame() {
  if (!await ensureCameraReadyForCapture()) return;
  const f = grabFrame();
  if (!f) { toast('Camera preview is not ready yet.','error'); return; }
  S.scanImage = f; renderConsole();
  toast('Frame captured.','success');
}

async function handleScanFileInput(e) {
  const [file] = Array.from(e.target.files||[]);
  if (!file) return;
  try { S.scanImage = await fileToDataUrl(file); renderConsole(); toast('Image loaded.','success'); }
  catch { toast('Cannot read image.','error'); }
}

async function handleManualScan() {
  if (!await ensureRecognitionReady()) return;
  const hasLiveVideo = Boolean(S.stream && $('cameraPreview').videoWidth && $('cameraPreview').videoHeight);
  const source = hasLiveVideo ? 'camera' : 'upload';
  const image = source === 'upload' ? S.scanImage : '';
  if (source === 'upload' && !image) { toast('Enable Live Scan or upload an image first.','error'); return; }
  await runScan({ source, image, showToast: true });
}

async function runScan(opts = {}) {
  if (S.scanInFlight) return null;
  const source = opts.source || (opts.image ? 'upload' : 'camera');
  const image = source === 'upload' ? (opts.image || S.scanImage || '') : '';
  if (source === 'upload' && !image) return null;
  S.scanInFlight = true;
  if (image) S.scanImage = image;
  renderConsole();
  setScanState('loading', 'Scanning...', 'Matching face in browser and validating access.');
  try {
    const probe = await detectRecognitionProbe({ source, image });
    if (source === 'camera') {
      setLiveDetection(probe?.detection || null, { keepSearchZoom: true });
      if (probe?.detection) {
        setScanState('loading', 'Face locked', buildDetectionAssistDetail(probe.detection), 'Face Lock');
      }
    }
    if (!probe?.detection) {
      const result = buildClientScanResult({
        status: 'retry',
        message: probe?.message || 'No face detected. Align your face and try again.',
        confidence: 0,
        source,
      });
      S.scanResult = result;
      renderScanResult();
      applyScanResult(result);
      return result;
    }

    const match = window.FaceAi.bestMatch(
      probe.detection.descriptor,
      S.faceUsers,
      S.recognitionThreshold
    );

    if (!match?.matched || !match.user?.id) {
      const result = buildClientScanResult({
        status: 'unknown',
        message: 'Unknown face. No enrolled member matched this scan.',
        confidence: match?.confidence || probe.detection.score || 0,
        faceBox: probe.detection.faceBox,
        distanceHint: probe.detection.distanceHint,
        captureMode: probe.detection.captureMode,
        zoomFactor: probe.detection.recommendedZoom,
        source,
      });
      S.scanResult = result;
      renderScanResult();
      applyScanResult(result);
      return result;
    }

    const userRecord = getUserRecord(match.user.id) || match.user;
    if (!canScan(match.user.id)) {
      return null;
    }

    const attendanceRecord = getAttendanceRecord(match.user.id);
    const action = inferAttendanceAction(match.user.id);

    const localCooldown = getCooldownInfo(match.user.id, action);
    if (localCooldown.remainingMs > 0) {
      const result = buildClientScanResult({
        status: 'cooldown',
        message: buildCooldownMessage(localCooldown.remainingMs, action),
        name: userRecord?.name || match.user.name,
        confidence: Number(match.confidence || probe.detection.score || 0),
        attendanceAction: action,
        cooldownRemainingSeconds: Math.ceil(localCooldown.remainingMs / 1000),
        faceBox: probe.detection.faceBox,
        distanceHint: probe.detection.distanceHint,
        captureMode: probe.detection.captureMode,
        zoomFactor: probe.detection.recommendedZoom,
        source,
        userId: match.user.id,
      });
      S.scanResult = result;
      renderScanResult();
      applyScanResult(result);
      if (opts.showToast) toast(result.message, 'warning');
      return result;
    }

    const backendResult = await api('/attendance', {
      method:'POST',
      body:{
        userId: match.user.id,
        action,
        area: $('scanAreaInput').value.trim() || 'Capper Sports Club Entry',
        confidence: match.confidence,
      },
    });
    const result = buildClientScanResult({
      ...backendResult,
      status: backendResult?.status || 'granted',
      message: backendResult?.message || 'Attendance marked successfully.',
      name: backendResult?.name || userRecord?.name || match.user.name,
      confidence: Number(backendResult?.confidence ?? match.confidence ?? 0),
      attendanceAction: backendResult?.attendanceAction || action,
      scannedAt: backendResult?.scannedAt,
      cooldownRemainingSeconds: Number(backendResult?.cooldownRemainingSeconds || 0),
      faceBox: probe.detection.faceBox,
      distanceHint: probe.detection.distanceHint,
      captureMode: probe.detection.captureMode,
      zoomFactor: probe.detection.recommendedZoom,
      source,
      userId: match.user.id || match.user?.userId || null,
    });
    if (result.status === 'granted' && result.attendanceAction) {
      recordAttendanceAction(match.user.id, result.attendanceAction, result.scannedAt, result.name);
      updateLocalUserAttendance(match.user.id, result.attendanceAction, result.scannedAt);
    } else if (result.status === 'cooldown') {
      syncCooldownFromResult(result, action);
    } else if (result.status === 'duplicate' && attendanceRecord?.completed) {
      recordAttendanceAction(match.user.id, attendanceRecord.action || 'OUT', attendanceRecord.timestamp, result.name);
    }
    S.scanResult = result;
    renderScanResult();
    applyScanResult(result);
    if (result.session) {
      upsertSessionLocal(result.session);
      syncActiveSessionsFromBackend();
      renderSessions();
      renderSystemStatus();
    }
    if (opts.showToast || result.status === 'granted') {
      toast(result.message||'Scan complete.', result.status==='granted'?'success':'warning');
    }
    return result;
  } catch (err) {
    setScanState('denied', 'Access Denied', err?.message || 'Scan failed.');
    if (opts.showToast) handleErr(err, { toast: true });
    return null;
  } finally {
    S.scanInFlight = false;
    if (S.cameraRequested && !streamHasActiveVideo(S.stream)) {
      startCamera().catch(console.error);
    }
    renderConsole();
  }
}

async function detectRecognitionProbe(opts = {}) {
  const source = opts.source || 'camera';
  if (source === 'upload') {
    const image = opts.image || S.scanImage;
    if (!image) return { detection: null, message: 'Upload an image first.' };
    return { source, detection: await window.FaceAi.detectFromDataUrl(image) };
  }

  const video = $('cameraPreview');
  if (!video?.videoWidth || !video?.videoHeight) {
    return { detection: null, message: 'Camera preview is not ready yet.' };
  }

  const detection = await window.FaceAi.detectFromVideo(video, {
    hintBox: S.liveDetection?.faceBox || null,
    allowLongRange: !S.liveDetection?.faceBox || S.scanMissStreak >= 2,
  });
  S.scanMissStreak = detection ? 0 : Math.min(S.scanMissStreak + 1, 6);
  return { source, detection };
}

function buildClientScanResult(opts = {}) {
  const action = String(opts.attendanceAction || '').toUpperCase();
  return {
    status: opts.status || 'retry',
    message: opts.message || 'Scan complete.',
    confidence: Number(opts.confidence || 0),
    name: opts.name || null,
    attendanceAction: action || null,
    scannedAt: opts.scannedAt || new Date().toISOString(),
    cooldownRemainingSeconds: Number(opts.cooldownRemainingSeconds || 0),
    faceBox: opts.faceBox || null,
    distanceHint: opts.distanceHint || '',
    captureMode: opts.captureMode || '',
    zoomFactor: Number(opts.zoomFactor || 0),
    source: opts.source || 'camera',
    userId: opts.userId || null,
    ttsMessage: opts.ttsMessage || '',
  };
}

function updateLocalUserAttendance(userId, action, scannedAt) {
  const id = String(userId || '').trim();
  const normalizedAction = normalizeAttendanceAction(action);
  const timestamp = normalizeTimestamp(scannedAt) || new Date().toISOString();
  if (!id || !normalizedAction) return;

  S.users = S.users.map(user => (
    String(user?.id || '') === id
      ? { ...user, lastAction: normalizedAction, lastActionAt: timestamp, lastTimestamp: timestamp }
      : user
  ));
  S.faceUsers = S.faceUsers.map(user => (
    String(user?.id || '') === id
      ? { ...user, lastAction: normalizedAction, lastActionAt: timestamp }
      : user
  ));
}

function upsertSessionLocal(session) {
  if (!session?.id) return;
  const sessionId = String(session.id);
  const nextSession = { ...session };
  const index = S.sessions.findIndex(item => String(item?.id || '') === sessionId);

  if (index >= 0) {
    S.sessions = S.sessions.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...nextSession } : item
    ));
    return;
  }

  S.sessions = [nextSession, ...S.sessions];
}

function inferAttendanceAction(userId) {
  const record = getAttendanceRecord(userId);
  return record?.active || record?.action === 'IN' ? 'OUT' : 'IN';
}

function applyScanResultLegacy(r) {
  const detail = r.name ? `${r.name} â€” ${fmtDT(r.scannedAt)}` : (r.message || fmtDT(r.scannedAt));
  if (r.status === 'granted') {
    setScanState('granted','Access Granted âœ“', detail);
    const isExit = String(r.attendanceAction || '').toUpperCase() === 'OUT';
    setScanState('granted', isExit ? 'Exit Marked' : 'Entry Marked', detail);
    speakText(`${isExit ? 'Exit' : 'Entry'} marked successfully for ${r.name || 'the member'}`, 'HIGH');
    return;
  }
  if (r.status === 'cooldown') {
    maybeSpeakCooldown(r.userId);
    setScanState('detected','Please Wait', r.message||detail, 'Cooldown');
    return;
  }
  if (r.status === 'duplicate' || r.status === 'retry') {
    setScanState('detected','Face Detected', r.message||detail); return;
  }
  speakText(r.message || 'Access denied.', 'LOW');
  setScanState('denied','Access Denied', r.message||detail, r.name ? 'Face Found' : 'No Match');
}

/* â”€â”€ ENROLLMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function applyScanResultBrowser(r) {
  const detail = r.name ? `${r.name} - ${fmtDT(r.scannedAt)}` : (r.message || fmtDT(r.scannedAt));
  if (r.status === 'granted') {
    setScanState('granted','Access Granted âœ“', detail);
    const isExit = String(r.attendanceAction || '').toUpperCase() === 'OUT';
    setScanState('granted', isExit ? 'Exit Marked' : 'Entry Marked', detail);
    speakText(`${isExit ? 'Exit' : 'Entry'} marked successfully for ${r.name || 'the member'}`, 'HIGH');
    return;
  }
  if (r.status === 'duplicate' || r.status === 'retry' || r.status === 'cooldown') {
    setScanState('detected','Face Detected', r.message||detail);
    return;
  }
  speakText(r.message || 'Access denied.', 'LOW');
  setScanState('denied','Access Denied', r.message||detail, r.name ? 'Face Found' : 'No Match');
}

async function captureEnrollFrame() {
  if (!await ensureCameraReadyForCapture()) return;
  syncIdleCameraPreview();
  const f = grabFrame({
    zoom: getEnrollmentZoom(),
    focusX: DEFAULT_CAMERA_FOCUS_X,
    focusY: DEFAULT_CAMERA_FOCUS_Y,
  });
  if (!f) { toast('Camera preview is not ready yet.','error'); return; }
  if (S.enrollmentImages.length >= 5) { toast('Max 5 images.','success'); return; }
  S.enrollmentImages.push(f); renderEnrollGallery();
  toast(`Frame ${S.enrollmentImages.length}/5 captured!`, 'success');
}
function clearEnrollmentImages() { S.enrollmentImages = []; renderEnrollGallery(); }
async function handleEnrollFiles(e) {
  const files = Array.from(e.target.files||[]);
  if (!files.length) return;
  try {
    const imgs = await Promise.all(files.slice(0, 5 - S.enrollmentImages.length).map(fileToDataUrl));
    S.enrollmentImages = S.enrollmentImages.concat(imgs);
    renderEnrollGallery(); toast(`${imgs.length} images added.`, 'success');
  } catch { toast('Cannot read images.','error'); }
  finally { $('enrollmentFilesInput').value = ''; }
}
async function handleFaceUpload(e) {
  e.preventDefault();
  const userId = $('enrollmentUserInput').value || (S.currentUser ? S.currentUser.id : null);
  if (!userId) { toast('Select a user first.','error'); return; }
  if (S.enrollmentImages.length < 3) { toast('Need at least 3 images.','error'); return; }
  try {
    const modelsReady = await ensureFaceModelsLoaded();
    if (!modelsReady) {
      toast(S.faceModelsError || 'AI models are not ready.', 'error');
      return;
    }
    const descriptors = await window.FaceAi.descriptorsFromImages(S.enrollmentImages);
    if (descriptors.length < 3) {
      toast('At least 3 clear faces are required for enrollment.', 'error');
      return;
    }
    await api('/users/embeddings', { method:'POST', body:{ userId, descriptors }});
    clearEnrollmentImages(); toast('Face enrollment complete!', 'success'); await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VOICE / TTS â€” Priority System
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
let ttsQueue = []; let ttsBusy = false;

function legacySpeakText(text, priority = 'LOW') {
  // Cancel LOW if HIGH/MEDIUM comes in
  if (priority === 'HIGH') { ttsQueue = ttsQueue.filter(i => i.priority === 'HIGH'); }
  ttsQueue.push({ text, priority });
  if (!ttsBusy) processTtsQueue();
}

async function legacyProcessTtsQueue() {
  if (!ttsQueue.length) { ttsBusy = false; return; }
  ttsBusy = true;
  const item = ttsQueue.shift();
  await doSpeak(item.text);
  processTtsQueue();
}

async function legacyDoSpeak(text) {
  return Boolean(text);
}

async function legacyHandleTts(e) {
  e.preventDefault();
  const text = $('ttsText').value.trim();
  if (!text) { toast('Enter some text.','error'); return; }
  await unlockAudioPlayback().catch(() => {});
  const accepted = speakText(text, 'HIGH', {
    cooldownMs: 0,
    cooldownKey: `manual:${Date.now()}`,
  });
  if (!accepted) {
    toast('Voice is not ready.','warning');
    return;
  }
  $('ttsText').value = '';
  toast('Speakingâ€¦', 'success');
}

function legacySpeakBrowser(text) {
  if (!('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-IN'; u.rate = 1;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(x => /^en/i.test(x.lang)) || voices[0];
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}
function legacyStopBrowserSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
function legacyClearAudio() {
  const a = $('ttsAudio'); a.pause(); a.removeAttribute('src'); a.load();
  if (S.audioUrl) { URL.revokeObjectURL(S.audioUrl); S.audioUrl = ''; }
}

function legacySetTtsMode(mode, text) {
  S.ttsMode = mode;
  S.ttsStatusText = text;
  renderTts();
}

function waitForAudioComplete(audio, timeout = 30000) {
  if (audio.ended) return Promise.resolve();
  return new Promise(res => {
    const done = () => { cleanup(); res(); };
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener('ended', done);
      audio.removeEventListener('error', done);
    };
    const timer = setTimeout(done, timeout);
    audio.addEventListener('ended', done);
    audio.addEventListener('error', done);
  });
}

function legacyRegisterMediaUnlock() {
  const unlock = () => { unlockAudioPlayback().catch(() => {}); };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
}

async function legacyUnlockAudioPlayback() {
  if (S.audioUnlocked) return true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { S.audioUnlocked = true; return true; }
  try {
    if (!S.audioContext) S.audioContext = new Ctx();
    if (S.audioContext.state !== 'running') await S.audioContext.resume();
    const gain = S.audioContext.createGain();
    const osc = S.audioContext.createOscillator();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(S.audioContext.destination);
    osc.start();
    osc.stop(S.audioContext.currentTime + 0.01);
    S.audioUnlocked = S.audioContext.state === 'running';
  } catch {
    S.audioUnlocked = false;
  }
  return S.audioUnlocked;
}

/* â”€â”€ SELECTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
let activeSpeechResolver = null;
let lastLowSpeechText = '';
let lastLowSpeechAt = 0;
let ttsVoiceCache = [];
let ttsPreferredVoice = null;
let ttsVoiceRetryTimer = null;
let ttsVoiceRetryCount = 0;
let activeSpeechItem = null;
const ttsMessageHistory = new Map();
const TTS_PROFILE = Object.freeze({
  lang: 'en-IN',
  rate: 1.0,
  pitch: 0.96,
  volume: 4,
  lowRepeatMs: 5000,
});
const TTS_COOLDOWN_MS = Object.freeze({
  HIGH: 1200,
  MEDIUM: 7000,
  LOW: 12000,
});

function getSpeechEngine() {
  return 'speechSynthesis' in window ? window.speechSynthesis : null;
}

function isSpeechBusy() {
  const synth = getSpeechEngine();
  return Boolean(ttsBusy || activeSpeechResolver || synth?.speaking || synth?.pending);
}

function normalizeSpeechText(text) {
  let message = sanitizeDisplayText(text).replace(/\s+/g, ' ').trim();
  if (!message) return '';
  message = message.replace(/\s*,\s*/g, ', ');
  message = message.replace(/\s*([.!?])/g, '$1');
  message = message.replace(/\.{3,}/g, '...');
  if (!/[.!?]$/.test(message)) message += '.';
  return message;
}

function describeSpeechVoice(voice) {
  if (!voice) return 'system voice';
  const name = String(voice.name || '').trim();
  const lang = String(voice.lang || TTS_PROFILE.lang).trim();
  return name ? `${name} (${lang})` : lang;
}

function buildTtsReadyText() {
  return ttsPreferredVoice
    ? `Browser voice ready. Using ${describeSpeechVoice(ttsPreferredVoice)}.`
    : 'Browser voice ready. Using the default system voice.';
}

function buildTtsQueuedText() {
  const queuedCount = ttsQueue.length + (activeSpeechResolver ? 1 : 0);
  return queuedCount > 1 ? `${queuedCount} voice alerts are lined up.` : 'Voice alert queued.';
}

function cleanupSpeechHistory() {
  const now = Date.now();
  for (const [key, value] of ttsMessageHistory.entries()) {
    if ((now - value) > 60000) ttsMessageHistory.delete(key);
  }
}

function refreshSpeechVoices() {
  const synth = getSpeechEngine();
  const voices = toArr(synth?.getVoices());
  if (!voices.length) return ttsVoiceCache;
  ttsVoiceRetryCount = 0;
  ttsVoiceCache = voices;
  ttsPreferredVoice = pickSpeechVoice(voices);
  if (!isSpeechBusy()) setTtsMode('ready', buildTtsReadyText());
  return voices;
}

function scheduleSpeechVoiceRefresh() {
  clearTimeout(ttsVoiceRetryTimer);
  if (ttsVoiceCache.length || ttsVoiceRetryCount >= 12) return;
  ttsVoiceRetryTimer = setTimeout(() => {
    ttsVoiceRetryCount += 1;
    refreshSpeechVoices();
    if (!ttsVoiceCache.length) scheduleSpeechVoiceRefresh();
  }, 300);
}

function ensureSpeechEngineReady() {
  const synth = getSpeechEngine();
  if (!synth) {
    setTtsMode('error', 'Browser speech is unavailable on this device.');
    return false;
  }
  refreshSpeechVoices();
  scheduleSpeechVoiceRefresh();
  if (!isSpeechBusy()) setTtsMode('ready', buildTtsReadyText());
  return true;
}

function speakText(text, priority = 'LOW', opts = {}) {
  if (!ensureSpeechEngineReady()) return false;

  const message = normalizeSpeechText(text);
  if (!message) return false;

  const level = String(priority || 'LOW').toUpperCase();
  const cooldownKey = String(
    opts.cooldownKey
    || `${level}:${String(opts.userId || '')}:${message.toLowerCase()}`
  );
  const cooldownMs = Number.isFinite(Number(opts.cooldownMs))
    ? Number(opts.cooldownMs)
    : (TTS_COOLDOWN_MS[level] || TTS_COOLDOWN_MS.LOW);

  cleanupSpeechHistory();
  if (cooldownMs > 0) {
    const lastAt = Number(ttsMessageHistory.get(cooldownKey) || 0);
    if ((Date.now() - lastAt) < cooldownMs) return false;
  }

  if (level === 'LOW') {
    const now = Date.now();
    if (message === lastLowSpeechText && (now - lastLowSpeechAt) < TTS_PROFILE.lowRepeatMs) return false;
    if (isSpeechBusy() || ttsQueue.length) return false;
    lastLowSpeechText = message;
    lastLowSpeechAt = now;
  }

  ttsMessageHistory.set(cooldownKey, Date.now());

  if (level === 'HIGH') {
    ttsQueue = [];
    stopBrowserSpeech();
  } else if (level === 'MEDIUM') {
    ttsQueue = ttsQueue.filter(item => item.priority !== 'LOW');
  }

  ttsQueue.push({
    text: message,
    priority: level,
    createdAt: Date.now(),
    cooldownKey,
  });
  ttsQueue.sort((left, right) => {
    const priorityDelta = ttsPriority(right.priority) - ttsPriority(left.priority);
    return priorityDelta || (left.createdAt - right.createdAt);
  });
  setTtsMode('queued', buildTtsQueuedText());
  if (!ttsBusy) processTtsQueue();
  return true;
}

async function processTtsQueue() {
  if (ttsBusy) return;
  ttsBusy = true;
  while (ttsQueue.length) {
    const item = ttsQueue.shift();
    await doSpeak(item);
  }
  ttsBusy = false;
  if (!activeSpeechResolver) setTtsMode('ready', buildTtsReadyText());
}

async function doSpeak(item) {
  const message = normalizeSpeechText(item?.text);
  if (!message) return false;
  clearAudio();
  const browserOk = await speakBrowser(message, item);
  if (browserOk) {
    if (!ttsQueue.length && !activeSpeechResolver) setTtsMode('ready', buildTtsReadyText());
    return true;
  }
  setTtsMode('error', 'Browser voice playback failed.');
  return false;
}

async function speakServerAudio(text) {
  return false;
}

async function handleTts(e) {
  e.preventDefault();
  const text = $('ttsText').value.trim();
  if (!text) { toast('Enter some text.','error'); return; }
  const accepted = speakText(text, 'HIGH', {
    cooldownMs: 0,
    cooldownKey: `manual:${Date.now()}`,
  });
  if (!accepted) {
    toast('Voice is not ready.','warning');
    return;
  }
  $('ttsText').value = '';
  toast('Speakingâ€¦', 'success');
}

function speakBrowserLegacy(text) {
  if (!('speechSynthesis' in window)) return Promise.resolve(false);
  stopBrowserSpeech();
  return new Promise(resolve => {
    try {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-IN';
      utterance.rate = 1;
      utterance.pitch = 1;
      const voices = synth.getVoices();
      const voice = voices.find(item => item.lang === 'en-IN')
        || voices.find(item => /^en/i.test(item.lang))
        || voices[0];
      if (voice) utterance.voice = voice;

      const finish = ok => {
        if (activeSpeechResolver !== finish) return;
        activeSpeechResolver = null;
        resolve(ok);
      };

      activeSpeechResolver = finish;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      synth.speak(utterance);
    } catch {
      activeSpeechResolver = null;
      resolve(false);
    }
  });
}

function stopBrowserSpeech() {
  const synth = getSpeechEngine();
  if (!synth) return;
  synth.cancel();
  if (activeSpeechResolver) {
    const finish = activeSpeechResolver;
    activeSpeechResolver = null;
    finish(false);
  }
  activeSpeechItem = null;
  if (!ttsQueue.length && !ttsBusy) setTtsMode('ready', buildTtsReadyText());
}

function clearAudio() {
  const audio = $('ttsAudio');
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio.hidden = true;
  if (S.audioUrl) {
    URL.revokeObjectURL(S.audioUrl);
    S.audioUrl = '';
  }
}

function setTtsMode(mode, text) {
  S.ttsMode = mode;
  S.ttsStatusText = text;
  renderTts();
}

function registerMediaUnlock() {
  if (!ensureSpeechEngineReady()) return;
  const warmVoices = () => {
    unlockAudioPlayback().catch(() => {});
    refreshSpeechVoices();
  };
  warmVoices();
  if (typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoices);
  }
  window.addEventListener('pointerdown', warmVoices, { passive: true });
  window.addEventListener('keydown', warmVoices);
}

async function unlockAudioPlayback() {
  if (!ensureSpeechEngineReady()) return false;
  const synth = getSpeechEngine();
  try { synth?.resume?.(); } catch {}
  refreshSpeechVoices();
  return true;
}

function ttsPriority(priority) {
  return ({ LOW: 1, MEDIUM: 2, HIGH: 3 }[String(priority || 'LOW').toUpperCase()] || 1);
}

function populateSelects() {
  fillSelect($('userSlotInput'), S.slots, { blank:true, blankLabel:'No slot', label: s=>`${s.name} (${s.startTime}â€“${s.endTime})` });
  applyMembershipUserSearch();
  const members = S.users.filter(u => u.role === 'user');
  fillSelect($('sessionUserInput'), members, { label: u=>`${u.name} (${u.memberId})` });
  applyEnrollmentMemberSearch({ query: $('enrollmentUserSearchInput')?.value || '' });
  fillSelect($('announcementUserInput'), members, { blank:true, blankLabel:'All members', label: u=>`${u.name} (${u.memberId})` });
  syncSlotField();
}

function applyMembershipUserSearch() {
  const query = String($('membershipUserSearchInput')?.value || '').trim().toLowerCase();
  const allMembers = S.users.filter(u => u.role === 'user');
  const matches = !query ? allMembers : allMembers.filter(user =>
    [
      user.name,
      user.memberId,
      user.email,
      user.mobileNumber || user.mobile_number,
    ].join(' ').toLowerCase().includes(query)
  );

  fillSelect($('membershipUserInput'), matches, {
    blank: !matches.length,
    blankLabel: matches.length ? 'Select member' : 'No member found',
    label: user => `${user.name} (${user.memberId})`,
  });

  if (matches.length === 1 && $('membershipUserInput')) {
    $('membershipUserInput').value = String(matches[0].id);
  }
}

function applyEnrollmentMemberSearch(opts = {}) {
  const input = $('enrollmentUserSearchInput');
  const query = String(opts.query ?? input?.value ?? '').trim();
  const allMembers = S.users.filter(u => u.role === 'user');
  const matches = !query ? allMembers : allMembers.filter(user =>
    [
      user.name,
      user.memberId,
      user.email,
      user.mobileNumber,
      user.mobile_number,
      user.sport,
    ].join(' ').toLowerCase().includes(query.toLowerCase())
  );

  fillSelect($('enrollmentUserInput'), matches, {
    blank: !matches.length,
    blankLabel: matches.length ? 'Select member' : 'No member found',
    label: user => `${user.name} (${user.memberId})`,
  });

  if (matches.length === 1 && $('enrollmentUserInput')) {
    $('enrollmentUserInput').value = String(matches[0].id);
  }

  if ($('enrollmentSearchHint')) {
    $('enrollmentSearchHint').textContent = query
      ? `${matches.length} member${matches.length === 1 ? '' : 's'} found.`
      : `Showing all ${allMembers.length} members.`;
  }

  if (opts.toastOnEmpty && query && !matches.length) {
    toast('No member matched the search.', 'warning');
  }
}

function fillSelect(sel, items, opts = {}) {
  if (!sel) return;
  const cur = sel.value;
  const html = [];
  if (opts.blank || !items.length) html.push(`<option value="">${esc(opts.blankLabel||'Select')}</option>`);
  items.forEach(item => html.push(`<option value="${esc(item.id)}">${esc((opts.label||(x=>x.name))(item))}</option>`));
  sel.innerHTML = html.join('');
  if (items.some(i => String(i.id) === String(cur))) sel.value = cur;
  else if (!opts.blank && items.length) sel.value = String(items[0].id);
}

/* â”€â”€ API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers||{}) };
  const init = { method: opts.method||'GET', headers, cache:'no-store' };
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res;
  try {
    res = await fetch(`${S.apiBase}${path}`, init);
  } catch (error) {
    if (S.healthOk) {
      S.healthOk = false;
      updateHealthUi();
    }
    throw error;
  }
  if (!S.healthOk) {
    S.healthOk = true;
    updateHealthUi();
  }
  if (!res.ok) {
    let payload = null;
    try { payload = await res.json(); } catch {}
    const err = new Error(payload?.message || `${res.status} ${res.statusText}`);
    err.status = res.status; err.payload = payload; throw err;
  }
  if (opts.responseType === 'blob') return res.blob();
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

/* â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function $(id) { return document.getElementById(id); }
function isAdmin() { return S.currentUser?.role === 'admin'; }
function ensureAdmin() {
  if (!S.currentUser || !S.token) { toast('Sign in first.','error'); return false; }
  if (!isAdmin()) { toast('Admin access required.','error'); return false; }
  return true;
}
function streamHasActiveVideo(stream) {
  return Boolean(stream && stream.getVideoTracks().some(track => track.readyState === 'live'));
}
// inferDefaultApiBase() - now using fixed production URL
function inferDefaultApiBase() {
  return 'https://caper-club-backend-production.up.railway.app';
}
function getApiBaseCandidates() {
  const origin = window.location.origin && window.location.origin !== 'null'
    ? window.location.origin
    : '';
  const list = [];
  const push = value => {
    const next = norm(value);
    if (next && !list.includes(next)) list.push(next);
  };

  push(S.apiBase);
  push(DEFAULT_API_BASE);
  push(origin);

  if (origin) {
    try {
      const url = new URL(origin);
      push(`${url.protocol}//${url.hostname}:8001`);
      push(`${url.protocol}//${url.hostname}:8000`);
    } catch {}
  }

  push('http://localhost:8001');
  push('http://127.0.0.1:8001');
  return list;
}
function setApiBase(value, opts = {}) {
  S.apiBase = norm(value);
  if (opts.persist !== false) localStorage.setItem(STORAGE_KEYS.apiBase, S.apiBase);
  updateApiBaseUi();
}
function updateApiBaseUi() {
  if ($('apiBaseInput')) $('apiBaseInput').value = S.apiBase;
  if ($('apiBaseLabel')) $('apiBaseLabel').textContent = S.apiBase.replace('http://','').replace('https://','');
}
function updateHealthUi() {
  $('healthDot').className = `status-dot ${S.healthOk ? 'online' : 'alert'}`;
  $('healthText').textContent = S.healthOk ? 'Backend online' : 'Backend offline';
}
async function probeHealth(base) {
  const target = norm(base);
  if (!target) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${target}/health`, {
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) return false;

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) return false;

    const payload = await response.json().catch(() => null);
    return payload?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function ensureBackendConnection() {
  for (const base of getApiBaseCandidates()) {
    if (!await probeHealth(base)) continue;
    setApiBase(base);
    S.healthOk = true;
    updateHealthUi();
    return true;
  }

  S.healthOk = false;
  updateHealthUi();
  return false;
}
function norm(v) { return String(v||DEFAULT_API_BASE).trim().replace(/\/+$/,''); }
function toArr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
function isoDate(d) { return d.toISOString().slice(0,10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function clamp(v,min,max) { return Math.max(min, Math.min(max, v)); }
function esc(v) { return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function parseOptionalNonNegativeInt(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
function fmtDT(v) {
  if (!v) return 'â€“';
  const d = new Date(v); if (isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat(undefined, { dateStyle:'medium', timeStyle:'short' }).format(d);
}
function fmtMoney(v) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(v||0)); }
function fmtDur(min) { const m = Number(min||0); if (!m) return '0 min'; const h = Math.floor(m/60), r = m%60; return h ? `${h}h ${r}m` : `${r}m`; }
function fileToDataUrl(f) { return new Promise((res,rej) => { const r = new FileReader(); r.onload = ()=>res(String(r.result||'')); r.onerror = ()=>rej(new Error('Read failed')); r.readAsDataURL(f); }); }

function renderList(el, items, tpl, emptyMsg) {
  el.innerHTML = toArr(items).length ? toArr(items).map(tpl).join('') : `<div class="empty-hint">${esc(emptyMsg)}</div>`;
}

function chip(tone, label) {
  return `<span class="status-chip ${TONE_MAP[String(tone||'').toLowerCase()]||'tone-slate'}">${esc(String(label||''))}</span>`;
}

function feedItemTpl(item) {
  return `<div class="feed-item ${TONE_MAP[item.status]||''}">
    <div class="feed-item-top"><span class="feed-item-name">${esc(item.name||'Unknown')}</span>${chip(item.status||'blue',item.status||'event')}</div>
    <p class="feed-item-msg">${esc(item.message||item.area||'')}</p>
  </div>`;
}

function statMiniCard(c) {
  const pct = clamp(Number(c.progress||0),0,100);
  const toneGrad = { blue:'linear-gradient(90deg,#38bdf8,#0ea5e9)', green:'linear-gradient(90deg,#34d399,#059669)', violet:'linear-gradient(90deg,#a78bfa,#7c3aed)', amber:'linear-gradient(90deg,#fbbf24,#d97706)', red:'linear-gradient(90deg,#fb7185,#e11d48)' };
  const grad = toneGrad[c.tone] || toneGrad.blue;
  const sc = { blue:'sc-blue', green:'sc-green', violet:'sc-violet', amber:'sc-amber', red:'sc-red' }[c.tone] || 'sc-blue';
  return `<div class="stat-mini ${sc}">
    <div class="stat-mini-label">${esc(c.label||'Metric')}</div>
    <div class="stat-mini-value">${esc(String(c.value??'0'))}</div>
    <div class="stat-mini-sub">${esc(c.sub||'')}</div>
    <div class="stat-mini-prog"><div class="stat-mini-prog-fill" style="width:${pct}%;background:${grad}"></div></div>
  </div>`;
}

function dRow(l, v) { return `<div class="detail-row"><span class="detail-label">${esc(l)}</span><strong class="detail-value">${esc(v||'-')}</strong></div>`; }
function meta(l, v) { return `<div class="meta-item"><span class="meta-label">${esc(l)}</span><span class="meta-value">${esc(v||'-')}</span></div>`; }

/* Toast */
function toast(msg, type = '') {
  const t = $('toast'); t.textContent = sanitizeDisplayText(msg); t.className = `toast show${type?' '+type:''}`;
  clearTimeout(S.toastTimer); S.toastTimer = setTimeout(() => t.className='toast', 2800);
}

/* Auth helpers */
function clearSess() {
  sessionStorage.removeItem(STORAGE_KEYS.token);
  scannedUsers.clear();
  Object.assign(S, {
    token:'', activeTab:'liveOpsTab', currentUser:null, dashboard:null, users:[], slots:[],
    sessions:[], announcements:[], reports:null, memberDashboard:null, memberProfile:null,
    memberHistory:[], memberPayments:[], memberNotifications:[], scanImage:'', scanResult:null,
    enrollmentImages:[], faceUsers:[], ttsMode:'ready', ttsStatusText:'Preparing the browser voice assistant.',
    enrollmentZoom:1,
    cameraRequested:false, cameraRestarting:false, scanState:'idle', scanPill:'Idle',
    liveDetection:null, cameraZoom:1,
    activeSessionsRenderKey:'', scanMissStreak:0,
    scanStatusText:'Live scanner is offline', scanStatusDetail:'Enable Live Scan to start.',
    cooldowns: loadCooldownStore(), cooldownVoiceAt: {},
    userFilters: { search:'', sport:'', plan:'', status:'', role:'' },
    reportFilter: { search:'', status:'', date:'' }, membershipFilter:'all',
  });
  clearInterval(S.scanLoopTimer); S.scanLoopTimer = null; S.isScanning = false; S.scanInFlight = false;
  clearInterval(S.sessionTimerLoop); S.sessionTimerLoop = null; S.activeSessions = {};
  localStorage.removeItem(STORAGE_KEYS.sessionTimers);
  stopBrowserSpeech(); clearAudio(); stopCamera(); clearDataPoll();
  closeAllMemberReport();
  if ($('lastSyncText')) $('lastSyncText').textContent = 'Never';
  openTab('liveOpsTab');
  renderAll();
}
function handleErr(err, opts={}) {
  if (err?.status === 401 && opts.logout !== false) { clearSess(); toast('Session expired.','error'); return; }
  if (opts.toast) toast(err?.message||'Request failed.','error');
}

/* Polling */
function startDataPoll() {
  clearDataPoll();
  if (!S.currentUser || !S.token) return;
  S.refreshTimer = setInterval(() => {
    if (document.hidden) return;
    refreshAll().catch(console.error);
  }, 30000);
}
function clearDataPoll() { clearInterval(S.refreshTimer); S.refreshTimer = null; }

function loadCooldownStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cooldowns);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return pruneCooldownStore(parsed);
  } catch {
    return {};
  }
}

function persistCooldownStore() {
  localStorage.setItem(STORAGE_KEYS.cooldowns, JSON.stringify(pruneCooldownStore(S.cooldowns)));
}

function normalizeAttendanceAction(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'IN' || normalized === 'OUT' ? normalized : '';
}

function normalizeTimestamp(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function localDateKey(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function normalizeCooldownRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const userId = String(record.userId || '').trim();
  if (!userId) return null;

  const lastAction = normalizeAttendanceAction(record.lastAction || record.action);
  const lastActionAt = normalizeTimestamp(record.lastActionAt || record.lastTimestamp || record.timestamp);
  const cooldownUntil = Number.isFinite(Number(record.cooldownUntil))
    ? Number(record.cooldownUntil)
    : (lastActionAt ? (Date.parse(lastActionAt) + ATTENDANCE_COOLDOWN_MS) : 0);
  const completedOn = typeof record.completedOn === 'string' ? record.completedOn : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';

  if (!lastAction && !lastActionAt && !completedOn && !cooldownUntil) return null;

  return {
    userId,
    name,
    lastAction,
    lastActionAt,
    cooldownUntil: Math.max(0, cooldownUntil),
    completedOn,
  };
}

function pruneCooldownStore(store) {
  const next = {};
  const now = Date.now();
  Object.entries(store || {}).forEach(([userId, value]) => {
    const record = normalizeCooldownRecord({ ...(value || {}), userId });
    if (!record) return;
    if (record.lastActionAt) {
      const ageMs = now - Date.parse(record.lastActionAt);
      if (ageMs > (7 * 24 * 60 * 60 * 1000) && record.cooldownUntil <= now) return;
    }
    next[userId] = record;
  });
  return next;
}

function syncCooldownStoreFromUsers(users) {
  const next = { ...pruneCooldownStore(S.cooldowns) };
  toArr(users).forEach(user => {
    if (!user?.id) return;
    const lastAction = normalizeAttendanceAction(user.lastAction);
    const lastActionAt = normalizeTimestamp(user.lastActionAt || user.lastTimestamp);
    if (!lastActionAt) return;
    const completedOn = lastAction === 'OUT' ? localDateKey(lastActionAt) : '';
    const record = normalizeCooldownRecord({
      userId: user.id,
      name: user.name || '',
      lastAction,
      lastActionAt,
      cooldownUntil: Date.parse(lastActionAt) + ATTENDANCE_COOLDOWN_MS,
      completedOn,
    });
    if (record) next[user.id] = record;
  });
  S.cooldowns = pruneCooldownStore(next);
  persistCooldownStore();
}

function getUserRecord(userId) {
  const id = String(userId || '');
  return S.users.find(user => String(user.id) === id)
    || S.faceUsers.find(user => String(user.id) === id)
    || null;
}

function getAttendanceRecord(userId) {
  const id = String(userId || '');
  if (!id) return null;

  const activeSession = toArr(S.sessions)
    .filter(session =>
      String(session.userId) === id
      && String(session.status || '').toLowerCase() === 'active'
    )
    .sort((left, right) => {
      const rightTime = Date.parse(right.startedAt || 0) || 0;
      const leftTime = Date.parse(left.startedAt || 0) || 0;
      return rightTime - leftTime;
    })[0];

  if (activeSession) {
    return {
      action: 'IN',
      active: true,
      completed: false,
      timestamp: activeSession.startedAt,
      name: activeSession.name || '',
    };
  }

  const timerSession = S.activeSessions[id];
  if (timerSession) {
    return {
      action: 'IN',
      active: true,
      completed: false,
      timestamp: new Date(Number(timerSession.startTime || Date.now())).toISOString(),
      name: timerSession.name || '',
    };
  }

  const today = localDateKey();
  const todaySessions = toArr(S.sessions)
    .filter(session => String(session.userId) === id && localDateKey(session.startedAt) === today)
    .sort((left, right) => {
      const rightTime = Date.parse(right.endedAt || right.startedAt || 0) || 0;
      const leftTime = Date.parse(left.endedAt || left.startedAt || 0) || 0;
      return rightTime - leftTime;
    });

  const completedSession = todaySessions.find(session => Boolean(session.endedAt));
  if (completedSession) {
    return {
      action: 'OUT',
      active: false,
      completed: true,
      timestamp: completedSession.endedAt || completedSession.startedAt,
      name: completedSession.name || '',
    };
  }

  const cachedRecord = normalizeCooldownRecord(S.cooldowns[id]);
  if (cachedRecord && localDateKey(cachedRecord.lastActionAt) === today) {
    return {
      action: cachedRecord.lastAction || 'IN',
      active: cachedRecord.lastAction === 'IN',
      completed: cachedRecord.completedOn === today || cachedRecord.lastAction === 'OUT',
      timestamp: cachedRecord.lastActionAt,
      name: cachedRecord.name,
    };
  }

  const userRecord = getUserRecord(id);
  const lastAction = normalizeAttendanceAction(userRecord?.lastAction);
  const lastActionAt = normalizeTimestamp(userRecord?.lastActionAt || userRecord?.lastTimestamp);
  if (!lastAction || !lastActionAt || localDateKey(lastActionAt) !== today) return null;

  return {
    action: lastAction,
    active: lastAction === 'IN',
    completed: lastAction === 'OUT',
    timestamp: lastActionAt,
    name: userRecord?.name || '',
  };
}

function canScan(userId) {
  const id = String(userId || '').trim();
  if (!id) return false;
  const now = Date.now();
  const last = scannedUsers.get(id);
  if (last && (now - last) < FACE_SCAN_DEBOUNCE_MS) return false;
  scannedUsers.set(id, now);
  scannedUsers.forEach((value, key) => {
    if ((now - value) >= FACE_SCAN_DEBOUNCE_MS) scannedUsers.delete(key);
  });
  return true;
}

function actionLabelFor(action) {
  const normalized = normalizeAttendanceAction(action);
  if (normalized === 'IN') return 'ENTRY';
  if (normalized === 'OUT') return 'EXIT';
  return '';
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildCooldownMessage(ms, action = '') {
  const normalized = normalizeAttendanceAction(action);
  return normalized === 'OUT'
    ? `Please wait ${formatCountdown(ms)} before exit.`
    : `Please wait ${formatCountdown(ms)} before next action.`;
}

function getCooldownInfo(userId, action = '') {
  const id = String(userId || '');
  const attendanceRecord = getAttendanceRecord(id);
  const normalizedAction = normalizeAttendanceAction(action);
  if (attendanceRecord?.active) {
    if (normalizedAction !== 'OUT') {
      return { until: 0, remainingMs: 0 };
    }
    const until = Date.parse(attendanceRecord.timestamp || '') + MIN_EXIT_BEFORE_CHECKOUT_MS;
    return {
      until,
      remainingMs: Math.max(0, until - Date.now()),
    };
  }

  const cached = normalizeCooldownRecord(S.cooldowns[id]);
  const userRecord = getUserRecord(id);
  const lastAction = normalizeAttendanceAction(cached?.lastAction || userRecord?.lastAction);
  if (lastAction !== 'OUT') {
    return { until: 0, remainingMs: 0 };
  }

  const backendLastActionAt = normalizeTimestamp(userRecord?.lastActionAt || userRecord?.lastTimestamp);
  const cachedDeadline = cached?.cooldownUntil || 0;
  const backendDeadline = backendLastActionAt ? (Date.parse(backendLastActionAt) + ATTENDANCE_COOLDOWN_MS) : 0;
  const until = Math.max(cachedDeadline, backendDeadline);
  return {
    until,
    remainingMs: Math.max(0, until - Date.now()),
  };
}

function recordAttendanceAction(userId, action, scannedAt, name) {
  const id = String(userId || '').trim();
  const normalizedAction = normalizeAttendanceAction(action);
  const timestamp = normalizeTimestamp(scannedAt) || new Date().toISOString();
  if (!id || !normalizedAction) return;

  const record = normalizeCooldownRecord({
    ...(S.cooldowns[id] || {}),
    userId: id,
    name: name || getUserRecord(id)?.name || '',
    lastAction: normalizedAction,
    lastActionAt: timestamp,
    cooldownUntil: Date.parse(timestamp) + ATTENDANCE_COOLDOWN_MS,
    completedOn: normalizedAction === 'OUT' ? localDateKey(timestamp) : '',
  });

  if (!record) return;
  S.cooldowns = {
    ...S.cooldowns,
    [id]: record,
  };
  persistCooldownStore();
}

function syncCooldownFromResult(result, fallbackAction) {
  const userId = String(result?.userId || '').trim();
  if (!userId) return;
  const existing = normalizeCooldownRecord(S.cooldowns[userId]) || { userId };
  const blockedAction = normalizeAttendanceAction(result?.attendanceAction || fallbackAction);
  const inferredLastAction = blockedAction === 'OUT'
    ? 'IN'
    : (blockedAction === 'IN' ? 'OUT' : existing.lastAction);
  const record = normalizeCooldownRecord({
    ...existing,
    userId,
    name: result?.name || existing.name || '',
    lastAction: inferredLastAction,
    lastActionAt: existing.lastActionAt || normalizeTimestamp(result?.scannedAt) || new Date().toISOString(),
    cooldownUntil: Date.now() + (Number(result?.cooldownRemainingSeconds || 0) * 1000),
    completedOn: inferredLastAction === 'OUT' ? localDateKey(existing.lastActionAt || result?.scannedAt) : existing.completedOn,
  });
  if (!record) return;
  S.cooldowns = {
    ...S.cooldowns,
    [userId]: record,
  };
  persistCooldownStore();
}

function refreshCooldownUi() {
  if (!S.scanResult?.userId || S.scanResult.status !== 'cooldown') return;
  const info = getCooldownInfo(S.scanResult.userId, S.scanResult.attendanceAction);
  if (info.remainingMs > 0) {
    S.scanResult.cooldownRemainingSeconds = Math.ceil(info.remainingMs / 1000);
    S.scanResult.message = buildCooldownMessage(info.remainingMs, S.scanResult.attendanceAction);
    renderScanResult();
    renderConsole();
    return;
  }

  S.scanResult.cooldownRemainingSeconds = 0;
  if (String(S.scanResult.message || '').startsWith('Please wait')) {
    S.scanResult.message = 'Ready for the next action.';
  }
  if (S.scanState === 'detected') {
    setScanState(S.isScanning ? 'loading' : 'idle', S.isScanning ? 'Scanning...' : 'Scanner ready', S.isScanning ? 'Live scan remains active.' : 'Ready to scan.');
  }
  renderScanResult();
  renderConsole();
}

function speechName(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  return value.split(/\s+/)[0];
}

function formatSpeechDuration(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  if (minutes && remainingSeconds) return `${minutes} minutes and ${remainingSeconds} seconds`;
  if (minutes) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
}

function buildScanSpeechText(result) {
  const name = speechName(result?.name);
  const action = normalizeAttendanceAction(result?.attendanceAction);
  const status = String(result?.status || '').toLowerCase();
  const rawMessage = String(result?.message || '').trim();

  if (status === 'granted') {
    if (action === 'OUT') {
      return name
        ? `${name}, your exit has been marked successfully. Have a good day.`
        : 'Your exit has been marked successfully. Have a good day.';
    }
    return name
      ? `Welcome, ${name}. Your attendance has been marked successfully.`
      : 'Welcome. Your attendance has been marked successfully.';
  }

  if (status === 'cooldown') {
    const waitFor = formatSpeechDuration(result?.cooldownRemainingSeconds || 0);
    return action === 'OUT'
      ? `Please wait ${waitFor}â€¦ then you can exit.`
      : `Please wait ${waitFor} before trying again.`;
  }

  if (status === 'duplicate') {
    if (/exit already/i.test(rawMessage)) return 'Your exit has already been marked for today.';
    if (/exit is pending/i.test(rawMessage)) return 'You are already checked inâ€¦ please scan again when you are ready to exit.';
    return 'Your attendance is already marked.';
  }

  if (status === 'retry') {
    return 'I need a clearer view of your faceâ€¦ please look at the camera and try again.';
  }

  if (status === 'unknown') {
    return 'I could not recognize your faceâ€¦ please try again.';
  }

  if (/expired/i.test(rawMessage)) {
    return 'Your membership has expired. Please contact the front desk.';
  }

  return rawMessage || 'Access denied. Please contact the front desk.';
}

function buildSessionSpeechText(session, type) {
  const name = speechName(session?.name);
  if (type === 'warning') {
    return name
      ? `${name}, your session will end in 5 minutesâ€¦ please prepare to exit.`
      : 'Your session will end in 5 minutesâ€¦ please prepare to exit.';
  }
  return name
    ? `${name}, your session time is over. Please exit now.`
    : 'Your session time is over. Please exit now.';
}

function shouldSpeakScanFeedback(key, throttleMs) {
  const now = Date.now();
  const lastAt = Number(S.cooldownVoiceAt[key] || 0);
  if ((now - lastAt) < throttleMs) return false;
  S.cooldownVoiceAt[key] = now;
  return true;
}

function maybeSpeakCooldown(result) {
  const key = `cooldown:${result?.userId || 'unknown'}`;
  if (!shouldSpeakScanFeedback(key, COOLDOWN_VOICE_THROTTLE_MS)) return;
  speakText(buildScanSpeechText(result), 'LOW', {
    cooldownKey: key,
    cooldownMs: COOLDOWN_VOICE_THROTTLE_MS,
    userId: result?.userId,
  });
}

function maybeSpeakDuplicate(result) {
  const key = `duplicate:${result?.userId || 'unknown'}`;
  if (!shouldSpeakScanFeedback(key, 10000)) return;
  speakText(buildScanSpeechText(result), 'LOW', {
    cooldownKey: key,
    cooldownMs: 10000,
    userId: result?.userId,
  });
}

function applyScanResult(r) {
  const detail = r.name ? `${r.name} - ${fmtDT(r.scannedAt)}` : (r.message || fmtDT(r.scannedAt));
  if (r.status === 'granted') {
    const isExit = normalizeAttendanceAction(r.attendanceAction) === 'OUT';
    setScanState('granted', isExit ? 'Exit Marked' : 'Entry Marked', detail, isExit ? 'EXIT' : 'ENTRY');
    speakText(buildScanSpeechText(r), 'HIGH', {
      cooldownKey: `granted:${r.userId || 'unknown'}:${r.attendanceAction || 'none'}:${localDateKey(r.scannedAt)}`,
      cooldownMs: 1500,
      userId: r.userId,
    });

    const resolvedUserId = String(
      r.userId || r.session?.userId || ''
    ).trim();
    const resolvedName = r.name || r.session?.name || 'Member';

    if (!isExit) {
      if (resolvedUserId) {
        startSessionTimer(resolvedUserId, resolvedName);
        if (r.session?.userId) {
          upsertActiveSessionFromBackend(r.session);
        }
      }
    } else {
      if (resolvedUserId) stopSessionTimer(resolvedUserId);
    }
    return;
  }
  if (r.status === 'duplicate') {
    maybeSpeakDuplicate(r);
    setScanState('detected', 'Already Marked', r.message || detail, 'Duplicate');
    return;
  }
  if (r.status === 'cooldown') {
    maybeSpeakCooldown(r);
    setScanState('detected', 'Please Wait', r.message || detail, 'Cooldown');
    return;
  }
  if (r.status === 'retry') {
    if (S.isScanning) setLiveDetection(null, { keepSearchZoom: true });
    setScanState(S.isScanning ? 'loading' : 'detected', 'Scanning...', r.message || 'Ready for the next face.', 'Scanning');
    return;
  }
  if (r.status === 'unknown') {
    speakText(buildScanSpeechText(r), 'LOW', {
      cooldownKey: `unknown:${r.userId || 'face'}`,
      cooldownMs: 8000,
      userId: r.userId,
    });
    setScanState('denied', 'No Match', r.message || detail, 'Unknown');
    return;
  }
  speakText(buildScanSpeechText(r), 'HIGH', {
    cooldownKey: `denied:${r.userId || 'unknown'}:${String(r.message || '').toLowerCase()}`,
    cooldownMs: 4000,
    userId: r.userId,
  });
  setScanState('denied', 'Access Denied', r.message || detail, r.name ? 'Face Found' : 'No Match');
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SESSION TIMER ENGINE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const SESSION_DURATION_MS = 70 * 60 * 1000;
const SESSION_TIMER_GRACE_MS = 10 * 60 * 1000;
const ACTIVE_SESSION_BACKEND_MISS_GRACE_MS = 2 * 60 * 1000;

function parseTimestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureSessionTimerLoop() {
  const hasActive = Object.keys(S.activeSessions).length > 0;
  if (hasActive && !S.sessionTimerLoop) {
    S.sessionTimerLoop = setInterval(tickSessionTimers, 1000);
  } else if (!hasActive && S.sessionTimerLoop) {
    clearInterval(S.sessionTimerLoop);
    S.sessionTimerLoop = null;
  }
}

function buildActiveSessionState(session, existing = null) {
  const startedAtMs = parseTimestampMs(session?.startedAt);
  const backendRemainingMs = Math.max(0, Number(session?.remainingSeconds || 0)) * 1000;
  const now = Date.now();
  const startTime = startedAtMs || Number(existing?.startTime) || Date.now();
  const slotDeadlineTime = parseTimestampMs(session?.slotEndAt);
  const limitDeadlineTime = startTime + SESSION_DURATION_MS;
  const cappedSlotDeadlineTime = slotDeadlineTime
    ? Math.min(slotDeadlineTime, limitDeadlineTime)
    : limitDeadlineTime;
  const deadlineTime = (backendRemainingMs ? (Date.now() + backendRemainingMs) : 0)
    || cappedSlotDeadlineTime
    || Number(existing?.deadlineTime)
    || (startTime + SESSION_DURATION_MS);
  const duration = Math.max(1000, deadlineTime - startTime);
  const sameSession = String(existing?.sessionId || '') === String(session?.id || '');

  return {
    sessionId: String(session?.id || existing?.sessionId || ''),
    userId: String(session?.userId || existing?.userId || ''),
    startTime,
    deadlineTime,
    duration,
    name: session?.name || existing?.name || 'Member',
    announced5: sameSession ? Boolean(existing?.announced5) : false,
    announcedEnd: sameSession ? Boolean(existing?.announcedEnd) : false,
    lastSeenAt: now,
  };
}

function snapshotActiveSessions() {
  return Object.fromEntries(
    Object.entries(S.activeSessions).map(([userId, session]) => [userId, { ...session }])
  );
}

function getBackendActiveSessionsByUser() {
  return toArr(S.sessions)
    .filter(session => String(session?.status || '').toLowerCase() === 'active')
    .reduce((acc, session) => {
      const userId = String(session?.userId || '').trim();
      if (!userId) return acc;
      acc[userId] = session;
      return acc;
    }, {});
}

function shouldPreserveMissingActiveSession(session, now = Date.now()) {
  const startTime = Number(session?.startTime || now);
  const duration = Math.max(1000, Number(session?.duration || SESSION_DURATION_MS));
  const deadlineTime = Number(session?.deadlineTime || (startTime + duration));
  const lastSeenAt = Number(session?.lastSeenAt || startTime);

  if (now >= deadlineTime) return false;
  return (now - lastSeenAt) <= ACTIVE_SESSION_BACKEND_MISS_GRACE_MS;
}

function restoreMissingActiveSessions(snapshot) {
  const now = Date.now();
  const backendActiveSessions = getBackendActiveSessionsByUser();

  Object.entries(snapshot || {}).forEach(([userId, session]) => {
    if (S.activeSessions[userId]) return;
    if (!shouldPreserveMissingActiveSession(session, now)) return;
    const backendSession = backendActiveSessions[userId];

    S.activeSessions[userId] = backendSession
      ? buildActiveSessionState(backendSession, session)
      : {
        ...session,
        userId: String(session?.userId || userId),
      };
  });
}

function upsertActiveSessionFromBackend(session) {
  const userId = String(session?.userId || '');
  if (!userId) return;
  if (String(session?.status || '').toLowerCase() !== 'active') {
    stopSessionTimer(userId);
    return;
  }

  S.activeSessions[userId] = buildActiveSessionState(session, S.activeSessions[userId]);
  persistSessionTimers();
  ensureSessionTimerLoop();
  renderActiveSessionsPanel();
}

function syncActiveSessionsFromBackend() {
  const snapshot = snapshotActiveSessions();
  const backendActiveSessions = getBackendActiveSessionsByUser();
  const nextSessions = {};
  const now = Date.now();

  Object.entries(backendActiveSessions).forEach(([userId, session]) => {
    nextSessions[userId] = buildActiveSessionState(session, S.activeSessions[userId] || null);
  });

  Object.entries(snapshot).forEach(([userId, session]) => {
    if (nextSessions[userId]) return;
    if (!shouldPreserveMissingActiveSession(session, now)) return;
    nextSessions[userId] = {
      ...session,
      userId: String(session?.userId || userId),
    };
  });

  S.activeSessions = nextSessions;
  persistSessionTimers();
  ensureSessionTimerLoop();
  renderActiveSessionsPanel();
}

function startSessionTimer(userId, name) {
  const normalizedUserId = String(userId || '').trim();
  if (
    !normalizedUserId
    || normalizedUserId === 'null'
    || normalizedUserId === 'undefined'
    || normalizedUserId === ''
  ) {
    console.warn('[SessionTimer] Invalid userId â€” timer not started:', userId);
    return;
  }

  const existing = S.activeSessions[normalizedUserId];
  if (existing && Date.now() < Number(existing?.deadlineTime || 0)) {
    renderActiveSessionsPanel();
    return;
  }

  const startTime = Date.now();
  S.activeSessions[normalizedUserId] = {
    sessionId: String(existing?.sessionId || ''),
    userId: normalizedUserId,
    startTime,
    deadlineTime: startTime + SESSION_DURATION_MS,
    duration: SESSION_DURATION_MS,
    announced5: false,
    announcedEnd: false,
    name: name || 'Member',
    lastSeenAt: Date.now(),
  };
  toast(`Session timer started for ${name || 'Member'}`, 'success');

  persistSessionTimers();
  ensureSessionTimerLoop();
  renderActiveSessionsPanel();
}

function stopSessionTimer(userId) {
  const normalizedUserId = String(userId || '');
  if (!S.activeSessions[normalizedUserId]) return;
  delete S.activeSessions[normalizedUserId];
  persistSessionTimers();
  ensureSessionTimerLoop();
  renderActiveSessionsPanel();
}

function tickSessionTimers() {
  const now = Date.now();
  let dirty = false;

  Object.entries(S.activeSessions).forEach(([userId, sess]) => {
    const startTime = Number(sess.startTime || now);
    const duration = Math.max(1000, Number(sess.duration || SESSION_DURATION_MS));
    const deadlineTime = Number(sess.deadlineTime || (startTime + duration));
    const remaining = deadlineTime - now;

    if (now >= deadlineTime + SESSION_TIMER_GRACE_MS) {
      delete S.activeSessions[userId];
      dirty = true;
      return;
    }

    if (!sess.announced5 && remaining <= 5 * 60 * 1000 && remaining > 0) {
      sess.announced5 = true;
      dirty = true;
      speakText(buildSessionSpeechText(sess, 'warning'), 'LOW', {
        cooldownKey: `session-warning:${sess.sessionId || userId}`,
        cooldownMs: 60000,
        userId,
      });
    }
    if (!sess.announcedEnd && remaining <= 0) {
      sess.announcedEnd = true;
      dirty = true;
      speakText(buildSessionSpeechText(sess, 'ended'), 'MEDIUM', {
        cooldownKey: `session-ended:${sess.sessionId || userId}`,
        cooldownMs: 60000,
        userId,
      });
    }
  });

  if (dirty) {
    persistSessionTimers();
  }
  ensureSessionTimerLoop();
  renderActiveSessionsPanel();
}

function persistSessionTimers() {
  try {
    localStorage.setItem(STORAGE_KEYS.sessionTimers, JSON.stringify(
      Object.fromEntries(
        Object.entries(S.activeSessions).map(([id, session]) => [id, { ...session }])
      )
    ));
  } catch {}
}

function restoreSessionTimers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sessionTimers);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const now = Date.now();
    Object.entries(parsed).forEach(([userId, sess]) => {
      const startTime = Number(sess?.startTime || now);
      const duration = Math.max(1000, Number(sess?.duration || SESSION_DURATION_MS));
      const deadlineTime = Number(sess?.deadlineTime || (startTime + duration));
      if (now < deadlineTime + SESSION_TIMER_GRACE_MS) {
        S.activeSessions[userId] = {
          ...sess,
          userId: String(sess?.userId || userId),
          startTime,
          duration,
          deadlineTime,
          lastSeenAt: Number(sess?.lastSeenAt || startTime),
          name: sess?.name || 'Member',
          announced5: Boolean(sess?.announced5),
          announcedEnd: Boolean(sess?.announcedEnd),
        };
      }
    });
    ensureSessionTimerLoop();
    renderActiveSessionsPanel();
  } catch {}
}

function renderActiveSessionsPanel(force = false) {
  const now = Date.now();
  const sessions = Object.entries(S.activeSessions);
  const renderKey = sessions.length
    ? sessions.map(([userId, sess]) => {
        const deadlineTime = Number(sess?.deadlineTime || 0);
        const bucket = Math.ceil((deadlineTime - now) / ACTIVE_SESSIONS_RENDER_INTERVAL_MS);
        return [
          userId,
          sess?.sessionId || '',
          sess?.announced5 ? 1 : 0,
          sess?.announcedEnd ? 1 : 0,
          bucket,
        ].join(':');
      }).join('|')
    : 'empty';
  if (!force && renderKey === S.activeSessionsRenderKey) return;
  S.activeSessionsRenderKey = renderKey;

  const countEl = document.getElementById('activeSessionCount');
  if (countEl) countEl.textContent = String(sessions.length);

  const container = document.getElementById('activeSessionsPanel');
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = '<div class="empty-hint">No active sessions.</div>';
    return;
  }

  container.innerHTML = sessions.map(([userId, sess]) => {
    const startTime = Number(sess.startTime || now);
    const duration = Math.max(1000, Number(sess.duration || SESSION_DURATION_MS));
    const deadlineTime = Number(sess.deadlineTime || (startTime + duration));
    const elapsed = Math.max(0, now - startTime);
    const remaining = Math.max(0, deadlineTime - now);
    const progress = Math.min(100, (elapsed / duration) * 100);
    const windowStr = formatSessionWindowLabel(duration);
    const elapsedStr = formatSessionElapsedLabel(elapsed);
    const remainStr = formatSessionRemainingLabel(remaining);
    const isEnding = remaining <= 5 * 60 * 1000 && remaining > 0;
    const isExpired = remaining <= 0;
    const endAction = sess.sessionId
      ? `endSession(${JSON.stringify(sess.sessionId)})`
      : `stopSessionTimer(${JSON.stringify(userId)})`;
    const endLabel = sess.sessionId ? 'End' : 'Clear';

    const cardClass = isExpired ? 'sess-card expired' : isEnding ? 'sess-card ending' : 'sess-card';
    const statusLabel = isExpired ? 'Expired' : isEnding ? 'Ending Soon' : 'Active';
    const statusTone = isExpired ? 'tone-red' : isEnding ? 'tone-amber' : 'tone-green';
    const barColor = isExpired ? '#e11d48' : isEnding ? '#d97706' : '#059669';

    return `<div class="${cardClass}" data-uid="${esc(userId)}">
      <div class="sess-card-top">
        <div class="sess-avatar">${esc((sess.name || '?')[0].toUpperCase())}</div>
        <div class="sess-info">
          <div class="sess-name">${esc(sess.name)}</div>
          <div class="sess-id">Window: ${esc(windowStr)} | Elapsed: ${esc(elapsedStr)}</div>
        </div>
        <span class="status-chip ${statusTone}">${statusLabel}</span>
        <button class="mini-btn del" onclick='${endAction}'>${endLabel}</button>
      </div>
      <div class="sess-times">
        <div class="sess-time-block full">
          <span class="sess-time-label">REMAINING</span>
          <span class="sess-time-value ${isExpired ? 'expired-text' : isEnding ? 'ending-text' : ''}">${remainStr}</span>
        </div>
      </div>
      <div class="sess-progress-rail">
        <div class="sess-progress-fill" style="width:${Math.round(progress)}%;background:${barColor};transition:width 1s linear;"></div>
      </div>
      ${isEnding ? `<div style="margin-top:6px;font-family:var(--font-mono);font-size:.62rem;color:var(--amber);text-align:center;animation:badgeBlink 1.4s ease-in-out infinite;">âš  Ending soon â€” please wrap up</div>` : ''}
      ${isExpired ? `<div style="margin-top:6px;font-family:var(--font-mono);font-size:.62rem;color:var(--rose);text-align:center;">Session time is over</div>` : ''}
    </div>`;
  }).join('');
}

function msToMMSS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatSessionRemainingLabel(ms) {
  if (Number(ms || 0) <= 0) return 'OVER';
  return `${Math.max(1, Math.ceil(Number(ms || 0) / 60000))} min`;
}

function formatSessionWindowLabel(ms) {
  const totalMinutes = Math.max(1, Math.ceil(Number(ms || 0) / 60000));
  return fmtDur(totalMinutes);
}

function formatSessionElapsedLabel(ms) {
  const totalMinutes = Math.floor(Math.max(0, Number(ms || 0)) / 60000);
  if (!totalMinutes) return '<1 min';
  return fmtDur(totalMinutes);
}

function pickSpeechVoice(voices) {
  return toArr(voices)
    .map(voice => {
      const lang = String(voice?.lang || '').toLowerCase();
      const name = String(voice?.name || '').toLowerCase();
      let score = 0;
      if (lang === 'en-in') score += 300;
      else if (lang.startsWith('en')) score += 180;
      if (name.includes('google')) score += 80;
      if (name.includes('microsoft')) score += 60;
      if (name.includes('india') || name.includes('indian')) score += 50;
      if (name.includes('natural') || name.includes('online') || name.includes('premium')) score += 35;
      if (name.includes('female')) score += 15;
      if (voice?.default) score += 5;
      return { voice, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.voice || null;
}

function speakBrowser(text, item = null) {
  const synth = getSpeechEngine();
  if (!synth) return Promise.resolve(false);
  return new Promise(resolve => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickSpeechVoice(refreshSpeechVoices());
      utterance.voice = voice || null;
      utterance.lang = voice?.lang || TTS_PROFILE.lang;
      utterance.rate = TTS_PROFILE.rate;
      utterance.pitch = TTS_PROFILE.pitch;
      utterance.volume = TTS_PROFILE.volume;

      const finish = ok => {
        if (activeSpeechResolver !== finish) return;
        activeSpeechResolver = null;
        activeSpeechItem = null;
        resolve(ok);
      };

      utterance.onstart = () => {
        activeSpeechItem = item;
        setTtsMode('speaking', `Speaking with ${describeSpeechVoice(voice)}.`);
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      synth.cancel();
      activeSpeechResolver = finish;
      synth.speak(utterance);
    } catch {
      activeSpeechResolver = null;
      activeSpeechItem = null;
      resolve(false);
    }
  });
}

function startHealthPoll() {
  clearInterval(S.healthTimer);
  S.healthTimer = setInterval(() => {
    if (document.hidden) return;
    pingHealth().catch(console.error);
  }, 30000);
}

/* â”€â”€ PARTICLES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function initParticles() {
  const canvas = $('particleCanvas');
  if (!canvas) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    canvas.hidden = true;
    return;
  }
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  let W, H, particles = [], lastTime = 0;

  const TARGET_FPS = 36;
  const FRAME_MS = 1000 / TARGET_FPS;
  const MAX_PARTICLES = 72;
  const MIN_PARTICLES = 18;
  const PARTICLE_DENSITY = 18000;
  const LINK_DISTANCE = 84;
  const LINK_DISTANCE_SQ = LINK_DISTANCE * LINK_DISTANCE;

  const COLORS = [
    '99,102,241',
    '14,165,233',
    '124,58,237',
    '5,150,105',
    '217,119,6',
    '225,29,72',
    '59,130,246',
    '16,185,129',
  ];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    const count = Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, Math.floor((W * H) / PARTICLE_DENSITY)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - .5) * .4,
      vy: (Math.random() - .5) * .4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: Math.random() * .4 + .1,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * .02 + .005,
    }));
  }

  function draw(timestamp) {
    if (document.hidden) {
      lastTime = timestamp;
      requestAnimationFrame(draw);
      return;
    }

    const delta = timestamp - lastTime;
    if (delta < FRAME_MS) {
      requestAnimationFrame(draw);
      return;
    }
    lastTime = timestamp - (delta % FRAME_MS);

    ctx.clearRect(0, 0, W, H);

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += p.pulseSpeed;

      if (p.x < 0 || p.x > W) p.vx = -p.vx;
      if (p.y < 0 || p.y > H) p.vy = -p.vy;

      const r = p.r + Math.sin(p.pulse) * 0.4;
      const a = p.alpha + Math.sin(p.pulse) * 0.05;

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${a})`;
      ctx.fill();
    });

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distanceSq = (dx * dx) + (dy * dy);
        if (distanceSq < LINK_DISTANCE_SQ) {
          const distance = Math.sqrt(distanceSq);
          const opacity = .05 * (1 - (distance / LINK_DISTANCE));
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(${particles[i].color},${opacity})`;
          ctx.lineWidth = .6;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(draw);
}
