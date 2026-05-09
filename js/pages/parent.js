"use strict";
async function loadStudentData() {
    const apiCalls = [
        { name: 'get_student_attendance', url: `${API_URL}?action=get_student_attendance&user_id=${currentUserId}` },
        { name: 'get_student_profile', url: `${API_URL}?action=get_student_profile&user_id=${currentUserId}` },
        { name: 'get_leave_history', url: `${API_URL}?action=get_leave_history&user_id=${currentUserId}` },
        { name: 'get_announcements', url: `${API_URL}?action=get_announcements` }
    ];

    const results = {};
    const errors = [];

    // Load all endpoints in parallel (was sequential — caused compounding latency)
    const settled = await Promise.allSettled(
        apiCalls.map(call => fetchApi(call.url).then(data => ({ name: call.name, data })))
    );

    settled.forEach((r, i) => {
        const name = apiCalls[i].name;
        if (r.status === 'fulfilled') {
            results[name] = { status: 'fulfilled', value: r.value.data };
        } else {
            results[name] = { status: 'rejected', reason: r.reason };
            errors.push({
                endpoint: name,
                error: r.reason?.message || 'Unknown error'
            });
            console.error(`Failed to load ${name}:`, r.reason);
        }
    });

    // Process successful results
    const attData = results.get_student_attendance?.status === 'fulfilled' ? results.get_student_attendance.value : null;
    const profileDataRes = results.get_student_profile?.status === 'fulfilled' ? results.get_student_profile.value : null;
    const leaveDataRes = results.get_leave_history?.status === 'fulfilled' ? results.get_leave_history.value : null;
    const annData = results.get_announcements?.status === 'fulfilled' ? results.get_announcements.value : null;

    allAttendanceRecords = attData?.data || attData || [];
    const profileData = profileDataRes?.data || profileDataRes || null;
    const leaveData = leaveDataRes?.data || leaveDataRes || [];
    allAnnouncements = annData?.data || annData || [];

    displayStudentAttendance(allAttendanceRecords);
    if (profileData) {
        if (currentUser) {
            currentUser.grades_data = profileData.profile.grades_data;
            currentUser.grades_locked = profileData.profile.grades_locked;
        }
        renderParentGrades();
        displayStudentBalances(profileData);
    }

    // Update parent portal avatar with profile picture
    if (currentUserId && currentUser && currentUser.full_name) {
        updateParentAvatar(currentUserId, currentUser.full_name);
    }

    displayLeaveHistory(leaveData);
    displayAnnouncements();

    // Cache whatever we successfully loaded with timestamp for expiry
    if (attData)
        CacheManager.setWithTimestamp(CACHE_KEYS.attendance, allAttendanceRecords, CACHE_TIMESTAMP_KEYS.attendance);
    if (profileDataRes)
        CacheManager.setWithTimestamp(CACHE_KEYS.profile, profileData || {}, CACHE_TIMESTAMP_KEYS.profile);
    if (leaveDataRes)
        CacheManager.setWithTimestamp(CACHE_KEYS.leaves, leaveData, CACHE_TIMESTAMP_KEYS.leaves);
    if (annData)
        CacheManager.setWithTimestamp(CACHE_KEYS.announcements, allAnnouncements, CACHE_TIMESTAMP_KEYS.announcements);

    // Show specific error messages for failed endpoints
    if (errors.length > 0) {
        const errorMessages = errors.map(e => `${e.endpoint}: ${e.error}`).join('\n');
        console.error('Parent data loading errors:', errorMessages);

        // Try to use cached data for failed endpoints
        let usedCache = false;
        try {
            if (!attData) {
                const cachedAttendance = CacheManager.getWithExpiry(CACHE_KEYS.attendance, CACHE_TIMESTAMP_KEYS.attendance);
                if (cachedAttendance && cachedAttendance.length) {
                    allAttendanceRecords = cachedAttendance;
                    displayStudentAttendance(cachedAttendance);
                    usedCache = true;
                }
            }
            if (!profileDataRes) {
                const cachedProfile = CacheManager.getWithExpiry(CACHE_KEYS.profile, CACHE_TIMESTAMP_KEYS.profile);
                if (cachedProfile && Object.keys(cachedProfile).length > 0) {
                    if (currentUser && cachedProfile.profile) {
                        currentUser.grades_data = cachedProfile.profile.grades_data;
                        currentUser.grades_locked = cachedProfile.profile.grades_locked;
                    }
                    renderParentGrades();
                    displayStudentBalances(cachedProfile);
                    usedCache = true;
                }
            }
            if (!leaveDataRes) {
                const cachedLeaves = CacheManager.getWithExpiry(CACHE_KEYS.leaves, CACHE_TIMESTAMP_KEYS.leaves);
                if (cachedLeaves && cachedLeaves.length) {
                    displayLeaveHistory(cachedLeaves);
                    usedCache = true;
                }
            }
            if (!annData) {
                const cachedAnnouncements = CacheManager.getWithExpiry(CACHE_KEYS.announcements, CACHE_TIMESTAMP_KEYS.announcements);
                if (cachedAnnouncements && cachedAnnouncements.length) {
                    allAnnouncements = cachedAnnouncements;
                    displayAnnouncements();
                    usedCache = true;
                }
            }
        } catch (cacheError) {
            console.error('Cache fallback error:', cacheError);
        }

        if (errors.length === apiCalls.length && !usedCache) {
            // All endpoints failed and no cache available
            const errMessage = errors[0].error;
            showToast(` Failed to load your data (${errMessage}). Please refresh or contact support.`, 'error', 0);
            const body = document.getElementById('studentAttendanceBody');
            if (body) {
                body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--danger); padding:2rem;">Error loading records. Please refresh or contact IT support.</td></tr>';
            }
        } else if (usedCache) {
            // Some endpoints failed but cache available
            const failedEndpoints = errors.map(e => e.endpoint).join(', ');
            showToast(` Server issue detected. Using cached data for: ${failedEndpoints}. Data may be outdated.`, 'warning', 8000);
        } else {
            // Some endpoints failed but no cache for those
            const failedEndpoints = errors.map(e => e.endpoint).join(', ');
            showToast(` Partial data loaded. Failed: ${failedEndpoints}. Check console for details.`, 'warning', 8000);
        }
    }
}
// displayStudentAttendance() moved to attendance.js
// displayStudentGrades() removed — dead code, system uses renderParentGrades() from grades.js
/**
 * Calculates the outstanding balance.
 * @param {number} tuitionFee
 * @param {number} miscFee
 * @param {number} amountPaid
 * @returns {number}
 */
