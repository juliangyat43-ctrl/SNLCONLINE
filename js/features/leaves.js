"use strict";
// Leave request feature — submitLeave, displayLeaveHistory, showLeaveMsg, clearLeaveForm
function displayLeaveHistory(leaves) {
    const tbody = document.getElementById('leaveHistoryBody');
    if (!tbody)
        return;
    if (!leaves || leaves.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No requests submitted yet.</td></tr>';
        return;
    }
    tbody.innerHTML = leaves.map(r => `<tr>
    <td class="text-mono">${r.submitted_at ? r.submitted_at.split(' ')[0] : '—'}</td>
    <td class="text-mono">${r.start_date}</td>
    <td>${r.leave_type}</td>
    <td><span class="badge badge-${r.status === 'Approved' ? 'success' : r.status === 'Rejected' ? 'danger' : 'warning'}">${r.status}</span></td>
  </tr>`).join('');
}
async function submitLeave() {
    const start = document.getElementById('leaveStartDate').value;
    const end = document.getElementById('leaveEndDate').value;
    const type = document.getElementById('leaveType').value;
    const reason = document.getElementById('leaveReason').value.trim();
    const conf = document.getElementById('leaveConfirm').checked;
    if (!start || !end || !type || !reason || !conf) {
        showLeaveMsg('Please fill all fields and check the confirmation box.', 'error');
        return;
    }
    if (new Date(end) < new Date(start)) {
        showLeaveMsg('End date cannot be before start date.', 'error');
        return;
    }
    try {
        const submitRes = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=submit_leave&user_id=${currentUserId}&start_date=${start}&end_date=${end}&leave_type=${encodeURIComponent(type)}&reason=${encodeURIComponent(reason)}`
        });
        if (!submitRes.ok)
            throw new Error(`HTTP ${submitRes.status}`);
        const data = await submitRes.json();
        if (data.success) {
            showLeaveMsg('✓ Leave request submitted! Status: Pending review.', 'success');
            showToast('✓ Leave request submitted!', 'success');
            clearLeaveForm();
            const lr = await fetchApi(`${API_URL}?action=get_leave_history&user_id=${currentUserId}`);
            displayLeaveHistory(lr.data || []);
            return;
        }
        showLeaveMsg('Error: ' + (data.error || 'Submission failed.'), 'error');
    }
    catch {
        showLeaveMsg('Connection error. Please try again.', 'error');
    }
}
function showLeaveMsg(msg, type) {
    const el = document.getElementById('leaveMessage');
    el.textContent = msg;
    el.style.cssText = `display:block; padding:.75rem 1rem; border-radius:8px; font-size:.85rem; font-weight:500;
    background:${type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)'};
    color:${type === 'success' ? 'var(--success)' : 'var(--danger)'};`;
    if (type === 'success')
        setTimeout(() => { el.style.display = 'none'; }, 5000);
}
function clearLeaveForm() {
    ['leaveStartDate', 'leaveEndDate', 'leaveReason'].forEach(id => (document.getElementById(id).value = ''));
    document.getElementById('leaveType').value = '';
    document.getElementById('leaveConfirm').checked = false;
}
