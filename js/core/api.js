"use strict";
async function fetchWithTimeout(input, init = {}, timeoutMs = 10000) {
    const creds = init.credentials !== undefined ? init.credentials : 'include';
    const hasAbort = typeof AbortController !== 'undefined';
    
    // Add cache-busting headers
    init.headers = init.headers || {};
    init.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    init.headers['Pragma'] = 'no-cache';
    init.headers['Expires'] = '0';
    
    // Add cache-busting timestamp to URL
    let url = input;
    if (typeof input === 'string') {
        const separator = input.includes('?') ? '&' : '?';
        url = input + separator + '_cb=' + Date.now();
    }
    
    if (!hasAbort)
        return fetch(url, { ...init, credentials: creds });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, credentials: creds, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}

// Progressive timeout based on operation type
function getTimeoutForOperation(url, method) {
    const urlLower = url.toLowerCase();
    const methodUpper = (method || 'GET').toUpperCase();
    
    // Long-running operations get longer timeouts
    if (urlLower.includes('export') || urlLower.includes('import')) {
        return 60000; // 60 seconds for exports/imports
    }
    if (urlLower.includes('backup') || urlLower.includes('restore')) {
        return 120000; // 2 minutes for backup/restore
    }
    if (methodUpper === 'POST' && urlLower.includes('bulk')) {
        return 30000; // 30 seconds for bulk operations
    }
    if (methodUpper === 'POST' && urlLower.includes('upload')) {
        return 60000; // 60 seconds for file uploads
    }
    
    // Default timeout
    return 10000; // 10 seconds for normal operations
}
async function checkConnection() {
    const el = document.getElementById('connectionStatus');
    try {
        const r = await fetchWithTimeout(API_URL + '?action=ping', {}, 10000);
        if (!r.ok)
            throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (d.success) {
            el.className = 'connection-status online';
            el.textContent = '● Connected';
            setTimeout(() => { el.style.display = 'none'; }, 3000);
        }
        else {
            el.className = 'connection-status offline';
            el.textContent = '● API Error';
        }
    }
    catch {
        el.className = 'connection-status offline';
        el.textContent = '● Server Offline';
    }
}
function getApiBaseCandidates() {
    const saved = (() => {
        try {
            return localStorage.getItem('apiBase') || '';
        }
        catch {
            return '';
        }
    })();
    return Array.from(new Set([
        API_URL,
        saved,
        'api/index.php',
        'Api.php',
    ].map(s => (s || '').trim()).filter(Boolean)));
}
function classifyUnauthorized(status, payload, bodySnippet) {
    if (status === 401)
        return true;
    const msg = String(payload?.error || payload?.message || bodySnippet || '').toLowerCase();
    return msg.includes('unauthorized') || msg.includes('access denied') || msg.includes('not logged');
}
function isLikelyHtmlResponse(contentType, bodySnippet) {
    const ct = (contentType || '').toLowerCase();
    if (ct.includes('text/html'))
        return true;
    const s = (bodySnippet || '').trim().toLowerCase();
    return s.startsWith('<!doctype') || s.startsWith('<html') || s.includes('<body');
}
function replaceKnownApiBase(url, newBase) {
    const trimmed = (url || '').trim();
    if (!trimmed)
        return trimmed;
    // Replace any known base prefix with the candidate base.
    for (const base of getApiBaseCandidates()) {
        if (trimmed.startsWith(base))
            return newBase + trimmed.slice(base.length);
    }
    return trimmed;
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
function jitterBackoffMs(attemptIndex) {
    const base = 350 * Math.pow(2, attemptIndex); // 350, 700...
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(2000, base + jitter);
}

// ─── CIRCUIT BREAKER ───
const CircuitBreaker = {
    states: {},
    
    getState(endpoint) {
        return this.states[endpoint] || { failures: 0, lastFailure: 0, state: 'closed' };
    },
    
    setState(endpoint, state) {
        this.states[endpoint] = state;
    },
    
    recordFailure(endpoint) {
        const state = this.getState(endpoint);
        state.failures++;
        state.lastFailure = Date.now();
        
        // Open circuit after 5 consecutive failures (higher threshold for parallel API calls)
        if (state.failures >= 5) {
            state.state = 'open';
        }
        
        this.setState(endpoint, state);
    },
    
    recordSuccess(endpoint) {
        const state = this.getState(endpoint);
        state.failures = 0;
        state.state = 'closed';
        this.setState(endpoint, state);
    },
    
    canAttempt(endpoint) {
        const state = this.getState(endpoint);
        
        if (state.state === 'closed') {
            return true;
        }
        
        // Try again after 15 seconds if circuit is open (faster recovery for parallel calls)
        if (state.state === 'open' && Date.now() - state.lastFailure > 15000) {
            state.state = 'half-open';
            this.setState(endpoint, state);
            return true;
        }
        
        return state.state !== 'open';
    },
    
    // Manual reset for circuit breaker (useful after extended outages)
    manualReset(endpoint) {
        this.states[endpoint] = { failures: 0, lastFailure: 0, state: 'closed' };
    },
    
    // Reset all circuit breakers (useful after server recovery)
    resetAll() {
        this.states = {};
    }
};
function isRetryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}
function isRetryableError(err) {
    const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
    return msg.includes('network') || msg.includes('failed to fetch') || msg.includes('timeout') || msg.includes('abort');
}
function maybeRedirectUnauthorizedOnce(message) {
    try {
        const k = '__authRedirectedOnce';
        if (sessionStorage.getItem(k) === '1')
            return;
        sessionStorage.setItem(k, '1');
    }
    catch { /* ignore */ }
    clearAuthRedirectState();
    safeNavigate('login.html?reason=session_expired', message || 'Your session has expired. Please sign in again.');
}
async function apiFetchWithFallback(input, init = {}, options = {}) {
    // Use progressive timeout if not explicitly provided
    const timeoutMs = Number(options.timeoutMs || getTimeoutForOperation(String(input), init.method));
    const candidates = options.candidates || getApiBaseCandidates();
    const method = (init.method || 'GET').toUpperCase();
    const maxRetries = Number(options.retries ?? ((method === 'GET') ? 2 : 0));
    
    // Initialize headers if not present
    init.headers = init.headers || {};
    
    // Add session token to all requests (v11 - token-based sessions)
    const sessionToken = localStorage.getItem('sessionToken');
    if (sessionToken && !init.headers['X-Session-Token']) {
        init.headers['X-Session-Token'] = sessionToken;
    }
    
    // Add CSRF token to POST requests
    if (method === 'POST' && csrfToken) {
        // Add as header if not already present
        if (!init.headers['X-CSRF-Token'] && !init.headers['x-csrf-token']) {
            init.headers['X-CSRF-Token'] = csrfToken;
        }
        // Also add to body if it's form-urlencoded and doesn't have it
        if (typeof init.body === 'string' && init.body.includes('action=') && !init.body.includes('csrf_token=')) {
            init.body += '&csrf_token=' + encodeURIComponent(csrfToken);
        }
        // Add session token to body for logout (backward compatibility)
        if (typeof init.body === 'string' && init.body.includes('action=logout') && sessionToken && !init.body.includes('session_token=')) {
            init.body += '&session_token=' + encodeURIComponent(sessionToken);
        }
        // Add to JSON body if it's an object
        if (init.headers['Content-Type'] === 'application/json' && typeof init.body === 'string') {
            try {
                const bodyObj = JSON.parse(init.body);
                if (!bodyObj.csrf_token) {
                    bodyObj.csrf_token = csrfToken;
                    init.body = JSON.stringify(bodyObj);
                }
            } catch { /* not JSON or already has token */ }
        }
    }
    
    let lastErr = null;
    for (const endpoint of candidates) {
        // Check circuit breaker before attempting endpoint
        if (!CircuitBreaker.canAttempt(endpoint)) {
            lastErr = new Error(`Circuit breaker open for ${endpoint}, skipping`);
            continue;
        }
        
        const targetUrl = replaceKnownApiBase(String(input), endpoint);
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // BUG-1 FIX: Removed duplicate sessionStorage read (token already added above from localStorage)
                const res = await fetchWithTimeout(targetUrl, init, timeoutMs);
                
                // Quick endpoint validation: treat 404 + HTML as "wrong entrypoint".
                const contentType = res.headers?.get?.('content-type') || '';
                const bodyPeek = await res.clone().text().then(t => t.slice(0, 160)).catch(() => '');
                if (isLikelyHtmlResponse(contentType, bodyPeek) || (res.status === 404)) {
                    // If the server returned an HTML page (or a 404), try next endpoint base.
                    lastErr = new Error(`Endpoint ${endpoint} not usable (HTTP ${res.status})`);
                    break;
                }
                
                // Remember base as long as we reached a non-HTML endpoint.
                rememberApiBase(endpoint);
                
                // Record success in circuit breaker
                CircuitBreaker.recordSuccess(endpoint);
                
                // BUG-2 FIX: Check for CSRF token expiry and auto-refresh
                if (res.status === 403) {
                    try {
                        const json = await res.clone().json();
                        if (json?.error_code === 'csrf_invalid') {
                            // CSRF token expired - refresh it via session_status
                            const refreshed = await verifySessionStatus([endpoint]);
                            if (refreshed.ok && refreshed.payload?.data?.csrf_token) {
                                csrfToken = refreshed.payload.data.csrf_token;
                                try { localStorage.setItem('csrfToken', csrfToken); } catch {}
                                
                                // Retry the original request once with new CSRF token
                                if (method === 'POST') {
                                    // Update headers
                                    init.headers['X-CSRF-Token'] = csrfToken;
                                    
                                    // Update body if form-urlencoded
                                    if (typeof init.body === 'string' && init.body.includes('csrf_token=')) {
                                        init.body = init.body.replace(/csrf_token=[^&]*/, 'csrf_token=' + encodeURIComponent(csrfToken));
                                    } else if (typeof init.body === 'string' && init.body.includes('action=')) {
                                        init.body += '&csrf_token=' + encodeURIComponent(csrfToken);
                                    }
                                    
                                    // Retry the request
                                    const retryRes = await fetchWithTimeout(targetUrl, init, timeoutMs);
                                    return retryRes;
                                }
                            }
                        }
                    } catch { /* not JSON or refresh failed, continue with normal error handling */ }
                }
                
                // If unauthorized, redirect once and surface error to caller.
                // BUT: Don't intercept 401s from login/session_status — let the caller handle it
                if (classifyUnauthorized(res.status, null, bodyPeek)) {
                    const body = typeof init.body === 'string' ? init.body : '';
                    const url = String(input || '');
                    const isAuthExempt = body.includes('action=login') || url.includes('action=session_status');
                    if (!isAuthExempt) {
                        maybeRedirectUnauthorizedOnce('Your session has expired. Please sign in again.');
                        throw new Error('Unauthorized');
                    }
                }
                
                // Retry some 5xx / transient statuses for GETs only.
                if (method === 'GET' && isRetryableStatus(res.status) && attempt < maxRetries) {
                    await sleep(jitterBackoffMs(attempt));
                    continue;
                }
                
                return res;
            }
            catch (err) {
                lastErr = err instanceof Error ? err : new Error(String(err || 'Unknown error'));
                
                // Record failure in circuit breaker
                CircuitBreaker.recordFailure(endpoint);
                
                if (method === 'GET' && attempt < maxRetries && isRetryableError(lastErr)) {
                    await sleep(jitterBackoffMs(attempt));
                    continue;
                }
                // If this endpoint attempt failed (network/timeout), try next endpoint base.
                break;
            }
        }
    }
    throw (lastErr || new Error('API request failed'));
}
async function fetchApiWithFallback(url, options = {}) {
    const res = await apiFetchWithFallback(url, options.init || {}, options);
    let data;
    try {
        data = await res.json();
    }
    catch {
        const text = await res.text().catch(() => '');
        throw new Error(text ? `Invalid JSON response: ${text.substring(0, 140)}` : 'Invalid JSON response');
    }
    const _url = typeof url === 'string' ? url : '';
    if (classifyUnauthorized(res.status, data, '') && !_url.includes('action=session_status')) {
        maybeRedirectUnauthorizedOnce('Your session has expired. Please sign in again.');
        throw new Error('Unauthorized');
    }
    if (options.expectSuccess !== false && !data.success) {
        const msg = data.error || data.message || 'API request failed';
        if (classifyUnauthorized(res.status, data, msg)) {
            maybeRedirectUnauthorizedOnce('Your session has expired. Please sign in again.');
        }
        throw new Error(msg);
    }
    return data;
}
async function fetchApi(url) {
    return await fetchApiWithFallback(url, { timeoutMs: 10000, retries: 2, expectSuccess: true });
}
async function parseApiJson(res) {
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    try {
        return await res.json();
    }
    catch {
        const text = await res.text().catch(() => '');
        throw new Error(text ? `Invalid JSON response: ${text.substring(0, 140)}` : 'Invalid JSON response');
    }
}
function btnLoading(btn, loading, originalText) {
    if (loading) {
        btn._originalText = btn.innerHTML;
        btn.innerHTML = originalText || 'Saving…';
        btn.classList.add('btn-loading');
        btn.disabled = true;
    }
    else {
        btn.innerHTML = btn._originalText || originalText || '';
        btn.classList.remove('btn-loading');
        btn.disabled = false;
    }
}
// ─── ANIMATED STAT NUMBER ───
function animateStat(id, value) {
    const el = document.getElementById(id);
    if (!el)
        return;
    const end = typeof value === 'number' ? value : parseInt(String(value)) || 0;
    if (isNaN(end)) {
        el.textContent = String(value);
        return;
    }
    const from = parseInt(el.textContent || '0') || 0;
    if (from === end) {
        el.textContent = String(end);
        return;
    }
    const duration = 500;
    const startTime = Date.now();
    const tick = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = String(Math.round(from + (end - from) * eased));
        if (progress < 1)
            requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

// ─── LOADING OVERLAY ───
let loadingOverlay = null;

function showLoading(message = 'Loading...') {
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = `
            <div style="text-align: center; color: white;">
                <div class="loading-spinner"></div>
                <div style="margin-top: 16px; font-size: 14px;" id="loadingMessage">${message}</div>
            </div>
        `;
        document.body.appendChild(loadingOverlay);
    }
    
    const messageEl = loadingOverlay.querySelector('#loadingMessage');
    if (messageEl) messageEl.textContent = message;
    
    setTimeout(() => loadingOverlay.classList.add('active'), 10);
}

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
    }
}

