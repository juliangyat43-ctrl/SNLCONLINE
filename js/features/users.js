"use strict";

// buildAvatarUrl() removed — was never called anywhere in the codebase.
// Avatar URLs are built inline where needed.

function setUserEditModalAvatar(userId, fullName) {
    const avatarEl = document.getElementById('u-m-avatar');
    if (!avatarEl)
        return;
    const ts = window.userAvatarTimestamps && window.userAvatarTimestamps[userId] ? '?t=' + window.userAvatarTimestamps[userId] : '';
    const initials = getInitials(fullName || '');
    avatarEl.innerHTML = `
        <img src="Profile_pic/${userId}.jpg${ts}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">
        <span style="display:none; align-items:center; justify-content:center; width:100%; height:100%; font-size:20px; font-weight:500;">${initials}</span>`;
}

function bindUserProfilePicDropzone() {
    const z = document.getElementById('u-profile-pic-dropzone');
    if (!z || z.dataset.bound === '1')
        return;
    z.dataset.bound = '1';
    const prevent = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    z.addEventListener('dragenter', prevent);
    z.addEventListener('dragover', (e) => {
        prevent(e);
        z.classList.add('dragover');
    });
    z.addEventListener('dragleave', () => z.classList.remove('dragover'));
    z.addEventListener('drop', (e) => {
        prevent(e);
        z.classList.remove('dragover');
        if (!currentUserEditId)
            return;
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f || !f.type.startsWith('image/')) {
            showToast('Please drop an image file.', 'error');
            return;
        }
        if (f.size > 5 * 1024 * 1024) {
            showToast('Image must be 5MB or smaller.', 'error');
            return;
        }
        const input = document.getElementById('u-pic-input');
        if (!input)
            return;
        const dt = new DataTransfer();
        dt.items.add(f);
        input.files = dt.files;
        uploadProfilePic({ target: input });
    });
    z.addEventListener('click', () => document.getElementById('u-pic-input')?.click());
    z.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            document.getElementById('u-pic-input')?.click();
        }
    });
}

async function removeUserProfilePic() {
    if (!currentUserEditId)
        return;
    try {
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'action=delete_profile_pic&user_id=' + encodeURIComponent(String(currentUserEditId)),
        });
        const data = await res.json();
        if (data.success) {
            showToast('Profile photo removed.', 'success');
            if (!window.userAvatarTimestamps)
                window.userAvatarTimestamps = {};
            const uid = Number(currentUserEditId);
            window.userAvatarTimestamps[uid] = Date.now();
            const user = allUsers.find(u => u.user_id == currentUserEditId);
            setUserEditModalAvatar(uid, user ? user.full_name : '');
            displayAdminUsers(allUsers);
        }
        else {
            showToast(data.error || 'Could not remove photo.', 'error');
        }
    }
    catch {
        showToast('Error removing photo.', 'error');
    }
}

function updateNewUserProfilePicClearUi() {
    const btn = document.getElementById('new-user-clear-pic-btn');
    if (btn)
        btn.style.display = window.pendingNewUserProfilePic ? '' : 'none';
}
function clearNewUserProfilePicSelection() {
    window.pendingNewUserProfilePic = null;
    const picInp = document.getElementById('newUserProfilePic');
    if (picInp)
        picInp.value = '';
    updateNewUserProfilePicClearUi();
}
function onNewUserProfilePicSelected(ev) {
    const f = ev.target.files && ev.target.files[0];
    window.pendingNewUserProfilePic = f || null;
    if (f && f.size > 5 * 1024 * 1024) {
        showToast('Image must be 5MB or smaller.', 'error');
        ev.target.value = '';
        window.pendingNewUserProfilePic = null;
    }
    updateNewUserProfilePicClearUi();
}

async function uploadProfilePic(event) {
    const file = event.target.files[0];
    const inputEl = event.target;
    if (!file || !currentUserEditId) {
        if (inputEl)
            inputEl.value = '';
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image must be 5MB or smaller.', 'error');
        inputEl.value = '';
        return;
    }
    const formData = new FormData();
    formData.append('action', 'upload_profile_pic');
    formData.append('user_id', String(currentUserEditId));
    formData.append('profile_pic', file);
    try {
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();
        if (data.success) {
            if (!window.userAvatarTimestamps)
                window.userAvatarTimestamps = {};
            window.userAvatarTimestamps[Number(currentUserEditId)] = Date.now();
            const nameEl = document.getElementById('u-m-name');
            const name = nameEl ? nameEl.textContent : '';
            setUserEditModalAvatar(currentUserEditId, name);
            showToast('Profile picture uploaded!', 'success');
            displayAdminUsers(allUsers);
        }
        else {
            showToast(data.error || 'Failed to upload image', 'error');
        }
    }
    catch {
        showToast('Error uploading picture', 'error');
    }
    finally {
        if (inputEl)
            inputEl.value = '';
    }
}

