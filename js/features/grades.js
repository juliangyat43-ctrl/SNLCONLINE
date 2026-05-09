"use strict";

// getInitials() is defined in js/core/data.js — no duplicate needed here

function switchQuarter(q, el) {
    currentGradeQuarter = q;
    document.querySelectorAll('.quarter-tab').forEach(t => t.classList.remove('active'));
    if(el) el.classList.add('active');
    const user = allUsers.find(u => u.user_id == currentUserEditId);
    if(user) renderUserGrades(user);
}

function updateNoShowButton(locked) {
    const btn = document.getElementById('no-show-btn');
    if(!btn) return;
    if(locked) {
        btn.textContent = 'NO SHOW: LOCKED';
        btn.style.background = 'var(--red-soft)';
        btn.style.color = 'var(--red)';
        btn.style.borderColor = 'var(--red)';
    } else {
        btn.textContent = 'NO SHOW';
        btn.style.background = 'var(--color-background-secondary)';
        btn.style.color = 'var(--color-text-secondary)';
        btn.style.borderColor = 'var(--color-border-tertiary)';
    }
}

async function toggleNoShow() {
    const user = allUsers.find(u => u.user_id == currentUserEditId);
    if (!user) return;
    const newLockedStatus = user.grades_locked ? 0 : 1;
    try {
        const res = await apiFetchWithFallback(API_URL + '?action=toggle_no_show', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.user_id, grades_locked: newLockedStatus })
        });
        const data = await res.json();
        if(data.success) {
            user.grades_locked = newLockedStatus;
            updateNoShowButton(user.grades_locked);
            showToast(newLockedStatus ? 'Grades locked (NO SHOW)' : 'Grades unlocked', 'success');
        }
    } catch(e) { console.error(e); }
}

const PASS_THRESHOLD = 75;
const HONOR_MIN = 90;
const GRADE_WEIGHTS = { ww: 0.25, pt: 0.50, qa: 0.25 };
const GRADE_SUBJECTS = [
    { name: 'Mathematics', teacher: 'Mr. Dela Cruz' },
    { name: 'English', teacher: 'Ms. Santos' },
    { name: 'Science', teacher: 'Mr. Reyes' },
    { name: 'Filipino', teacher: 'Ms. Garcia' },
    { name: 'Araling Panlipunan', teacher: 'Mr. Lopez' },
    { name: 'MAPEH', teacher: 'Ms. Villanueva' },
    { name: 'TLE / EPP', teacher: 'Mr. Bautista' },
    { name: 'Values Education', teacher: 'Ms. Mendoza' }
];

let currentGradeQuarter = 1;

function renderUserGrades(user) {
    updateNoShowButton(user.grades_locked);
    
    let gData = {};
    try { if (user.grades_data) gData = JSON.parse(user.grades_data); } catch(e){}
    for(let q=1; q<=4; q++) {
        if(!gData[q]) {
            gData[q] = GRADE_SUBJECTS.map(() => ({ ww: 0, pt: 0, qa: 0 }));
        }
    }
    
    const computeQuarter = (g) => Math.min(100, Math.max(0, Math.round(g.ww*GRADE_WEIGHTS.ww + g.pt*GRADE_WEIGHTS.pt + g.qa*GRADE_WEIGHTS.qa)));
    const computeFinal = (si) => Math.round((computeQuarter(gData[1][si]) + computeQuarter(gData[2][si]) + computeQuarter(gData[3][si]) + computeQuarter(gData[4][si])) / 4);
    
    let overallFinal = 0;
    let failedCount = 0;
    for(let i=0; i<GRADE_SUBJECTS.length; i++) {
        const fg = computeFinal(i);
        overallFinal += fg;
        if(fg < PASS_THRESHOLD) failedCount++;
    }
    overallFinal = Math.round(overallFinal / GRADE_SUBJECTS.length);
    
    const sCards = document.getElementById('status-cards');
    if(sCards) {
        let promo = { lbl: 'Promoted', cls: 'promoted', n: 'All subjects passed' };
        if(failedCount === 1) promo = { lbl: 'Conditional', cls: 'conditional', n: '1 subject failed' };
        else if(failedCount > 1) promo = { lbl: 'Retained', cls: 'retained', n: failedCount + ' subjects failed' };
        
        let honor = { lbl: 'Not Qualified', cls: 'no-honor', n: 'Overall avg: ' + overallFinal };
        if(failedCount === 0 && overallFinal >= HONOR_MIN) honor = { lbl: '🏅 Honor Roll', cls: 'honor', n: 'Overall avg: ' + overallFinal };
        
        sCards.innerHTML = `
        <div class="status-card ${promo.cls}">
            <div class="s-label">Promotion</div><div class="s-value">${promo.lbl}</div><div class="s-note">${promo.n}</div>
        </div>
        <div class="status-card ${honor.cls}">
            <div class="s-label">Honor Roll</div><div class="s-value">${honor.lbl}</div><div class="s-note">${honor.n}</div>
        </div>
        <div class="status-card ${overallFinal >= PASS_THRESHOLD ? 'promoted' : 'retained'}">
            <div class="s-label">Overall Avg</div><div class="s-value">${overallFinal}</div><div class="s-note">Passing: ${PASS_THRESHOLD}</div>
        </div>`;
    }
    
    if (currentGradeQuarter === 'final') {
        renderFinalGradeView(gData, computeQuarter, computeFinal, overallFinal);
    } else {
        renderQuarterGradeView(gData, computeQuarter);
    }
}

