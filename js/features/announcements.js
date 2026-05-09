"use strict";
function displayAnnouncements() {
    const c = document.getElementById('dashboardAnnouncementsBody');
    if (!c)
        return;
    if (!allAnnouncements.length) {
        c.innerHTML = '<div style="padding:1rem; text-align:center; color:var(--text-light); font-size:.85rem;">No recent announcements.</div>';
        return;
    }
    c.innerHTML = allAnnouncements.map(a => `
    <div style="padding:.65rem 0; border-bottom:1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; margin-bottom:.3rem;">
        <span style="font-weight:600; color:var(--text-dark);">${escHtml(a.title)}</span>
        <span class="badge badge-${a.type === 'warning' ? 'warning' : a.type === 'success' ? 'success' : 'info'}">${a.type.toUpperCase()}</span>
      </div>
      <div style="color:var(--text-light); font-size:.85rem; margin-bottom:.3rem; line-height:1.4;">${escHtml(a.content)}</div>
      <div style="color:var(--muted); font-size:.75rem;">${new Date(a.created_at).toLocaleDateString()}</div>
    </div>
  `).join('');
}
function openPostAnnouncementModal() {
    document.getElementById('annTitle').value = '';
    document.getElementById('annContent').value = '';
    document.getElementById('annType').value = 'info';
    openModal('announcementModal');
}
async function submitAnnouncement() {
    const title = document.getElementById('annTitle').value.trim();
    const content = document.getElementById('annContent').value.trim();
    const type = document.getElementById('annType').value;
    if (!title || !content) {
        showToast('Please enter title and message', 'error');
        return;
    }
    try {
        const r = await apiFetchWithFallback(API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `action=add_announcement&title=${encodeURIComponent(title)}&content=${encodeURIComponent(content)}&type=${type}`
        });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        if ((await r.json()).success) {
            showToast('Announcement posted!', 'success');
            closeModal('announcementModal');
            const refreshed = await fetchApi(`${API_URL}?action=get_announcements`);
            allAnnouncements = refreshed.data || [];
            displayAnnouncements();
        }
        else {
            showToast('Error posting', 'error');
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Connection error';
        showToast(`Connection error (${message})`, 'error');
    }
}

// -------------------------------------------------------------------
// Auto-load logic for Announcements and Financials
// -------------------------------------------------------------------
window.addEventListener('load', () => {
    // Announcements are visible on the student dashboard; fetch for both roles.
    if (document.getElementById('dashboardAnnouncementsBody')) {
        (async () => {
            try {
                const data = (typeof fetchApiWithFallback === 'function')
                    ? await fetchApiWithFallback(`${API_URL}?action=get_announcements`, { timeoutMs: 12000, retries: 2, expectSuccess: false })
                    : await (await fetch(`${API_URL}?action=get_announcements`)).json();
                if (data.success) {
                    allAnnouncements = data.data || [];
                    if (typeof displayAnnouncements === 'function')
                        displayAnnouncements();
                }
            }
            catch (e) {
                console.error('Error fetching announcements', e);
            }
        })();
    }
    // Financials UI only matters for admin; only load if the grid exists.
    if (document.getElementById('financialsGrid')) {
        (async () => {
            try {
                const data = (typeof fetchApiWithFallback === 'function')
                    ? await fetchApiWithFallback(`${API_URL}?action=get_all_users`, { timeoutMs: 12000, retries: 2, expectSuccess: false })
                    : await (await fetch(`${API_URL}?action=get_all_users`)).json();
                if (data.success) {
                    allUsers = data.data || [];
                    if (typeof renderFinancialsList === 'function')
                        renderFinancialsList();
                }
            }
            catch (e) {
                console.error('Error loading users for financials', e);
            }
        })();
    }
});