function calcBalance(tuitionFee, miscFee, amountPaid) {
    return Math.max(0, tuitionFee + miscFee - amountPaid);
}
window.calcBalance = calcBalance;

function displayStudentBalances(data) {
    if (!data) return;
    const p = data.profile || {};
    const f = data.financial || {};
    
    document.getElementById('balancesProgramTitle').textContent = p.grade ? p.grade + ' - ' + (p.section || '') : 'Elementary School';
    
    const tuition = toNumber(f.tuition_fee ?? 13000, 0);
    const miscFee = toNumber(f.misc_fee ?? 0, 0);
    const plan = (f.payment_plan || p.payment_plan || 'monthly').toLowerCase();
    
    let paymentsCount = 10;
    let intervalMonths = 1;
    if (plan === 'quarterly') { paymentsCount = 4; intervalMonths = 3; }
    if (plan === 'annually') { paymentsCount = 1; intervalMonths = 12; }
    const amountPerPayment = tuition / paymentsCount;

    let pd = {};
    try { if (p.payments_data) pd = JSON.parse(p.payments_data); } catch(e){}
    const currentPlanPd = pd[plan] || {};

    let paid = toNumber(f.amount_paid, 0);
    // Fall back to per-installment tracking when amount_paid is not yet maintained.
    if (paid <= 0) {
        paid = 0;
    for (let i = 0; i < paymentsCount; i++) {
        if (currentPlanPd[i] && currentPlanPd[i].paid) paid += amountPerPayment;
    }
    }

    const balance = calcBalance(tuition, miscFee, paid);
    
    document.getElementById('oneSnlcTuitionFee').textContent = formatCurrency(tuition);

    // Misc fee line item — update if element exists, otherwise skip gracefully
    const miscFeeEl = document.getElementById('oneSnlcMiscFee');
    if (miscFeeEl) miscFeeEl.textContent = formatCurrency(miscFee);

    document.getElementById('oneSnlcGrossAssessment').textContent = formatCurrency(tuition + miscFee);
    document.getElementById('oneSnlcTotalPayments').textContent = formatCurrency(paid);
    document.getElementById('oneSnlcFinalBalance').textContent = formatCurrency(balance);
    document.getElementById('oneSnlcTotalBalanceTop').textContent = formatCurrency(balance);
    
    const paymentsBody = document.getElementById('oneSnlcPaymentsBody');
    if (paid > 0) {
        paymentsBody.innerHTML = `<tr><td class="desc-col">${getTodayStr()} | Payments Applied</td><td class="amount-col">${formatCurrency(paid)}</td></tr>`;
    } else {
        paymentsBody.innerHTML = `<tr><td class="desc-col">No payments made</td><td class="amount-col">${formatCurrency(0)}</td></tr>`;
    }
    
    const scheduleBody = document.getElementById('oneSnlcPaymentScheduleBody');
    let scheduleHtml = '';
    const startDate = new Date('2026-06-10T00:00:00');
    
    for (let i = 0; i < paymentsCount; i++) {
        const d = new Date(startDate);
        d.setMonth(d.getMonth() + (i * intervalMonths));
        const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const isPaid = currentPlanPd[i] && currentPlanPd[i].paid;
        const statusBadge = isPaid ? '<span class="badge" style="background:var(--green-soft); color:var(--green); font-size:10px; padding:2px 6px;">PAID</span>' : '<span class="badge" style="background:var(--red-soft); color:var(--red); font-size:10px; padding:2px 6px;">UNPAID</span>';
        scheduleHtml += `<tr><td class="desc-col">${dateStr} &nbsp; ${statusBadge}</td><td class="amount-col">${formatCurrency(amountPerPayment)}</td></tr>`;
    }
    scheduleBody.innerHTML = scheduleHtml;
    document.getElementById('oneSnlcScheduleTotal').textContent = formatCurrency(tuition);
}
// Leave functions moved to leaves.js:
// - displayLeaveHistory()
// - submitLeave()
// - showLeaveMsg()
// - clearLeaveForm()

