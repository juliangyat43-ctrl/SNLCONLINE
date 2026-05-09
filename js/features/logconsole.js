/**
 * SNLC System Console - Admin Log Monitor
 * Provides real-time monitoring, command execution, and system diagnostics
 * @version 1.0
 */

const LogConsole = {
    autoRefreshInterval: null,
    refreshRate: 5000, // 5 seconds
    isAutoRefresh: false,
    logHistory: [],
    maxLogLines: 500,
    commandHistory: [],
    historyIndex: -1,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════
    
    init() {
        this.setupKeyboardShortcuts();
        this.log('[INFO]', 'System Console initialized');
        this.log('[INFO]', 'Type /help for available commands');
    },
    
    setupKeyboardShortcuts() {
        const input = document.getElementById('consoleCommandInput');
        if (!input) return;
        
        input.addEventListener('keydown', (e) => {
            // Up arrow - previous command
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    input.value = this.commandHistory[this.historyIndex];
                }
            }
            // Down arrow - next command
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.historyIndex < this.commandHistory.length - 1) {
                    this.historyIndex++;
                    input.value = this.commandHistory[this.historyIndex];
                } else {
                    this.historyIndex = this.commandHistory.length;
                    input.value = '';
                }
            }
            // Escape - clear input
            else if (e.key === 'Escape') {
                input.value = '';
                this.hideHelp();
            }
            // Tab - autocomplete
            else if (e.key === 'Tab') {
                e.preventDefault();
                this.autocompleteCommand();
            }
        });
        
        // Show help on focus if empty
        input.addEventListener('focus', () => {
            if (input.value.startsWith('/')) {
                this.showHelp();
            }
        });
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // LOG OUTPUT
    // ═══════════════════════════════════════════════════════════════════════════
    
    log(type, message, data = null) {
        const timestamp = new Date().toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        const logEntry = {
            time: timestamp,
            type: type,
            message: message,
            data: data,
            id: Date.now()
        };
        
        this.logHistory.push(logEntry);
        
        // Trim history
        if (this.logHistory.length > this.maxLogLines) {
            this.logHistory.shift();
        }
        
        this.renderLogLine(logEntry);
        this.scrollToBottom();
    },
    
    renderLogLine(entry) {
        const output = document.getElementById('consoleLogOutput');
        if (!output) return;
        
        const line = document.createElement('div');
        line.className = `console-line ${this.getTypeClass(entry.type)}`;
        line.dataset.type = entry.type;
        
        let content = `
            <span class="console-time">${entry.time}</span>
            <span class="console-type">${entry.type}</span>
            <span class="console-message">${this.escapeHtml(entry.message)}</span>
        `;
        
        if (entry.data) {
            content += `<pre class="console-data">${JSON.stringify(entry.data, null, 2)}</pre>`;
        }
        
        line.innerHTML = content;
        output.appendChild(line);
        
        // Remove old lines if too many
        while (output.children.length > this.maxLogLines) {
            output.removeChild(output.firstChild);
        }
    },
    
    getTypeClass(type) {
        const classes = {
            '[INFO]': 'console-info',
            '[WARN]': 'console-warning',
            '[ERROR]': 'console-error',
            '[SUCCESS]': 'console-success',
            '[CMD]': 'console-command',
            '[PING]': 'console-ping',
            '[SQL]': 'console-sql'
        };
        return classes[type] || 'console-info';
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    scrollToBottom() {
        const output = document.getElementById('consoleLogOutput');
        if (output) {
            output.scrollTop = output.scrollHeight;
        }
    },
    
    clear() {
        this.logHistory = [];
        const output = document.getElementById('consoleLogOutput');
        if (output) {
            output.innerHTML = '';
        }
        this.log('[INFO]', 'Console cleared');
    },
    
    filterLog() {
        const showInfo = document.getElementById('consoleFilterInfo')?.checked ?? true;
        const showWarning = document.getElementById('consoleFilterWarning')?.checked ?? true;
        const showError = document.getElementById('consoleFilterError')?.checked ?? true;
        
        const output = document.getElementById('consoleLogOutput');
        if (!output) return;
        
        const lines = output.querySelectorAll('.console-line');
        lines.forEach(line => {
            const type = line.dataset.type;
            let visible = true;
            
            if (type === '[INFO]' || type === '[SUCCESS]' || type === '[PING]') {
                visible = showInfo;
            } else if (type === '[WARN]') {
                visible = showWarning;
            } else if (type === '[ERROR]') {
                visible = showError;
            }
            
            line.style.display = visible ? 'flex' : 'none';
        });
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // COMMAND HANDLING
    // ═══════════════════════════════════════════════════════════════════════════
    
    executeCommand() {
        const input = document.getElementById('consoleCommandInput');
        if (!input) return;
        
        const cmd = input.value.trim();
        if (!cmd) return;
        
        // Add to history
        this.commandHistory.push(cmd);
        this.historyIndex = this.commandHistory.length;
        
        // Log the command
        this.log('[CMD]', cmd);
        
        // Parse and execute
        this.parseAndExecute(cmd);
        
        // Clear input
        input.value = '';
        this.hideHelp();
    },
    
    parseAndExecute(cmd) {
        const parts = cmd.split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        switch (command) {
            case '/help':
            case 'help':
                this.showCommandHelp();
                break;
            case '/clear':
            case 'clear':
                this.clear();
                break;
            case '/ping':
                this.handlePingCommand(args);
                break;
            case '/logout':
                this.handleLogoutCommand(args);
                break;
            case '/sessions':
                this.handleSessionsCommand();
                break;
            case '/errors':
                this.handleErrorsCommand(args);
                break;
            case '/queue':
                this.handleQueueCommand();
                break;
            case '/sql':
                this.handleSqlCommand(args);
                break;
            case '/users':
                this.handleUsersCommand(args);
                break;
            case '/stats':
                this.handleStatsCommand();
                break;
            case '/refresh':
                this.refreshConsole();
                break;
            case '/clearcache':
                this.handleClearCacheCommand();
                break;
            default:
                this.log('[ERROR]', `Unknown command: ${command}. Type /help for available commands.`);
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // COMMAND IMPLEMENTATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    async handlePingCommand(args) {
        const target = args[0] || 'server';
        
        if (target === 'rfid' || target === 'rfidprogram') {
            this.log('[PING]', 'Checking RFID terminal status...');
            try {
                const response = await fetchApi(`${API_URL}?action=check_rfid_status`);
                if (response.success) {
                    const data = response.data || {};
                    this.log('[SUCCESS]', `RFID Terminal: ${data.online ? 'ONLINE' : 'OFFLINE'}`);
                    if (data.data || data.last_heartbeat) {
                        this.log('[INFO]', `Last heartbeat: ${data.last_heartbeat || data.data?.last_heartbeat || 'Never'}`);
                        this.log('[INFO]', `Queue count: ${data.queue_count || 0}`);
                        this.log('[INFO]', `Terminal IP: ${data.terminal_ip || data.data?.terminal_ip || 'Unknown'}`);
                    }
                    this.updateRfidStatus(data.online ? 'ON' : 'OFF');
                } else {
                    this.log('[ERROR]', 'Failed to get RFID status');
                }
            } catch (e) {
                this.log('[ERROR]', `RFID ping failed: ${e.message}`);
            }
        } 
        else if (target === 'user' || target === 'parent') {
            const userId = args[1];
            if (!userId) {
                this.log('[ERROR]', 'Usage: /ping user <user_id>');
                return;
            }
            this.log('[PING]', `Checking user ${userId} session...`);
            try {
                const response = await fetchApi(`${API_URL}?action=check_user_session&user_id=${userId}`);
                if (response.success) {
                    const data = response.data || {};
                    this.log('[SUCCESS]', `User ${userId}: ${data.active ? 'ACTIVE' : 'INACTIVE'}`);
                    if (data.data) {
                        this.log('[INFO]', `Last activity: ${data.data.last_activity || 'Unknown'}`);
                        this.log('[INFO]', `IP Address: ${data.data.ip_address || 'Unknown'}`);
                    }
                } else {
                    this.log('[WARN]', `User ${userId} not found or inactive`);
                }
            } catch (e) {
                this.log('[ERROR]', `User ping failed: ${e.message}`);
            }
        }
        else {
            // Ping server
            const start = performance.now();
            try {
                const response = await fetchApi(`${API_URL}?action=ping`);
                const latency = Math.round(performance.now() - start);
                if (response.success) {
                    const data = response.data || {};
                    this.log('[SUCCESS]', `Server is ONLINE (latency: ${latency}ms)`);
                    this.log('[INFO]', `Server time: ${data.server_time || 'Unknown'}`);
                } else {
                    this.log('[ERROR]', 'Server ping failed');
                }
            } catch (e) {
                this.log('[ERROR]', `Server ping failed: ${e.message}`);
            }
        }
    },
    
    async handleLogoutCommand(args) {
        const userId = args[0];
        if (!userId) {
            this.log('[ERROR]', 'Usage: /logout <user_id>');
            return;
        }
        
        this.log('[CMD]', `Force logging out user ${userId}...`);
        try {
            const response = await fetchApi(`${API_URL}?action=admin_logout_user`, {
                method: 'POST',
                body: JSON.stringify({ user_id: userId })
            });
            if (response.success) {
                this.log('[SUCCESS]', `User ${userId} logged out successfully`);
            } else {
                this.log('[ERROR]', `Failed to logout user ${userId}: ${response.message}`);
            }
        } catch (e) {
            this.log('[ERROR]', `Logout failed: ${e.message}`);
        }
    },
    
    async handleSessionsCommand() {
        this.log('[CMD]', 'Fetching active sessions...');
        try {
            const response = await fetchApi(`${API_URL}?action=get_active_sessions`);
            if (response.success) {
                const data = response.data || {};
                const sessions = data.sessions || [];
                if (sessions.length > 0) {
                    this.log('[SUCCESS]', `Found ${sessions.length} active sessions`);
                    sessions.forEach(session => {
                        this.log('[INFO]', `${session.username} (${session.role}) - ${session.ip} - Last: ${session.last_activity}`);
                    });
                    this.updateSessionsTable(sessions);
                } else {
                    this.log('[INFO]', 'No active sessions found');
                }
            }
        } catch (e) {
            this.log('[ERROR]', `Failed to fetch sessions: ${e.message}`);
        }
    },
    
    async handleErrorsCommand(args) {
        const limit = parseInt(args[0]) || 10;
        this.log('[CMD]', `Fetching last ${limit} errors...`);
        try {
            const response = await fetchApi(`${API_URL}?action=get_error_logs&limit=${limit}`);
            if (response.success) {
                const data = response.data || {};
                const errors = data.errors || [];
                if (errors.length === 0) {
                    this.log('[INFO]', 'No errors found in the last 24 hours');
                } else {
                    this.log('[WARN]', `Found ${errors.length} error(s)`);
                    errors.forEach(err => {
                        this.log('[ERROR]', `[${err.time}] ${err.message}`, err.details);
                    });
                }
                this.updateErrorCount(errors.length);
            } else {
                this.log('[ERROR]', 'Failed to fetch error logs');
            }
        } catch (e) {
            this.log('[ERROR]', `Failed to fetch errors: ${e.message}`);
        }
    },
    
    async handleQueueCommand() {
        this.log('[CMD]', 'Checking RFID offline queue...');
        try {
            const response = await fetchApi(`${API_URL}?action=get_rfid_queue_status`);
            if (response.success) {
                const data = response.data || {};
                this.log('[INFO]', `Pending queue items: ${data.queue_count || 0}`);
                this.log('[INFO]', `Last sync attempt: ${data.last_sync || 'Never'}`);
                this.log('[INFO]', `Sync errors: ${data.sync_errors || 0}`);
                if (data.last_error) {
                    this.log('[ERROR]', `Last error: ${data.last_error}`);
                }
            } else {
                this.log('[ERROR]', 'Failed to get queue status');
            }
        } catch (e) {
            this.log('[ERROR]', `Queue check failed: ${e.message}`);
        }
    },
    
    async handleSqlCommand(args) {
        const query = args.join(' ');
        if (!query) {
            this.log('[ERROR]', 'Usage: /sql <SQL query>');
            this.log('[INFO]', 'Example: /sql SELECT COUNT(*) FROM users');
            return;
        }
        
        this.log('[SQL]', `Executing: ${query}`);
        this.log('[WARN]', 'SQL queries should be used with caution in production');
        
        try {
            const response = await fetchApi(`${API_URL}?action=admin_sql_query`, {
                method: 'POST',
                body: JSON.stringify({ query: query })
            });
            if (response.success) {
                const data = response.data || {};
                this.log('[SUCCESS]', `Query executed successfully`);
                if (data.data) {
                    this.log('[INFO]', `Result:`, data.data);
                }
                if (data.affected_rows !== undefined) {
                    this.log('[INFO]', `Affected rows: ${data.affected_rows}`);
                }
            } else {
                this.log('[ERROR]', `Query failed: ${response.message}`);
            }
        } catch (e) {
            this.log('[ERROR]', `SQL execution failed: ${e.message}`);
        }
    },
    
    async handleUsersCommand(args) {
        const action = args[0] || 'count';
        
        if (action === 'count') {
            try {
                const response = await fetchApi(`${API_URL}?action=get_user_stats`);
                if (response.success) {
                    const data = response.data || {};
                    this.log('[INFO]', `Total users: ${data.total || 0}`);
                    this.log('[INFO]', `Students: ${data.students || 0}`);
                    this.log('[INFO]', `Parents: ${data.parents || 0}`);
                    this.log('[INFO]', `Teachers: ${data.teachers || 0}`);
                    this.log('[INFO]', `Admins: ${data.admins || 0}`);
                    this.updateActiveUsers(data.total || 0);
                }
            } catch (e) {
                this.log('[ERROR]', `Failed to get user stats: ${e.message}`);
            }
        }
    },
    
    async handleStatsCommand() {
        this.log('[CMD]', 'Fetching system statistics...');
        try {
            const response = await fetchApi(`${API_URL}?action=get_system_stats`);
            if (response.success) {
                const data = response.data || {};
                this.log('[INFO]', '=== System Statistics ===');
                this.log('[INFO]', `Database size: ${data.db_size || 'Unknown'}`);
                this.log('[INFO]', `Total attendance records: ${data.attendance_count || 0}`);
                this.log('[INFO]', `Total payments: ${data.payment_count || 0}`);
                this.log('[INFO]', `Active sessions: ${data.active_sessions || 0}`);
                this.log('[INFO]', `PHP errors (24h): ${data.error_count || 0}`);
                this.log('[INFO]', `Server uptime: ${data.uptime || 'Unknown'}`);
            } else {
                this.log('[ERROR]', 'Failed to get system stats');
            }
        } catch (e) {
            this.log('[ERROR]', `Stats fetch failed: ${e.message}`);
        }
    },
    
    async handleClearCacheCommand() {
        this.log('[CMD]', 'Clearing all caches...');
        this.log('[WARN]', 'This will force all connected users to refresh their data');
        
        try {
            const response = await fetchApi(`${API_URL}?action=clear_all_caches`, {
                method: 'POST'
            });
            if (response.success) {
                const data = response.data || {};
                this.log('[SUCCESS]', `Server caches cleared: ${data.versions_bumped || 0} data versions bumped`);
                this.log('[INFO]', `Global cache version: ${data.global_cache_version || '?'}`);
                
                // Clear local caches immediately
                if (typeof CacheManager !== 'undefined' && CacheManager.clearAll) {
                    CacheManager.clearAll();
                    this.log('[SUCCESS]', 'Local browser cache cleared');
                }
                
                // Clear sessionStorage data caches
                try { sessionStorage.clear(); } catch (e) {}
                
                // Clear any API response cache
                try { localStorage.removeItem('apiResponseCache'); } catch (e) {}
                try { localStorage.removeItem('lastDataFetch'); } catch (e) {}
                try { localStorage.removeItem('sessionCache'); } catch (e) {}
                
                this.log('[INFO]', 'All connected clients will auto-refresh within 30 seconds');
                this.log('[WARN]', 'Reloading admin page in 3 seconds to apply changes...');
                
                // Force reload after a short delay so the admin can see the log
                setTimeout(() => {
                    window.location.href = window.location.pathname + '?nocache=' + Date.now();
                }, 3000);
            } else {
                this.log('[ERROR]', `Failed to clear caches: ${response.message}`);
            }
        } catch (e) {
            this.log('[ERROR]', `Cache clear failed: ${e.message}`);
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UI HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    
    showHelp() {
        const help = document.getElementById('consoleCommandHelp');
        if (help) help.style.display = 'block';
    },
    
    hideHelp() {
        const help = document.getElementById('consoleCommandHelp');
        if (help) help.style.display = 'none';
    },
    
    showCommandHelp() {
        this.showHelp();
        this.log('[INFO]', 'Available commands:');
        this.log('[INFO]', '/ping [rfid|user <id>] - Check status');
        this.log('[INFO]', '/logout <user_id> - Force logout user');
        this.log('[INFO]', '/sessions - List active sessions');
        this.log('[INFO]', '/errors [limit] - Show recent PHP errors');
        this.log('[INFO]', '/queue - Show RFID queue status');
        this.log('[INFO]', '/sql <query> - Execute SQL (admin only)');
        this.log('[INFO]', '/users count - Show user statistics');
        this.log('[INFO]', '/stats - System statistics');
        this.log('[INFO]', '/clearcache - Clear all caches (force all users to refresh)');
        this.log('[INFO]', '/clear - Clear console');
        this.log('[INFO]', '/help - Show this help');
    },
    
    autocompleteCommand() {
        const input = document.getElementById('consoleCommandInput');
        if (!input) return;
        
        const commands = [
            '/ping rfid',
            '/ping user ',
            '/logout ',
            '/sessions',
            '/errors',
            '/queue',
            '/sql ',
            '/users count',
            '/stats',
            '/clearcache',
            '/clear',
            '/help'
        ];
        
        const current = input.value.toLowerCase();
        const match = commands.find(cmd => cmd.toLowerCase().startsWith(current));
        
        if (match && current.length > 1) {
            input.value = match;
        }
    },
    
    updateRfidStatus(status) {
        const el = document.getElementById('consoleRfidStatus');
        if (el) el.textContent = status;
    },
    
    updateActiveUsers(count) {
        const el = document.getElementById('consoleActiveUsers');
        if (el) el.textContent = count;
    },
    
    updateErrorCount(count) {
        const el = document.getElementById('consoleErrorCount');
        if (el) el.textContent = count;
    },
    
    updateLastSync(time) {
        const el = document.getElementById('consoleLastSync');
        if (el) el.textContent = time || '—';
    },
    
    updateSessionsTable(sessions) {
        const tbody = document.getElementById('consoleSessionsBody');
        if (!tbody) return;
        
        if (!sessions || sessions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active sessions</td></tr>';
            return;
        }
        
        tbody.innerHTML = sessions.map(s => `
            <tr>
                <td>${this.escapeHtml(s.username)}</td>
                <td><span class="badge badge-${s.role}">${s.role}</span></td>
                <td>${s.ip || 'Unknown'}</td>
                <td>${s.last_activity || '—'}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="LogConsole.logoutUser('${s.user_id}')">
                        <i class="fas fa-sign-out-alt"></i> Logout
                    </button>
                </td>
            </tr>
        `).join('');
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO REFRESH
    // ═══════════════════════════════════════════════════════════════════════════
    
    startAutoRefresh() {
        if (this.autoRefreshInterval) return;
        this.isAutoRefresh = true;
        
        const btn = document.getElementById('consoleAutoRefreshBtn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-pause"></i> Stop Auto Refresh';
            btn.classList.remove('btn-gold');
            btn.classList.add('btn-danger');
        }
        
        this.autoRefreshInterval = setInterval(() => {
            this.refreshConsole();
        }, this.refreshRate);
        
        this.log('[INFO]', 'Auto refresh started (5s interval)');
    },
    
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
        this.isAutoRefresh = false;
        
        const btn = document.getElementById('consoleAutoRefreshBtn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-play"></i> Auto Refresh';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-gold');
        }
        
        this.log('[INFO]', 'Auto refresh stopped');
    },
    
    toggleAutoRefresh() {
        if (this.isAutoRefresh) {
            this.stopAutoRefresh();
        } else {
            this.startAutoRefresh();
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════
    
    async refreshConsole() {
        this.log('[INFO]', 'Refreshing console data...');
        await this.handleUsersCommand(['count']);
        await this.handlePingCommand(['server']);
        await this.handleErrorsCommand(['5']);
        await this.handleSessionsCommand();
        this.updateLastSync(new Date().toLocaleTimeString());
    },
    
    async logoutUser(userId) {
        await this.handleLogoutCommand([userId]);
        await this.handleSessionsCommand();
    },
    
    refreshSessions() {
        this.handleSessionsCommand();
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL FUNCTIONS (called from HTML)
// ═══════════════════════════════════════════════════════════════════════════

function loadSystemConsole() {
    LogConsole.init();
    LogConsole.refreshConsole();
}

function executeConsoleCommand() {
    LogConsole.executeCommand();
}

function startConsoleAutoRefresh() {
    // Don't auto-start, let user choose
}

function stopConsoleAutoRefresh() {
    LogConsole.stopAutoRefresh();
}

function toggleAutoRefresh() {
    LogConsole.toggleAutoRefresh();
}

function refreshConsole() {
    LogConsole.refreshConsole();
}

function clearConsole() {
    LogConsole.clear();
}

function filterConsoleLog() {
    LogConsole.filterLog();
}

function refreshSessions() {
    LogConsole.refreshSessions();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Console is initialized when page is shown
});
