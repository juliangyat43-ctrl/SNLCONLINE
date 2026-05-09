"use strict";

// ── SESSION RECOVERY HELPERS ──
// These are available for manual recovery via browser console.
// Normal session validation is handled by verifySessionStatus() in data.js
// which is called by apiFetchWithFallback() automatically.
async function validateAdminSession() {
    try {
        const sessionCheck = await verifySessionStatus();
        console.log('Session validation result:', sessionCheck);
        return sessionCheck.ok === true;
    } catch (err) {
        console.error('Session validation failed:', err);
        return false;
    }
}

// ── CUSTOM PERSISTENT ERROR TOAST WITH ACTION BUTTON ──
function showPersistentErrorToast(message, actionFunctionName) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    // Remove any existing persistent error toasts
    const existing = container.querySelectorAll('.toast-persistent');
    existing.forEach(t => t.remove());
    
    const toast = document.createElement('div');
    toast.className = 'toast toast-error toast-persistent';
    toast.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px; background:var(--red-soft); border:2px solid var(--red); border-radius:8px; color:var(--red); font-weight:500; max-width:500px;';
    
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    msgSpan.style.flex = '1';
    
    const btn = document.createElement('button');
    btn.textContent = 'Fix Now';
    btn.style.cssText = 'background:var(--red); color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600; white-space:nowrap; flex-shrink:0;';
    btn.onclick = () => {
        toast.remove();
        if (typeof window[actionFunctionName] === 'function') {
            window[actionFunctionName]();
        }
    };
    
    toast.appendChild(msgSpan);
    toast.appendChild(btn);
    container.appendChild(toast);
    
    // Auto-remove after 30 seconds if not clicked
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.transition = 'opacity 0.3s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }
    }, 30000);
}

function forceClearChromeSession() {
    console.log('Force clearing Chrome session state...');
    
    // Clear all auth-related localStorage
    const keysToRemove = [
        'sessionToken',
        'csrfToken',
        'currentUser',
        'currentRole',
        'currentUserId',
        'currentPage',
        'apiBase',
        'userData',
        'apiResponseCache',
        'lastDataFetch',
        'sessionCache'
    ];
    
    keysToRemove.forEach(key => {
        try { localStorage.removeItem(key); } catch (e) {}
    });
    
    // Clear sessionStorage completely
    try { sessionStorage.clear(); } catch (e) {}
    
    // Reset in-memory state
    try {
        if (typeof DataCenter !== 'undefined' && DataCenter.clearSession) {
            DataCenter.clearSession();
        }
    } catch (e) {}
    
    // Clear circuit breaker states
    try {
        if (typeof CircuitBreaker !== 'undefined' && CircuitBreaker.resetAll) {
            CircuitBreaker.resetAll();
        }
    } catch (e) {}
    
    // Clear data cache using CacheManager (knows the actual key names)
    try {
        if (typeof CacheManager !== 'undefined' && CacheManager.clearAll) {
            CacheManager.clearAll();
        }
    } catch (e) {}
    
    console.log('Session cleared. Redirecting to login...');
    window.location.href = 'login.html?reason=session_cleared&clear=' + Date.now();
}

