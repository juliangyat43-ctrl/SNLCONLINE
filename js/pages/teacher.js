"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// teacher.js  —  Teacher portal bootstrap
//
// All shared functions (displayAdminUsers, displayAdminAttendance, escHtml,
// getTodayStr, toNumber, formatCurrency, downloadCSV, etc.) are provided by:
//   • js/core/data.js       — shared state & helpers
//   • js/core/api.js        — fetch utilities
//   • js/core/ui.js         — navigation, modals, toasts
//   • js/features/*.js      — attendance, grades, financial, leaves, users, rfid
//   • js/pages/enroll.js    — enrollment management
//
// This file only contains what is unique to the teacher portal.
// ─────────────────────────────────────────────────────────────────────────────

// ── Bootstrap: load all admin data (same as admin.js but silences 403s) ──────
async function loadAdminData() {
    const apiCalls = [
        { name: 'get_admin_stats', url: `${API_URL}?action=get_admin_stats` },
        { name: 'get_all_users', url: `${API_URL}?action=get_all_users` },
        { name: 'get_all_attendance', url: `${API_URL}?action=get_all_attendance` },
        { name: 'get_recent_activity', url: `${API_URL}?action=get_recent_activity` },
        { name: 'get_chart_data', url: `${API_URL}?action=get_chart_data` },
        { name: 'get_all_leaves', url: `${API_URL}?action=get_all_leaves` },
        { name: 'get_announcements', url: `${API_URL}?action=get_announcements` }
    ];

    const results = {};
    const errors = [];

    // Load each endpoint individually for better error handling
    for (const apiCall of apiCalls) {
        try {
            const response = await fetchApi(apiCall.url);
            results[apiCall.name] = { status: 'fulfilled', value: response };
        } catch (error) {
            results[apiCall.name] = { status: 'rejected', reason: error };
            // Don't count 403 errors as real failures for teachers (permission restrictions)
            if (!error.message.includes('403') && !error.message.includes('Unauthorized')) {
                errors.push({
                    endpoint: apiCall.name,
                    error: error.message || 'Unknown error'
                });
            }
            console.error(`Failed to load ${apiCall.name}:`, error);
        }
    }

    // Process successful results
    const statsRes  = results.get_admin_stats?.status === 'fulfilled' ? results.get_admin_stats.value : null;
    const usersRes  = results.get_all_users?.status === 'fulfilled' ? results.get_all_users.value : null;
    const attRes    = results.get_all_attendance?.status === 'fulfilled' ? results.get_all_attendance.value : null;
    const actRes    = results.get_recent_activity?.status === 'fulfilled' ? results.get_recent_activity.value : null;
    const chartRes  = results.get_chart_data?.status === 'fulfilled' ? results.get_chart_data.value : null;
    const leavesRes = results.get_all_leaves?.status === 'fulfilled' ? results.get_all_leaves.value : null;
    const annRes    = results.get_announcements?.status === 'fulfilled' ? results.get_announcements.value : null;

    const stats = statsRes?.data || {};
    if (statsRes) {
        animateStat('adminStudents',   stats.students        ?? 0);
        animateStat('adminTeachers',   stats.teachers        ?? 0);
        animateStat('adminAttendance', stats.today_attendance ?? 0);
        animateStat('adminAlerts',     stats.alerts          ?? 0);
    }

    const hydrationPayload = {};
    if (usersRes)  hydrationPayload.users         = usersRes.data  || [];
    if (attRes)    hydrationPayload.attendance     = attRes.data    || [];
    if (leavesRes) hydrationPayload.leaves         = leavesRes.data || [];
    if (annRes)    hydrationPayload.announcements  = annRes.data    || [];

    DataCenter.hydrateAdminData(hydrationPayload);
    syncLegacyStateFromDataCenter();

    const activity  = actRes?.data   || [];
    const chartData = chartRes?.data || null;

    displayAdminUsers(allUsers);
    renderFinancialsList();
    displayAdminAttendance(allAdminAttendance);
    displayAdminLeaves(allLeaves);
    displayAdminActivity(activity);
    loadEnrollments();

    if (chartData) renderAdminCharts(chartData);

    // Alert banner — updated by _updateEnrollmentBadge() inside loadEnrollments()

    // Show specific error messages for failed endpoints (excluding 403s for teachers)
    if (errors.length > 0) {
        const errorMessages = errors.map(e => `${e.endpoint}: ${e.error}`).join('\n');
        console.error('Teacher data loading errors:', errorMessages);

        if (errors.length === apiCalls.length) {
            // All endpoints failed (excluding 403s)
            showToast(' Failed to load teacher data. Please check your connection and refresh.', 'error', 0);
        } else {
            // Some endpoints failed, but others succeeded
            const failedEndpoints = errors.map(e => e.endpoint).join(', ');
            showToast(` Partial data loaded. Failed: ${failedEndpoints}. Check console for details.`, 'warning', 8000);
        }
    } else {
        // Only 403 errors (permission restrictions) - this is expected for teachers
        const totalFailures = Object.values(results).filter(r => r.status === 'rejected').length;
        if (totalFailures > 0) {
            console.log('Some endpoints failed due to permission restrictions (expected for teachers).');
        }
    }
}

