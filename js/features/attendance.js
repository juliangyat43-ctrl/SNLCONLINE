"use strict";
// Attendance feature — student + admin display, add/edit/delete/filter/export
function displayStudentAttendance(records) {
    const tbody = document.getElementById('studentAttendanceBody');
    if (!records || records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No attendance records yet.</td></tr>';
        document.getElementById('stdPresent').textContent = '0';
        document.getElementById('stdLate').textContent = '0';
        document.getElementById('stdAbsent').textContent = '0';
        document.getElementById('stdRate').textContent = '0%';
        return;
    }
    const present = records.filter(r => r.status === 'Present' || r.status === 'Late').length;
    const late = records.filter(r => r.status === 'Late').length;
    const absent = records.filter(r => r.status === 'Absent').length;
    const rate = records.length > 0 ? Math.round((present / records.length) * 100) : 0;
    document.getElementById('stdPresent').textContent = String(present);
    document.getElementById('stdLate').textContent = String(late);
    document.getElementById('stdAbsent').textContent = String(absent);
    document.getElementById('stdRate').textContent = rate + '%';
    tbody.innerHTML = records.map(r => `<tr>
    <td class="text-mono">${r.date}</td>
    <td>${r.day_name || getDayName(r.date)}</td>
    <td class="text-mono">${r.time_in || '—'}</td>
    <td class="text-mono">${r.time_out || '—'}</td>
    <td><span class="badge badge-${r.status === 'Present' ? 'success' : r.status === 'Late' ? 'warning' : 'danger'}">${r.status}</span></td>
    <td>${r.late_minutes > 0 ? r.late_minutes : '—'}</td>
  </tr>`).join('');
}

function displayAdminAttendance(att) {
    const tbody = document.getElementById('adminAttendanceBody');
    if (!att || att.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No records found.</td></tr>';
        return;
    }
    tbody.innerHTML = att.map(a => `<tr>
    <td class="text-mono">${a.date}</td>
    <td class="text-mono">${a.user_code || a.user_id}</td>
    <td>${escHtml(a.full_name ?? '')}</td>
    <td class="text-mono">${a.time_in || '—'}</td>
    <td class="text-mono">${a.time_out || '—'}</td>
    <td><span class="badge badge-${a.status === 'Present' ? 'success' : a.status === 'Late' ? 'warning' : 'danger'}">${a.status}</span></td>
    <td>${a.late_minutes > 0 ? a.late_minutes : '—'}</td>
    <td><div class="action-btns">
      <button class="btn btn-outline btn-sm" onclick="editAttendanceRecord(${a.id})" title="Edit"></button>
      <button class="btn btn-danger btn-sm" onclick="deleteAttendance(${a.id})" title="Delete"></button>
    </div></td>
  </tr>`).join('');
}