async function loadAdminData() {
    console.log('loadAdminData: Starting admin data load...');

    // ── STEP 1: Show cached data immediately (stale-while-revalidate) ──
    const cachedStats = CacheManager.getWithExpiry(CACHE_KEYS.adminStats, CACHE_TIMESTAMP_KEYS.adminStats);
    const cachedUsers = CacheManager.getWithExpiry(CACHE_KEYS.adminUsers, CACHE_TIMESTAMP_KEYS.adminUsers);
    const cachedAtt  = CacheManager.getWithExpiry(CACHE_KEYS.adminAttendance, CACHE_TIMESTAMP_KEYS.adminAttendance);
    const cachedAct  = CacheManager.getWithExpiry(CACHE_KEYS.adminActivity, CACHE_TIMESTAMP_KEYS.adminActivity);
    const cachedChart = CacheManager.getWithExpiry(CACHE_KEYS.adminChartData, CACHE_TIMESTAMP_KEYS.adminChartData);
    const cachedLeaves = CacheManager.getWithExpiry(CACHE_KEYS.adminLeaves, CACHE_TIMESTAMP_KEYS.adminLeaves);
    const cachedAnn = CacheManager.getWithExpiry(CACHE_KEYS.adminAnnouncements, CACHE_TIMESTAMP_KEYS.adminAnnouncements);

    if (cachedStats) {
        const s = cachedStats.data || cachedStats;
        animateStat('adminStudents', s.students ?? 0);
        animateStat('adminTeachers', s.teachers ?? 0);
        animateStat('adminAttendance', s.today_attendance ?? 0);
        animateStat('adminAlerts', s.alerts ?? 0);
    }
    if (cachedUsers) {
        const u = cachedUsers.data || cachedUsers;
        // API returns { users: [...], pagination: {...} } — extract the array
        allUsers = Array.isArray(u) ? u : (u?.users || []);
        displayAdminUsers(allUsers);
    }
    if (cachedAtt) {
        const a = cachedAtt.data || cachedAtt;
        allAdminAttendance = Array.isArray(a) ? a : [];
        displayAdminAttendance(allAdminAttendance);
    }
    if (cachedLeaves) {
        const l = cachedLeaves.data || cachedLeaves;
        allLeaves = Array.isArray(l) ? l : [];
        displayAdminLeaves(allLeaves);
    }
    if (cachedAnn) {
        const an = cachedAnn.data || cachedAnn;
        allAnnouncements = Array.isArray(an) ? an : [];
    }
    if (cachedAct) displayAdminActivity(cachedAct.data || cachedAct || []);
    if (cachedChart) renderAdminCharts(cachedChart.data || cachedChart);
    renderFinancialsList();
    loadEnrollments();

    // ── STEP 2: Fetch fresh data in parallel ──
    const apiCalls = [
        { name: 'get_admin_stats',   url: `${API_URL}?action=get_admin_stats` },
        { name: 'get_all_users',     url: `${API_URL}?action=get_all_users` },
        { name: 'get_all_attendance',url: `${API_URL}?action=get_all_attendance` },
        { name: 'get_recent_activity',url: `${API_URL}?action=get_recent_activity` },
        { name: 'get_chart_data',    url: `${API_URL}?action=get_chart_data` },
        { name: 'get_all_leaves',    url: `${API_URL}?action=get_all_leaves` },
        { name: 'get_announcements', url: `${API_URL}?action=get_announcements` }
    ];

    const settled = await Promise.allSettled(
        apiCalls.map(call => fetchApi(call.url).then(data => ({ name: call.name, data })))
    );

    const results = {};
    const errors = [];
    settled.forEach((r, i) => {
        const name = apiCalls[i].name;
        if (r.status === 'fulfilled') {
            results[name] = r.value.data;
        } else {
            errors.push({ endpoint: name, error: r.reason?.message || 'Unknown error' });
            console.error(`Failed to load ${name}:`, r.reason);
        }
    });

    // ── STEP 3: Process fresh results & cache them ──
    const stats = results.get_admin_stats?.data || null;
    if (stats) {
        animateStat('adminStudents', stats.students ?? 0);
        animateStat('adminTeachers', stats.teachers ?? 0);
        animateStat('adminAttendance', stats.today_attendance ?? 0);
        animateStat('adminAlerts', stats.alerts ?? 0);
        CacheManager.setWithTimestamp(CACHE_KEYS.adminStats, results.get_admin_stats, CACHE_TIMESTAMP_KEYS.adminStats);
    }

    const usersRaw = results.get_all_users?.data || null;
    // API returns { users: [...], pagination: {...} } — extract the array
    const users = Array.isArray(usersRaw) ? usersRaw : (usersRaw?.users || null);
    if (users) {
        allUsers = users;
        displayAdminUsers(allUsers);
        CacheManager.setWithTimestamp(CACHE_KEYS.adminUsers, results.get_all_users, CACHE_TIMESTAMP_KEYS.adminUsers);
    } else if (!cachedUsers) {
        allUsers = DataCenter.getUsers();
        if (allUsers && allUsers.length > 0) {
            displayAdminUsers(allUsers);
        } else {
            const grid = document.getElementById('adminUsersGrid');
            if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-light);">Unable to load users. <button onclick="loadAdminData()" class="btn btn-outline btn-sm" style="margin-left:8px;">Retry</button></div>';
        }
    }

    const attData = results.get_all_attendance?.data || null;
    if (attData) {
        allAdminAttendance = attData;
        displayAdminAttendance(allAdminAttendance);
        CacheManager.setWithTimestamp(CACHE_KEYS.adminAttendance, results.get_all_attendance, CACHE_TIMESTAMP_KEYS.adminAttendance);
    }

    const activity = results.get_recent_activity?.data || null;
    if (activity) {
        displayAdminActivity(activity);
        CacheManager.setWithTimestamp(CACHE_KEYS.adminActivity, results.get_recent_activity, CACHE_TIMESTAMP_KEYS.adminActivity);
    }

    const chartData = results.get_chart_data?.data || null;
    if (chartData) {
        renderAdminCharts(chartData);
        CacheManager.setWithTimestamp(CACHE_KEYS.adminChartData, results.get_chart_data, CACHE_TIMESTAMP_KEYS.adminChartData);
    }

    const leavesData = results.get_all_leaves?.data || null;
    if (leavesData) {
        allLeaves = leavesData;
        displayAdminLeaves(allLeaves);
        CacheManager.setWithTimestamp(CACHE_KEYS.adminLeaves, results.get_all_leaves, CACHE_TIMESTAMP_KEYS.adminLeaves);
    }

    const annData = results.get_announcements?.data || null;
    if (annData) {
        allAnnouncements = annData;
        CacheManager.setWithTimestamp(CACHE_KEYS.adminAnnouncements, results.get_announcements, CACHE_TIMESTAMP_KEYS.adminAnnouncements);
    }

    // Hydrate DataCenter with whatever we got
    const hydrationPayload = {};
    if (users) hydrationPayload.users = users;
    if (attData) hydrationPayload.attendance = attData;
    if (leavesData) hydrationPayload.leaves = leavesData;
    if (annData) hydrationPayload.announcements = annData;
    if (Object.keys(hydrationPayload).length) {
        DataCenter.hydrateAdminData(hydrationPayload);
        syncLegacyStateFromDataCenter();
    }

    // ── STEP 4: Cache fallback for failed endpoints ──
    if (errors.length > 0) {
        let usedCache = false;
        try {
            // Stats fallback
            if (!stats && !cachedStats) {
                const fallback = CacheManager.getWithExpiry(CACHE_KEYS.adminStats, CACHE_TIMESTAMP_KEYS.adminStats);
                if (fallback) {
                    const s = fallback.data || fallback;
                    animateStat('adminStudents', s.students ?? 0);
                    animateStat('adminTeachers', s.teachers ?? 0);
                    animateStat('adminAttendance', s.today_attendance ?? 0);
                    animateStat('adminAlerts', s.alerts ?? 0);
                    usedCache = true;
                }
            }
            // Users fallback
            if (!users && !cachedUsers) {
                const fallback = CacheManager.getWithExpiry(CACHE_KEYS.adminUsers, CACHE_TIMESTAMP_KEYS.adminUsers);
                if (fallback) {
                    const u = fallback.data || fallback;
                    // API returns { users: [...], pagination: {...} } — extract the array
                    allUsers = Array.isArray(u) ? u : (u?.users || []);
                    displayAdminUsers(allUsers);
                    usedCache = true;
                }
            }
            // Attendance fallback
            if (!attData && !cachedAtt) {
                const fallback = CacheManager.getWithExpiry(CACHE_KEYS.adminAttendance, CACHE_TIMESTAMP_KEYS.adminAttendance);
                if (fallback) {
                    const a = fallback.data || fallback;
                    allAdminAttendance = Array.isArray(a) ? a : [];
                    displayAdminAttendance(allAdminAttendance);
                    usedCache = true;
                }
            }
            // Activity fallback
            if (!activity && !cachedAct) {
                const fallback = CacheManager.getWithExpiry(CACHE_KEYS.adminActivity, CACHE_TIMESTAMP_KEYS.adminActivity);
                if (fallback) {
                    displayAdminActivity(fallback.data || fallback || []);
                    usedCache = true;
                }
            }
            // Chart data fallback
            if (!chartData && !cachedChart) {
                const fallback = CacheManager.getWithExpiry(CACHE_KEYS.adminChartData, CACHE_TIMESTAMP_KEYS.adminChartData);
                if (fallback) {
                    renderAdminCharts(fallback.data || fallback);
                    usedCache = true;
                }
            }
            // Leaves fallback
            if (!leavesData && !cachedLeaves) {
                const fallback = CacheManager.getWithExpiry(CACHE_KEYS.adminLeaves, CACHE_TIMESTAMP_KEYS.adminLeaves);
                if (fallback) {
                    const l = fallback.data || fallback;
                    allLeaves = Array.isArray(l) ? l : [];
                    displayAdminLeaves(allLeaves);
                    usedCache = true;
                }
            }
            // Announcements fallback
            if (!annData && !cachedAnn) {
                const fallback = CacheManager.getWithExpiry(CACHE_KEYS.adminAnnouncements, CACHE_TIMESTAMP_KEYS.adminAnnouncements);
                if (fallback) {
                    const an = fallback.data || fallback;
                    allAnnouncements = Array.isArray(an) ? an : [];
                    usedCache = true;
                }
            }
        } catch (cacheError) {
            console.error('Cache fallback error:', cacheError);
        }

        // ── STEP 5: Error reporting ──
        const errorMessages = errors.map(e => `${e.endpoint}: ${e.error}`).join('\n');
        console.error('Admin data loading errors:', errorMessages);

        if (errors.length === apiCalls.length) {
            // All endpoints failed
            if (cachedStats || cachedUsers || usedCache) {
                showToast('Using cached data (server unreachable). Will retry on next refresh.', 'warning', 8000);
            } else {
                showPersistentErrorToast(
                    'Failed to load admin data and no cache available. Click "Fix Now" to retry or clear session.',
                    'loadAdminData'
                );
            }
        } else {
            const failedEndpoints = errors.map(e => e.endpoint).join(', ');
            if (usedCache) {
                showToast(`Server issue detected. Using cached data for: ${failedEndpoints}. Data may be outdated.`, 'warning', 8000);
            } else {
                showToast(`Partial data loaded. Failed: ${failedEndpoints}.`, 'warning', 8000);
            }
        }
    }
}
function displayAdminActivity(activity) {
    const tbody = document.getElementById('adminActivityBody');
    if (!tbody) return;
    if (!activity || activity.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No recent activity.</td></tr>';
        return;
    }
    tbody.innerHTML = activity.map(a => {
        const time = a.created_at ? new Date(a.created_at).toLocaleString() : '—';
        const statusClass = a.status === 'Success' ? 'success' : a.status === 'Failed' ? 'danger' : 'info';
        return `<tr>
      <td class="text-mono" style="font-size:.78rem;">${time}</td>
      <td>${escHtml(a.user_name || 'System')}</td>
      <td>${escHtml(a.action)}</td>
      <td><span class="badge badge-${statusClass}">${a.status}</span></td>
    </tr>`;
    }).join('');
}
// getInitials() is defined in js/core/data.js
function displayAdminUsers(users) {
    const grid = document.getElementById('adminUsersGrid');
    if (!grid)
        return;
    if (!users || users.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:2rem; color:var(--text-light);">No users found.</div>';
        return;
    }
    if (!window.userAvatarTimestamps)
        window.userAvatarTimestamps = {};
    grid.innerHTML = users.map(u => {
        const initials = getInitials(u.full_name);
        const isActive = u.status === 'active';
        const roleDisp = (u.grade && u.section) ? `${u.grade} - ${u.section}` : u.role.toUpperCase();
        const parentDisp = u.parent_email || (u.role === 'student' ? 'No Parent Info' : '');
        const ts = window.userAvatarTimestamps[u.user_id] ? '?t=' + window.userAvatarTimestamps[u.user_id] : '';
        return `
  <div class="user-card" onclick="openUserEditModal(${u.user_id})">
    <span class="status-dot ${isActive ? 'active' : 'inactive'}" title="${isActive ? 'Active' : 'Inactive'}"></span>
    <div class="card-inner">
      <div class="avatar" style="overflow:hidden; position:relative;">
        <img src="Profile_pic/${u.user_id}.jpg${ts}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" alt="Profile" style="width:100%; height:100%; object-fit:cover;">
        <span style="display:none; align-items:center; justify-content:center; width:100%; height:100%;">${initials}</span>
      </div>
      <div class="card-info">
        <div class="card-name">${escHtml(u.full_name ?? '')}</div>
        <div class="card-role">${escHtml(roleDisp)}</div>
        <div class="card-grade">${escHtml(parentDisp)}</div>
      </div>
    </div>
    <div class="card-actions">
      <button class="action-btn btn-edit" onclick="event.stopPropagation(); openUserEditModal(${u.user_id})">Edit profile</button>
      <button class="action-btn ${isActive ? 'btn-deactivate' : 'btn-activate'}" onclick="event.stopPropagation(); toggleUserStatus(${u.user_id})">
        ${isActive ? 'Deactivate' : 'Activate'}
      </button>
    </div>
  </div>`;
    }).join('');
}

