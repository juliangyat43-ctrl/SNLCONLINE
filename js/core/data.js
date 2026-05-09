"use strict";
// ═══════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// CONFIG & STATE
// ═══════════════════════════════════════════════
// Cache version for API endpoint discovery - increment when deployment changes
const API_CACHE_VERSION = '1.0.0';
const API_CACHE_VERSION_KEY = 'apiCacheVersion';

// API entrypoint can vary by environment (rewrite vs direct file).
// We persist the last-known-working endpoint to avoid bricking the app on deploy.
let API_URL = localStorage.getItem('apiBase') || 'api/index.php';

// Check and clear stale cache if version changed
try {
    const cachedVersion = localStorage.getItem(API_CACHE_VERSION_KEY);
    if (cachedVersion !== API_CACHE_VERSION) {
        localStorage.removeItem('apiBase');
        localStorage.setItem(API_CACHE_VERSION_KEY, API_CACHE_VERSION);
        API_URL = 'api/index.php';
    }
} catch { /* ignore storage errors */ }

/** Ordered list of API endpoints to try for auth/session + initial bootstrap. */
const LOGIN_API_FALLBACKS = Array.from(new Set([
    API_URL,
    'api/index.php',
    'Api.php'
]));

function rememberApiBase(endpoint) {
    API_URL = endpoint;
    try {
        localStorage.setItem('apiBase', endpoint);
    }
    catch { /* ignore storage errors */ }
}

async function resolveApiBase(endpoints = LOGIN_API_FALLBACKS) {
    for (const endpoint of endpoints) {
        try {
            const r = await fetchWithTimeout(endpoint + '?action=ping', { method: 'GET' }, 7000);
            if (!r.ok)
                continue;
            const d = await r.json().catch(() => null);
            if (d && d.success) {
                rememberApiBase(endpoint);
                return endpoint;
            }
        }
        catch { /* try next */ }
    }
    return null;
}

// ─── REDIRECT LOOP GUARD ───
const REDIRECT_GUARD = {
    lastAt: '__redirectLastAt',
    count: '__redirectCount'
};
function canRedirectNow() {
    try {
        const now = Date.now();
        const lastAt = Number(sessionStorage.getItem(REDIRECT_GUARD.lastAt) || '0');
        const prevCount = Number(sessionStorage.getItem(REDIRECT_GUARD.count) || '0');
        const withinWindow = (now - lastAt) <= 5000;
        const nextCount = withinWindow ? (prevCount + 1) : 1;
        sessionStorage.setItem(REDIRECT_GUARD.lastAt, String(now));
        sessionStorage.setItem(REDIRECT_GUARD.count, String(nextCount));
        // If we redirected too many times within 5s, stop redirecting.
        if (withinWindow && nextCount >= 4)
            return false;
        return true;
    }
    catch {
        // If sessionStorage is blocked, don't brick navigation.
        return true;
    }
}
function safeNavigate(url, messageIfBlocked) {
    const path = window.location.pathname || '';
    if (path.includes(url))
        return;
    if (!canRedirectNow()) {
        if (messageIfBlocked)
            showToast(messageIfBlocked, 'error');
        return;
    }
    window.location.href = url;
}
function clearAuthRedirectState() {
    // Reset in-memory CSRF token
    csrfToken = '';
    
    try { DataCenter.clearSession(); } catch {}
    try {
        localStorage.removeItem('currentPage');
        localStorage.removeItem('apiBase');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('currentRole');
        localStorage.removeItem('currentUserId');
        localStorage.removeItem('sessionToken');   // BUG-1 FIX: clear from localStorage
        localStorage.removeItem('csrfToken');      // Clear stale CSRF token
    } catch {}
}