function renderQuarterGradeView(gData, computeQuarter) {
    document.getElementById('view-quarter').style.display = 'block';
    document.getElementById('view-final').style.display = 'none';
    const qd = gData[currentGradeQuarter];
    
    let passed = 0, failed = 0, sum = 0;
    qd.forEach(g => { const qg = computeQuarter(g); sum += qg; if(qg>=PASS_THRESHOLD) passed++; else failed++; });
    const avg = Math.round(sum / qd.length);
    
    const gradesSummaryEl = document.getElementById('grades-summary');
    if (gradesSummaryEl) gradesSummaryEl.innerHTML = `
    <div class="g-stat"><div class="g-stat-val">${avg}</div><div class="g-stat-label">Q${currentGradeQuarter} Avg</div></div>
    <div class="g-stat"><div class="g-stat-val" style="color:var(--green);">${passed}</div><div class="g-stat-label">Passed</div></div>
    <div class="g-stat"><div class="g-stat-val" style="color:var(--red);">${failed}</div><div class="g-stat-label">Failed</div></div>
    <div class="g-stat"><div class="g-stat-val">${GRADE_SUBJECTS.length}</div><div class="g-stat-label">Subjects</div></div>`;
    
    const gradesBodyEl = document.getElementById('grades-body');
    if (gradesBodyEl) gradesBodyEl.innerHTML = GRADE_SUBJECTS.map((s, si) => {
        const g = qd[si];
        const qg = computeQuarter(g);
        let rLbl = 'Failed', rCls = 'fail';
        if(qg >= 90) { rLbl = 'Excellent'; rCls = 'excellent'; }
        else if(qg >= 75) { rLbl = 'Passed'; rCls = 'pass'; }
        else if(qg >= 70) { rLbl = 'Average'; rCls = 'avg'; }
        return `
        <tr>
            <td><div style="font-weight:500;">${s.name}</div><div style="font-size:11px;color:var(--color-text-secondary);">${s.teacher}</div></td>
            <td style="text-align:center;"><input class="grade-input" type="number" min="0" max="100" value="${g.ww}" onchange="updateGradeComp(${si},'ww',this.value)" /></td>
            <td style="text-align:center;"><input class="grade-input" type="number" min="0" max="100" value="${g.pt}" onchange="updateGradeComp(${si},'pt',this.value)" /></td>
            <td style="text-align:center;"><input class="grade-input" type="number" min="0" max="100" value="${g.qa}" onchange="updateGradeComp(${si},'qa',this.value)" /></td>
            <td style="text-align:center;font-weight:600;">${qg}</td>
            <td style="text-align:center;"><span class="grade-badge ${rCls}">${rLbl}</span></td>
        </tr>`;
    }).join('');
}