// ─── ATTENDANCE FUNCTIONS ───
// displayAdminAttendance, openAddAttendanceModal, populateStudentDropdown,
// editAttendanceRecord, saveAttendance, deleteAttendance, searchUsersTable,
// filterAdminAttendance, exportAttendance, exportUsersCSV
// are all defined in js/features/attendance.js

// ─── UTILITIES ───
// escHtml, getTodayStr, getDayName, toNumber, formatCurrency, downloadCSV
// are all defined in js/core/data.js

// Chart instances
function displayAdminLeaves(leaves) {
    const tbody = document.getElementById('adminLeavesBody');
    if (!tbody)
        return;
    if (!leaves || leaves.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No leave requests found.</td></tr>';
        return;
    }
    tbody.innerHTML = leaves.map(l => `<tr>
    <td class="text-mono">${l.submitted_at ? l.submitted_at.split(' ')[0] : '—'}</td>
    <td>${escHtml(l.student_name || 'Student #' + l.user_id)}</td>
    <td>${l.leave_type}</td>
    <td class="text-mono">${l.start_date}</td>
    <td class="text-mono">${l.end_date}</td>
    <td style="max-width:160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escHtml(l.reason)}">${escHtml(l.reason)}</td>
    <td><span class="badge badge-${l.status === 'Approved' ? 'success' : l.status === 'Rejected' ? 'danger' : 'warning'}">${l.status}</span></td>
    <td>${l.status === 'Pending' ? `<div class="action-btns">
      <button class="btn btn-success btn-sm" onclick="updateLeaveStatus(${l.id},'Approved')"> Approve</button>
      <button class="btn btn-danger btn-sm" onclick="updateLeaveStatus(${l.id},'Rejected')">✕ Reject</button>
    </div>` : `<span style="color:var(--text-light); font-size:.82rem;">${l.status}</span>`}</td>
  </tr>`).join('');
}
async function updateLeaveStatus(leaveId, status) {
    const leave = allLeaves.find(l => l.id === leaveId);
    if (!leave)
        return;
    showConfirm(`${status} Leave Request`, `${status} the leave request from ${leave.student_name || 'this student'}?`, async () => {
        try {
            const res = await apiFetchWithFallback(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `action=update_leave_status&leave_id=${leaveId}&status=${status}`
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.success) {
                showToast(data.error || 'Failed to update status.', 'error');
                return;
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Connection error';
            showToast(`Connection error (${message})`, 'error');
            return;
        }
        const idx = allLeaves.findIndex(l => l.id === leaveId);
        if (idx !== -1)
            allLeaves[idx].status = status;
        displayAdminLeaves(allLeaves);
        showToast(`✓ Leave request ${status.toLowerCase()}!`, status === 'Approved' ? 'success' : 'info');
    }, status);
}
function filterLeavesByStatus(status) {
    displayAdminLeaves(status === 'all' ? allLeaves : allLeaves.filter(l => l.status === status));
}
// viewUserDetail() and editUser() removed — dead code.
// The system uses openUserEditModal() from users.js instead.
function toggleUserStatus(userId) {
    const u = DataCenter.getUsers().find(user => user.user_id === userId);
    if (!u)
        return;
    const newStatus = u.status === 'active' ? 'inactive' : 'active';
    showConfirm('Toggle User Status', `Set "${u.full_name}" to "${newStatus}"?`, async () => {
        try {
            const res = await apiFetchWithFallback(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `action=update_user_status&user_id=${userId}&status=${newStatus}`
            });
            if (!(await res.json()).success) {
                showToast(' Failed to update.', 'error');
                return;
            }
        }
        catch {
            showToast(' Connection error.', 'error');
            return;
        }
        DataCenter.updateUserStatus(userId, newStatus);
        allUsers = DataCenter.getUsers();
        displayAdminUsers(allUsers);
        showToast(`✓ Status updated to ${newStatus}.`, 'success');
    }, `Set to ${newStatus}`);
}
async function deleteUser(userId) {
    const u = DataCenter.getUsers().find(user => user.user_id === userId);
    if (!u)
        return;
    showConfirm(' Permanently Delete User', `Delete "${u.full_name}" (${u.role})? This will permanently remove the account and ALL related records (grades, attendance, payments). This cannot be undone.`, async () => {
        try {
            const res = await apiFetchWithFallback(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `action=delete_user&user_id=${userId}`
            });
            const data = await res.json();
            if (!data.success) {
                showToast(' ' + (data.error || 'Failed to delete user.'), 'error');
                return;
            }
        }
        catch {
            showToast(' Connection error. Could not delete user.', 'error');
            return;
        }
        try {
            const refreshData = await fetchApiWithFallback(`${API_URL}?action=get_all_users`, { timeoutMs: 12000, retries: 2, expectSuccess: false });
            if (refreshData.success) {
                DataCenter.setUsers(refreshData.data || []);
            }
            else {
                DataCenter.removeUser(userId);
            }
        }
        catch {
            DataCenter.removeUser(userId);
        }
        allUsers = DataCenter.getUsers();
        displayAdminUsers(allUsers);
        populateStudentDropdown();
        document.getElementById('adminStudents').textContent =
            String(allUsers.filter(u => u.role === 'student' && u.status === 'active').length);
        document.getElementById('adminTeachers').textContent =
            String(allUsers.filter(u => u.role === 'teacher' && u.status === 'active').length);
        showToast(`✓ "${u.full_name}" has been permanently deleted.`, 'success');
    }, ' Delete Permanently');
}
function openAddUserModal() {
    document.getElementById('userModalTitle').textContent = ' Add New User';
    document.getElementById('editUserId').value = '';
    const photoG = document.getElementById('newUserPhotoGroup');
    if (photoG)
        photoG.style.display = 'block';
    window.pendingNewUserProfilePic = null;
    const picInp = document.getElementById('newUserProfilePic');
    if (picInp)
        picInp.value = '';
    updateNewUserProfilePicClearUi();
    ['newUserName', 'newUserUsername', 'newUserPassword', 'newUserEmail', 'userRfidUid', 'newUserSection', 'newUserTuition', 'newUserPaid'].forEach(id => (document.getElementById(id).value = ''));
    document.getElementById('newUserRole').value = 'student';
    document.getElementById('newUserGrade').value = '';
    document.getElementById('newUserClass').value = '';
    document.getElementById('newUserStatus').value = 'active';
    document.querySelectorAll('input[name="teacher_perm"]').forEach(cb => cb.checked = false);
    toggleUserFields();
    openModal('userModal');
}
function toggleUserFields() {
    const role = document.getElementById('newUserRole').value;
    document.getElementById('studentFields').style.display =
        role === 'student' ? 'block' : 'none';
    const tpGroup = document.getElementById('teacherPermissionsGroup');
    if (tpGroup) {
        tpGroup.style.display = role === 'teacher' ? 'block' : 'none';
    }
}
async function saveUser() {
    const name = document.getElementById('newUserName').value.trim();
    const username = document.getElementById('newUserUsername').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const editId = document.getElementById('editUserId').value;
    if (!name || !username) {
        showToast('Name and username are required.', 'error');
        return;
    }
    if (!editId && !password) {
        showToast('Password is required for new users.', 'error');
        return;
    }
    const userData = {
        full_name: name, username, role: document.getElementById('newUserRole').value,
        parent_email: document.getElementById('newUserEmail').value,
        rfid_uid: document.getElementById('userRfidUid').value.trim(),
        grade: document.getElementById('newUserGrade').value,
        section: document.getElementById('newUserSection').value,
        class_type: document.getElementById('newUserClass').value,
        tuition_fee: document.getElementById('newUserTuition').value || 0,
        amount_paid: document.getElementById('newUserPaid').value || 0,
        status: document.getElementById('newUserStatus').value,
    };
    if (userData.role === 'teacher') {
        const perms = Array.from(document.querySelectorAll('input[name="teacher_perm"]:checked')).map(cb => cb.value);
        // PHP expects an array, and standard URL encoding for arrays doesn't use JSON for post body
        // But our backend uses json_encode on $permissions if it's an array.
        // Wait, backend reads: $_POST['permissions']
        userData.permissions = JSON.stringify(perms);
    }
    if (password)
        userData.password = password;
    const saveBtn = document.querySelector('#userModal .btn-success');
    btnLoading(saveBtn, true, editId ? ' Saving…' : ' Adding…');
    try {
        const action = editId ? 'update_user' : 'add_user';
        if (editId)
            userData.user_id = editId;
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: Object.entries({ action, ...userData }).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
        });
        const data = await res.json();
        if (!data.success) {
            showToast(' ' + (data.error || 'Save failed.'), 'error');
            btnLoading(saveBtn, false);
            return;
        }
        if (data.data && data.data.user_id)
            userData.user_id = data.data.user_id;

        if (!editId && window.pendingNewUserProfilePic && userData.user_id) {
            const fd = new FormData();
            fd.append('action', 'upload_profile_pic');
            fd.append('user_id', String(userData.user_id));
            fd.append('profile_pic', window.pendingNewUserProfilePic);
            try {
                const upRes = await apiFetchWithFallback(API_URL, { method: 'POST', body: fd });
                const upData = await upRes.json();
                if (upData.success) {
                    if (!window.userAvatarTimestamps)
                        window.userAvatarTimestamps = {};
                    window.userAvatarTimestamps[Number(userData.user_id)] = Date.now();
                }
                else {
                    showToast(upData.error || 'User saved but photo upload failed.', 'error');
                }
            }
            catch {
                showToast('User saved but photo upload failed.', 'error');
            }
            window.pendingNewUserProfilePic = null;
            const picInput = document.getElementById('newUserProfilePic');
            if (picInput)
                picInput.value = '';
            updateNewUserProfilePicClearUi();
        }
    }
    catch {
        showToast(' Connection error.', 'error');
        btnLoading(saveBtn, false);
        return;
    }
    btnLoading(saveBtn, false);
    if (editId) {
        DataCenter.upsertUser({ ...userData, user_id: Number(editId) });
    }
    else {
        const newUser = { ...userData, user_id: userData.user_id || Date.now() };
        DataCenter.upsertUser(newUser);
        allUsers = DataCenter.getUsers();
        animateStat('adminStudents', allUsers.filter(u => u.role === 'student' && u.status === 'active').length);
        animateStat('adminTeachers', allUsers.filter(u => u.role === 'teacher' && u.status === 'active').length);
    }
    allUsers = DataCenter.getUsers();
    displayAdminUsers(allUsers);
    populateStudentDropdown();
    closeModal('userModal');
    showToast(editId ? '✓ User updated!' : '✓ User added!', 'success');
}
// ─── ATTENDANCE & SEARCH FUNCTIONS ───
// displayAdminAttendance, openAddAttendanceModal, populateStudentDropdown,
// editAttendanceRecord, saveAttendance, deleteAttendance, searchUsersTable,
// filterAdminAttendance, exportAttendance, exportUsersCSV
// are all defined in js/features/attendance.js — no duplicates here.

