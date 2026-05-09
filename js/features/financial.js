"use strict";
function renderFinancialsList() {
    const q = (document.getElementById('finSearchInput')?.value || '').toLowerCase();
    const gFilter = document.getElementById('finGradeFilter')?.value || 'all';
    const grid = document.getElementById('financialsGrid');
    if (!grid)
        return;
    const students = allUsers.filter(u => {
        if (u.role !== 'student')
            return false;
        if (gFilter !== 'all' && u.grade !== gFilter)
            return false;
        if (q && !u.full_name.toLowerCase().includes(q))
            return false;
        return true;
    });
    if (!students.length) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No students match criteria.</div>';
        return;
    }
    grid.innerHTML = students.map(s => {
        const tuit = toNumber(s.tuition_fee, 0);
        const paid = toNumber(s.amount_paid, 0);
        const bal = tuit - paid;
        return `
    <div class="card" style="margin-bottom:0; cursor:pointer;" onclick="openFinancialPlanModal(${s.user_id})">
      <div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:.5rem;">
          <div>
            <div style="font-weight:600; color:var(--text-dark); font-size:1.05rem;">${escHtml(s.full_name)}</div>
            <div style="font-size:.8rem; color:var(--text-light);">${s.grade || 'No Grade'} - ${s.section || 'No Section'}</div>
          </div>
          <div class="badge badge-${bal <= 0 ? 'success' : 'warning'}">${bal <= 0 ? 'Settled' : 'Has Balance'}</div>
        </div>
        <div style="background:var(--bg); border-radius:6px; padding:.75rem; margin-top:.75rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:.25rem;">
            <span style="font-size:.8rem; color:var(--text-mid);">Plan:</span>
            <span style="font-size:.8rem; font-weight:600; text-transform:capitalize;">${s.payment_plan || 'Monthly'}</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:.25rem;">
            <span style="font-size:.8rem; color:var(--text-mid);">Next Payment:</span>
            <span style="font-size:.8rem; font-weight:600;">${s.next_payment_date || '2026-06-08'}</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-top:1px solid var(--border-light); padding-top:.25rem; margin-top:.25rem;">
            <span style="font-size:.8rem; color:var(--text-mid);">Balance:</span>
            <span style="font-size:.85rem; font-weight:700; color:var(--maroon);">₱${formatCurrency(bal)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
    }).join('');
}
// formatCurrencyObj removed — use formatCurrency() from data.js instead

// ─── GLOBAL FEE SETTINGS ───

/**
 * Loads the current global fee settings from the API and populates the
 * #globalTuitionInput and #globalMiscInput fields on the financials page.
 */
async function loadGlobalFeeSettings() {
    const tuitionEl = document.getElementById('globalTuitionInput');
    const miscEl    = document.getElementById('globalMiscInput');
    if (!tuitionEl || !miscEl) return; // elements not present on this page

    try {
        const data = await fetchApiWithFallback(
            `${API_URL}?action=get_global_settings`,
            { timeoutMs: 10000, retries: 2, expectSuccess: false }
        );
        if (data.success && data.data) {
            tuitionEl.value = data.data.global_tuition_fee ?? '';
            miscEl.value    = data.data.global_misc_fee    ?? '';
        }
    } catch (err) {
        // Silently fail — inputs remain empty so admin can still type values
        console.error('loadGlobalFeeSettings error:', err);
    }
}
window.loadGlobalFeeSettings = loadGlobalFeeSettings;

/**
 * Reads #globalTuitionInput and #globalMiscInput, validates, then POSTs
 * action=set_global_fees. On success refreshes the financial list.
 */
async function saveGlobalFees() {
    const tuitionEl = document.getElementById('globalTuitionInput');
    const miscEl    = document.getElementById('globalMiscInput');
    if (!tuitionEl || !miscEl) return;

    const tuitionVal = tuitionEl.value.trim();
    const miscVal    = miscEl.value.trim();

    // Client-side validation
    if (tuitionVal === '' || isNaN(Number(tuitionVal)) || Number(tuitionVal) < 0) {
        showToast('Tuition fee must be a number ≥ 0', 'error');
        return;
    }
    if (miscVal === '' || isNaN(Number(miscVal)) || Number(miscVal) < 0) {
        showToast('Miscellaneous fee must be a number ≥ 0', 'error');
        return;
    }

    try {
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=set_global_fees&tuition_fee=${encodeURIComponent(tuitionVal)}&misc_fee=${encodeURIComponent(miscVal)}`
        });
        const data = await res.json();
        if (data.success) {
            showToast('Global fees updated successfully', 'success');
            typeof loadAdminData === 'function'  && loadAdminData(); // refresh student financial cards
        } else {
            showToast(data.error || data.message || 'Failed to update fees', 'error');
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Connection error';
        showToast('Error saving fees: ' + msg, 'error');
    }
}
window.saveGlobalFees = saveGlobalFees;