function renderFinalGradeView(gData, computeQuarter, computeFinal, overallFinal) {
    document.getElementById('view-quarter').style.display = 'none';
    document.getElementById('view-final').style.display = 'block';
    
    const finalBodyEl = document.getElementById('final-body');
    if (finalBodyEl) finalBodyEl.innerHTML = GRADE_SUBJECTS.map((s, si) => {
        const fg = computeFinal(si);
        let rLbl = 'Failed', rCls = 'fail';
        if(fg >= 90) { rLbl = 'Excellent'; rCls = 'excellent'; }
        else if(fg >= 75) { rLbl = 'Passed'; rCls = 'pass'; }
        else if(fg >= 70) { rLbl = 'Average'; rCls = 'avg'; }
        return `
        <tr>
            <td><div style="font-weight:500;">${s.name}</div><div style="font-size:11px;color:var(--color-text-secondary);">${s.teacher}</div></td>
            <td style="text-align:center;">${computeQuarter(gData[1][si])}</td>
            <td style="text-align:center;">${computeQuarter(gData[2][si])}</td>
            <td style="text-align:center;">${computeQuarter(gData[3][si])}</td>
            <td style="text-align:center;">${computeQuarter(gData[4][si])}</td>
            <td style="text-align:center;font-weight:700;">${fg}</td>
            <td style="text-align:center;"><span class="grade-badge ${rCls}">${rLbl}</span></td>
        </tr>`;
    }).join('') + `
    <tr class="final-row">
        <td colspan="5" style="text-align:right;font-size:12px;color:var(--color-text-secondary);">Overall Final Average</td>
        <td style="text-align:center;font-weight:700;font-size:15px;">${overallFinal}</td>
        <td style="text-align:center;"><span class="grade-badge ${overallFinal >= 75 ? (overallFinal >= 90 ? 'excellent' : 'pass') : 'fail'}">${overallFinal >= 75 ? (overallFinal >= 90 ? 'Excellent' : 'Passed') : 'Failed'}</span></td>
    </tr>`;
}

async function updateGradeComp(si, comp, val) {
    const user = allUsers.find(u => u.user_id == currentUserEditId);
    if(!user) return;
    let gData = {};
    try { if(user.grades_data) gData = JSON.parse(user.grades_data); } catch(e){}
    if(!gData[currentGradeQuarter]) gData[currentGradeQuarter] = GRADE_SUBJECTS.map(()=>({ww:0,pt:0,qa:0}));
    gData[currentGradeQuarter][si][comp] = Math.min(100, Math.max(0, parseInt(val) || 0));
    user.grades_data = JSON.stringify(gData);
    
    renderUserGrades(user);
    try {
        await apiFetchWithFallback(API_URL + '?action=update_grades_data', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ user_id: user.user_id, grades_data: user.grades_data })
        });
    } catch(e) { console.error('Grade save error', e); }
}


// ==================== PARENT PORTAL GRADES VIEW ====================

let parentCurrentGradeQuarter = 1;

