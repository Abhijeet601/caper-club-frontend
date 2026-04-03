'use strict';

/* ═══════════════════════════════════════════════
   CAPPER SPORTS CLUB — script.js
   Enhanced UI: Tab system + Voice + Reports
   ═══════════════════════════════════════════════ */

const STORAGE_KEYS = {
  apiBase: 'capper-api-base',
  token: 'capper-token',
  cooldowns: 'capper-attendance-cooldowns',
  sessionTimers: 'capper-session-timers',
};
const DEFAULT_API_BASE = 'https://caper-club-backend-production.up.railway.app';
const LIVE_SCAN_INTERVAL = 1200;
const FACE_SCAN_DEBOUNCE_MS = 3000;
const ATTENDANCE_COOLDOWN_MS = 5 * 60 * 1000;
const COOLDOWN_VOICE_THROTTLE_MS = 30000;

const TONE_MAP = {
  green:'tone-green', valid:'tone-green', granted:'tone-green', active:'tone-green', paid:'tone-green', user:'tone-green',
  blue:'tone-blue', admin:'tone-blue',
  purple:'tone-purple', violet:'tone-purple',
  red:'tone-red', denied:'tone-red', error:'tone-red', expired:'tone-red', unknown:'tone-red',
  amber:'tone-amber', warning:'tone-amber', pending:'tone-amber', duplicate:'tone-amber', retry:'tone-amber', cooldown:'tone-amber', ended:'tone-amber',
};

/* ── STATE ─────────────────────────────────────── */
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
  faceModelsReady: false, faceModelsLoading: false, faceModelsError: '',
  faceUsers: [], recognitionThreshold: window.FaceAi?.DEFAULT_THRESHOLD || 0.56,
  scanState: 'idle', scanPill: 'Idle',
  scanStatusText: 'Live scanner is offline',
  scanStatusDetail: 'Enable Live Scan to start face recognition.',
  cooldowns: loadCooldownStore(),
  cooldownVoiceAt: {},
  activeSessions: {},        // { userId: { sessionId, startTime, deadlineTime, duration, name, announced5, announcedEnd } }
  sessionTimerLoop: null,
  enrollmentImages: [],
  stream: null, refreshTimer: null, healthTimer: null, toastTimer: null,
  audioUrl: '', audioContext: null, audioUnlocked: false,
  ttsMode: 'ready', ttsStatusText: 'Type an announcement to speak.', userFilter: '',
  reportFilter: { search: '', status: '', date: '' },
  membershipFilter: 'all',
};

const scannedUsers = new Map();

/* ── BOOT ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
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
  const apiConfigForm = $('apiConfigForm');
  if (apiConfigForm?.closest('.panel-card')) {
    apiConfigForm.closest('.panel-card').hidden = true;
  }
  $('scanAreaInput').value = 'Capper Sports Club Entry';
  $('sessionAreaInput').value = 'Capper Sports Club Floor';
  $('sessionConfidenceValue').textContent = Number($('sessionConfidenceInput').value).toFixed(2);

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
  $('userRoleInput').addEventListener('change', syncSlotField);
  $('userForm').addEventListener('submit', handleUserSubmit);
  $('userResetBtn').addEventListener('click', resetUserForm);
  if ($('usersTableBody')) $('usersTableBody').addEventListener('click', handleUsersClick);
  if ($('userFilterInput')) $('userFilterInput').addEventListener('input', e => { S.userFilter = e.target.value; renderUsers(); });

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

  // Sessions
  $('sessionConfidenceInput').addEventListener('input', () => {
    $('sessionConfidenceValue').textContent = Number($('sessionConfidenceInput').value).toFixed(2);
  });
  $('sessionStartForm').addEventListener('submit', handleSessionStart);
  $('sessionsTableBody').addEventListener('click', handleSessionsClick);

  // Announcements
  $('announcementForm').addEventListener('submit', handleAnnouncementSubmit);

  // Camera/Scan
  $('enableCameraInput').addEventListener('change', handleLiveScanToggle);
  $('captureScanBtn').addEventListener('click', captureScanFrame);
  $('scanFileInput').addEventListener('change', handleScanFileInput);
  $('runScanBtn').addEventListener('click', handleManualScan);

  // Enrollment
  $('captureEnrollmentBtn').addEventListener('click', captureEnrollFrame);
  $('clearEnrollmentBtn').addEventListener('click', clearEnrollmentImages);
  $('enrollmentFilesInput').addEventListener('change', handleEnrollFiles);
  $('faceUploadForm').addEventListener('submit', handleFaceUpload);

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

/* ── SESSION RESTORE ───────────────────────────── */
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

/* ── API CONFIG ─────────────────────────────────── */
async function handleApiSave(e) {
  e.preventDefault();
  setApiBase($('apiBaseInput')?.value || DEFAULT_API_BASE);
  const ok = await pingHealth();
  if (S.currentUser && ok) await refreshAll({ toast: true });
  else if (ok) toast('Backend URL saved.', 'success');
  else toast('Backend URL saved, but the health check failed.', 'warning');
}

/* ── AUTH ───────────────────────────────────────── */
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
  $('authText').textContent = ok ? `${user.role?.toUpperCase()} • ${user.name}` : 'Signed out';

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

/* ── REFRESH ────────────────────────────────────── */
async function refreshAll(opts = {}) {
  await pingHealth();
  if (!S.currentUser || !S.token) { renderAll(); return; }
  try {
    await Promise.all(isAdmin() ? [loadAdmin(), loadMember()] : [loadMember()]);
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

/* ── HEALTH ─────────────────────────────────────── */
async function pingHealth() {
  S.healthOk = await probeHealth(S.apiBase);
  updateHealthUi();
  return S.healthOk;
}

/* ════════════════════════════════════════════════
   RENDER ALL
   ════════════════════════════════════════════════ */
function renderAll() {
  setAuth(S.currentUser);
  populateSelects();
  renderSystemStatus();
  renderLiveFeed();
  renderActiveSessionsPanel();
  renderUsers();
  renderSlots();
  renderSessions();
  renderAnnouncements();
  renderReports();
  renderMembershipList();
  renderAlerts();
  renderReportsAll();
  renderEnrollGallery();
  renderMember();
  renderScannerStatus();
  renderConsole();
  renderTts();
  renderScanResult();
  updateAlertBadge();
}

/* ── TABS ───────────────────────────────────────── */
function openTab(id) {
  S.activeTab = id;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === id));
  if (id === 'reportsTab') renderReportsAll();
}

