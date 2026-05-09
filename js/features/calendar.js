"use strict";
// Feature: school-management-enhancements
// CalendarManager (admin CRUD) + CalendarViewer (parent read-only)
// Shared renderCalendarGrid helper

// ─── SHARED GRID RENDERER ───────────────────────────────────────────────────

// Registry so cell clicks can call back into the right handler without
// serialising a function reference into an inline onclick string.
const _calClickRegistry = {};

/**
 * Renders a 7-column Sunday–Saturday calendar grid into the given container.
 *
 * @param {string}        containerId  — id of the <div> to render into
 * @param {number}        year
 * @param {number}        month        — 1-based
 * @param {Map}           eventsMap    — Map<'YYYY-MM-DD', {id, title, type}>
 * @param {Function|null} onCellClick  — called with dateStr; null = read-only
 */
function renderCalendarGrid(containerId, year, month, eventsMap, onCellClick) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Register the click handler so inline onclick can reach it safely
    if (onCellClick) {
        _calClickRegistry[containerId] = onCellClick;
    } else {
        delete _calClickRegistry[containerId];
    }

    // Update month label
    const labelId = containerId === 'adminCalendarGrid' ? 'calMonthLabel' : 'calViewerMonthLabel';
    const labelEl = document.getElementById(labelId);
    if (labelEl) {
        const monthNames = ['January','February','March','April','May','June',
                            'July','August','September','October','November','December'];
        labelEl.textContent = monthNames[month - 1] + ' ' + year;
    }

    // Type badge styles
    const typeBadge = {
        'Holiday':     'background:#fee2e2;color:#dc2626;',
        'Academic':    'background:#dbeafe;color:#2563eb;',
        'School Event':'background:#dcfce7;color:#16a34a;',
    };

    // Day-of-week headers
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">';
    days.forEach(d => {
        html += `<div style="text-align:center;font-size:11px;font-weight:600;color:var(--text-mid);padding:6px 0;">${d}</div>`;
    });

    const firstDay   = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const today      = new Date().toISOString().slice(0, 10);

    // Empty leading cells
    for (let i = 0; i < firstDay; i++) {
        html += '<div style="min-height:72px;"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const mm      = String(month).padStart(2, '0');
        const dd      = String(day).padStart(2, '0');
        const dateStr = `${year}-${mm}-${dd}`;
        const event   = eventsMap.get(dateStr);
        const isToday = dateStr === today;

        const cellStyle = [
            'min-height:72px',
            'border:1px solid var(--border,#e5e7eb)',
            'border-radius:8px',
            'padding:6px 8px',
            'font-size:12px',
            'transition:box-shadow .15s',
            isToday
                ? 'background:var(--maroon-soft,#fdf2f4);border-color:var(--maroon,#7B0D1E);'
                : 'background:var(--white,#fff)',
            onCellClick ? 'cursor:pointer;' : '',
        ].join(';');

        // Use registry-based onclick — no function serialisation
        const clickAttr = onCellClick
            ? `onclick="_calClickRegistry['${containerId}'] && _calClickRegistry['${containerId}']('${dateStr}')"`
            : '';

        let eventHtml = '';
        if (event) {
            const badge = typeBadge[event.type] || 'background:#f3f4f6;color:#374151;';
            eventHtml = `
                <div style="margin-top:4px;">
                    <div style="font-size:11px;font-weight:600;color:var(--text,#111);
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                         title="${escHtml(event.title)}">${escHtml(event.title)}</div>
                    <span style="display:inline-block;margin-top:2px;font-size:10px;
                                 padding:1px 6px;border-radius:99px;${badge}">
                        ${escHtml(event.type)}
                    </span>
                </div>`;
        } else if (onCellClick) {
            // Admin: show a faint "+" hint on hover
            eventHtml = `<div style="margin-top:6px;font-size:18px;color:var(--border,#ccc);
                                     text-align:center;line-height:1;">+</div>`;
        }

        html += `
            <div style="${cellStyle}" ${clickAttr}
                 onmouseover="if(this.style.cursor==='pointer')this.style.boxShadow='0 2px 8px rgba(0,0,0,.10)'"
                 onmouseout="this.style.boxShadow=''">
                <div style="font-weight:${isToday ? '700' : '500'};
                            color:${isToday ? 'var(--maroon,#7B0D1E)' : 'var(--text,#111)'};">
                    ${day}
                </div>
                ${eventHtml}
            </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

// ─── CALENDAR MANAGER (Admin) ────────────────────────────────────────────────

let _cm = {
    year:        new Date().getFullYear(),
    month:       new Date().getMonth() + 1,
    events:      new Map(),   // Map<'YYYY-MM-DD', {id, event_date, title, type}>
    containerId: null,
    modalId:     null,
    initialized: false,
};

const CalendarManager = {
    init(containerId, modalId) {
        _cm.containerId = containerId;
        _cm.modalId     = modalId;
        _cm.initialized = true;
        CalendarManager.loadMonth(_cm.year, _cm.month);
    },

    loadMonth(year, month) {
        _cm.year  = year;
        _cm.month = month;
        _cm.events.clear();

        const mm = String(month).padStart(2, '0');
        apiFetchWithFallback(`${API_URL}?action=get_calendar_events&year=${year}&month=${mm}`, {
            method: 'GET'
        }).then(res => res.json()).then(data => {
            if (data.success && Array.isArray(data.data)) {
                data.data.forEach(ev => {
                    _cm.events.set(ev.event_date, ev);
                });
            }
            CalendarManager._render();
        }).catch(err => {
            console.error('CalendarManager.loadMonth error:', err);
            CalendarManager._render();
        });
    },

    _render() {
        renderCalendarGrid(
            _cm.containerId,
            _cm.year,
            _cm.month,
            _cm.events,
            (dateStr) => CalendarManager.openEditor(dateStr)
        );
    },

    prevMonth() {
        let { year, month } = _cm;
        month--;
        if (month < 1) { month = 12; year--; }
        CalendarManager.loadMonth(year, month);
    },

    nextMonth() {
        let { year, month } = _cm;
        month++;
        if (month > 12) { month = 1; year++; }
        CalendarManager.loadMonth(year, month);
    },

    openEditor(dateStr) {
        const idEl    = document.getElementById('calEventId');
        const dateEl  = document.getElementById('calEventDate');
        const titleEl = document.getElementById('calEventTitle');
        const typeEl  = document.getElementById('calEventType');
        const delBtn  = document.getElementById('calDeleteBtn');
        const titleH  = document.getElementById('calModalTitle');

        if (!idEl || !dateEl || !titleEl || !typeEl) return;

        const existing = dateStr ? _cm.events.get(dateStr) : null;

        if (existing) {
            idEl.value    = String(existing.id);
            dateEl.value  = existing.event_date;
            titleEl.value = existing.title;
            typeEl.value  = existing.type;
            if (delBtn) delBtn.style.display = '';
            if (titleH) titleH.textContent = 'Edit Event';
        } else {
            idEl.value    = '';
            dateEl.value  = dateStr || '';
            titleEl.value = '';
            typeEl.value  = 'Academic';
            if (delBtn) delBtn.style.display = 'none';
            if (titleH) titleH.textContent = 'Add Event';
        }

        if (_cm.modalId) openModal(_cm.modalId);
    },

    saveEvent() {
        const id      = document.getElementById('calEventId')?.value || '';
        const date    = document.getElementById('calEventDate')?.value || '';
        const title   = (document.getElementById('calEventTitle')?.value || '').trim();
        const type    = document.getElementById('calEventType')?.value || '';

        if (!date) { showToast('Please select a date', 'error'); return; }
        if (!title) { showToast('Event title is required', 'error'); return; }
        if (title.length > 200) { showToast('Title must be 200 characters or fewer', 'error'); return; }

        const isEdit = id !== '';
        const action = isEdit ? 'update_calendar_event' : 'add_calendar_event';
        let body = `action=${action}&title=${encodeURIComponent(title)}&type=${encodeURIComponent(type)}`;
        if (isEdit) {
            body += `&id=${encodeURIComponent(id)}`;
        } else {
            body += `&event_date=${encodeURIComponent(date)}`;
        }

        apiFetchWithFallback(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        }).then(res => res.json()).then(data => {
            if (data.success) {
                showToast(isEdit ? 'Event updated!' : 'Event added!', 'success');
                if (_cm.modalId) closeModal(_cm.modalId);
                // Update in-memory map
                const eventDate = isEdit ? (_cm.events.get(date)?.event_date || date) : date;
                const newId = isEdit ? parseInt(id) : (data.data?.id || Date.now());
                // For edit, find the existing entry by id
                if (isEdit) {
                    _cm.events.forEach((ev, key) => {
                        if (ev.id == parseInt(id)) {
                            _cm.events.set(key, { ...ev, title, type });
                        }
                    });
                } else {
                    _cm.events.set(date, { id: newId, event_date: date, title, type });
                }
                CalendarManager._render();
            } else {
                showToast(data.error || data.message || 'Failed to save event', 'error');
            }
        }).catch(err => {
            showToast('Error saving event: ' + (err.message || err), 'error');
        });
    },

    deleteEvent(id) {
        if (!id) return;
        showConfirm('Delete Event', 'Permanently delete this calendar event?', () => {
            apiFetchWithFallback(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `action=delete_calendar_event&id=${encodeURIComponent(id)}`,
            }).then(res => res.json()).then(data => {
                if (data.success) {
                    showToast('Event deleted', 'success');
                    if (_cm.modalId) closeModal(_cm.modalId);
                    // Remove from map
                    _cm.events.forEach((ev, key) => {
                        if (ev.id == parseInt(id)) _cm.events.delete(key);
                    });
                    CalendarManager._render();
                } else {
                    showToast(data.error || data.message || 'Failed to delete event', 'error');
                }
            }).catch(err => {
                showToast('Error deleting event: ' + (err.message || err), 'error');
            });
        }, 'Delete');
    },
};
window.CalendarManager = CalendarManager;

// ─── CALENDAR VIEWER (Parent — read-only) ───────────────────────────────────

let _cv = {
    year:        new Date().getFullYear(),
    month:       new Date().getMonth() + 1,
    events:      new Map(),
    containerId: null,
};

const CalendarViewer = {
    init(containerId) {
        _cv.containerId = containerId;
        CalendarViewer.loadMonth(_cv.year, _cv.month);
    },

    loadMonth(year, month) {
        _cv.year  = year;
        _cv.month = month;
        _cv.events.clear();

        const mm = String(month).padStart(2, '0');
        apiFetchWithFallback(`${API_URL}?action=get_calendar_events&year=${year}&month=${mm}`, {
            method: 'GET'
        }).then(res => res.json()).then(data => {
            if (data.success && Array.isArray(data.data)) {
                data.data.forEach(ev => {
                    _cv.events.set(ev.event_date, ev);
                });
            }
            renderCalendarGrid(_cv.containerId, _cv.year, _cv.month, _cv.events, null);
        }).catch(err => {
            console.error('CalendarViewer.loadMonth error:', err);
            renderCalendarGrid(_cv.containerId, _cv.year, _cv.month, _cv.events, null);
        });
    },

    prevMonth() {
        let { year, month } = _cv;
        month--;
        if (month < 1) { month = 12; year--; }
        CalendarViewer.loadMonth(year, month);
    },

    nextMonth() {
        let { year, month } = _cv;
        month++;
        if (month > 12) { month = 1; year++; }
        CalendarViewer.loadMonth(year, month);
    },

    /** Re-fetches the current month from the server — picks up any admin changes. */
    refresh() {
        CalendarViewer.loadMonth(_cv.year, _cv.month);
    },
};
window.CalendarViewer = CalendarViewer;