function generateReport(type) {
    const from = document.getElementById('reportFromDate').value;
    const to = document.getElementById('reportToDate').value;
    const grade = document.getElementById('reportGrade').value;
    let csv = '';
    let filename = '';
    if (type === 'attendance') {
        let data = allAdminAttendance;
        if (from && to)
            data = data.filter(a => a.date >= from && a.date <= to);
        if (!data.length) {
            showToast('No attendance data for the selected range.', 'error');
            return;
        }
        csv = 'Date,Student ID,Name,Time In,Time Out,Status,Late (min)\n';
        data.forEach(a => {
            csv += `"${a.date}","${a.user_code || a.user_id}","${a.full_name}","${a.time_in || ''}","${a.time_out || ''}","${a.status}","${a.late_minutes || 0}"\n`;
        });
        filename = 'attendance_report.csv';
    }
    else if (type === 'users') {
        let data = allUsers;
        if (grade !== 'all')
            data = data.filter(u => u.grade === grade);
        if (!data.length) {
            showToast('No user data for the selected filters.', 'error');
            return;
        }
        csv = 'ID,Name,Role,Email,Grade,Section,Status\n';
        data.forEach(u => {
            csv += `"${u.user_id}","${u.full_name}","${u.role}","${u.parent_email || ''}","${u.grade || ''}","${u.section || ''}","${u.status}"\n`;
        });
        filename = 'users_report.csv';
    }
    else if (type === 'leaves') {
        let data = allLeaves;
        if (from && to)
            data = data.filter(l => l.start_date >= from && l.start_date <= to);
        if (!data.length) {
            showToast('No leave data for the selected range.', 'error');
            return;
        }
        csv = 'Submitted,Student,Type,Start,End,Reason,Status\n';
        data.forEach(l => {
            csv += `"${l.submitted_at || ''}","${l.student_name || ''}","${l.leave_type}","${l.start_date}","${l.end_date}","${l.reason}","${l.status}"\n`;
        });
        filename = 'leave_requests.csv';
    }
    if (csv) {
        downloadCSV(csv, filename);
        const r = document.getElementById('reportResult');
        r.textContent = `✓ ${filename} has been downloaded.`;
        r.style.display = 'flex';
        setTimeout(() => { r.style.display = 'none'; }, 4000);
    }
}
// ─── UTILITIES ───
// escHtml, getTodayStr, getDayName, toNumber, formatCurrency, downloadCSV
// are all defined in js/core/data.js — no duplicates here.