async function verifySessionStatus(endpoints = LOGIN_API_FALLBACKS) {
    // Get session token from localStorage (BUG-1 FIX: must match write location)
    const sessionToken = localStorage.getItem('sessionToken');
    
    for (const endpoint of endpoints) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (sessionToken) {
                headers['X-Session-Token'] = sessionToken;
            }
            
            const res = await fetchWithTimeout(
                `${endpoint}?action=session_status`,
                { method: 'GET', headers },
                10000
            );
            if (!res.ok)
                continue;
            const json = await res.json().catch(() => null);
            if (!json || !json.success || !json.data)
                return { ok: false, reachedServer: true, payload: json };
            rememberApiBase(endpoint);
            // Update CSRF token if provided
            if (json.data.csrf_token) {
                csrfToken = json.data.csrf_token;
                try { localStorage.setItem('csrfToken', csrfToken); } catch {}
            }
            return { ok: true, reachedServer: true, payload: json };
        }
        catch {
            // try next endpoint
        }
    }
    return { ok: false, reachedServer: false, payload: null };
}
let currentRole = 'student';
let currentUser = null;
let currentUserId = null;
let currentUserEditId = null; // tracks the user open in the edit-overlay modal
let csrfToken = ''; // CSRF token for protected requests
let allAttendanceRecords = [];
let allAdminAttendance = [];
let allUsers = [];
let allLeaves = [];
let sentMessages = [];
let allAnnouncements = [];
// Notification poller state — used by startNotificationPoller() in admin.js / teacher.js
let notificationPoller = null;
let lastSeenAnnouncementId = (() => { try { return localStorage.getItem('lastAnnouncementId'); } catch { return null; } })();
const CACHE_KEYS = {
    attendance: 'cacheStudentAttendance',
    profile: 'cacheStudentProfile',
    leaves: 'cacheStudentLeaves',
    announcements: 'cacheAnnouncements',
    adminStats: 'cacheAdminStats',
    adminUsers: 'cacheAdminUsers',
    adminAttendance: 'cacheAdminAttendance',
    adminActivity: 'cacheAdminActivity',
    adminChartData: 'cacheAdminChartData',
    adminLeaves: 'cacheAdminLeaves',
    adminAnnouncements: 'cacheAdminAnnouncements'
};

// Cache expiry configuration (24 hours default)
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const CACHE_TIMESTAMP_KEYS = {
    attendance: 'cacheStudentAttendanceTimestamp',
    profile: 'cacheStudentProfileTimestamp',
    leaves: 'cacheStudentLeavesTimestamp',
    announcements: 'cacheAnnouncementsTimestamp',
    adminStats: 'cacheAdminStatsTimestamp',
    adminUsers: 'cacheAdminUsersTimestamp',
    adminAttendance: 'cacheAdminAttendanceTimestamp',
    adminActivity: 'cacheAdminActivityTimestamp',
    adminChartData: 'cacheAdminChartDataTimestamp',
    adminLeaves: 'cacheAdminLeavesTimestamp',
    adminAnnouncements: 'cacheAdminAnnouncementsTimestamp'
};

// Cache version - increment when cache format changes
const CACHE_VERSION = '1.0.0';
const CACHE_VERSION_KEY = 'cacheVersion';

// Check and clear stale cache if version changed
try {
    const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
    if (cachedVersion !== CACHE_VERSION) {
        Object.values(CACHE_KEYS).forEach(key => localStorage.removeItem(key));
        Object.values(CACHE_TIMESTAMP_KEYS).forEach(key => localStorage.removeItem(key));
        localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
    }
} catch { /* ignore storage errors */ }

// ── GLOBAL CACHE VERSION CHECK ──
// When an admin runs /clearcache, the server bumps a "global_cache" version.
// All clients periodically check this — if it changed, they wipe their
// localStorage cache and hard-reload so users always get fresh data after
// a deploy or cache-clear.
const GLOBAL_CACHE_VERSION_KEY = 'globalCacheVersion';
let _globalCacheCheckInterval = null;

async function checkGlobalCacheVersion() {
    try {
        const resp = await fetch(`${API_URL}?action=get_data_versions`, { method: 'GET' });
        const json = await resp.json();
        if (!json || !json.success) return;
        // Response::success puts data in .data field; handle both for robustness
        const versions = json.data || json.message || [];
        if (!Array.isArray(versions)) return;
        const globalEntry = versions.find(e => e.data_type === 'global_cache');
        if (!globalEntry) return;
        const serverVersion = globalEntry.version;
        const localVersion = localStorage.getItem(GLOBAL_CACHE_VERSION_KEY);
        if (localVersion !== null && Number(serverVersion) > Number(localVersion)) {
            // Server version is newer → wipe all caches and reload
            console.warn('[CacheSync] Global cache version changed (' + localVersion + ' → ' + serverVersion + '). Clearing caches and reloading...');
            Object.values(CACHE_KEYS).forEach(key => { try { localStorage.removeItem(key); } catch(e) {} });
            Object.values(CACHE_TIMESTAMP_KEYS).forEach(key => { try { localStorage.removeItem(key); } catch(e) {} });
            localStorage.setItem(GLOBAL_CACHE_VERSION_KEY, String(serverVersion));
            // Hard-reload to fetch fresh assets and data
            window.location.href = window.location.pathname + '?nocache=' + Date.now();
        } else if (localVersion === null) {
            // First time — just store the current version
            localStorage.setItem(GLOBAL_CACHE_VERSION_KEY, String(serverVersion));
        }
    } catch { /* ignore network errors */ }
}