function renderParentGrades() {
    const user = currentUser;
    if (!user) return;
    
    document.getElementById('hero-initials').textContent = getInitials(user.full_name);
    document.getElementById('hero-name').textContent = user.full_name || 'Loading...';
    document.getElementById('hero-grade').textContent = (user.grade && user.section) ? `${user.grade} — ${user.section}` : '';
    
    let gData = {};
    try { if (user.grades_data) gData = JSON.parse(user.grades_data); } catch(e){}
    for(let q=1; q<=4; q++) {
        if(!gData[q]) gData[q] = GRADE_SUBJECTS.map(() => ({ ww: 0, pt: 0, qa: 0 }));
    }
    
    // In case NO SHOW is enabled
    if (user.grades_locked) {
        document.getElementById('view-quarter').innerHTML = '<div class="notice">Grades are currently locked (NO SHOW). Please contact the administration.</div>';
        document.getElementById('view-final').innerHTML = '';
        return;
    }
    
    const computeQuarter = (g) => Math.min(100, Math.max(0, Math.round(g.ww*GRADE_WEIGHTS.ww + g.pt*GRADE_WEIGHTS.pt + g.qa*GRADE_WEIGHTS.qa)));
    const computeFinal = (si) => Math.round((computeQuarter(gData[1][si]) + computeQuarter(gData[2][si]) + computeQuarter(gData[3][si]) + computeQuarter(gData[4][si])) / 4);
    
    let overallFinal = 0;
    let failedCount = 0;
    for(let i=0; i<GRADE_SUBJECTS.length; i++) {
        const fg = computeFinal(i);
        overallFinal += fg;
        if(fg < PASS_THRESHOLD) failedCount++;
    }
    overallFinal = Math.round(overallFinal / GRADE_SUBJECTS.length);
    const passedCount = GRADE_SUBJECTS.length - failedCount;
    
    document.getElementById('hero-avg').textContent = overallFinal;
    document.getElementById('hero-passed').textContent = passedCount;
    document.getElementById('hero-failed').textContent = failedCount;
    
    let promoPill = '', honorPill = '';
    if (failedCount === 0)       promoPill = `<div class="status-pill pill-promoted"><span class="pill-icon">✅</span> Promoted</div>`;
    else if (failedCount === 1)  promoPill = `<div class="status-pill pill-conditional"><span class="pill-icon">⚠️</span> Conditional</div>`;
    else                         promoPill = `<div class="status-pill pill-retained"><span class="pill-icon">❌</span> Retained</div>`;

    if (failedCount === 0 && overallFinal >= HONOR_MIN)
        honorPill = `<div class="status-pill pill-honor"><span class="pill-icon">🏅</span> Honor Roll</div>`;
    else
        honorPill = `<div class="status-pill pill-no-honor"><span class="pill-icon">📋</span> Not on Honor Roll</div>`;

    document.getElementById('badge-row').innerHTML = promoPill + honorPill;
    
    if (parentCurrentGradeQuarter === 'final') {
        renderParentFinalGradeView(gData, computeQuarter, computeFinal, overallFinal, passedCount, failedCount);
    } else {
        renderParentQuarterGradeView(gData, computeQuarter);
    }
}

function getParentGradeColor(g) {
    if (g >= 90) return { cls:'color-exc', fill:'rem-exc',  cardcls:'excellent' };
    if (g >= PASS_THRESHOLD) return { cls:'color-pass',fill:'rem-pass', cardcls:'passing' };
    if (g >= 70) return { cls:'color-avg', fill:'rem-avg',  cardcls:'' };
    return { cls:'color-fail', fill:'rem-fail',  cardcls:'failing' };
}
function getParentGradeLabel(g) {
    if (g >= 90) return 'Excellent';
    if (g >= PASS_THRESHOLD) return 'Passed';
    if (g >= 70) return 'Average';
    return 'Failed';
}
function getParentFinalColorCls(g) {
    if (g >= 90) return 'c-exc';
    if (g >= PASS_THRESHOLD) return 'c-pass';
    if (g >= 70) return 'c-avg';
    return 'c-fail';
}

function renderParentQuarterGradeView(gData, computeQuarter) {
    document.getElementById('view-quarter').style.display = 'flex';
    document.getElementById('view-final').style.display = 'none';
    const qData = gData[parentCurrentGradeQuarter];
    
    let passed = 0, failed = 0, sum = 0;
    const qGrades = qData.map(g => {
        const qg = computeQuarter(g);
        sum += qg;
        if(qg >= PASS_THRESHOLD) passed++; else failed++;
        return qg;
    });
    const avg = Math.round(sum / qData.length);
    
    document.getElementById('q-stats').innerHTML = `
    <div class="q-stat"><div class="q-stat-val" style="color:var(--maroon)">${avg}</div><div class="q-stat-lbl">Q${parentCurrentGradeQuarter} Average</div></div>
    <div class="q-stat"><div class="q-stat-val" style="color:var(--green)">${passed}</div><div class="q-stat-lbl">Passed</div></div>
    <div class="q-stat"><div class="q-stat-val" style="color:var(--red)">${failed}</div><div class="q-stat-lbl">Failed</div></div>
    <div class="q-stat"><div class="q-stat-val" style="color:var(--text-mid)">${GRADE_SUBJECTS.length}</div><div class="q-stat-lbl">Subjects</div></div>`;
    
    document.getElementById('view-quarter').innerHTML = GRADE_SUBJECTS.map((s, si) => {
        const g = qData[si];
        const qg = qGrades[si];
        const c = getParentGradeColor(qg);
        return `
        <div class="subject-card ${c.cardcls}">
            <div class="sc-top">
            <div>
                <div class="sc-name">${s.name}</div>
                <div class="sc-teacher">${s.teacher}</div>
            </div>
            <div>
                <div class="sc-grade-big ${c.cls}">${qg}</div>
            </div>
            </div>
            <div class="sc-components">
            <div class="comp-item">
                <div class="comp-label">Written</div>
                <div class="comp-bar-track"><div class="comp-bar-fill fill-ww" style="width:${g.ww}%"></div></div>
                <div class="comp-val">${g.ww}</div>
            </div>
            <div class="comp-item">
                <div class="comp-label">Perf. Task</div>
                <div class="comp-bar-track"><div class="comp-bar-fill fill-pt" style="width:${g.pt}%"></div></div>
                <div class="comp-val">${g.pt}</div>
            </div>
            <div class="comp-item">
                <div class="comp-label">Q. Assess.</div>
                <div class="comp-bar-track"><div class="comp-bar-fill fill-qa" style="width:${g.qa}%"></div></div>
                <div class="comp-val">${g.qa}</div>
            </div>
            </div>
            <span class="sc-remarks ${c.fill}">${getParentGradeLabel(qg)}</span>
        </div>`;
    }).join('');
}