function submitContactMessage() {
    const subject = document.getElementById('contactSubject').value;
    const message = document.getElementById('contactMessage').value.trim();
    const priority = document.getElementById('contactPriority').value;
    if (!subject || !message) {
        setContactResult(' Please select a subject and write a message.', false);
        return;
    }
    sentMessages.unshift({ subject, message, priority, time: new Date().toLocaleString() });
    setContactResult('✓ Message sent! The admin will respond within 1–2 school days.', true);
    renderSentMessages();
    showToast('✓ Message sent to admin!', 'success');
    clearContactForm();
}
function setContactResult(msg, success) {
    const r = document.getElementById('contactResult');
    r.textContent = msg;
    r.style.cssText = `display:block; padding:.75rem; border-radius:8px; font-size:.85rem;
    background:${success ? 'var(--success-bg)' : 'var(--warning-bg)'};
    color:${success ? 'var(--success)' : 'var(--warning)'};`;
    if (success)
        setTimeout(() => { r.style.display = 'none'; }, 5000);
}
function renderSentMessages() {
    const el = document.getElementById('sentMessagesBody');
    if (!sentMessages.length) {
        el.textContent = 'No messages sent yet.';
        return;
    }
    el.innerHTML = sentMessages.map(m => `<div style="padding:.6rem 0; border-bottom:1px solid var(--border);">
    <div style="display:flex; justify-content:space-between; margin-bottom:.2rem;">
      <span style="font-weight:600; color:var(--text-dark);">${escHtml(m.subject)}</span>
      <span class="badge badge-${m.priority === 'urgent' ? 'danger' : 'info'}">${m.priority}</span>
    </div>
    <div style="color:var(--text-light); font-size:.78rem;">${m.time}</div>
  </div>`).join('');
}
function clearContactForm() {
    document.getElementById('contactSubject').value = '';
    document.getElementById('contactMessage').value = '';
    document.getElementById('contactPriority').value = 'normal';
}
function printReceipt() {
    const name = document.getElementById('profileName').textContent ?? '';
    const id = document.getElementById('profileId').textContent ?? '';
    const tuition = document.getElementById('profileTuition').textContent ?? '';
    const paid = document.getElementById('profilePaid').textContent ?? '';
    const balance = document.getElementById('profileBalance').textContent ?? '';
    const w = window.open('', '_blank', 'width=500,height=600');
    w.document.write(`<html><head><title>Receipt – SNLC</title>
<link rel="stylesheet" href="style.css">
</head><body>
<h2> SNLC Payment Receipt</h2>
<p style="text-align:center;color:#888;font-size:.85rem;">St. Nazareth Learning Center<br>SY 2026–2027</p><hr>
<div class="row"><span>Student Name</span><strong>${name}</strong></div>
<div class="row"><span>Student ID</span><strong>${id}</strong></div>
<div class="row"><span>Tuition Fee</span><span>${tuition}</span></div>
<div class="row"><span>Amount Paid</span><span style="color:green;">${paid}</span></div>
<div class="row total"><span>Balance Due</span><span style="color:#7B0D1E;">${balance}</span></div>
<div class="footer">Printed: ${new Date().toLocaleString()}<br>This is a system-generated receipt.</div>
<script>window.print();<\/script></body></html>`);
}
function showUpdateContactModal() { openModal('updateContactModal'); }
async function saveContactInfo() {
    const email = document.getElementById('updateEmail').value.trim();
    const phone = document.getElementById('updatePhone').value.trim();
    const address = document.getElementById('updateAddress').value.trim();
    if (!email && !phone && !address) {
        showToast('Please fill in at least one field.', 'error');
        return;
    }
    try {
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=update_contact&user_id=${currentUserId}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}&address=${encodeURIComponent(address)}`
        });
        const data = await res.json();
        if (data.success) {
            closeModal('updateContactModal');
            showToast('✓ Contact information updated!', 'success');
        }
        else {
            showToast(data.error || 'Failed to update.', 'error');
        }
    }
    catch {
        showToast('Connection error.', 'error');
    }
}
function filterAttendance(filter) {
    if (!allAttendanceRecords.length)
        return;
    const now = new Date();
    let filtered = allAttendanceRecords;
    if (filter === 'week')
        filtered = allAttendanceRecords.filter(r => new Date(r.date) >= new Date(now.getTime() - 7 * 864e5));
    if (filter === 'month')
        filtered = allAttendanceRecords.filter(r => new Date(r.date) >= new Date(now.getFullYear(), now.getMonth(), 1));
    displayStudentAttendance(filtered);
}
function exportStudentAttendanceCSV() {
    if (!allAttendanceRecords.length) {
        showToast('No data to export.', 'error');
        return;
    }
    let csv = 'Date,Day,Time In,Time Out,Status,Late (min)\n';
    allAttendanceRecords.forEach(r => {
        csv += `"${r.date}","${r.day_name || getDayName(r.date)}","${r.time_in || ''}","${r.time_out || ''}","${r.status}","${r.late_minutes || 0}"\n`;
    });
    downloadCSV(csv, 'my_attendance.csv');
}


// ─── UTILITIES ───
// escHtml, getTodayStr, getDayName, toNumber, formatCurrency, downloadCSV
// are defined in js/core/data.js and available on all pages.

function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

/**
 * Updates the #navAvatar element in the parent portal topbar to show the
 * user's profile picture with an initials fallback.
 */
function updateParentAvatar(userId, fullName) {
    const avatarEl = document.getElementById('navAvatar');
    if (!avatarEl) return;
    const parts = (fullName || '').trim().split(/\s+/);
    const initials = parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (fullName || '??').substring(0, 2).toUpperCase();
    avatarEl.innerHTML = `<img src="Profile_pic/${userId}.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%;">${initials}</span>`;
}
window.updateParentAvatar = updateParentAvatar;