// ─── CONFIRMATION DIALOG ───
function showConfirm(title, message, onConfirm, onCancel) {
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
        <div class="confirm-dialog-content">
            <div class="confirm-dialog-title">${title}</div>
            <div class="confirm-dialog-message">${message}</div>
            <div class="confirm-dialog-actions">
                <button class="btn btn-outline" id="confirmCancel">Cancel</button>
                <button class="btn btn-primary" id="confirmOk">Confirm</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    setTimeout(() => dialog.classList.add('active'), 10);
    
    const handleClose = (confirmed) => {
        dialog.classList.remove('active');
        setTimeout(() => {
            dialog.remove();
            if (confirmed && onConfirm) onConfirm();
            if (!confirmed && onCancel) onCancel();
        }, 200);
    };
    
    dialog.querySelector('#confirmOk').onclick = () => handleClose(true);
    dialog.querySelector('#confirmCancel').onclick = () => handleClose(false);
    dialog.onclick = (e) => {
        if (e.target === dialog) handleClose(false);
    };
}

// ─── BUTTON LOADING STATE ───
function setButtonLoading(button, loading, originalText) {
    if (loading) {
        button.dataset.originalText = button.innerHTML;
        button.classList.add('btn-loading');
        button.disabled = true;
    } else {
        button.innerHTML = button.dataset.originalText || originalText || '';
        button.classList.remove('btn-loading');
        button.disabled = false;
    }
}

// Make globally available
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.showConfirm = showConfirm;
window.setButtonLoading = setButtonLoading;