// Hook loadGlobalFeeSettings to fire when the financials page becomes active
document.addEventListener('DOMContentLoaded', () => {
    const financialsPage = document.getElementById('page-admin-financials');
    if (!financialsPage) return;
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && financialsPage.classList.contains('active')) {
                loadGlobalFeeSettings();
            }
        });
    });
    observer.observe(financialsPage, { attributes: true, attributeFilter: ['class'] });
});
function openFinancialPlanModal(userId) {
    const s = allUsers.find(u => u.user_id === userId);
    if (!s)
        return;
    document.getElementById('finUserId').value = String(userId);
    document.getElementById('finStudentName').textContent = s.full_name;
    document.getElementById('finGradeSec').textContent = (s.grade || '') + ' - ' + (s.section || '');
    document.getElementById('finPlanSelect').value = s.payment_plan || 'Monthly';
    const amountPaidEl = document.getElementById('finAmountPaid');
    if (amountPaidEl)
        amountPaidEl.value = String(s.amount_paid || 0);
    openModal('finPlanModal');
}
async function saveFinancialPlan() {
    const id = document.getElementById('finUserId').value;
    const plan = document.getElementById('finPlanSelect').value;
    const paidEl = document.getElementById('finAmountPaid');
    const paid = paidEl ? paidEl.value : 0;
    try {
        const r = await apiFetchWithFallback(API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=update_financial_plan&user_id=${id}&payment_plan=${plan}&amount_paid=${paid}`
        });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const result = await r.json();
        if (result.success) {
            showToast('Plan updated!', 'success');
            closeModal('finPlanModal');
            typeof loadAdminData === 'function'  && loadAdminData();
        }
        else {
            showToast(result.error || 'Failed to update plan', 'error');
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Connection error';
        showToast(`Connection error (${message})`, 'error');
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    const isParent = path.includes('parent.html');
    const isAdmin = path.includes('admin.html');
    const isTeacher = path.includes('teacher.html');
    const isProtected = isParent || isAdmin || isTeacher;
    const isLogin = path.includes('login.html');
    const isEnroll = path.includes('enroll.html');
    const isLanding = path.includes('index.html') || path === '/' || path.endsWith('/');
    
    // Check for session expiry message on login page
    if (isLogin) {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const reason = urlParams.get('reason');
            if (reason === 'session_expired') {
                const msgEl = document.getElementById('sessionExpiredMessage');
                if (msgEl) {
                    msgEl.style.display = 'block';
                    // Clear the URL parameter without reloading
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            }
        } catch { /* ignore */ }
    }
    
    // Load CSRF token from storage
    try {
        csrfToken = localStorage.getItem('csrfToken') || '';
    } catch { /* ignore */ }
    
    DataCenter.initFromCache();
    syncLegacyStateFromDataCenter();
    const hasSession = !!(currentUser && currentRole && currentUserId);
    if ((isLanding || isLogin || isEnroll) && hasSession) {
        (async () => {
            const status = await verifySessionStatus(LOGIN_API_FALLBACKS);
            // Never redirect away from login unless session is confirmed valid.
            if (!status.ok) {
                if (status.reachedServer) {
                    clearAuthRedirectState();
                }
                // Stay on login/landing/enroll so user can recover.
                if (isLogin) {
                    showToast('Session expired. Please sign in again.', 'error');
                }
                return;
            }
            const activeRole = DataCenter.getCurrentRole() || currentRole;
            safeNavigate('' + (activeRole === 'admin' ? 'admin.html' : (activeRole === 'teacher' ? 'teacher.html' : 'parent.html')), 'Too many redirects detected. Please refresh and sign in again.');
        })();
        return;
    }
    if (isEnroll) {
        if (typeof enrollGoToStep === 'function') enrollGoToStep(1);
        return;
    }
    if (isProtected) {
        (async () => {
            let payload = null;
            try {
                const endpoints = LOGIN_API_FALLBACKS;
                let reachedServer = false;
                for (const endpoint of endpoints) {
                    try {
                        const res = await fetchWithTimeout(`${endpoint}?action=session_status`, { method: 'GET' }, 10000);
                        if (!res.ok)
                            continue;
                        const json = await res.json().catch(() => null);
                        if (!json) {
                            // Non-JSON response (HTML/PHP error) — try next endpoint.
                            continue;
                        }
                        reachedServer = true;
                        payload = json;
                        // Remember the endpoint that actually answered.
                        rememberApiBase(endpoint);
                        break;
                    }
                    catch { /* try next */ }
                }
                // If we couldn't reach ANY session endpoint, don't brick the app.
                // Keep legacy localStorage session so the shell can load and show "offline".
                if (!reachedServer) {
                    await resolveApiBase(endpoints);
                    showToast('Cannot reach server to verify session. Continuing in offline mode.', 'error');
                    completeLogin();
                    if (currentRole === 'student' && typeof loadStudentData === 'function')
                        loadStudentData();
                    else
                        typeof loadAdminData === 'function'  && loadAdminData();
                    return;
                }
            }
            catch (e) {
                console.error('Session verify failed:', e);
                DataCenter.clearSession();
                localStorage.removeItem('currentPage');
                clearAuthRedirectState();
                safeNavigate('login.html', 'Too many redirects detected. Please refresh and sign in again.');
                return;
            }
            if (!payload || !payload.success || !payload.data) {
                clearAuthRedirectState();
                safeNavigate('login.html', 'Too many redirects detected. Please refresh and sign in again.');
                return;
            }
            const d = payload.data;
            const userObj = DataCenter.normalizeUserRecord({
                user_id: d.user_id,
                id: d.user_id,
                full_name: d.full_name,
                name: d.name,
                username: d.username,
                role: d.role,
                parent_email: d.parent_email,
                permissions: d.permissions
            });
            DataCenter.setSession(userObj, d.role);
            syncLegacyStateFromDataCenter();
            // Update CSRF token from session status
            if (d.csrf_token) {
                csrfToken = d.csrf_token;
                try {
                    localStorage.setItem('csrfToken', csrfToken);
                } catch { /* ignore */ }
            }
            try {
                if (isAdmin && currentRole !== 'admin') {
                    safeNavigate(currentRole === 'teacher' ? 'teacher.html' : 'parent.html', 'Too many redirects detected. Please refresh and sign in again.');
                    return;
                }
                if (isTeacher && currentRole !== 'teacher') {
                    safeNavigate(currentRole === 'admin' ? 'admin.html' : 'parent.html', 'Too many redirects detected. Please refresh and sign in again.');
                    return;
                }
                if (isParent && currentRole !== 'student') {
                    safeNavigate(currentRole === 'admin' ? 'admin.html' : 'teacher.html', 'Too many redirects detected. Please refresh and sign in again.');
                    return;
                }
                completeLogin();
                if (currentRole === 'student' && typeof loadStudentData === 'function')
                    loadStudentData();
                else
                    typeof loadAdminData === 'function'  && loadAdminData();
            }
            catch (e) {
                console.error('Session restore failed:', e);
                clearAuthRedirectState();
                safeNavigate('login.html', 'Too many redirects detected. Please refresh and sign in again.');
            }
        })();
        return;
    }
});
// ─── PUSH NOTIFICATIONS POLLER ───
// notificationPoller and lastSeenAnnouncementId moved to data.js