/* ── CONSOLE STATE ──────────────────────────────── */
function renderConsole() {
  const live = S.isScanning;
  const cameraReady = streamHasActiveVideo(S.stream);
  const cameraAccess = Boolean(S.currentUser && S.token && isAdmin());
  const activeSession = S.sessions?.find(s => s.status === 'active');
  const buttonCooldown = { remainingMs: 0 };
  const cooldownActive = false;

  $('camStatusPrimary').textContent = live ? 'Live scan active' : (cameraReady ? 'Camera ready' : 'Scanner ready');
  $('camDetect').textContent = live ? 'Scanning…' : (S.scanResult ? `Result: ${S.scanResult.status?.toUpperCase()}` : 'No scan yet');
  $('camLastAction').textContent = S.scanResult?.message || 'Waiting';
  $('camSource').textContent = cameraReady ? 'Live camera' : (S.scanImage ? 'Image upload' : 'Camera / Upload');
  $('camArea').textContent = $('scanAreaInput').value || 'Club Entry';

  const timerBadge = $('sessionTimerBadge');
  if (activeSession && timerBadge) {
    const min = activeSession.remainingMinutes || 0;
    timerBadge.textContent = `● ${Math.floor(min/60).toString().padStart(2,'0')}:${(min%60).toString().padStart(2,'0')}`;
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
    ? 'Scanning…'
    : (cooldownActive ? `Wait ${formatCountdown(buttonCooldown.remainingMs)}` : '▶ Run Scan');
}

/* ── SCANNER STATUS ─────────────────────────────── */
function setScanState(mode, title, detail = '', pill = '') {
  S.scanState = mode;
  S.scanPill = pill || { loading:'Scanning…', granted:'Granted ✓', denied:'Denied ✗', detected:'Face Found' }[mode] || 'Idle';
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
  updateFaceBoxOverlay(S.scanResult?.faceBox || null);

  const shell = $('cameraShell');
  shell.classList.remove('is-scanning','is-granted','is-denied','is-detected');
  if (S.scanState === 'loading')   { shell.classList.add('is-scanning'); $('faceDetectLabel').textContent = 'Scanning…'; }
  else if (S.scanState === 'granted') { shell.classList.add('is-granted'); $('faceDetectLabel').textContent = 'GRANTED'; }
  else if (S.scanState === 'denied')  { shell.classList.add('is-denied');  $('faceDetectLabel').textContent = 'DENIED'; }
  else if (S.scanState === 'detected'){ shell.classList.add('is-detected'); $('faceDetectLabel').textContent = 'FACE FOUND'; }
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

/* ── CLOCK ──────────────────────────────────────── */
function startClock() { updateClock(); setInterval(updateClock, 1000); }
function updateClock() {
  const d = new Date(), pad = n => String(n).padStart(2,'0');
  $('liveTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const mons = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  $('liveDate').textContent = `${days[d.getDay()]} ${pad(d.getDate())} ${mons[d.getMonth()]} ${d.getFullYear()}`;
  refreshCooldownUi();
}

/* ── SUBTITLE LOOP ──────────────────────────────── */
function startSubtitleLoop() {
  const lines = ['AI attendance & access control','Browser AI + fast attendance API','Live member & session management','Smart club operations — all in one'];
  const el = $('typingSubtitle'); let ti = 0, ci = 0, del = false;
  function tick() {
    const t = lines[ti];
    if (!del) { el.textContent = t.slice(0, ++ci); if (ci === t.length) { del = true; setTimeout(tick, 1600); return; } }
    else       { el.textContent = t.slice(0, --ci); if (ci === 0) { del = false; ti = (ti+1) % lines.length; } }
    setTimeout(tick, del ? 26 : 50);
  }
  setTimeout(tick, 800);
}

/* ═══════════════════════════════════════════════
   RENDER SECTIONS
   ═══════════════════════════════════════════════ */

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

  const filtered = S.users.filter(u => {
    if (!S.userFilter.trim()) return true;
    return [u.name, u.email, u.memberId, u.role].join(' ').toLowerCase().includes(S.userFilter.toLowerCase());
  });
  tableBody.innerHTML = filtered.length
    ? filtered.map(u => `<tr data-user-row="${u.id}">
        <td><div class="t-primary">${esc(u.name)}</div><div class="t-secondary">${esc(u.email)}</div></td>
        <td>${esc(u.membershipPlan||'-')} ${chip(u.membershipStatus||'slate', u.membershipStatus||'-')}</td>
        <td>${chip(u.role, u.role)}</td>
        <td><div class="table-actions">
          <button class="mini-btn" data-user-edit="${u.id}">Edit</button>
          <button class="mini-btn del" data-user-delete="${u.id}">Del</button>
        </div></td>
      </tr>`).join('')
    : `<tr><td colspan="4"><div class="empty-hint">No members found.</div></td></tr>`;
}

function renderSlots() {
  $('slotsTableBody').innerHTML = S.slots.length
    ? S.slots.map(s => `<tr>
        <td>${esc(s.name)}</td>
        <td class="t-secondary">${esc(s.startTime||'-')} – ${esc(s.endTime||'-')}</td>
        <td><div class="table-actions">
          <button class="mini-btn" data-slot-edit="${s.id}">Edit</button>
          <button class="mini-btn del" data-slot-delete="${s.id}">Del</button>
        </div></td>
      </tr>`).join('')
    : `<tr><td colspan="3"><div class="empty-hint">No slots yet.</div></td></tr>`;
}

function renderSessions() {
  $('sessionsTableBody').innerHTML = S.sessions.length
    ? S.sessions.map(s => `<tr>
        <td><div class="t-primary">${esc(s.name||'Unknown')}</div><div class="t-secondary">${esc(s.area||'-')}</div></td>
        <td>${chip(s.status, s.status)}</td>
        <td>${esc(fmtDur(s.durationMinutes))}</td>
        <td>${s.status==='active' ? `<button class="mini-btn" data-session-end="${s.id}">End</button>` : '—'}</td>
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

/* ── REPORTS ─────────────────────────────────────── */
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
        <td class="t-secondary">${r.confidence ? `${Math.round(Number(r.confidence)*100)}%` : '–'}</td>
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

  detailName.textContent = `📊 ${name}`;
  detailContent.innerHTML = `
    <div class="meta-grid" style="margin-bottom:8px;">
      <div class="meta-item"><span class="meta-label">Visits</span><span class="meta-value">${esc(String(report?.profile?.visits||0))}</span></div>
      <div class="meta-item"><span class="meta-label">Sessions</span><span class="meta-value">${toArr(report?.sessions).length}</span></div>
      <div class="meta-item"><span class="meta-label">Faces</span><span class="meta-value">${esc(String(report?.profile?.faceImageCount||0))}</span></div>
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

/* ── MEMBERSHIP LIST ─────────────────────────────── */
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
            <div class="mem-plan">${esc(u.membershipPlan||'Unknown plan')} • ${esc(u.memberId||'-')}</div>
            <div class="mem-dates">Expires: ${esc(u.membershipExpiry||'Unknown')}</div>
          </div>
          ${chip(status, status)}
        </div>`;
      }).join('')
    : '<div class="empty-hint">No members found.</div>';
}

/* ═══════════════════════════════════════════════
   REPORTS MODULE
   ═══════════════════════════════════════════════ */

const RPT = {
  search: '', plan: '', payment: '', date: '', mode: '',
  renewalTab: 'expiring',
};

function initReportsModule() {
  $('rptSearch').addEventListener('input', e => { RPT.search = e.target.value; renderReportsAll(); });
  $('rptFilterPlan').addEventListener('change', e => { RPT.plan = e.target.value; renderReportsAll(); });
$('rptFilterPayment').addEventListener('change', e => { RPT.payment = e.target.value; renderReportsAll(); });
$('rptFilterMode') && $('rptFilterMode').addEventListener('change', e => { RPT.mode = e.target.value; renderReportsAll(); });
  $('rptFilterDate').addEventListener('change', e => { RPT.date = e.target.value; renderReportsAll(); });
  $('rptClearFilters').addEventListener('click', clearRptFilters);
  $('rptDetailClose').addEventListener('click', () => { $('rptDetailDrawer').hidden = true; });
  $('admissionTable').addEventListener('click', handleAdmissionRowClick);
  $('rptExportBtn').addEventListener('click', exportReportCSV);

  document.querySelectorAll('.rpt-rtab').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rpt-rtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      RPT.renewalTab = btn.dataset.rtab;
      renderRenewalList();
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
  renderReportsAll();
}

function renderReportsAll() {
  renderSummaryCards();
  renderAdmissionTable();
  renderPaymentSummary();
  renderRenewalList();
  renderAttendanceAnalytics();
  renderSlotEngagement();
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
  const todayRevenue = S.users
    .filter(u => u.role === 'user' && localDateKey(u.membershipStart) === localDateKey())
    .reduce((sum, u) => sum + Number(u.paymentAmount || 0), 0);

  $('rptTotalMembersVal').textContent = users.length;
  $('rptActiveMembersVal').textContent = active.length;
  $('rptExpiringSoonVal').textContent = expiring.length;
  $('rptTodayRevenueVal').textContent = fmtMoney(todayRevenue);
  $('rptTodayCheckinsVal').textContent = todaySessions.length;
  $('rptAdmissionCount').textContent = getFilteredAdmissions().length;
}

function getFilteredAdmissions() {
  return S.sessions.filter(s => {
    const user = S.users.find(u => u.id === s.userId);
    if (!user) return false;
    if (RPT.search) {
      const q = RPT.search.toLowerCase();
      if (!(user.name||'').toLowerCase().includes(q) &&
          !(user.memberId||'').toLowerCase().includes(q)) return false;
    }
    if (RPT.plan && user.membershipPlan !== RPT.plan) return false;
if (RPT.payment && user.paymentStatus !== RPT.payment) return false;
if (RPT.mode && user.paymentMode !== RPT.mode) return false;
    if (RPT.date && !localDateKey(s.startedAt).startsWith(RPT.date)) return false;
    return true;
  });
}

function renderAdmissionTable() {
  const records = getFilteredAdmissions();
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
          <td class="t-secondary">${s.endedAt ? esc(fmtDT(s.endedAt)) : '<span class="status-chip tone-green">Active</span>'}</td>
          <td>${chip(user.membershipPlan||'slate', user.membershipPlan||'-')}</td>
<td class="t-secondary">${esc(user.paymentMode||'-')}</td>
<td>${chip(user.paymentStatus||'slate', user.paymentStatus||'-')}</td>
          <td class="t-secondary">${fmtMoney(user.paymentAmount||0)}</td>
          <td><span class="status-chip ${renewTone}">${renewalStatus}</span></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7"><div class="empty-hint">No records match the filters.</div></td></tr>`;
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

  $('rptDetailTitle').textContent = `📊 ${user.name}`;
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
          <td class="t-secondary">${s.endedAt ? esc(fmtDT(s.endedAt)) : '–'}</td>
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

  const paidUsers = S.users.filter(u => u.role === 'user' && u.paymentStatus === 'Paid');
  const calc = (from) => paidUsers
    .filter(u => u.membershipStart && new Date(u.membershipStart) >= from)
    .reduce((sum, u) => sum + Number(u.paymentAmount || 0), 0);

  $('payDaily').textContent   = fmtMoney(calc(startOfDay));
  $('payWeekly').textContent  = fmtMoney(calc(startOfWeek));
  $('payMonthly').textContent = fmtMoney(calc(startOfMonth));
  $('payPending').textContent = fmtMoney(
    S.users.filter(u => u.role === 'user' && u.paymentStatus === 'Pending')
      .reduce((sum, u) => sum + Number(u.paymentAmount || 0), 0)
  );

  const payRows = S.users.filter(u => u.role === 'user' && u.paymentAmount > 0);
  $('payHistoryBody').innerHTML = payRows.length
    ? payRows.map(u => `<tr>
        <td><div class="t-primary">${esc(u.name)}</div></td>
        <td>${esc(u.membershipPlan||'-')}</td>
        <td>${fmtMoney(u.paymentAmount||0)}</td>
        <td>${esc(u.paymentMode||'-')}</td>
        <td>${chip(u.paymentStatus||'slate', u.paymentStatus||'-')}</td>
        <td class="t-secondary">${esc(u.membershipStart||'-')}</td>
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
          <p class="alert-msg">${esc(u.memberId||'-')} · ${fmtMoney(u.paymentAmount||0)}</p>
          <span class="alert-time">
            Expires: ${esc(u.membershipExpiry||'Unknown')}
            ${daysLeft !== null ? ` · ${daysLeft < 0 ? Math.abs(daysLeft)+' days ago' : daysLeft+' days left'}` : ''}
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
  const peak = Object.entries(hourCount).sort((a,b) => b[1]-a[1])[0]?.[0] || '–';

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
  const icons  = { Morning: '🌅', Afternoon: '☀', Evening: '🌙' };

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
      s.endedAt ? fmtDT(s.endedAt) : '',
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

/* ── PLAN CALCULATOR ─────────────────────────────── */
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
  $('planCalcText').textContent = `${type} plan · Expires on ${isoDate(expiry)}`;

  // Sync with membership form
  $('membershipStartInput').value = startVal;
  $('membershipExpiryInput').value = isoDate(expiry);
  $('membershipPlanInput').value = type;
}


/* ── ALERTS ──────────────────────────────────────── */
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
      <p class="alert-msg">Plan: ${esc(u.membershipPlan||'-')} • ${esc(u.memberId||'-')}</p>
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

/* ── SCAN RESULT ─────────────────────────────────── */
function renderScanResult() {
  const el = $('scanResult');
  if (!S.scanResult) { el.innerHTML = '<div class="empty-hint">Scan results appear here</div>'; return; }
  const r = S.scanResult;
  const actionLabel = actionLabelFor(r.attendanceAction);
  const waitText = r.cooldownRemainingSeconds ? `Wait ${formatCountdown(r.cooldownRemainingSeconds * 1000)}` : '';
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
      <span>${esc(fmtDT(r.scannedAt))}</span>
    </div>`;
  el.classList.remove('result-pop');
  requestAnimationFrame(() => el.classList.add('result-pop'));
}

/* ── ENROLLMENT GALLERY ─────────────────────────── */
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
    : '<div class="empty-hint">Capture 3–5 clear face images</div>';
}

/* ── MEMBER ─────────────────────────────────────── */
function renderMember() {
  const profile = S.memberProfile || S.memberDashboard?.profile;
  if (!profile) return;

  const myAcc = $('myAccountSection');
  const myRec = $('myRecordsSection');
  if (myAcc) myAcc.hidden = false;
  if (myRec) myRec.hidden = false;

  $('memberSummaryGrid').innerHTML = `
    <div class="meta-grid" style="margin-bottom:8px;">
      ${meta('Plan', profile.membershipPlan||'-')}
      ${meta('Status', profile.membershipStatus||'-')}
      ${meta('Slot', profile.slotName||'None')}
      ${meta('Visits', profile.visits||'0')}
    </div>`;

  $('memberProfileCard').innerHTML = `<div class="detail-grid">
    ${dRow('Name', profile.name)} ${dRow('Email', profile.email)}
    ${dRow('Member ID', profile.memberId)} ${dRow('Plan', profile.membershipPlan)}
    ${dRow('Expires', profile.membershipExpiry||'-')} ${dRow('Payment', profile.paymentStatus||'-')}
  </div>`;

  renderList($('memberHistoryList'), S.memberHistory, h => `
    <div class="alert-item">
      <div class="alert-top"><span class="alert-name">${esc(h.eventType||'Attendance')}</span>${chip(h.eventType||'blue', h.eventType||'event')}</div>
      <span class="alert-time">${esc(h.area||'-')} • ${esc(fmtDT(h.occurredAt))}</span>
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

/* ── TTS ─────────────────────────────────────────── */
function renderTts() {
  const map = {
    ready:{label:'READY',cls:'chip-blue'},
    server:{label:'ELEVEN',cls:'chip-green'},
    browser:{label:'BROWSER',cls:'chip-green'},
    error:{label:'ERROR',cls:'chip-rose'},
  };
  const s = map[S.ttsMode] || map.ready;
  $('ttsModeChip').className = `badge-chip ${s.cls}`;
  $('ttsModeChip').textContent = s.label;
  $('ttsStatusText').textContent = S.ttsStatusText;
  $('ttsAudio').hidden = S.ttsMode !== 'server';
}

/* ═══════════════════════════════════════════════
   CRUD
   ═══════════════════════════════════════════════ */

async function handleUserSubmit(e) {
  e.preventDefault();
  if (!ensureAdmin()) return;
  const editId = $('userIdInput').value.trim();
  const password = $('userPasswordInput').value.trim();
  const payload = {
    name: $('userNameInput').value.trim(),
    memberId: $('userMemberIdInput').value.trim(),
    email: $('userEmailInput').value.trim(),
    password: password || null,
    mobileNumber: $('userMobileInput')?.value?.trim() || null,
    role: $('userRoleInput').value,
    slotId: $('userSlotInput').value || null,
    membershipPlan: $('userPlanInput').value,
    membershipStart: $('userStartInput').value,
    membershipExpiry: $('userExpiryInput').value,
    paymentAmount: Number($('userAmountInput').value||0),
    paymentMode: $('userPaymentModeInput').value,
    paymentStatus: $('userPaymentStatusInput').value,
    note: $('userNoteInput').value.trim(),
  };
  try {
    if (editId) {
      await api(`/admin/update-user/${editId}`, { method:'PUT', body: payload });
      toast('Member updated.', 'success');
    } else {
      await api('/users', { method:'POST', body: payload });
      toast('Member created!', 'success');
      showFormSuccess('userFormSuccess');
    }
    resetUserForm(); await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}

function showFormSuccess(id) {
  const el = $(id); if (!el) return;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2000);
}

async function handleUsersClick(e) {
  if (e.target.dataset.userEdit)   beginUserEdit(e.target.dataset.userEdit);
  if (e.target.dataset.userDelete) deleteUser(e.target.dataset.userDelete);
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
  $('userRoleInput').value = u.role||'user';
  $('userSlotInput').value = u.slotId||'';
  $('userPlanInput').value = u.membershipPlan||'Monthly';
  $('userStartInput').value = u.membershipStart||isoDate(new Date());
  $('userExpiryInput').value = u.membershipExpiry||isoDate(addDays(new Date(),30));
  $('userAmountInput').value = String(u.paymentAmount||0);
  $('userPaymentModeInput').value = u.paymentMode||'Cash';
  $('userPaymentStatusInput').value = u.paymentStatus||'Pending';
  $('userNoteInput').value = u.adminNote||u.note||'';
  $('userPasswordInput').value = '';
  $('userPasswordInput').required = false;
  $('userPasswordInput').placeholder = 'Leave blank to keep';
  $('userFormTitle').textContent = `✏ Edit ${u.name}`;
  $('userSubmitBtn').textContent = 'Update Member';
  syncSlotField();
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
  $('userFormTitle').textContent = '➕ Create Member';
  $('userSubmitBtn').textContent = 'Create Member';
  $('userRoleInput').value = 'user';
  $('userPlanInput').value = 'Monthly';
  $('userPaymentModeInput').value = 'Cash';
  $('userPaymentStatusInput').value = 'Pending';
  $('userStartInput').value = isoDate(new Date());
  $('userExpiryInput').value = isoDate(addDays(new Date(), 30));
  $('userAmountInput').value = '0';
  $('userPasswordInput').required = true;
  $('userPasswordInput').placeholder = 'Min 8 characters';
  syncSlotField();
}

function syncSlotField() {
  $('userSlotInput').disabled = $('userRoleInput').value !== 'user';
}

/* ── SLOTS ────────────────────────────────────── */
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

/* ── MEMBERSHIP ────────────────────────────────── */
async function handleMembershipSubmit(e) {
  e.preventDefault();
  if (!ensureAdmin()) return;
  try {
    await api('/admin/create-membership', { method:'POST', body: {
      userId: $('membershipUserInput').value, plan: $('membershipPlanInput').value,
      startDate: $('membershipStartInput').value, expiryDate: $('membershipExpiryInput').value,
      paymentAmount: Number($('membershipAmountInput').value||0),
      paymentMode: $('membershipModeInput').value, paymentStatus: $('membershipStatusInput').value,
      source: $('membershipSourceInput').value.trim(),
    }});
    toast('Membership created.','success'); await refreshAll();
  } catch (err) { handleErr(err, { toast: true }); }
}

/* ── SESSIONS ──────────────────────────────────── */
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

/* ── ANNOUNCEMENTS ─────────────────────────────── */
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

/* ═══════════════════════════════════════════════
   FACE RECOGNITION / LIVE SCAN
   ═══════════════════════════════════════════════ */
async function handleLiveScanToggle(e) {
  if (e.target.checked) await startLiveScan({ toast: true });
  else stopLiveScan({ toast: true });
}

async function startLiveScan(opts = {}) {
  if (!await ensureRecognitionReady()) { $('enableCameraInput').checked = false; return false; }
  if (S.isScanning) return true;
  S.cameraRequested = true;
  const ok = await startCamera();
  if (!ok) { S.cameraRequested = false; $('enableCameraInput').checked = false; return false; }
  S.isScanning = true;
  clearInterval(S.scanLoopTimer);
  S.scanLoopTimer = setInterval(() => runLiveCycle().catch(console.error), LIVE_SCAN_INTERVAL);
  renderConsole();
  setScanState('loading','Scanning…','Matching in browser and validating membership.');
  if (opts.toast) toast('Live scan started.','success');
  await runLiveCycle();
  return true;
}

function stopLiveScan(opts = {}) {
  clearInterval(S.scanLoopTimer); S.scanLoopTimer = null;
  S.cameraRequested = false;
  S.cameraRestarting = false;
  S.isScanning = false; S.scanInFlight = false;
  stopCamera();
  setScanState('idle','Live scanner is offline','Enable Live Scan to start.');
  renderConsole();
  if (opts.toast) toast('Live scan stopped.');
}

async function startCamera() {
  const preview = $('cameraPreview');
  if (streamHasActiveVideo(S.stream)) {
    preview.srcObject = S.stream;
    await preview.play().catch(()=>{});
    const ready = await waitVideoReady(preview);
    if (!ready) {
      toast('Camera connected, but the preview is not ready yet. Retry in a moment.','warning');
      renderConsole();
      return false;
    }
    $('cameraShell').classList.add('has-stream');
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
    S.stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user' }, audio:false });
    preview.srcObject = S.stream;
    S.stream.getVideoTracks().forEach(track => {
      track.addEventListener('ended', handleCameraTrackEnded, { once: true });
    });
    await preview.play().catch(()=>{});
    const ready = await waitVideoReady(preview);
    if (!ready) throw new Error('Camera preview did not become ready.');
    $('cameraShell').classList.add('has-stream');
    renderConsole(); return true;
  } catch (err) { toast(getCameraErrorMessage(err),'error'); renderConsole(); return false; }
}

function stopCamera(opts = {}) {
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  $('cameraPreview').srcObject = null;
  $('cameraShell').classList.remove('has-stream');
  if (!opts.preserveRequest) S.cameraRequested = false;
  if (!opts.silent) S.cameraRestarting = false;
  renderConsole();
}

async function handleCameraTrackEnded() {
  if (!S.cameraRequested || S.cameraRestarting) return;
  S.cameraRestarting = true;
  stopCamera({ preserveRequest: true, silent: true });
  setScanState('loading','Camera reconnecting…','Restoring the live preview.');
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

function grabFrame() {
  const v = $('cameraPreview');
  if (!v.videoWidth || !v.videoHeight) return '';
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
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
  setScanState('loading','Scanning…','Matching face in browser and validating access.');
  try {
    const probe = await detectRecognitionProbe({ source, image });
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
    if (!action && attendanceRecord?.completed) {
      const result = buildClientScanResult({
        status: 'duplicate',
        message: 'Attendance already marked.',
        name: userRecord?.name || match.user.name,
        confidence: Number(match.confidence || probe.detection.score || 0),
        attendanceAction: attendanceRecord.action || 'OUT',
        faceBox: probe.detection.faceBox,
        source,
        userId: match.user.id,
        ttsMessage: 'Attendance already recorded.',
      });
      S.scanResult = result;
      renderScanResult();
      applyScanResult(result);
      if (opts.showToast) toast(result.message, 'warning');
      return result;
    }

    const localCooldown = getCooldownInfo(match.user.id);
    if (localCooldown.remainingMs > 0) {
      const result = buildClientScanResult({
        status: 'cooldown',
        message: buildCooldownMessage(localCooldown.remainingMs),
        name: userRecord?.name || match.user.name,
        confidence: Number(match.confidence || probe.detection.score || 0),
        attendanceAction: action,
        cooldownRemainingSeconds: Math.ceil(localCooldown.remainingMs / 1000),
        faceBox: probe.detection.faceBox,
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
      source,
      userId: match.user.id,
    });
    if (result.status === 'granted' && result.attendanceAction) {
      recordAttendanceAction(match.user.id, result.attendanceAction, result.scannedAt, result.name);
    } else if (result.status === 'cooldown') {
      syncCooldownFromResult(result, action);
    } else if (result.status === 'duplicate' && attendanceRecord?.completed) {
      recordAttendanceAction(match.user.id, attendanceRecord.action || 'OUT', attendanceRecord.timestamp, result.name);
    }
    S.scanResult = result;
    renderScanResult();
    applyScanResult(result);
    if (opts.showToast || result.status === 'granted') {
      toast(result.message||'Scan complete.', result.status==='granted'?'success':'warning');
    }
    if (isAdmin()) { await loadAdmin(); renderAll(); }
    return result;
  } catch (err) {
    setScanState('denied','Access Denied', err?.message||'Scan failed.');
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

  return { source, detection: await window.FaceAi.detectFromVideo(video) };
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
    source: opts.source || 'camera',
    userId: opts.userId || null,
    ttsMessage: opts.ttsMessage || '',
  };
}

function inferAttendanceAction(userId) {
  const record = getAttendanceRecord(userId);
  if (record?.completed) return null;
  return record?.active || record?.action === 'IN' ? 'OUT' : 'IN';
}

function applyScanResultLegacy(r) {
  const detail = r.name ? `${r.name} — ${fmtDT(r.scannedAt)}` : (r.message || fmtDT(r.scannedAt));
  if (r.status === 'granted') {
    setScanState('granted','Access Granted ✓', detail);
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

/* ── ENROLLMENT ─────────────────────────────────── */
function applyScanResultBrowser(r) {
  const detail = r.name ? `${r.name} - ${fmtDT(r.scannedAt)}` : (r.message || fmtDT(r.scannedAt));
  if (r.status === 'granted') {
    setScanState('granted','Access Granted ✓', detail);
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
  const f = grabFrame();
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

/* ═══════════════════════════════════════════════
   VOICE / TTS — Priority System
   ═══════════════════════════════════════════════ */
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
  speakText(text, 'HIGH');
  toast('Speaking…', 'success');
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

/* ── SELECTS ─────────────────────────────────────── */
let activeSpeechResolver = null;
let lastLowSpeechText = '';
let lastLowSpeechAt = 0;

function speakText(text, priority = 'LOW') {
  const message = String(text || '').trim();
  if (!message) return;

  if (priority === 'LOW') {
    const now = Date.now();
    if (message === lastLowSpeechText && (now - lastLowSpeechAt) < 5000) return;
    lastLowSpeechText = message;
    lastLowSpeechAt = now;
  }

  if (priority === 'HIGH') {
    ttsQueue = ttsQueue.filter(item => item.priority === 'HIGH');
    stopBrowserSpeech();
  } else if (priority === 'MEDIUM') {
    ttsQueue = ttsQueue.filter(item => item.priority === 'HIGH');
  }

  ttsQueue.push({ text: message, priority });
  ttsQueue.sort((left, right) => ttsPriority(right.priority) - ttsPriority(left.priority));
  if (!ttsBusy) processTtsQueue();
}

async function processTtsQueue() {
  if (ttsBusy) return;
  ttsBusy = true;
  while (ttsQueue.length) {
    const item = ttsQueue.shift();
    await doSpeak(item.text);
  }
  ttsBusy = false;
}

async function doSpeak(text) {
  const message = String(text || '').trim();
  if (!message) return false;
  clearAudio();
  const serverOk = await speakServerAudio(message);
  if (serverOk) {
    setTtsMode('server', 'ElevenLabs voice is active.');
    return true;
  }
  const browserOk = await speakBrowser(message);
  if (browserOk) {
    setTtsMode('browser', 'Browser voice fallback is active.');
    return true;
  }
  setTtsMode('error', 'ElevenLabs and Web Speech are unavailable.');
  return false;
}

async function speakServerAudio(text) {
  const message = String(text || '').trim();
  if (!message || !S.token || !isAdmin()) return false;

  try {
    const response = await fetch(`${S.apiBase}/tts`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Authorization': `Bearer ${S.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) return false;

    const audioBlob = await response.blob();
    if (!audioBlob.size) return false;

    const audio = $('ttsAudio');
    S.audioUrl = URL.createObjectURL(audioBlob);
    audio.src = S.audioUrl;
    audio.hidden = false;
    await unlockAudioPlayback().catch(() => {});
    await audio.play();
    await waitForAudioComplete(audio, 60000);
    return true;
  } catch {
    clearAudio();
    return false;
  }
}

async function handleTts(e) {
  e.preventDefault();
  const text = $('ttsText').value.trim();
  if (!text) { toast('Enter some text.','error'); return; }
  speakText(text, 'HIGH');
  toast('Speaking…', 'success');
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
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  if (activeSpeechResolver) {
    const finish = activeSpeechResolver;
    activeSpeechResolver = null;
    finish(false);
  }
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
  if (!('speechSynthesis' in window)) return;
  const warmVoices = () => { window.speechSynthesis.getVoices(); };
  warmVoices();
  if (typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', warmVoices);
  }
}

async function unlockAudioPlayback() {
  return true;
}

function ttsPriority(priority) {
  return ({ LOW: 1, MEDIUM: 2, HIGH: 3 }[String(priority || 'LOW').toUpperCase()] || 1);
}

function populateSelects() {
  fillSelect($('userSlotInput'), S.slots, { blank:true, blankLabel:'No slot', label: s=>`${s.name} (${s.startTime}–${s.endTime})` });
  const members = S.users.filter(u => u.role === 'user');
  fillSelect($('membershipUserInput'), members, { label: u=>`${u.name} (${u.memberId})` });
  fillSelect($('sessionUserInput'), members, { label: u=>`${u.name} (${u.memberId})` });
  fillSelect($('enrollmentUserInput'), members, { label: u=>`${u.name} (${u.memberId})` });
  fillSelect($('announcementUserInput'), members, { blank:true, blankLabel:'All members', label: u=>`${u.name} (${u.memberId})` });
  syncSlotField();
}

function fillSelect(sel, items, opts = {}) {
  const cur = sel.value;
  const html = [];
  if (opts.blank || !items.length) html.push(`<option value="">${esc(opts.blankLabel||'Select')}</option>`);
  items.forEach(item => html.push(`<option value="${esc(item.id)}">${esc((opts.label||(x=>x.name))(item))}</option>`));
  sel.innerHTML = html.join('');
  if (items.some(i => String(i.id) === String(cur))) sel.value = cur;
  else if (!opts.blank && items.length) sel.value = String(items[0].id);
}

/* ── API ─────────────────────────────────────────── */
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

/* ── HELPERS ─────────────────────────────────────── */
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

  const endpoints = [`${target}/health`, target];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(endpoint, {
        cache: 'no-store',
        redirect: 'follow',
        headers: { 'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8' },
        signal: controller.signal,
      });

      if (!response.ok) continue;

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        try {
          const payload = await response.json();
          if (typeof payload?.ok === 'boolean') return payload.ok;
          return true;
        } catch {
          return true;
        }
      }

      return true;
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return false;
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
function fmtDT(v) {
  if (!v) return '–';
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
  const t = $('toast'); t.textContent = msg; t.className = `toast show${type?' '+type:''}`;
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
    enrollmentImages:[], faceUsers:[], userFilter:'', ttsMode:'ready', ttsStatusText:'Type an announcement to speak.',
    cameraRequested:false, cameraRestarting:false, scanState:'idle', scanPill:'Idle',
    scanStatusText:'Live scanner is offline', scanStatusDetail:'Enable Live Scan to start.',
    cooldowns: loadCooldownStore(), cooldownVoiceAt: {},
    reportFilter: { search:'', status:'', date:'' }, membershipFilter:'all',
  });
  clearInterval(S.scanLoopTimer); S.scanLoopTimer = null; S.isScanning = false; S.scanInFlight = false;
  clearInterval(S.sessionTimerLoop); S.sessionTimerLoop = null; S.activeSessions = {};
  localStorage.removeItem(STORAGE_KEYS.sessionTimers);
  stopBrowserSpeech(); clearAudio(); stopCamera(); clearDataPoll();
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
  S.refreshTimer = setInterval(() => refreshAll().catch(console.error), 30000);
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

  const today = localDateKey();
  const todaySessions = toArr(S.sessions)
    .filter(session => String(session.userId) === id && localDateKey(session.startedAt) === today)
    .sort((left, right) => {
      const rightTime = Date.parse(right.endedAt || right.startedAt || 0) || 0;
      const leftTime = Date.parse(left.endedAt || left.startedAt || 0) || 0;
      return rightTime - leftTime;
    });

  const activeSession = todaySessions.find(session => String(session.status || '').toLowerCase() === 'active');
  if (activeSession) {
    return {
      action: 'IN',
      active: true,
      completed: false,
      timestamp: activeSession.startedAt,
      name: activeSession.name || '',
    };
  }

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

function buildCooldownMessage(ms) {
  return `Please wait ${formatCountdown(ms)} before next action.`;
}

function getCooldownInfo(userId) {
  const id = String(userId || '');
  const cached = normalizeCooldownRecord(S.cooldowns[id]);
  const userRecord = getUserRecord(id);
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
  const info = getCooldownInfo(S.scanResult.userId);
  if (info.remainingMs > 0) {
    S.scanResult.cooldownRemainingSeconds = Math.ceil(info.remainingMs / 1000);
    S.scanResult.message = buildCooldownMessage(info.remainingMs);
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

function shouldSpeakScanFeedback(key, throttleMs) {
  const now = Date.now();
  const lastAt = Number(S.cooldownVoiceAt[key] || 0);
  if ((now - lastAt) < throttleMs) return false;
  S.cooldownVoiceAt[key] = now;
  return true;
}

function maybeSpeakCooldown(userId) {
  const key = `cooldown:${userId || 'unknown'}`;
  if (!shouldSpeakScanFeedback(key, COOLDOWN_VOICE_THROTTLE_MS)) return;
  speakText('Please wait before marking again', 'MEDIUM');
}

function maybeSpeakDuplicate(userId) {
  const key = `duplicate:${userId || 'unknown'}`;
  if (!shouldSpeakScanFeedback(key, 10000)) return;
  speakText('Attendance already recorded', 'MEDIUM');
}

function applyScanResult(r) {
  const detail = r.name ? `${r.name} - ${fmtDT(r.scannedAt)}` : (r.message || fmtDT(r.scannedAt));
  if (r.status === 'granted') {
    const isExit = normalizeAttendanceAction(r.attendanceAction) === 'OUT';
    setScanState('granted', isExit ? 'Exit Marked' : 'Entry Marked', detail, isExit ? 'EXIT' : 'ENTRY');
    speakText(r.ttsMessage || `${isExit ? 'Exit' : 'Entry'} marked for ${r.name || 'the member'}`, 'HIGH');
    if (!isExit && r.session) {
      upsertActiveSessionFromBackend(r.session);
    } else if (!isExit && r.userId) {
      startSessionTimer(r.userId, r.name || 'Member');
    }
    if (isExit && r.userId) {
      stopSessionTimer(r.userId);
    }
    return;
  }
  if (r.status === 'duplicate') {
    maybeSpeakDuplicate(r.userId);
    setScanState('detected', 'Already Marked', r.message || detail, 'Duplicate');
    return;
  }
  if (r.status === 'cooldown') {
    maybeSpeakCooldown(r.userId);
    setScanState('detected', 'Please Wait', r.message || detail, 'Cooldown');
    return;
  }
  if (r.status === 'retry') {
    setScanState(S.isScanning ? 'loading' : 'detected', 'Scanning...', r.message || 'Ready for the next face.', 'Scanning');
    return;
  }
  if (r.status === 'unknown') {
    speakText(r.message || 'Face not recognized.', 'LOW');
    setScanState('denied', 'No Match', r.message || detail, 'Unknown');
    return;
  }
  speakText(r.message || 'Access denied.', 'LOW');
  setScanState('denied', 'Access Denied', r.message || detail, r.name ? 'Face Found' : 'No Match');
}

/* ═══════════════════════════════════════════════
   SESSION TIMER ENGINE
   ═══════════════════════════════════════════════ */

const SESSION_DURATION_MS = 70 * 60 * 1000;
const SESSION_TIMER_GRACE_MS = 10 * 60 * 1000;

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
  const startTime = startedAtMs || Number(existing?.startTime) || Date.now();
  const deadlineTime = parseTimestampMs(session?.slotEndAt)
    || (startedAtMs ? (startTime + SESSION_DURATION_MS) : 0)
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
  };
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
  const nextSessions = {};
  toArr(S.sessions)
    .filter(session => String(session?.status || '').toLowerCase() === 'active')
    .forEach(session => {
      const userId = String(session?.userId || '');
      if (!userId) return;
      nextSessions[userId] = buildActiveSessionState(session, S.activeSessions[userId]);
    });

  S.activeSessions = nextSessions;
  persistSessionTimers();
  ensureSessionTimerLoop();
  renderActiveSessionsPanel();
}

function startSessionTimer(userId, name) {
  const normalizedUserId = String(userId || '');
  if (!normalizedUserId) return;

  const startTime = Date.now();
  S.activeSessions[normalizedUserId] = {
    sessionId: String(S.activeSessions[normalizedUserId]?.sessionId || ''),
    userId: normalizedUserId,
    startTime,
    deadlineTime: startTime + SESSION_DURATION_MS,
    duration: SESSION_DURATION_MS,
    announced5: false,
    announcedEnd: false,
    name: name || S.activeSessions[normalizedUserId]?.name || 'Member',
  };
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
      speakText(`${sess.name}, your time is ending in 5 minutes`, 'MEDIUM');
    }
    if (!sess.announcedEnd && remaining <= 0) {
      sess.announcedEnd = true;
      dirty = true;
      speakText(`${sess.name}, your time is over`, 'HIGH');
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

function renderActiveSessionsPanel() {
  const now = Date.now();
  const sessions = Object.entries(S.activeSessions);
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
    const elapsedStr = msToMMSS(elapsed);
    const remainStr = msToMMSS(remaining);
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
          <div class="sess-id">${esc(userId)}</div>
        </div>
        <span class="status-chip ${statusTone}">${statusLabel}</span>
        <button class="mini-btn del" onclick='${endAction}'>${endLabel}</button>
      </div>
      <div class="sess-times">
        <div class="sess-time-block">
          <span class="sess-time-label">ELAPSED</span>
          <span class="sess-time-value">${elapsedStr}</span>
        </div>
        <div class="sess-time-block">
          <span class="sess-time-label">REMAINING</span>
          <span class="sess-time-value ${isExpired ? 'expired-text' : isEnding ? 'ending-text' : ''}">${isExpired ? 'OVER' : remainStr}</span>
        </div>
      </div>
      <div class="sess-progress-rail">
        <div class="sess-progress-fill" style="width:${progress}%;background:${barColor};"></div>
      </div>
    </div>`;
  }).join('');
}

function msToMMSS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function pickSpeechVoice(voices) {
  return toArr(voices)
    .map(voice => {
      const lang = String(voice?.lang || '').toLowerCase();
      const name = String(voice?.name || '').toLowerCase();
      let score = 0;
      if (lang === 'en-in') score += 120;
      if (lang === 'hi-in') score += 110;
      if (lang.startsWith('en')) score += 80;
      if (lang.startsWith('hi')) score += 70;
      if (name.includes('india') || name.includes('hindi')) score += 25;
      if (name.includes('google') || name.includes('microsoft')) score += 20;
      if (name.includes('natural') || name.includes('online')) score += 10;
      if (voice?.default) score += 5;
      return { voice, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.voice || null;
}

function speakBrowser(text) {
  if (!('speechSynthesis' in window)) return Promise.resolve(false);
  stopBrowserSpeech();
  return new Promise(resolve => {
    try {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickSpeechVoice(synth.getVoices());
      utterance.voice = voice || null;
      utterance.lang = voice?.lang || 'en-IN';
      utterance.rate = 1;
      utterance.pitch = 1;

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

function startHealthPoll() {
  clearInterval(S.healthTimer);
  S.healthTimer = setInterval(() => pingHealth().catch(console.error), 30000);
}

/* ── PARTICLES ──────────────────────────────────── */
function initParticles() {
  const canvas = $('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];
  function resize() {
    W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight;
    particles = Array.from({ length: Math.floor((W * H) / 14000) }, () => ({
      x: Math.random()*W, y: Math.random()*H,
      r: Math.random()*1.3+0.4, vx: (Math.random()-.5)*.3, vy: (Math.random()-.5)*.3,
      color: ['99,102,241','14,165,233','124,58,237','5,150,105'][Math.floor(Math.random()*4)],
      alpha: Math.random()*.35+.1,
    }));
  }
  function draw() {
    ctx.clearRect(0,0,W,H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x<0||p.x>W) p.vx=-p.vx;
      if (p.y<0||p.y>H) p.vy=-p.vy;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`; ctx.fill();
    });
    for (let i=0;i<particles.length;i++) for (let j=i+1;j<particles.length;j++) {
      const dx=particles[i].x-particles[j].x, dy=particles[i].y-particles[j].y;
      const d=Math.sqrt(dx*dx+dy*dy);
      if (d<85) { ctx.beginPath(); ctx.moveTo(particles[i].x,particles[i].y); ctx.lineTo(particles[j].x,particles[j].y); ctx.strokeStyle=`rgba(99,102,241,${.04*(1-d/85)})`; ctx.lineWidth=.5; ctx.stroke(); }
    }
    requestAnimationFrame(draw);
  }
  resize(); window.addEventListener('resize', resize); draw();
}
