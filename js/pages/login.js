"use strict";

// Clear stale session data on login (NOT admin cache — that's for offline fallback)
function clearBrowserCache() {
    try {
        // Clear session storage (session-specific data)
        sessionStorage.clear();
        
        // Only clear auth/session keys — NOT data cache keys which are needed for offline fallback
        const itemsToRemove = [
            'apiResponseCache',
            'lastDataFetch',
            'sessionCache'
        ];
        
        itemsToRemove.forEach(item => {
            try {
                localStorage.removeItem(item);
            } catch (e) {
                console.warn('Could not remove localStorage item:', item, e);
            }
        });
        
        // Clear Cache API (HTTP cache, not our localStorage data cache)
        if (window.caches) {
            caches.keys().then(names => {
                names.forEach(name => {
                    caches.delete(name);
                });
            }).catch(e => {
                console.warn('Cache API not available or error clearing caches:', e);
            });
        }
        
        // Use CacheManager.clearAll() if available — it knows the actual key names
        if (typeof CacheManager !== 'undefined' && CacheManager.clearAll) {
            CacheManager.clearAll();
        }
        
        console.log('Browser cache cleared successfully');
    } catch (e) {
        console.warn('Error clearing browser cache:', e);
    }
}

// ── HANDLE SESSION CLEARED MESSAGE ──
(function handleLoginReasons() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const reason = urlParams.get('reason');
        
        if (reason === 'session_cleared') {
            // Show a toast explaining what happened
            showToast('Session was cleared due to loading issues. Please sign in again.', 'info', 8000);
            // Clear the URL parameter without reloading
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (reason === 'session_expired') {
            showToast('Your session has expired. Please sign in again.', 'warning', 6000);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    } catch { /* ignore */ }
})();

function showForgotModal() { openModal('forgotModal'); }
async function submitForgotPassword() {
    const u = document.getElementById('forgotUsername').value.trim();
    if (!u) {
        showToast('Please enter your username.', 'error');
        return;
    }
    try {
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=forgot_password&username=${encodeURIComponent(u)}`
        });
        const data = await res.json();
        closeModal('forgotModal');
        showToast(data.message || 'If that username exists, the admin has been notified.', 'info', 6000);
    }
    catch {
        closeModal('forgotModal');
        showToast('Connection error. Please contact the school office directly.', 'error');
    }
    document.getElementById('forgotUsername').value = '';
}
// ═══════════════════════════════════════════════
// ADMIN DATA
// ═══════════════════════════════════════════════
