"use strict";
// Feature: User Data Export/Import
// Complete backup and restore of all user data

// ─── EXPORT ALL USERS ────────────────────────────────────────────────────────

async function exportAllUsers() {
    if (!confirm('Export all user data?\n\nThis will create a JSON file with:\n• All user info\n• RFID UIDs\n• Grades data\n• Payment data\n• Profile photos\n\nThis may take a moment...')) {
        return;
    }

    showToast('Exporting user data...', 'info');

    try {
        const res = await apiFetchWithFallback(`${API_URL}?action=export_all_users`, {
            method: 'POST'
        });
        const data = await res.json();

        if (data.success) {
            showToast(`Exported ${data.data.total_users} users successfully!`, 'success');
            
            // Download the file
            const downloadUrl = `${API_URL}?action=download_user_export&filename=${data.data.filename}`;
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = data.data.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            showToast(data.error || data.message || 'Export failed', 'error');
        }
    } catch (err) {
        showToast('Error exporting user data', 'error');
        console.error('exportAllUsers error:', err);
    }
}
window.exportAllUsers = exportAllUsers;

// ─── IMPORT USERS ────────────────────────────────────────────────────────────

function showImportModal() {
    document.getElementById('importModal').classList.add('open');
    document.getElementById('importFileInput').value = '';
    document.getElementById('importMode').value = 'update';
}
window.showImportModal = showImportModal;

function closeImportModal() {
    document.getElementById('importModal').classList.remove('open');
}
window.closeImportModal = closeImportModal;

async function importUsers() {
    const fileInput = document.getElementById('importFileInput');
    const mode = document.getElementById('importMode').value;

    if (!fileInput.files || fileInput.files.length === 0) {
        showToast('Please select a JSON file to import', 'error');
        return;
    }

    const file = fileInput.files[0];
    if (!file.name.endsWith('.json')) {
        showToast('Please select a valid JSON file', 'error');
        return;
    }

    // Validate JSON before uploading
    try {
        const text = await file.text();
        const json = JSON.parse(text);
        
        if (!json.users || !Array.isArray(json.users)) {
            showToast('Invalid JSON format: missing "users" array', 'error');
            return;
        }
        
        console.log(`JSON validated: ${json.users.length} users found`);
    } catch (err) {
        showToast('Invalid JSON file: ' + err.message, 'error');
        return;
    }

    if (!confirm(`Import user data from ${file.name}?\n\nMode: ${mode === 'update' ? 'Update existing users' : 'Skip existing users'}\n\nThis will modify the database. Continue?`)) {
        return;
    }

    showToast('Importing user data...', 'info');

    try {
        const formData = new FormData();
        formData.append('import_file', file);
        formData.append('import_mode', mode);
        
        // Add CSRF token if available
        if (typeof csrfToken !== 'undefined' && csrfToken) {
            formData.append('csrf_token', csrfToken);
        }
        
        // Add session token if available
        const sessionToken = localStorage.getItem('sessionToken');
        if (sessionToken) {
            formData.append('session_token', sessionToken);
        }

        const res = await fetch(`${API_URL}?action=import_users`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
            // Don't set Content-Type header - browser will set it with boundary
        });
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        const data = await res.json();

        if (data.success) {
            const summary = `Import completed!\n\n` +
                `• Imported: ${data.data.imported} new users\n` +
                `• Updated: ${data.data.updated} existing users\n` +
                `• Skipped: ${data.data.skipped} users\n` +
                `• Total: ${data.data.total_processed} processed`;
            
            if (data.data.errors && data.data.errors.length > 0) {
                console.warn('Import errors:', data.data.errors);
            }
            
            showToast('Import successful!', 'success');
            alert(summary);
            
            closeImportModal();
            
            // Reload users
            if (typeof loadAllUsers === 'function') {
                await loadAllUsers();
            }
        } else {
            showToast(data.error || data.message || 'Import failed', 'error');
            console.error('Import error:', data);
        }
    } catch (err) {
        showToast('Error importing user data: ' + err.message, 'error');
        console.error('importUsers error:', err);
    }
}
window.importUsers = importUsers;

// ─── EXPORT SINGLE USER ──────────────────────────────────────────────────────

async function exportSingleUser(userId, userName) {
    if (!confirm(`Export data for ${userName}?`)) {
        return;
    }

    try {
        const downloadUrl = `${API_URL}?action=export_single_user&user_id=${userId}`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `user_${userId}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        showToast('User data exported', 'success');
    } catch (err) {
        showToast('Error exporting user data', 'error');
        console.error('exportSingleUser error:', err);
    }
}
window.exportSingleUser = exportSingleUser;

// ─── LIST EXPORTS ────────────────────────────────────────────────────────────

async function listUserExports() {
    try {
        const res = await apiFetchWithFallback(`${API_URL}?action=list_user_exports`, {
            method: 'GET'
        });
        const data = await res.json();

        if (data.success) {
            return data.data.exports;
        } else {
            console.error('Failed to list exports:', data.message);
            return [];
        }
    } catch (err) {
        console.error('listUserExports error:', err);
        return [];
    }
}
window.listUserExports = listUserExports;