// ==================== MANAGE USERS MODAL & GRADES ====================
// ==================== MANAGE USERS MODAL & GRADES ====================

let currentEditPlan = 'monthly';

function openUserEditModal(userId) {
    const user = allUsers.find(u => u.user_id == userId);
    if (!user) return;
    currentUserEditId = userId;
    
    currentEditPlan = String(user.payment_plan || 'monthly').toLowerCase();
    currentGradeQuarter = 1;
    
    setUserEditModalAvatar(userId, user.full_name);
    bindUserProfilePicDropzone();
    document.getElementById('u-m-name').textContent = user.full_name || '';
    document.getElementById('u-m-meta').textContent = ((user.grade && user.section) ? (user.grade + ' - ' + user.section) : user.role.toUpperCase()) + ' · ' + (user.status === 'active' ? 'Active' : 'Inactive');
    
    document.getElementById('u-f-name').value = user.full_name || '';
    document.getElementById('u-f-role').value = user.role || 'student';
    document.getElementById('u-f-grade').value = (user.grade && user.section) ? (user.grade + ' - ' + user.section) : '';
    document.getElementById('u-f-parent').value = user.parent_email || '';
    document.getElementById('u-f-contact').value = user.contact_number || '';
    document.getElementById('u-f-email').value = user.email || '';
    document.getElementById('u-f-rfid').value = user.rfid_uid || '';
    
    const deactBtn = document.getElementById('u-deact-btn');
    if (deactBtn) {
        if (user.status === 'active') {
            deactBtn.textContent = 'Deactivate account';
            deactBtn.style.color = 'var(--red)';
        } else {
            deactBtn.textContent = 'Activate account';
            deactBtn.style.color = 'var(--green)';
        }
    }
    
    const hint = document.querySelector('.open-tabs-hint');
    const tabBar = document.querySelector('#u-view-profile .tab-bar');
    if (user.role === 'student') {
        if(hint) hint.style.display = 'flex';
        if(tabBar) tabBar.style.display = 'flex';
        renderUserPayments(user);
        renderUserGrades(user);
    } else {
        if(hint) hint.style.display = 'none';
        if(tabBar) tabBar.style.display = 'none';
    }
    
    switchUserTabView('profile');
    document.getElementById('userEditOverlay').classList.add('open');
}

function closeUserEditModal() {
    document.getElementById('userEditOverlay').classList.remove('open');
    currentUserEditId = null;
}

// Alias used by the "← Profile" tab button in admin.html
function switchToProfile() { switchUserTabView('profile'); }

function toggleUserModalActive() {
    if(!currentUserEditId) return;
    toggleUserStatus(currentUserEditId);
    setTimeout(() => {
        if(document.getElementById('userEditOverlay').classList.contains('open')) {
            openUserEditModal(currentUserEditId);
        }
    }, 500);
}

function switchUserPlan(plan, el) {
    currentEditPlan = String(plan || 'monthly').toLowerCase();
    document.querySelectorAll('.plan-tab').forEach(t => t.classList.remove('active'));
    if(el) el.classList.add('active');
    const user = allUsers.find(u => u.user_id == currentUserEditId);
    if(user) renderUserPayments(user);
}

function getPlanStructure(plan) {
    if (plan === 'monthly') return [
        { l: 'August', d: 'Aug 5' }, { l: 'September', d: 'Sep 5' }, { l: 'October', d: 'Oct 5' },
        { l: 'November', d: 'Nov 5' }, { l: 'December', d: 'Dec 5' }, { l: 'January', d: 'Jan 5' },
        { l: 'February', d: 'Feb 5' }, { l: 'March', d: 'Mar 5' }, { l: 'April', d: 'Apr 5' }, { l: 'May', d: 'May 5' }
    ];
    if (plan === 'quarterly') return [
        { l: 'Q1 (Aug-Oct)', d: 'Aug 5' }, { l: 'Q2 (Nov-Jan)', d: 'Nov 5' },
        { l: 'Q3 (Feb-Apr)', d: 'Feb 5' }, { l: 'Q4 (May)', d: 'May 5' }
    ];
    return [ { l: 'School Year 2025-2026', d: 'Aug 1' } ];
}

function renderUserPayments(user) {
    const pGrid = document.getElementById('u-payment-grid');
    if (!pGrid) return;
    const planRows = getPlanStructure(currentEditPlan);
    let pd = [];
    try { if (user.payments_data) pd = JSON.parse(user.payments_data); } catch(e){}
    
    pGrid.innerHTML = planRows.map((p, pi) => {
        const isPaid = pd[currentEditPlan] && pd[currentEditPlan][pi] ? pd[currentEditPlan][pi].paid : false;
        return `
        <div class="payment-row">
          <div>
            <div class="payment-label">${p.l}</div>
            <div class="payment-due">Due: ${p.d}</div>
          </div>
          <div class="pay-toggle">
            <span class="paid-badge ${isPaid ? 'paid' : 'unpaid'}">${isPaid ? 'Paid' : 'Unpaid'}</span>
            <button class="toggle-btn" onclick="toggleUserPayment(${pi})">${isPaid ? 'Mark unpaid' : 'Mark paid'}</button>
          </div>
        </div>`;
    }).join('');
}

