"use strict";
// Feature: school-management-enhancements
// RFID System monitoring — whitelist management, activity feed, auto-refresh

let _rfidRefreshInterval = null;

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * Filters attendance records to today's date only, returning at most 10.
 * Uses local date (not UTC) to match the server's localtime.
 * @param {Array} records
 * @returns {Array}
 */
function filterTodayActivity(records) {
    const now   = new Date();
    const today = now.getFullYear() + '-' +
                  String(now.getMonth() + 1).padStart(2, '0') + '-' +
                  String(now.getDate()).padStart(2, '0');
    return (records || []).filter(r => r.date === today).slice(0, 10);
}
window.filterTodayActivity = filterTodayActivity;

// getRfidStatus() removed — was never called. Status is handled by applyRfidStatus().

// ─── WHITELIST ───────────────────────────────────────────────────────────────

/**
 * Shared: updates the system status card from already-fetched rfid_settings data.
 * Called by both loadRfidWhitelist (which fetches the data) and checkRfidSystemStatus.
 */
function applyRfidStatus(data) {
    const statusDot    = document.getElementById('rfidStatusDot');
    const statusText   = document.getElementById('rfidStatusText');
    const statusDetail = document.getElementById('rfidStatusDetail');
    if (!statusDot || !statusText) return;

    let status = 'System Offline';
    let detail = 'Java terminal not running';

    if (data && data.success && data.data) {
        const d = data.data;
        // seconds_ago must be a non-negative finite number to count as a real heartbeat
        const raw = d.seconds_ago;
        const secondsAgo = (raw !== null && raw !== undefined && isFinite(raw) && raw >= 0)
            ? parseInt(raw, 10) : null;

        if (secondsAgo === null) {
            status = 'System Offline';
            detail = 'No heartbeat received yet';
        } else if (secondsAgo <= 45) {
            status = 'System Online';
            detail = 'Last seen ' + secondsAgo + 's ago';
        } else if (secondsAgo <= 90) {
            status = 'System Degraded';
            detail = 'Last seen ' + secondsAgo + 's ago — may be slow';
        } else {
            status = 'System Offline';
            const mins = Math.round(secondsAgo / 60);
            detail = 'Last seen ' + (mins < 60 ? mins + 'm' : Math.round(mins / 60) + 'h') + ' ago';
        }

        // Show terminal IP hint — always show if we have an IP, regardless of status
        const ipHintEl = document.getElementById('rfidTerminalIp');
        if (ipHintEl) {
            if (d.last_heartbeat_ip) {
                const span = ipHintEl.querySelector('span');
                if (span) span.textContent = d.last_heartbeat_ip;
                ipHintEl.style.display = '';
            } else {
                ipHintEl.style.display = 'none';
            }
        }
    }

    const colorMap = {
        'System Online':   '#4caf50',
        'System Degraded': '#ff9800',
        'System Offline':  '#f44336',
    };
    statusDot.style.background = colorMap[status] || '#6c757d';
    statusText.textContent     = status;
    if (statusDetail) statusDetail.textContent = detail;
}

async function loadRfidWhitelist() {
    const tbody = document.getElementById('rfidWhitelistBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;">Loading...</td></tr>';

    try {
        const res = await apiFetchWithFallback(`${API_URL}?action=get_rfid_settings`, { method: 'GET' });
        const data = await res.json();

        // Update status card from the same response — no second API call needed
        applyRfidStatus(data);

        if (!data.success) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--red);">${escHtml(data.message || 'Error loading whitelist')}</td></tr>`;
            return;
        }

        const whitelist = (data.data && Array.isArray(data.data.whitelist)) ? data.data.whitelist : [];
        const count     = (data.data && data.data.count != null) ? data.data.count : whitelist.length;

        const countEl = document.getElementById('rfidWhitelistCount');
        if (countEl) countEl.textContent = count + ' IP' + (count !== 1 ? 's' : '');

        if (whitelist.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-mid);">No IP addresses configured</td></tr>';
            return;
        }

        tbody.innerHTML = whitelist.map(entry => {
            const ip = typeof entry === 'object' && entry.ip ? entry.ip : String(entry);
            const label = typeof entry === 'object' && entry.label ? entry.label : '—';
            // Use data attribute to store IP for removal
            return `
            <tr>
                <td style="font-family:var(--font-mono,monospace);font-size:13px;">${escHtml(ip)}</td>
                <td style="color:var(--text-mid);">${escHtml(label)}</td>
                <td style="text-align:center;">
                    <button onclick="removeRfidIp('${escHtml(ip).replace(/'/g, "\\'")}')"
                            class="btn btn-danger btn-sm"
                            style="padding:4px 10px;font-size:11px;"
                            title="Remove from whitelist">
                        Remove
                    </button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--red);">Error loading whitelist</td></tr>`;
        // Mark as offline on fetch error
        applyRfidStatus(null);
        console.error('loadRfidWhitelist error:', err);
    }
}
window.loadRfidWhitelist = loadRfidWhitelist;