function renderParentFinalGradeView(gData, computeQuarter, computeFinal, overallFinal, passedCount, failedCount) {
    document.getElementById('view-quarter').style.display = 'none';
    document.getElementById('view-final').style.display = 'block';
    
    document.getElementById('q-stats').innerHTML = `
    <div class="q-stat"><div class="q-stat-val" style="color:var(--maroon)">${overallFinal}</div><div class="q-stat-lbl">Final Avg</div></div>
    <div class="q-stat"><div class="q-stat-val" style="color:var(--green)">${passedCount}</div><div class="q-stat-lbl">Passed</div></div>
    <div class="q-stat"><div class="q-stat-val" style="color:var(--red)">${failedCount}</div><div class="q-stat-lbl">Failed</div></div>
    <div class="q-stat"><div class="q-stat-val" style="color:var(--text-mid)">${GRADE_SUBJECTS.length}</div><div class="q-stat-lbl">Subjects</div></div>`;
    
    const rows = GRADE_SUBJECTS.map((s, si) => {
        const q1 = computeQuarter(gData[1][si]);
        const q2 = computeQuarter(gData[2][si]);
        const q3 = computeQuarter(gData[3][si]);
        const q4 = computeQuarter(gData[4][si]);
        const fg = computeFinal(si);
        const cc = getParentFinalColorCls(fg);
        return `
        <tr>
            <td><div class="subj-nm">${s.name}</div><div class="subj-tc">${s.teacher}</div></td>
            <td class="qcell">${q1}</td>
            <td class="qcell">${q2}</td>
            <td class="qcell">${q3}</td>
            <td class="qcell">${q4}</td>
            <td class="fcell ${cc}">${fg}</td>
            <td><span class="sc-remarks ${cc.replace('c-','rem-').replace('exc','exc')}">${getParentGradeLabel(fg)}</span></td>
        </tr>`;
    }).join('');
    
    const oc = getParentFinalColorCls(overallFinal);
    document.getElementById('view-final').innerHTML = `
    <div class="final-table-scroll">
    <table class="final-table">
        <thead>
        <tr>
            <th>Subject</th>
            <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th>
            <th>Final</th><th>Remarks</th>
        </tr>
        </thead>
        <tbody>
        ${rows}
        <tr class="final-avg-row">
            <td colspan="5" style="text-align:right;font-size:12px;color:var(--maroon);letter-spacing:.02em;">Overall Final Average</td>
            <td class="fcell ${oc}" style="font-size:17px;">${overallFinal}</td>
            <td><span class="sc-remarks ${oc.replace('c-','rem-')}">${getParentGradeLabel(overallFinal)}</span></td>
        </tr>
        </tbody>
    </table>
    </div>`;
}

function setParentGradesQ(q, el) {
    parentCurrentGradeQuarter = q;
    document.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    
    const isF = q === 'final';
    document.getElementById('view-quarter').style.display = isF ? 'none' : 'flex';
    document.getElementById('view-final').style.display   = isF ? 'block' : 'none';
    const legend = document.getElementById('legend');
    if(legend) legend.style.display = isF ? 'none' : 'flex';
    
    renderParentGrades();
}
