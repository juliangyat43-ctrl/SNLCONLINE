"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// enroll.js  —  Public enrollment form & Admin-side enrollment management
// ─────────────────────────────────────────────────────────────────────────────

// Store enrollment objects by ID so we never pass JSON through HTML attributes
const _enrollmentCache = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ENROLLMENT FORM FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// ── Step management ──────────────────────────────────────────────────────────
function enrollGoToStep(step) {
  for (let i = 1; i <= 4; i++) {
    const panel = document.getElementById('enrollStep' + i);
    const ind   = document.getElementById('stepIndicator' + i);
    if (panel) panel.style.display = (i === step) ? 'block' : 'none';
    if (ind) {
      ind.className = 'enroll-step ' + (i < step ? 'done' : i === step ? 'active' : 'todo');
      const num = ind.querySelector('.enroll-step-num');
      if (num) {
        num.innerHTML = i < step
          ? '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8l3.5 3.5 6.5-6.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : String(i);
      }
    }
  }
  // Scroll form to top on step change
  const formSide = document.querySelector('.enroll-form-side');
  if (formSide) formSide.scrollTop = 0;
}

function enrollBack(currentStep) {
  enrollGoToStep(currentStep - 1);
}

function enrollNext(currentStep) {
  // ── Validate current step ──
  if (currentStep === 1) {
    const name   = document.getElementById('enrollName').value.trim();
    const dob    = document.getElementById('enrollDOB').value;
    const gender = document.getElementById('enrollGender').value;
    if (!name)   { showToast('Please enter the student\'s full name.', 'error'); return; }
    if (!dob)    { showToast('Please enter the date of birth.', 'error'); return; }
    if (!gender) { showToast('Please select a gender.', 'error'); return; }
  }

  else if (currentStep === 2) {
    const grade = document.getElementById('enrollGrade').value;
    if (!grade) { showToast('Please select a grade level.', 'error'); return; }
  }

  else if (currentStep === 3) {
    const guardian = document.getElementById('enrollGuardianName').value.trim();
    const rel      = document.getElementById('enrollRelationship').value;
    const email    = document.getElementById('enrollEmail').value.trim();
    const contact  = document.getElementById('enrollContact').value.trim();
    const address  = document.getElementById('enrollAddress').value.trim();
    const pass     = document.getElementById('enrollPassword').value;
    const passConf = document.getElementById('enrollPasswordConfirm').value;

    if (!guardian) { showToast('Please enter the guardian\'s name.', 'error'); return; }
    if (!rel)      { showToast('Please select the relationship.', 'error'); return; }
    if (!email)    { showToast('Please enter an email address.', 'error'); return; }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk)  { showToast('Please enter a valid email address.', 'error'); return; }

    if (!contact)  { showToast('Please enter a contact number.', 'error'); return; }
    if (!address)  { showToast('Please enter the home address.', 'error'); return; }
    if (!pass || pass.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
    if (pass !== passConf)        { showToast('Passwords do not match.', 'error'); return; }

    // Populate review box
    document.getElementById('enrollReviewBox').innerHTML = `
      <strong>Student Name:</strong> ${escHtml(document.getElementById('enrollName').value.trim())}<br>
      <strong>Date of Birth:</strong> ${escHtml(document.getElementById('enrollDOB').value)}<br>
      <strong>Gender:</strong> ${escHtml(document.getElementById('enrollGender').value)}<br>
      <strong>Grade Level:</strong> ${escHtml(document.getElementById('enrollGrade').value)}<br><br>
      <strong>Guardian / Parent:</strong> ${escHtml(guardian)} (${escHtml(rel)})<br>
      <strong>Email:</strong> ${escHtml(email)}<br>
      <strong>Contact Number:</strong> +63 ${escHtml(contact)}<br>
      <strong>Address:</strong> ${escHtml(address)}<br><br>
      <strong>Login Email:</strong> ${escHtml(email)}<br>
      <strong>Password:</strong> ${'•'.repeat(pass.length)}
    `;
  }

  enrollGoToStep(currentStep + 1);
}

// ── Phone Number Formatting ──────────────────────────────────────────────────────
function formatPhoneNumber(input) {
  // Remove all non-digit characters
  let value = input.value.replace(/\D/g, '');
  
  // Limit to 11 digits (9XX XXX XXXX format)
  if (value.length > 11) {
    value = value.slice(0, 11);
  }
  
  // Format as 9XX XXX XXXX
  if (value.length >= 7) {
    value = value.slice(0, 3) + ' ' + value.slice(3, 6) + ' ' + value.slice(6);
  } else if (value.length >= 3) {
    value = value.slice(0, 3) + ' ' + value.slice(3);
  }
  
  input.value = value;
}