async function toggleUserPayment(pi) {
    const user = allUsers.find(u => u.user_id == currentUserEditId);
    if (!user) return;
    let pd = {};
    try { if (user.payments_data) pd = JSON.parse(user.payments_data); } catch(e){}
    if (!pd[currentEditPlan]) pd[currentEditPlan] = {};
    if (!pd[currentEditPlan][pi]) pd[currentEditPlan][pi] = { paid: false };
    pd[currentEditPlan][pi].paid = !pd[currentEditPlan][pi].paid;
    
    user.payments_data = JSON.stringify(pd);
    renderUserPayments(user);
    
    // Auto-save payments
    try {
        await apiFetchWithFallback(API_URL + '?action=update_payments_data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.user_id, payments_data: user.payments_data })
        });
    } catch(e) { console.error('Payment save error', e); }
}

async function saveUserEditModal() {
    const user = allUsers.find(u => u.user_id == currentUserEditId);
    if (!user) return;
    
    const role = document.getElementById('u-f-role').value;
    const parentOrGuardian = document.getElementById('u-f-parent').value.trim();
    const emailValue = document.getElementById('u-f-email').value.trim();
    const updateData = {
        user_id: user.user_id,
        username: user.username,
        full_name: document.getElementById('u-f-name').value,
        role: role,
        parent_email: parentOrGuardian || emailValue,
        contact_number: document.getElementById('u-f-contact').value,
        email: emailValue,
        rfid_uid: document.getElementById('u-f-rfid').value.trim(),
        payment_plan: user.payment_plan,
        class_type: user.class_type,
        status: user.status,
        tuition_fee: user.tuition_fee,
        amount_paid: user.amount_paid
    };
    
    const gs = document.getElementById('u-f-grade').value.split('-');
    if (gs.length >= 2) {
        updateData.grade = gs[0].trim();
        updateData.section = gs[1].trim();
    } else {
        updateData.grade = document.getElementById('u-f-grade').value;
        updateData.section = '';
    }
    
    try {
        const postBody = Object.entries({ action: 'update_user', ...updateData })
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)
            .join('&');
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: postBody
        });
        const data = await res.json();
        if (data.success) {
            showToast('User profile updated successfully', 'success');
            loadAdminData(); // refresh
            closeUserEditModal();
        } else {
            showToast(data.error || 'Failed to update user', 'error');
        }
    } catch(e) {
        showToast('Error saving user data', 'error');
    }
}

function switchUserTabView(tab) {
    document.getElementById('u-view-profile').style.display = (tab === 'profile') ? 'flex' : 'none';
    document.getElementById('u-view-tabs').style.display = (tab !== 'profile') ? 'flex' : 'none';
    if(tab !== 'profile') switchUserTab(tab);
}

function switchUserTab(tab) {
    document.getElementById('tab-finance').style.display = (tab === 'finance') ? 'block' : 'none';
    document.getElementById('tab-grades').style.display  = (tab === 'grades')  ? 'block' : 'none';
    const fbtn = document.getElementById('tab-finance-btn');
    const gbtn = document.getElementById('tab-grades-btn');
    if(fbtn) fbtn.classList.toggle('active', tab === 'finance');
    if(gbtn) gbtn.classList.toggle('active', tab === 'grades');
    if (tab === 'finance') {
        const user = allUsers.find(u => u.user_id == currentUserEditId);
        if(user) renderUserPayments(user);
        // Load global tuition setting dynamically
        loadGlobalTuitionForModal();
    }
    if (tab === 'grades') {
        currentGradeQuarter = 1;
        document.querySelectorAll('.quarter-tab').forEach((t, i) => t.classList.toggle('active', i===0));
        const user = allUsers.find(u => u.user_id == currentUserEditId);
        if(user) renderUserGrades(user);
    }
}

async function loadGlobalTuitionForModal() {
    try {
        const res = await apiFetchWithFallback(`${API_URL}?action=get_global_settings`, { method: 'GET' });
        const data = await res.json();
        if (data.success && data.data && data.data.tuition_fee) {
            const tuitionEl = document.getElementById('modalTotalTuition');
            if (tuitionEl) {
                tuitionEl.textContent = '₱' + parseFloat(data.data.tuition_fee).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }
        }
    } catch (err) {
        console.error('Failed to load global tuition:', err);
    }
}

