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

// ─── NAVIGATION CONSTANTS ───
const studentNav = [
    { id: 'student-dashboard', label: 'Dashboard',       icon: '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>' },
    { id: 'student-grades',    label: 'Grades',           icon: '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>' },
    { id: 'student-balances',  label: 'Balances',         icon: '<svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>' },
    { id: 'student-leave',     label: 'Leave Request',    icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>' },
    { id: 'student-calendar',  label: 'School Calendar',  icon: '<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg>' },
    { id: 'student-contact',   label: 'Contact Admin',    icon: '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>' },
];
const adminNav = [
    { id: 'admin-dashboard',   label: 'Dashboard',        icon: '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>' },
    { id: 'admin-users',       label: 'Manage Users',     icon: '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' },
    { id: 'admin-financials',  label: 'Financials',       icon: '<svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>' },
    { id: 'admin-attendance',  label: 'Attendance',       icon: '<svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>' },
    { id: 'admin-leaves',      label: 'Leave Requests',   icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>' },
    { id: 'admin-enrollments', label: 'Enrollments',      icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' },
    { id: 'admin-reports',     label: 'Reports',          icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' },
    { id: 'admin-rfid',        label: 'RFID System',      icon: '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>' },
    { id: 'admin-calendar',    label: 'School Calendar',  icon: '<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg>' },
    { id: 'admin-console',     label: 'System Console',   icon: '<svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-2h11v2zm0-4H4v-2h11v2zm0-4H4V8h11v2zm5 6h-4v-2h4v2zm0-4h-4V8h4v2z"/></svg>' },
];
// ─── TOASTS ───
const TOAST_ICONS = { success: '', error: '', info: '', warning: '' };
function showToast(msg, type = 'success', duration = 3500) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = TOAST_ICONS[type] || '';
    const text = document.createElement('span');
    text.textContent = msg;
    t.appendChild(icon);
    t.appendChild(text);
    c.appendChild(t);
    setTimeout(() => {
        t.classList.add('hiding');
        setTimeout(() => t.remove(), 230);
    }, duration);
}
// ─── MODALS ───
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('modal-overlay'))
        closeModal(target.id);
});
function showConfirm(title, message, onConfirm, btnLabel = 'Confirm') {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const btn = document.getElementById('confirmBtn');
    btn.textContent = btnLabel;
    btn.onclick = () => { closeModal('confirmModal'); if (onConfirm)
        onConfirm(); };
    openModal('confirmModal');
}
// ─── PAGE NAVIGATION ───
function showLandingPage() { window.location.href = 'index.html'; }
function showEnrollPage() { window.location.href = 'enroll.html'; }
function showLoginPage() { window.location.href = 'login.html'; }
function showMainApp() {
    const role = DataCenter.getCurrentRole() || localStorage.getItem('currentRole');
    window.location.href = (role === 'admin') ? 'admin.html' : (role === 'teacher' ? 'teacher.html' : 'parent.html');
}
function updateEnrollSteps(step) {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById('enrollStep' + i);
        const ind = document.getElementById('stepIndicator' + i);
        if (el)
            el.style.display = (i === step) ? 'block' : 'none';
        if (ind) {
            ind.className = 'enroll-step';
            if (i < step)
                ind.classList.add('done');
            else if (i === step)
                ind.classList.add('active');
            else
                ind.classList.add('todo');
            const numEl = ind.querySelector('.enroll-step-num');
            if (i < step) {
                numEl.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8l3.5 3.5 6.5-6.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            }
            else {
                numEl.innerHTML = String(i);
            }
        }
    }
}
function nextEnrollStep(currentStep) {
    if (currentStep === 1) {
        const name = document.getElementById('enrollName').value.trim();
        const dob = document.getElementById('enrollDOB').value;
        const gender = document.getElementById('enrollGender').value;
        if (!name || !dob || !gender) {
            showToast('Please fill out all Personal fields', 'error');
            return;
        }
    }
    else if (currentStep === 2) {
        const grade = document.getElementById('enrollGrade').value;
        if (!grade) {
            showToast('Please select a grade level', 'error');
            return;
        }
    }
    else if (currentStep === 3) {
        const guard = document.getElementById('enrollGuardianName').value.trim();
        const rel = document.getElementById('enrollRelationship').value;
        const email = document.getElementById('enrollEmail').value.trim();
        const contact = document.getElementById('enrollContact').value.trim();
        const address = document.getElementById('enrollAddress').value.trim();
        const password = document.getElementById('enrollPassword').value.trim();
        const passwordConfirm = document.getElementById('enrollPasswordConfirm').value.trim();
        
        if (!guard || !rel || !email || !contact || !address) {
            showToast('Please fill out all Contact & Address fields', 'error');
            return;
        }
        
        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showToast('Please enter a valid email address', 'error');
            return;
        }
        
        // Validate password
        if (!password || password.length < 6) {
            showToast('Password must be at least 6 characters long', 'error');
            return;
        }
        
        if (password !== passwordConfirm) {
            showToast('Passwords do not match', 'error');
            return;
        }
        
        // Populate Review Step
        const reviewHtml = `
      <strong>Student Name:</strong> ${document.getElementById('enrollName').value.trim()}<br>
      <strong>Date of Birth:</strong> ${document.getElementById('enrollDOB').value}<br>
      <strong>Gender:</strong> ${document.getElementById('enrollGender').value}<br><br>
      <strong>Grade Level:</strong> ${document.getElementById('enrollGrade').value}<br><br>
      <strong>Guardian / Parent:</strong> ${document.getElementById('enrollGuardianName').value.trim()} (${document.getElementById('enrollRelationship').value})<br>
      <strong>Email:</strong> ${document.getElementById('enrollEmail').value.trim()}<br>
      <strong>Contact Number:</strong> +63 ${document.getElementById('enrollContact').value.trim()}<br>
      <strong>Address:</strong> ${document.getElementById('enrollAddress').value.trim()}<br><br>
      <strong>Login Email:</strong> ${email}<br>
      <strong>Password:</strong> ${'•'.repeat(password.length)}
    `;
        document.getElementById('enrollReviewBox').innerHTML = reviewHtml;
    }
    updateEnrollSteps(currentStep + 1);
}
function prevEnrollStep(currentStep) {
    updateEnrollSteps(currentStep - 1);
}
// ─── ROLE SWITCH ───
function switchRole(role) {
    currentRole = role;
    document.getElementById('tabStudent').classList.toggle('active', role === 'student');
    document.getElementById('tabAdmin').classList.toggle('active', role === 'admin');
    document.getElementById('loginError').style.display = 'none';
}
// ─── LOGIN ───
let isLoggingIn = false; // Prevent multiple simultaneous login requests
async function doLogin() {
    // Prevent multiple simultaneous login attempts
    if (isLoggingIn) {
        // Login already in progress, ignoring duplicate request
        return;
    }
    isLoggingIn = true;
    
    // Clear browser cache to prevent stale data issues
    try {
        if (typeof clearBrowserCache === 'function') {
            clearBrowserCache();
        }
    } catch (e) {
        console.warn('Cache clear function not available:', e);
    }
    
    if (window.location.protocol === 'file:') {
        showLoginError('You are opening this file locally (file://). Please use a local web server (like XAMPP or VSCode Live Server) for login to work properly.');
        isLoggingIn = false;
        return;
    }
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    if (!username || !password) {
        showLoginError('Please enter both username and password.');
        isLoggingIn = false;
        return;
    }
    const btn = document.getElementById('loginBtn');
    btn.innerHTML = ' Verifying…';
    btn.disabled = true;
    
    try {
        const requestBody = `action=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&role=${currentRole}`;
        
        // Use apiFetchWithFallback for consistency (login is CSRF-exempt on server)
        const response = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: requestBody
        }, {
            candidates: LOGIN_API_FALLBACKS,
            timeoutMs: 10000,
            retries: 0
        });
        
        const raw = await response.text();
        const data = JSON.parse(raw);
        
        if (!response.ok) {
            const message = data?.error || data?.message || `Login failed (HTTP ${response.status})`;
            showLoginError(message);
            btn.innerHTML = 'Sign In →';
            btn.disabled = false;
            isLoggingIn = false;
            return;
        }
        
        if (data.success && data.data) {
            const normalizedRole = data.data.role || currentRole;
            const normalizedUser = DataCenter.normalizeUserRecord(data.data);
            DataCenter.setSession(normalizedUser, normalizedRole);
            rememberApiBase(API_URL);
            // Store the session token in localStorage (BUG-1 FIX: must match read location)
            if (data.data.session_token) {
                try { localStorage.setItem('sessionToken', data.data.session_token); } catch {}
            }
            // Store CSRF token
            if (data.data.csrf_token) {
                csrfToken = data.data.csrf_token;
                try { localStorage.setItem('csrfToken', csrfToken); } catch {}
            }
            // Don't reset isLoggingIn here - we're redirecting anyway
            window.location.href = (normalizedRole === 'admin') ? 'admin.html' : (normalizedRole === 'teacher' ? 'teacher.html' : 'parent.html');
            return;
        }
        
        // Server responded with error
        showLoginError(data.error || data.message || 'Invalid username or password.');
        btn.innerHTML = 'Sign In →';
        btn.disabled = false;
        isLoggingIn = false;
    }
    catch (err) {
        showLoginError('Cannot connect to server. Please contact IT Support.');
        console.error(err);
        btn.innerHTML = 'Sign In →';
        btn.disabled = false;
        isLoggingIn = false;
    }
}
function showLoginError(msg) {
    const e = document.getElementById('loginError');
    e.textContent = ' ' + msg;
    e.style.display = 'block';
    setTimeout(() => { e.style.display = 'none'; }, 6000);
}
function completeLogin() {
    DataCenter.setSession(currentUser, currentRole);
    syncLegacyStateFromDataCenter();
    const loginPage = document.getElementById('loginPage');
    if (loginPage)
        loginPage.style.display = 'none';
    const enrollPage = document.getElementById('enrollPage');
    if (enrollPage)
        enrollPage.style.display = 'none';
    const mainApp = document.getElementById('mainApp');
    if (mainApp)
        mainApp.style.display = 'flex';
    const isAdmin = currentRole === 'admin';
    const isTeacher = currentRole === 'teacher';
    const displayName = (currentUser && currentUser.full_name) ? currentUser.full_name : 'User';
    const navTitleSub = document.getElementById('navTitleSub');
    if (navTitleSub)
        navTitleSub.textContent = isAdmin ? 'Admin System' : (isTeacher ? 'Teacher Portal' : 'Parent System');
    const navTitle = document.getElementById('navTitle');
    if (navTitle)
        navTitle.textContent = 'Dashboard';
    const navUserName = document.getElementById('navUserName');
    if (navUserName)
        navUserName.textContent = displayName;
    const navUserRole = document.getElementById('navUserRole');
    if (navUserRole)
        navUserRole.textContent = isAdmin ? 'Administrator' : (isTeacher ? 'Teacher' : 'Parent/Student');
    const navAvatar = document.getElementById('navAvatar');
    if (navAvatar)
        navAvatar.textContent = displayName.substring(0, 2).toUpperCase();
    if (!isAdmin && !isTeacher) {
        const leaveEl = document.getElementById('leaveStudentName');
        if (leaveEl)
            leaveEl.value = displayName;
        const profileEl = document.getElementById('profileName');
        if (profileEl)
            profileEl.textContent = displayName;
        const welcomeEl = document.getElementById('studentWelcome');
        if (welcomeEl)
            welcomeEl.textContent = `Welcome back, Parent of ${displayName.split(' ')[0]}! `;
    }
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) {
        console.error('navLinks element not found');
        return;
    }
    navLinks.innerHTML = '';
    const mobileBottomNav = document.getElementById('mobileBottomNav');
    if (mobileBottomNav) mobileBottomNav.innerHTML = '';

    const defaultPage = (isAdmin || isTeacher) ? 'admin-dashboard' : 'student-dashboard';
    let savedPage = localStorage.getItem('currentPage');

    // Compute Teacher Nav based on permissions
    let activeNav = studentNav;
    if (isAdmin) {
        activeNav = adminNav;
    } else if (isTeacher) {
        // Teacher portal uses the admin views
        const perms = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
        activeNav = [
            { id: 'admin-dashboard', label: 'Dashboard', icon: '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>' }
        ];
        if (perms.includes('users')) activeNav.push({ id: 'admin-users', label: 'Manage Users', icon: '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' });
        if (perms.includes('financials')) activeNav.push({ id: 'admin-financials', label: 'Financials', icon: '<svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>' });
        if (perms.includes('attendance')) activeNav.push({ id: 'admin-attendance', label: 'Attendance', icon: '<svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>' });
        if (perms.includes('leaves')) activeNav.push({ id: 'admin-leaves', label: 'Leave Requests', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>' });
        if (perms.includes('enrollments')) activeNav.push({ id: 'admin-enrollments', label: 'Enrollments', icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' });
        if (perms.includes('rfid')) activeNav.push({ id: 'admin-rfid', label: 'RFID System', icon: '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>' });
        if (perms.includes('announcements')) activeNav.push({ id: 'admin-calendar', label: 'School Calendar', icon: '<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg>' });
    }

    const allowedPages = activeNav.map((nav) => nav.id);
    if (savedPage && !allowedPages.includes(savedPage)) {
        savedPage = null;
    }
    const targetPage = savedPage || defaultPage;

    activeNav.forEach((l) => {
        const btn = document.createElement('button');
        btn.className = 's-item';
        btn.dataset.pageId = l.id;
        if (l.id === targetPage) btn.classList.add('active');
        btn.innerHTML = l.icon + '<span>' + l.label + '</span>';
        btn.onclick = () => {
            showPage(l.id);
            setActiveNav(btn);

            // Safety: if the sidebar exists and was opened previously, close it on nav click
            const sb = document.querySelector('.sidebar');
            if (sb) sb.classList.remove('open');
        };
        navLinks.appendChild(btn);

        if (mobileBottomNav) {
            const mbtn = document.createElement('button');
            mbtn.className = 'mnav-item';
            mbtn.dataset.pageId = l.id;
            if (l.id === targetPage) mbtn.classList.add('active');
            mbtn.innerHTML = l.icon + '<span class="mnav-label">' + l.label + '</span>';
            mbtn.onclick = () => {
                showPage(l.id);
                setActiveNavByPage(l.id);
            };
            mobileBottomNav.appendChild(mbtn);
        }
    });
    
    showPage(targetPage);
    if ('Notification' in window && Notification.permission !== 'denied' && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
    if (typeof startNotificationPoller === 'function') {
        startNotificationPoller();
    }
    checkConnection();
}
function doLogout() {
    showConfirm('Logout', 'Are you sure you want to sign out?', async () => {
        try {
            await apiFetchWithFallback(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=logout'
            });
        } catch (err) {
            console.error('Logout API call failed:', err);
        }
        
        // Clear session data
        DataCenter.clearSession();
        csrfToken = '';  // Reset in-memory CSRF token
        
        // Clear localStorage
        localStorage.removeItem('currentPage');
        localStorage.removeItem('sessionToken');   // BUG-1 FIX: clear from localStorage
        localStorage.removeItem('csrfToken');
        
        window.location.href = 'login.html';
    }, 'Sign Out');
}
function setActiveNav(btn) {
    document.querySelectorAll('#navLinks .s-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}
function setActiveNavByPage(pageId) {
    document.querySelectorAll('#navLinks .s-item, #mobileBottomNav .mnav-item').forEach(b => {
        b.classList.toggle('active', b.dataset.pageId === pageId);
    });
}
// ─── NAVIGATION ───
const PAGE_TITLES = {
    'student-dashboard': 'Dashboard',
    'student-grades':    'Grades',
    'student-balances':  'Balances',
    'student-leave':     'Leave Request',
    'student-calendar':  'School Calendar',
    'student-contact':   'Contact Admin',
    'admin-dashboard':   'Dashboard',
    'admin-users':       'Manage Users',
    'admin-financials':  'Manage Financials',
    'admin-attendance':  'Attendance Records',
    'admin-leaves':      'Leave Requests',
    'admin-enrollments': 'Pre-Enrollments',
    'admin-reports':     'Reports',
    'admin-rfid':        'RFID System',
    'admin-calendar':    'School Calendar',
    'admin-console':     'System Console',
};
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const t = document.getElementById('page-' + id);
    if (t) {
        t.classList.add('active');
        t.classList.remove('fade-in');
        void t.offsetWidth;
        t.classList.add('fade-in');
    }
    const titleEl = document.getElementById('navTitle');
    if (titleEl && PAGE_TITLES[id])
        titleEl.textContent = PAGE_TITLES[id];
    localStorage.setItem('currentPage', id);
    setActiveNavByPage(id);

    const bottomNav = document.getElementById('mobileBottomNav');
    if (bottomNav) {
        const active = bottomNav.querySelector('.mnav-item.active');
        if (active) {
            try { active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch {}
        }
    }

    // Auto-reload enrollments when admin navigates to that tab
    if (id === 'admin-enrollments' && typeof loadEnrollments === 'function') {
        loadEnrollments();
    }
    
    // Auto-load system console when navigating to that tab
    if (id === 'admin-console' && typeof loadSystemConsole === 'function') {
        loadSystemConsole();
    }
}
// ─── CONNECTION CHECK ───