async function addRfidIp() {
    const ipInput    = document.getElementById('newRfidIp');
    const labelInput = document.getElementById('newRfidLabel');
    if (!ipInput) return;

    const ipAddress = ipInput.value.trim();
    const label     = labelInput ? labelInput.value.trim() : '';

    if (!ipAddress) {
        showToast('Please enter an IP address', 'error');
        return;
    }

    // Basic IPv4 / IPv6 validation
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    if (!ipv4Pattern.test(ipAddress) && !ipv6Pattern.test(ipAddress)) {
        showToast('Invalid IP address format', 'error');
        return;
    }

    try {
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=save_rfid_settings&operation=add&ip_address=${encodeURIComponent(ipAddress)}&label=${encodeURIComponent(label)}`,
        });
        const data = await res.json();
        if (data.success) {
            showToast('IP address added to whitelist', 'success');
            ipInput.value = '';
            if (labelInput) labelInput.value = '';
            await loadRfidWhitelist();
        } else {
            showToast(data.error || data.message || 'Failed to add IP address', 'error');
        }
    } catch (err) {
        showToast('Error adding IP address', 'error');
        console.error('addRfidIp error:', err);
    }
}
window.addRfidIp = addRfidIp;

async function removeRfidIp(ipAddress) {
    showConfirm(
        'Remove IP Address',
        `Remove ${ipAddress} from the whitelist? RFID readers from this IP will no longer be able to record attendance.`,
        async () => {
            try {
                const res = await apiFetchWithFallback(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `action=save_rfid_settings&operation=remove&ip_address=${encodeURIComponent(ipAddress)}`,
                });
                const data = await res.json();
                if (data.success) {
                    showToast('IP address removed from whitelist', 'success');
                    await loadRfidWhitelist();
                } else {
                    showToast(data.error || data.message || 'Failed to remove IP address', 'error');
                }
            } catch (err) {
                showToast('Error removing IP address', 'error');
                console.error('removeRfidIp error:', err);
            }
        },
        'Remove'
    );
}
window.removeRfidIp = removeRfidIp;

// ─── ACTIVITY FEED ───────────────────────────────────────────────────────────

async function loadRfidActivity() {
    const tbody = document.getElementById('rfidActivityBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;">Loading...</td></tr>';

    try {
        const res = await apiFetchWithFallback(`${API_URL}?action=get_all_attendance`, { method: 'GET' });
        const data = await res.json();

        if (!data.success) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--red);">${escHtml(data.message || 'Error loading activity')}</td></tr>`;
            return;
        }

        const records     = data.data || [];
        const todayRecords = filterTodayActivity(records);

        // Sort by most recent time first (time_out takes precedence over time_in)
        todayRecords.sort((a, b) => {
            const timeA = a.time_out || a.time_in || '';
            const timeB = b.time_out || b.time_in || '';
            return timeB.localeCompare(timeA);
        });

        // Update stats
        const totalEl   = document.getElementById('rfidTotalTaps');
        const presentEl = document.getElementById('rfidPresentCount');
        const lateEl    = document.getElementById('rfidLateCount');
        const lastTapEl = document.getElementById('rfidLastTap');

        if (totalEl)   totalEl.textContent   = todayRecords.length;
        if (presentEl) presentEl.textContent = todayRecords.filter(r => r.status === 'Present').length;
        if (lateEl)    lateEl.textContent    = todayRecords.filter(r => r.status === 'Late').length;

        if (lastTapEl) {
            if (todayRecords.length > 0) {
                const last = todayRecords[0];
                lastTapEl.textContent = last.time_out || last.time_in || '—';
            } else {
                lastTapEl.textContent = '—';
            }
        }

        if (todayRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-mid);">No activity today</td></tr>';
            return;
        }

        tbody.innerHTML = todayRecords.map(r => {
            const time        = r.time_out || r.time_in || '—';
            const action      = r.time_out ? 'TIME OUT' : 'TIME IN';
            const statusClass = r.status === 'Present' ? 'success' : r.status === 'Late' ? 'warning' : 'danger';
            return `
                <tr>
                    <td style="font-family:var(--font-mono,monospace);font-size:12px;">${escHtml(time)}</td>
                    <td>${escHtml(r.full_name || 'Unknown')}</td>
                    <td><span class="badge badge-${statusClass}">${action}</span></td>
                    <td><span class="badge badge-${statusClass}">${escHtml(r.status || '—')}</span></td>
                </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--red);">Error loading activity</td></tr>`;
        console.error('loadRfidActivity error:', err);
    }
}
window.loadRfidActivity = loadRfidActivity;

// ─── SYSTEM STATUS ───────────────────────────────────────────────────────────

async function checkRfidSystemStatus() {
    // Status is now updated inside loadRfidWhitelist from the same API response.
    // This function is kept for the orchestrator interface but delegates to loadRfidWhitelist
    // to avoid a duplicate API call.
    await loadRfidWhitelist();
}
window.checkRfidSystemStatus = checkRfidSystemStatus;

// ─── ORCHESTRATOR ────────────────────────────────────────────────────────────

async function refreshRfidPage() {
    // loadRfidWhitelist handles both whitelist rendering AND status update in one call.
    // loadRfidActivity handles the activity feed and stats.
    await Promise.all([
        loadRfidWhitelist(),
        loadRfidActivity(),
    ]);
}
window.refreshRfidPage = refreshRfidPage;

// ─── AUTO-REFRESH ────────────────────────────────────────────────────────────

function startRfidAutoRefresh() {
    if (_rfidRefreshInterval) return; // already running
    _rfidRefreshInterval = setInterval(() => {
        const rfidPage = document.getElementById('page-admin-rfid');
        if (rfidPage && rfidPage.classList.contains('active')) {
            refreshRfidPage();
        }
    }, 30000);
}
window.startRfidAutoRefresh = startRfidAutoRefresh;

function stopRfidAutoRefresh() {
    if (_rfidRefreshInterval) {
        clearInterval(_rfidRefreshInterval);
        _rfidRefreshInterval = null;
    }
}
window.stopRfidAutoRefresh = stopRfidAutoRefresh;

// ─── PAGE OBSERVER ───────────────────────────────────────────────────────────
// NOTE: The MutationObserver that triggers refreshRfidPage() on tab activation
// is registered in admin.html's inline script (with a firstLoad guard) to avoid
// double-firing. This file only exports the public functions.