// ── Activity log display ──────────────────────────────────────────────────────
function displayAdminActivity(activity) {
    const tbody = document.getElementById('adminActivityBody');
    if (!tbody) return;
    if (!activity || activity.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No recent activity.</td></tr>';
        return;
    }
    tbody.innerHTML = activity.map(a => {
        const time        = a.created_at ? new Date(a.created_at).toLocaleString() : '—';
        const statusClass = a.status === 'Success' ? 'success' : a.status === 'Failed' ? 'danger' : 'info';
        return `<tr>
            <td class="text-mono" style="font-size:.78rem;">${time}</td>
            <td>${escHtml(a.user_name || 'System')}</td>
            <td>${escHtml(a.action)}</td>
            <td><span class="badge badge-${statusClass}">${a.status}</span></td>
        </tr>`;
    }).join('');
}

// ── Charts ────────────────────────────────────────────────────────────────────
let enrollmentChartInstance = null;
let attendanceChartInstance = null;

function renderAdminCharts(data) {
    if (enrollmentChartInstance) enrollmentChartInstance.destroy();
    if (attendanceChartInstance) attendanceChartInstance.destroy();

    const enrollCtx = document.getElementById('enrollmentChart');
    if (enrollCtx && data.enrollmentsByGrade) {
        enrollmentChartInstance = new Chart(enrollCtx, {
            type: 'doughnut',
            data: {
                labels:   data.enrollmentsByGrade.map(d => d.grade || 'Unknown'),
                datasets: [{ data: data.enrollmentsByGrade.map(d => d.count),
                    backgroundColor: ['#7B0D1E','#9e1428','#C9952A','#F0C060','#1D5F78','#2D6A4F'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    const attCtx = document.getElementById('attendanceChart');
    if (attCtx && data.attendanceTrends) {
        attendanceChartInstance = new Chart(attCtx, {
            type: 'line',
            data: {
                labels:   data.attendanceTrends.map(d => d.date),
                datasets: [{
                    label:           'Students Present',
                    data:            data.attendanceTrends.map(d => d.present_count),
                    borderColor:     '#7B0D1E',
                    backgroundColor: 'rgba(123,13,30,0.1)',
                    fill:            true,
                    tension:         0.3
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    }
}

// ── Notification poller (same as admin) ───────────────────────────────────────
async function startNotificationPoller() {
    if (notificationPoller) clearInterval(notificationPoller);

    if (!lastSeenAnnouncementId) {
        try {
            const data = await fetchApiWithFallback(`${API_URL}?action=get_announcements`,
                { timeoutMs: 12000, retries: 2, expectSuccess: false });
            if (data.success && data.data && data.data.length > 0) {
                lastSeenAnnouncementId = String(data.data[0].id);
                localStorage.setItem('lastAnnouncementId', lastSeenAnnouncementId);
            }
        } catch { /* silent */ }
    }

    notificationPoller = setInterval(async () => {
        try {
            const data = await fetchApiWithFallback(`${API_URL}?action=get_announcements`,
                { timeoutMs: 12000, retries: 2, expectSuccess: false });
            if (data.success && data.data && data.data.length > 0) {
                const latestAnn = data.data[0];
                if (lastSeenAnnouncementId && latestAnn.id > Number(lastSeenAnnouncementId)) {
                    lastSeenAnnouncementId = String(latestAnn.id);
                    localStorage.setItem('lastAnnouncementId', lastSeenAnnouncementId);
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification('SNLC Portal Announcement', {
                            body: latestAnn.title + '\n' +
                                  latestAnn.content.replace(/<[^>]*>?/gm, '').substring(0, 100),
                            icon: ''
                        });
                    } else {
                        showToast('New Announcement: ' + latestAnn.title, 'success');
                    }
                    loadAdminData();
                }
            }
        } catch { /* silent */ }
    }, 15000);
}

// Connection monitoring for teacher portal
let connectionMonitor = null;
function startConnectionMonitoring() {
    if (connectionMonitor)
        clearInterval(connectionMonitor);
    
    connectionMonitor = setInterval(async () => {
        const el = document.getElementById('connectionStatus');
        if (!el) return;
        
        try {
            const r = await fetchWithTimeout(API_URL + '?action=ping', {}, 5000);
            if (!r.ok)
                throw new Error('HTTP ' + r.status);
            const d = await r.json();
            if (d.success) {
                el.className = 'connection-status online';
                el.textContent = '● Connected';
                el.style.display = 'none';
            }
            else {
                el.className = 'connection-status offline';
                el.textContent = '● API Error';
                el.style.display = 'block';
            }
        }
        catch {
            el.className = 'connection-status offline';
            el.textContent = '● Server Offline';
            el.style.display = 'block';
        }
    }, 30000); // Check every 30 seconds
    
    // Initial check
    checkConnection();
}

// Auto-start connection monitoring when teacher page loads
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        setTimeout(startConnectionMonitoring, 1000);
        setTimeout(startDataSyncMonitoring, 2000);
    });
}

// Data sync monitoring to detect changes from other sessions
let dataSyncMonitor = null;
let lastDataVersions = {};

async function startDataSyncMonitoring() {
    if (dataSyncMonitor)
        clearInterval(dataSyncMonitor);
    
    // Get initial data versions
    try {
        const versionData = await fetchApi(`${API_URL}?action=get_data_versions`);
        if (versionData && versionData.data) {
            versionData.data.forEach(item => {
                lastDataVersions[item.data_type] = item.version;
            });
        }
    } catch (e) {
        console.error('Failed to get initial data versions:', e);
    }
    
    // Check for updates every 30 seconds
    dataSyncMonitor = setInterval(async () => {
        try {
            const versionData = await fetchApi(`${API_URL}?action=get_data_versions`);
            if (versionData && versionData.data) {
                let hasChanges = false;
                versionData.data.forEach(item => {
                    if (lastDataVersions[item.data_type] !== item.version) {
                        lastDataVersions[item.data_type] = item.version;
                        hasChanges = true;
                        console.log(`Data changed: ${item.data_type} (version ${item.version})`);
                    }
                });
                
                if (hasChanges) {
                    showToast('Data has been updated by another user. Refreshing...', 'info', 3000);
                    // Refresh data after a short delay to allow the user to see the toast
                    setTimeout(() => {
                        loadAdminData();
                    }, 2000);
                }
            }
        } catch (e) {
            console.error('Failed to check data versions:', e);
        }
    }, 30000);
}