function openAddAttendanceModal() {
    document.getElementById('editAttendanceId').value = '';
    document.getElementById('attendanceModalTitle').textContent = ' Add Attendance Record';
    document.getElementById('attDate').value = getTodayStr();
    document.getElementById('attTimeIn').value = '';
    document.getElementById('attTimeOut').value = '';
    document.getElementById('attStatus').value = 'Present';
    document.getElementById('attLateMin').value = '';
    populateStudentDropdown();
    openModal('attendanceModal');
}
function populateStudentDropdown() {
    const sel = document.getElementById('attStudentSelect');
    const students = allUsers.filter(u => u.role === 'student' && u.status === 'active');
    sel.innerHTML = '<option value="">Select student…</option>' +
        students.map(s => `<option value="${s.user_id}">${escHtml(s.full_name)}</option>`).join('');
}
function editAttendanceRecord(id) {
    const a = allAdminAttendance.find(r => r.id === id);
    if (!a)
        return;
    document.getElementById('editAttendanceId').value = String(id);
    document.getElementById('attendanceModalTitle').textContent = ' Edit Attendance Record';
    populateStudentDropdown();
    document.getElementById('attStudentSelect').value = String(a.user_id);
    document.getElementById('attDate').value = a.date;
    document.getElementById('attTimeIn').value = a.time_in || '';
    document.getElementById('attTimeOut').value = a.time_out || '';
    document.getElementById('attStatus').value = a.status;
    document.getElementById('attLateMin').value = String(a.late_minutes || '');
    openModal('attendanceModal');
}
async function saveAttendance() {
    const studentId = document.getElementById('attStudentSelect').value;
    const date = document.getElementById('attDate').value;
    const status = document.getElementById('attStatus').value;
    const editId = document.getElementById('editAttendanceId').value;
    if (!studentId || !date) {
        showToast('Please select a student and date.', 'error');
        return;
    }
    const payload = {
        user_id: studentId, date, status,
        time_in: document.getElementById('attTimeIn').value || '',
        time_out: document.getElementById('attTimeOut').value || '',
        late_minutes: document.getElementById('attLateMin').value || 0
    };
    if (editId)
        payload.id = editId;
    try {
        const res = await apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=${editId ? 'update_attendance' : 'add_attendance'}&${Object.entries(payload).map(([k, v]) => `${k}=${encodeURIComponent(String(v || ''))}`).join('&')}`
        });
        const data = await res.json();
        if (!data.success) {
            showToast(' ' + (data.error || 'Save failed.'), 'error');
            return;
        }
    }
    catch {
        showToast(' Connection error.', 'error');
        return;
    }
    const student = allUsers.find(u => u.user_id == Number(studentId));
    const newRecord = {
        id: editId ? parseInt(editId) : Date.now(),
        date,
        user_id: parseInt(studentId),
        user_code: student ? `STD-${String(student.user_id).padStart(3, '0')}` : '',
        full_name: student ? student.full_name : 'Unknown',
        time_in: payload.time_in || null,
        time_out: payload.time_out || null,
        status,
        late_minutes: parseInt(String(payload.late_minutes)) || 0
    };
    if (editId) {
        const idx = allAdminAttendance.findIndex(r => r.id == Number(editId));
        if (idx !== -1)
            allAdminAttendance[idx] = newRecord;
    }
    else {
        allAdminAttendance.unshift(newRecord);
    }
    displayAdminAttendance(allAdminAttendance);
    closeModal('attendanceModal');
    showToast(editId ? '✓ Record updated!' : '✓ Record added!', 'success');
}
function deleteAttendance(id) {
    showConfirm('Delete Attendance Record', 'Permanently delete this attendance record?', async () => {
        try {
            const res = await apiFetchWithFallback(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `action=delete_attendance&att_id=${id}`
            });
            if (!(await res.json()).success) {
                showToast(' Failed to delete.', 'error');
                return;
            }
        }
        catch {
            showToast(' Connection error.', 'error');
            return;
        }
        allAdminAttendance = allAdminAttendance.filter(r => r.id !== id);
        displayAdminAttendance(allAdminAttendance);
        showToast('✓ Record deleted.', 'success');
    }, ' Delete');
}
// ─── DEBOUNCED SEARCH ───
let _attendanceSearchTimer = null;
function searchUsersTable() {
    if (_attendanceSearchTimer)
        clearTimeout(_attendanceSearchTimer);
    _attendanceSearchTimer = setTimeout(() => {
        const term = document.getElementById('userSearchInput').value.toLowerCase();
        const role = document.getElementById('userRoleFilter').value;
        const status = document.getElementById('userStatusFilter').value;
        let filtered = allUsers.filter(u => u.full_name.toLowerCase().includes(term) ||
            String(u.user_id).includes(term) ||
            (u.parent_email || '').toLowerCase().includes(term) ||
            (u.username || '').toLowerCase().includes(term));
        if (role !== 'all')
            filtered = filtered.filter(u => u.role === role);
        if (status !== 'all')
            filtered = filtered.filter(u => u.status === status);
        displayAdminUsers(filtered);
    }, 220);
}
async function filterAdminAttendance() {
    const from = document.getElementById('attendanceFromDate').value;
    const to = document.getElementById('attendanceToDate').value;
    if (!from || !to) {
        showToast('Please select both dates.', 'error');
        return;
    }
    try {
        const data = await fetchApiWithFallback(`${API_URL}?action=get_all_attendance&from_date=${from}&to_date=${to}`, { timeoutMs: 12000, retries: 2, expectSuccess: false });
        allAdminAttendance = data.data || [];
        displayAdminAttendance(allAdminAttendance);
    }
    catch {
        showToast(' Failed to filter.', 'error');
    }
}
function exportAttendance() {
    if (!allAdminAttendance.length) {
        showToast('No data to export.', 'error');
        return;
    }
    let csv = 'Date,Student ID,Name,Time In,Time Out,Status,Late (min)\n';
    allAdminAttendance.forEach(a => {
        csv += `"${a.date}","${a.user_code || a.user_id}","${a.full_name}","${a.time_in || ''}","${a.time_out || ''}","${a.status}","${a.late_minutes || 0}"\n`;
    });
    downloadCSV(csv, 'attendance_report.csv');
    showToast('✓ Exported!', 'success');
}
function exportUsersCSV() {
    if (!allUsers.length) {
        showToast('No users to export.', 'error');
        return;
    }
    let csv = 'ID,Name,Username,Role,Email,Grade,Section,Status\n';
    allUsers.forEach(u => {
        csv += `"${u.user_id}","${u.full_name}","${u.username || ''}","${u.role}","${u.parent_email || ''}","${u.grade || ''}","${u.section || ''}","${u.status}"\n`;
    });
    downloadCSV(csv, 'users_list.csv');
    showToast('✓ Exported!', 'success');
}