// Start periodic global cache check (every 30 seconds)
function startGlobalCacheCheck() {
    if (_globalCacheCheckInterval) return;
    // Check once immediately
    checkGlobalCacheVersion();
    _globalCacheCheckInterval = setInterval(checkGlobalCacheVersion, 30000);
}

// Auto-start on pages that have data.js loaded (all authenticated pages)
startGlobalCacheCheck();

// Cache management functions
const CacheManager = {
    setWithTimestamp(key, data, timestampKey) {
        try {
            localStorage.setItem(key, JSON.stringify({
                data: data,
                timestamp: Date.now()
            }));
            localStorage.setItem(timestampKey, String(Date.now()));
        } catch { /* ignore storage errors */ }
    },
    
    getWithExpiry(key, timestampKey) {
        try {
            const cached = localStorage.getItem(key);
            const timestamp = localStorage.getItem(timestampKey);
            
            if (!cached || !timestamp) {
                return null;
            }
            
            const age = Date.now() - Number(timestamp);
            if (age > CACHE_EXPIRY_MS) {
                localStorage.removeItem(key);
                localStorage.removeItem(timestampKey);
                return null;
            }
            
            const parsed = JSON.parse(cached);
            return parsed.data || parsed; // Handle both old and new formats
        } catch {
            return null;
        }
    },
    
    clearAll() {
        try {
            Object.values(CACHE_KEYS).forEach(key => localStorage.removeItem(key));
            Object.values(CACHE_TIMESTAMP_KEYS).forEach(key => localStorage.removeItem(key));
        } catch { /* ignore storage errors */ }
    }
};
const DataCenter = (() => {
    const SESSION_KEYS = {
        user: 'currentUser',
        role: 'currentRole',
        userId: 'currentUserId'
    };
    const state = {
        session: { currentRole: 'student', currentUser: null, currentUserId: null },
        users: [],
        adminAttendance: [],
        leaves: [],
        announcements: []
    };
    function safeParse(raw, fallback) {
        if (!raw)
            return fallback;
        try {
            return JSON.parse(raw);
        }
        catch {
            return fallback;
        }
    }
    function normalizeUserRecord(user) {
        if (!user)
            return null;
        const normalizedUserId = (user.user_id != null) ? Number(user.user_id) : ((user.id != null) ? Number(user.id) : 0);
        const normalizedRole = String(user.role || 'student').toLowerCase();
        const normalizedName = String(user.full_name ?? user.name ?? '').trim();
        return {
            ...user,
            user_id: normalizedUserId,
            full_name: normalizedName,
            role: normalizedRole,
            status: user.status || 'active'
        };
    }
    function persistSession() {
        if (state.session.currentUser) {
            localStorage.setItem(SESSION_KEYS.user, JSON.stringify(state.session.currentUser));
        }
        else {
            localStorage.removeItem(SESSION_KEYS.user);
        }
        localStorage.setItem(SESSION_KEYS.role, state.session.currentRole || 'student');
        if (state.session.currentUserId && state.session.currentUserId.trim() !== '') {
            localStorage.setItem(SESSION_KEYS.userId, state.session.currentUserId);
        }
        else {
            localStorage.removeItem(SESSION_KEYS.userId);
        }
    }
    function setSession(user, role) {
        const normalizedUser = normalizeUserRecord(user);
        const normalizedRole = (role || normalizedUser?.role || state.session.currentRole || 'student').toLowerCase();
        const normalizedUserId = normalizedUser
            ? String(normalizedUser.user_id || normalizedUser.id || '')
            : null;
        state.session = {
            currentRole: normalizedRole,
            currentUser: normalizedUser,
            currentUserId: normalizedUserId && normalizedUserId.trim() !== '' ? normalizedUserId : null
        };
        persistSession();
    }
    return {
        normalizeUserRecord,
        initFromCache() {
            const savedUser = safeParse(localStorage.getItem(SESSION_KEYS.user), null);
            const savedRole = localStorage.getItem(SESSION_KEYS.role);
            const savedId = localStorage.getItem(SESSION_KEYS.userId);
            const normalizedUser = normalizeUserRecord(savedUser);
            const derivedRole = (savedRole || normalizedUser?.role || 'student').toLowerCase();
            const derivedUserId = savedId || String(normalizedUser?.user_id ?? normalizedUser?.id ?? '');
            state.session = {
                currentRole: derivedRole,
                currentUser: normalizedUser,
                currentUserId: derivedUserId && derivedUserId.trim() !== '' ? derivedUserId : null
            };
            persistSession();
        },
        setSession,
        clearSession() {
            state.session = { currentRole: 'student', currentUser: null, currentUserId: null };
            localStorage.removeItem(SESSION_KEYS.user);
            localStorage.removeItem(SESSION_KEYS.role);
            localStorage.removeItem(SESSION_KEYS.userId);
            // Clear all data caches to prevent data leak between users
            CacheManager.clearAll();
        },
        getCurrentRole() { return state.session.currentRole; },
        getCurrentUser() { return state.session.currentUser; },
        getCurrentUserId() { return state.session.currentUserId; },
        getUsers() { return state.users.slice(); },
        setUsers(users) {
            state.users = users
                .map(u => normalizeUserRecord(u))
                .filter((u) => !!u && !!u.user_id);
        },
        upsertUser(user) {
            const normalized = normalizeUserRecord(user);
            if (!normalized || !normalized.user_id)
                return null;
            const idx = state.users.findIndex(u => u.user_id === normalized.user_id);
            if (idx >= 0)
                state.users[idx] = { ...state.users[idx], ...normalized };
            else
                state.users.push(normalized);
            return normalized;
        },
        removeUser(userId) {
            state.users = state.users.filter(u => u.user_id !== userId);
        },
        updateUserStatus(userId, status) {
            const idx = state.users.findIndex(u => u.user_id === userId);
            if (idx !== -1)
                state.users[idx].status = status;
        },
        setAdminAttendance(records) { state.adminAttendance = records || []; },
        getAdminAttendance() { return state.adminAttendance.slice(); },
        setLeaves(leaves) { state.leaves = leaves || []; },
        getLeaves() { return state.leaves.slice(); },
        setAnnouncements(announcements) {
            state.announcements = announcements || [];
            localStorage.setItem(CACHE_KEYS.announcements, JSON.stringify(state.announcements));
        },
        getAnnouncements() { return state.announcements.slice(); },
        hydrateAdminData(payload) {
            if (payload.users)
                this.setUsers(payload.users);
            if (payload.attendance)
                this.setAdminAttendance(payload.attendance);
            if (payload.leaves)
                this.setLeaves(payload.leaves);
            if (payload.announcements)
                this.setAnnouncements(payload.announcements);
        }
    };
})();
function syncLegacyStateFromDataCenter() {
    currentRole = DataCenter.getCurrentRole();
    currentUser = DataCenter.getCurrentUser();
    currentUserId = DataCenter.getCurrentUserId();
    allUsers = DataCenter.getUsers();
    allAdminAttendance = DataCenter.getAdminAttendance();
    allLeaves = DataCenter.getLeaves();
    allAnnouncements = DataCenter.getAnnouncements();
}