// Chart instances
let enrollmentChartInstance = null;
let attendanceChartInstance = null;
function renderAdminCharts(data) {
    if (enrollmentChartInstance)
        enrollmentChartInstance.destroy();
    if (attendanceChartInstance)
        attendanceChartInstance.destroy();
    const enrollCtx = document.getElementById('enrollmentChart');
    if (enrollCtx && data.enrollmentsByGrade) {
        enrollmentChartInstance = new Chart(enrollCtx, {
            type: 'doughnut',
            data: {
                labels: data.enrollmentsByGrade.map(d => d.grade || 'Unknown'),
                datasets: [{
                        data: data.enrollmentsByGrade.map(d => d.count),
                        backgroundColor: ['#7B0D1E', '#9e1428', '#C9952A', '#F0C060', '#1D5F78', '#2D6A4F']
                    }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
    const attCtx = document.getElementById('attendanceChart');
    if (attCtx && data.attendanceTrends) {
        attendanceChartInstance = new Chart(attCtx, {
            type: 'line',
            data: {
                labels: data.attendanceTrends.map(d => d.date),
                datasets: [{
                        label: 'Students Present',
                        data: data.attendanceTrends.map(d => d.present_count),
                        borderColor: '#7B0D1E',
                        backgroundColor: 'rgba(123, 13, 30, 0.1)',
                        fill: true,
                        tension: 0.3
                    }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    }
}
async function startNotificationPoller() {
    if (notificationPoller)
        clearInterval(notificationPoller);
    if (!lastSeenAnnouncementId) {
        try {
            const data = await fetchApiWithFallback(`${API_URL}?action=get_announcements`, { timeoutMs: 12000, retries: 2, expectSuccess: false });
            if (data.success && data.data && data.data.length > 0) {
                lastSeenAnnouncementId = String(data.data[0].id);
                localStorage.setItem('lastAnnouncementId', lastSeenAnnouncementId);
            }
        }
        catch { /* silent */ }
    }
    notificationPoller = setInterval(async () => {
        try {
            const data = await fetchApiWithFallback(`${API_URL}?action=get_announcements`, { timeoutMs: 12000, retries: 2, expectSuccess: false });
            if (data.success && data.data && data.data.length > 0) {
                const latestAnn = data.data[0];
                if (lastSeenAnnouncementId && latestAnn.id > Number(lastSeenAnnouncementId)) {
                    lastSeenAnnouncementId = String(latestAnn.id);
                    localStorage.setItem('lastAnnouncementId', lastSeenAnnouncementId);
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification('SNLC Portal Announcement', {
                            body: latestAnn.title + '\n' + latestAnn.content.replace(/<[^>]*>?/gm, '').substring(0, 100),
                            icon: ''
                        });
                    }
                    else {
                        showToast('New Announcement: ' + latestAnn.title, 'success');
                    }
                    if (currentRole === 'student')
                        loadStudentData();
                    else if (currentRole === 'admin')
                        loadAdminData();
                }
            }
        }
        catch { /* silent */ }
    }, 15000);
}

// Connection monitoring for admin portal
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

// Auto-start connection monitoring when admin page loads
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        setTimeout(startConnectionMonitoring, 1000);
        setTimeout(startDataSyncMonitoring, 2000);
    });
}

// Data sync monitoring to detect changes from other admin sessions
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