// ── Toggle Other Relationship Field ────────────────────────────────────────────
function toggleOtherRelationship(value) {
  const wrapper = document.getElementById('otherRelationshipWrapper');
  const otherInput = document.getElementById('enrollRelationshipOther');
  
  if (value === 'Other') {
    wrapper.style.display = 'flex';
    otherInput.required = true;
    otherInput.focus();
  } else {
    wrapper.style.display = 'none';
    otherInput.required = false;
    otherInput.value = '';
  }
}

// ── Submit Enrollment ───────────────────────────────────────────────────────────
async function enrollSubmit() {
  const email    = document.getElementById('enrollEmail').value.trim();
  const pass     = document.getElementById('enrollPassword').value;
  const passConf = document.getElementById('enrollPasswordConfirm').value;

  // Final safety validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Invalid email address.', 'error'); return;
  }
  if (!pass || pass.length < 6) {
    showToast('Password must be at least 6 characters.', 'error'); return;
  }
  if (pass !== passConf) {
    showToast('Passwords do not match.', 'error'); return;
  }

  const payload = {
    action:        'submit_enrollment',
    fullName:      document.getElementById('enrollName').value.trim(),
    username:      email,
    gradeLevel:    document.getElementById('enrollGrade').value,
    parentEmail:   email,
    contactNumber: document.getElementById('enrollContact').value.trim(),
    address:       document.getElementById('enrollAddress').value.trim(),
    dob:           document.getElementById('enrollDOB').value,
    gender:        document.getElementById('enrollGender').value,
    guardian_name: document.getElementById('enrollGuardianName').value.trim(),
    relationship:  document.getElementById('enrollRelationship').value === 'Other' 
                   ? document.getElementById('enrollRelationshipOther').value.trim() 
                   : document.getElementById('enrollRelationship').value,
    password:      pass
  };

  const btn = document.getElementById('enrollSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Submitting...';
  showLoading('Submitting enrollment...');

  try {
    const data = await fetchApiWithFallback(API_URL, {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      timeoutMs: 15000,
      retries: 2,
      expectSuccess: false
    });

    if (data && data.success) {
      // Clear all fields
      ['enrollName','enrollDOB','enrollGuardianName','enrollEmail',
       'enrollContact','enrollAddress','enrollPassword','enrollPasswordConfirm',
       'enrollRelationshipOther']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      ['enrollGender','enrollGrade','enrollRelationship']
        .forEach(id => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
      
      // Hide other relationship field
      document.getElementById('otherRelationshipWrapper').style.display = 'none';

      enrollGoToStep(1);

      // Show credentials in success modal
      const credsDiv = document.getElementById('enrollSuccessCreds');
      if (credsDiv) {
        credsDiv.innerHTML = `
          <div style="background:#FFFBF0;border:2px solid #C9A227;border-radius:12px;padding:18px;margin-bottom:16px;">
            <div style="font-size:13px;font-weight:800;color:#7a5c00;text-align:center;margin-bottom:14px;letter-spacing:.5px;">
              🔐 YOUR LOGIN CREDENTIALS
            </div>
            <div style="background:#fff;border-radius:8px;padding:14px;border:1px solid #e8d89a;">
              <div style="margin-bottom:12px;">
                <div style="font-size:10px;color:#999;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;">Email / Username</div>
                <div style="font-size:15px;font-weight:700;font-family:monospace;padding:10px 12px;background:#f8f8f8;border-radius:6px;border:1px solid #ddd;word-break:break-all;color:#7B0D1E;">${escHtml(email)}</div>
              </div>
              <div>
                <div style="font-size:10px;color:#999;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;">Password</div>
                <div style="font-size:15px;font-weight:700;font-family:monospace;padding:10px 12px;background:#f8f8f8;border-radius:6px;border:1px solid #ddd;color:#7B0D1E;">${escHtml(pass)}</div>
              </div>
            </div>
            <div style="margin-top:12px;font-size:12px;color:#888;text-align:center;line-height:1.6;">
              ⚠️ <strong>Screenshot or write these down!</strong><br>
              Use these to log in once your enrollment is approved.
            </div>
          </div>
        `;
      }

      // Show success modal
      const modal = document.getElementById('enrollSuccessModal');
      if (modal) { modal.style.display = 'flex'; }

    } else {
      const errMsg = (data && (data.error || data.message)) || 'Enrollment failed. Please try again.';
      showToast(errMsg, 'error');
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection error';
    showToast(`Enrollment error: ${msg}`, 'error');
    console.error('enrollSubmit error:', err);
  } finally {
    hideLoading();
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Submit Application';
  }
}

// ── Success modal close ───────────────────────────────────────────────────────
function enrollSuccessClose() {
  const modal = document.getElementById('enrollSuccessModal');
  if (modal) modal.style.display = 'none';
  window.location.href = 'login.html';
}

// Close modal when clicking backdrop (only on enroll.html page)
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('enrollSuccessModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === this) enrollSuccessClose();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-SIDE ENROLLMENT MANAGEMENT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// ── HTML escape utility ───────────────────────────────────────────────────────
// escHtml() is defined in js/core/data.js (loaded before this file on admin.html).
// This is a safe no-op redeclaration — same logic, no conflict.

// ── Load & render enrollment list ─────────────────────────────────────────────
async function loadEnrollments() {
    const tbody = document.getElementById('adminEnrollmentsBody');
    if (!tbody) return; // not on admin page

    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading enrollments…</td></tr>';

    try {
        const data = await fetchApiWithFallback(
            `${API_URL}?action=get_enrollments`,
            { timeoutMs: 12000, retries: 2, expectSuccess: false }
        );

        // Update pending badge in nav if it exists
        _updateEnrollmentBadge(data.data || []);

        if (!data.success || !data.data || data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No enrollments found.</td></tr>';
            return;
        }

        // Cache all enrollment objects by ID for safe retrieval
        _enrollmentCache.clear();
        data.data.forEach(e => _enrollmentCache.set(e.enrollment_id, e));

        tbody.innerHTML = data.data.map(e => {
            const statusClass = e.status === 'Approved' ? 'success'
                              : e.status === 'Rejected' ? 'danger'
                              : 'warning';

            const actionBtns = e.status === 'Pending'
                ? `<button class="btn btn-success btn-sm" onclick="approveEnrollment(${e.enrollment_id})">✓ Approve</button>
                   <button class="btn btn-danger btn-sm"  onclick="rejectEnrollment(${e.enrollment_id})">✕ Reject</button>`
                : '';

            return `<tr>
                <td style="white-space:nowrap;font-size:.82rem;">${escHtml(e.created_at)}</td>
                <td style="font-weight:600;">${escHtml(e.full_name)}</td>
                <td style="font-size:.82rem;">${escHtml(e.username || e.parent_email || '—')}</td>
                <td>${escHtml(e.grade_level || '—')}</td>
                <td><span class="badge badge-${statusClass}">${escHtml(e.status)}</span></td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-outline btn-sm" onclick="showEnrollmentDetails(${e.enrollment_id})">ℹ️ Info</button>
                    ${actionBtns}
                    <button class="btn btn-danger btn-sm" onclick="deleteEnrollment(${e.enrollment_id})">🗑️ Remove</button>
                </td>
            </tr>`;
        }).join('');

    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--danger);">Failed to load enrollments: ${escHtml(msg)}</td></tr>`;
        showToast(`Failed to load enrollments (${msg})`, 'error');
        console.error('loadEnrollments error:', err);
    }
}

// ── Update pending badge on nav / alert banner ────────────────────────────────
function _updateEnrollmentBadge(enrollments) {
    const pending = enrollments.filter(e => e.status === 'Pending').length;

    // Update alert banner on dashboard
    const banner = document.getElementById('adminAlertBanner');
    const bannerText = document.getElementById('adminAlertText');
    if (banner && bannerText) {
        if (pending > 0) {
            bannerText.textContent = `${pending} pending enrollment${pending > 1 ? 's' : ''} require your attention.`;
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
    }

    // Update pending count label inside the enrollments card header
    const countEl = document.getElementById('enrollmentPendingCount');
    if (countEl) {
        countEl.textContent = pending > 0 ? ` (${pending} pending)` : '';
    }
}

// ── Approve ───────────────────────────────────────────────────────────────────
async function approveEnrollment(id) {
    showConfirm(
        'Approve Enrollment',
        'Approve this enrollment and create a student account with the parent\'s chosen password?',
        async () => {
            try {
                const data = await fetchApiWithFallback(API_URL, {
                    init: {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'approve_enrollment', id })
                    },
                    timeoutMs: 15000,
                    retries: 0,
                    expectSuccess: false
                });

                if (data.success) {
                    showToast(data.message ?? 'Approved! Parent can now log in.', 'success', 5000);
                    loadEnrollments();
                } else {
                    showToast(data.error ?? data.message ?? 'Approval failed.', 'error');
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Connection error';
                showToast(`Approval error: ${msg}`, 'error');
                console.error('approveEnrollment error:', err);
            }
        }
    );
}

// ── Reject ────────────────────────────────────────────────────────────────────
async function rejectEnrollment(id) {
    showConfirm(
        'Reject Enrollment',
        'Are you sure you want to reject this enrollment?',
        async () => {
            try {
                const data = await fetchApiWithFallback(API_URL, {
                    init: {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'reject_enrollment', id })
                    },
                    timeoutMs: 12000,
                    retries: 0,
                    expectSuccess: false
                });

                if (data.success) {
                    showToast(data.message ?? 'Enrollment rejected.', 'success');
                    loadEnrollments();
                } else {
                    showToast(data.error ?? data.message ?? 'Rejection failed.', 'error');
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Connection error';
                showToast(`Rejection error: ${msg}`, 'error');
                console.error('rejectEnrollment error:', err);
            }
        }
    );
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteEnrollment(id) {
    showConfirm(
        'Remove Enrollment',
        'Permanently delete this enrollment request? This cannot be undone.',
        async () => {
            try {
                const data = await fetchApiWithFallback(API_URL, {
                    init: {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'delete_enrollment', id })
                    },
                    timeoutMs: 12000,
                    retries: 0,
                    expectSuccess: false
                });

                if (data.success) {
                    showToast(data.message ?? 'Enrollment deleted.', 'success');
                    loadEnrollments();
                } else {
                    showToast(data.error ?? data.message ?? 'Delete failed.', 'error');
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Connection error';
                showToast(`Delete error: ${msg}`, 'error');
                console.error('deleteEnrollment error:', err);
            }
        }
    );
}

// ── Show enrollment details modal ─────────────────────────────────────────────
function showEnrollmentDetails(id) {
    // Retrieve from cache — no JSON parsing from HTML attributes
    const enrollment = _enrollmentCache.get(id) || _enrollmentCache.get(Number(id));

    if (!enrollment) {
        showToast('Enrollment data not found. Please refresh the list.', 'error');
        return;
    }

    const modal   = document.getElementById('enrollmentDetailsModal');
    const content = document.getElementById('enrollmentDetailsContent');

    if (!modal || !content) {
        alert(
            `Student: ${enrollment.full_name}\n` +
            `Email: ${enrollment.parent_email || 'N/A'}\n` +
            `Password: ${enrollment.chosen_password || 'N/A'}\n` +
            `DOB: ${enrollment.dob || 'N/A'}\n` +
            `Gender: ${enrollment.gender || 'N/A'}\n` +
            `Grade: ${enrollment.grade_level || 'N/A'}\n` +
            `Guardian: ${enrollment.guardian_name || 'N/A'} (${enrollment.relationship || 'N/A'})\n` +
            `Contact: ${enrollment.contact_number || 'N/A'}\n` +
            `Address: ${enrollment.address || 'N/A'}\n` +
            `Status: ${enrollment.status}`
        );
        return;
    }

    const statusClass = enrollment.status === 'Approved' ? 'success'
                      : enrollment.status === 'Rejected' ? 'danger'
                      : 'warning';

    content.innerHTML = `
        <div class="profile-row">
            <span class="key">Student Name:</span>
            <span class="val">${escHtml(enrollment.full_name)}</span>
        </div>
        <div class="profile-row">
            <span class="key">Email / Username:</span>
            <span class="val">${escHtml(enrollment.parent_email || enrollment.username || 'N/A')}</span>
        </div>
        <div class="profile-row">
            <span class="key">Chosen Password:</span>
            <span class="val" style="font-family:monospace;background:var(--bg);padding:4px 8px;border-radius:4px;">${escHtml(enrollment.chosen_password || 'N/A')}</span>
        </div>
        <div class="profile-row">
            <span class="key">Date of Birth:</span>
            <span class="val">${escHtml(enrollment.dob || 'N/A')}</span>
        </div>
        <div class="profile-row">
            <span class="key">Gender:</span>
            <span class="val">${escHtml(enrollment.gender || 'N/A')}</span>
        </div>
        <div class="profile-row">
            <span class="key">Grade Level:</span>
            <span class="val">${escHtml(enrollment.grade_level || 'N/A')}</span>
        </div>
        <div class="profile-row">
            <span class="key">Guardian:</span>
            <span class="val">${escHtml(enrollment.guardian_name || 'N/A')} (${escHtml(enrollment.relationship || 'N/A')})</span>
        </div>
        <div class="profile-row">
            <span class="key">Contact Number:</span>
            <span class="val">${escHtml(enrollment.contact_number || 'N/A')}</span>
        </div>
        <div class="profile-row">
            <span class="key">Address:</span>
            <span class="val">${escHtml(enrollment.address || 'N/A')}</span>
        </div>
        <div class="profile-row">
            <span class="key">Status:</span>
            <span class="val"><span class="badge badge-${statusClass}">${escHtml(enrollment.status)}</span></span>
        </div>
        <div class="profile-row">
            <span class="key">Submitted:</span>
            <span class="val">${escHtml(enrollment.created_at)}</span>
        </div>
    `;

    openModal('enrollmentDetailsModal');
}