// ─── SHARED UTILITIES ───
function getInitials(name) {
    if (!name) return '--';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─── SHARED HELPER FUNCTIONS ─────────────────────────────────────────────────
// These are used across admin.html, parent.html, and all feature JS files.
// Defined here (data.js) so they are available to every page that loads data.js.

/**
 * Escapes a string for safe insertion into HTML.
 * Used everywhere to prevent XSS.
 */
function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Returns today's date as a YYYY-MM-DD string (local time).
 * Used by attendance modal default date and payment display.
 */
function getTodayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Returns the full weekday name for a YYYY-MM-DD date string.
 * Used in attendance records display.
 */
function getDayName(dateStr) {
    try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    } catch {
        return '—';
    }
}

/**
 * Safely converts a value to a finite number, returning fallback on failure.
 * Handles currency strings like "₱ 1,234.56", "PhP 1234", "(1,234.00)".
 */
function toNumber(val, fallback = 0) {
    if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
    if (val === null || val === undefined) return fallback;
    const s = String(val).trim();
    if (!s) return fallback;
    const parenNegative = /^\(.*\)$/.test(s);
    const cleaned = s
        .replace(/[₱$,]/g, '')
        .replace(/\bphp\b/ig, '')
        .replace(/\s+/g, '')
        .replace(/[()]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return fallback;
    return parenNegative ? -n : n;
}

/**
 * Formats a number as Philippine Peso currency string.
 * e.g. 13000 → "PhP 13,000.00"
 */
function formatCurrency(val) {
    const n = toNumber(val, 0);
    return 'PhP ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Triggers a CSV file download in the browser.
 * @param {string} content  - CSV string content
 * @param {string} filename - Desired filename e.g. 'report.csv'
 */
function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
