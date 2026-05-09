<?php
/**
 * ConsoleHandler - System Console API Endpoints
 * Provides monitoring and management endpoints for the admin console
 * @version 1.0
 */
require_once __DIR__ . '/../Response.php';

class ConsoleHandler {
    private PDO $pdo;
    
    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // RFID STATUS
    // ═══════════════════════════════════════════════════════════════════════════
    
    public function checkRfidStatus(): void {
        try {
            // Check if rfid_status table exists
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='rfid_status'");
            $tableExists = $stmt->fetch();
            
            if (!$tableExists) {
                Response::success('', [
                    'online' => false,
                    'data' => null,
                    'queue_count' => 0,
                    'terminal_ip' => null,
                    'last_heartbeat' => null,
                    'note' => 'RFID status table not initialized'
                ]);
                return;
            }
            
            // Get last heartbeat from rfid_status table
            $stmt = $this->pdo->query("SELECT * FROM rfid_status ORDER BY last_heartbeat DESC LIMIT 1");
            $status = $stmt->fetch();
            
            // Check if online (heartbeat within last 2 minutes)
            $isOnline = false;
            if ($status && !empty($status['last_heartbeat'])) {
                $lastBeat = strtotime($status['last_heartbeat']);
                $isOnline = (time() - $lastBeat) < 120; // 2 minute threshold
            }
            
            // Get queue count - check table exists first
            $queueCount = 0;
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='rfid_offline_queue'");
            if ($stmt->fetch()) {
                $queueStmt = $this->pdo->query("SELECT COUNT(*) as count FROM rfid_offline_queue WHERE synced = 0");
                $queueCount = $queueStmt->fetch()['count'] ?? 0;
            }
            
            Response::success('', [
                'online' => $isOnline,
                'data' => $status ?: null,
                'queue_count' => (int)$queueCount,
                'terminal_ip' => $status['terminal_ip'] ?? null,
                'last_heartbeat' => $status['last_heartbeat'] ?? null
            ]);
        } catch (Exception $e) {
            error_log('checkRfidStatus error: ' . $e->getMessage());
            Response::error('Failed to check RFID status');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // USER SESSION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════
    
    public function checkUserSession(): void {
        $userId = $_GET['user_id'] ?? null;
        if (!$userId) {
            Response::error('User ID required');
            return;
        }
        
        try {
            // Check active session
            $stmt = $this->pdo->prepare("
                SELECT s.*, u.username, u.full_name, u.role
                FROM sessions s
                JOIN users u ON u.user_id = s.user_id
                WHERE s.user_id = ? AND s.expires_at > datetime('now','localtime')
                ORDER BY s.expires_at DESC
                LIMIT 1
            ");
            $stmt->execute([$userId]);
            $session = $stmt->fetch();
            
            if ($session) {
                Response::success('', [
                    'active' => true,
                    'data' => [
                        'username' => $session['username'],
                        'full_name' => $session['full_name'],
                        'role' => $session['role'],
                        'last_activity' => $session['last_activity'] ?? $session['expires_at'],
                        'ip_address' => $session['ip_address'] ?? 'Unknown'
                    ]
                ]);
            } else {
                Response::success('', [
                    'active' => false,
                    'data' => null
                ]);
            }
        } catch (Exception $e) {
            error_log('checkUserSession error: ' . $e->getMessage());
            Response::error('Failed to check user session');
        }
    }
    
    public function adminLogoutUser(): void {
        $input = json_decode(file_get_contents('php://input'), true);
        $userId = $input['user_id'] ?? null;
        
        if (!$userId) {
            Response::error('User ID required');
            return;
        }
        
        try {
            // Delete all sessions for this user
            $stmt = $this->pdo->prepare("DELETE FROM sessions WHERE user_id = ?");
            $stmt->execute([$userId]);
            $deleted = $stmt->rowCount();
            
            // Log the action
            $this->logActivity('admin', "Force logout user ID: $userId");
            
            Response::success("User $userId logged out ($deleted session(s) terminated)");
        } catch (Exception $e) {
            error_log('adminLogoutUser error: ' . $e->getMessage());
            Response::error('Failed to logout user');
        }
    }
    
    public function getActiveSessions(): void {
        try {
            $stmt = $this->pdo->query("
                SELECT s.user_id, s.token, s.expires_at, s.created_at,
                       u.username, u.full_name, u.role
                FROM sessions s
                JOIN users u ON u.user_id = s.user_id
                WHERE s.expires_at > datetime('now','localtime')
                ORDER BY s.expires_at DESC
            ");
            $sessions = $stmt->fetchAll();
            
            // Format sessions for display
            $formatted = array_map(function($s) {
                return [
                    'user_id' => $s['user_id'],
                    'username' => $s['username'],
                    'full_name' => $s['full_name'],
                    'role' => $s['role'],
                    'ip' => 'Unknown',
                    'last_activity' => $this->formatTimeAgo($s['expires_at'])
                ];
            }, $sessions);
            
            Response::success('', [
                'sessions' => $formatted,
                'count' => count($formatted)
            ]);
        } catch (Exception $e) {
            error_log('getActiveSessions error: ' . $e->getMessage());
            Response::error('Failed to get active sessions');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ERROR LOGS
    // ═══════════════════════════════════════════════════════════════════════════
    
    public function getErrorLogs(): void {
        $limit = min(intval($_GET['limit'] ?? 10), 100);
        
        try {
            // Get from database error_logs table if exists
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='error_logs'");
            $tableExists = $stmt->fetch();
            
            $errors = [];
            
            if ($tableExists) {
                $stmt = $this->pdo->prepare("
                    SELECT * FROM error_logs
                    WHERE created_at > datetime('now','localtime','-24 hours')
                    ORDER BY created_at DESC
                    LIMIT ?
                ");
                $stmt->execute([$limit]);
                $dbErrors = $stmt->fetchAll();
                
                $errors = array_map(function($e) {
                    return [
                        'time' => $e['created_at'],
                        'message' => $e['message'],
                        'details' => $e['context'] ?? null,
                        'source' => $e['source'] ?? 'unknown'
                    ];
                }, $dbErrors);
            }
            
            // Also check for recent failed API requests in activity_logs (if table exists)
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_logs'");
            $activityTableExists = $stmt->fetch();
            
            if ($activityTableExists) {
                $stmt = $this->pdo->prepare("
                    SELECT created_at, action as description, user_id
                    FROM activity_logs
                    WHERE (action LIKE '%error%' OR action LIKE '%failed%')
                      AND created_at > datetime('now','localtime','-24 hours')
                    ORDER BY created_at DESC
                    LIMIT ?
                ");
                $stmt->execute([$limit]);
                $activityErrors = $stmt->fetchAll();
                
                foreach ($activityErrors as $e) {
                    $errors[] = [
                        'time' => $e['created_at'],
                        'message' => $e['description'],
                        'details' => ['user_id' => $e['user_id']],
                        'source' => 'activity_log'
                    ];
                }
            }
            
            // Limit combined results
            $errors = array_slice($errors, 0, $limit);
            
            Response::success('', [
                'errors' => $errors,
                'count' => count($errors)
            ]);
        } catch (Exception $e) {
            error_log('getErrorLogs error: ' . $e->getMessage());
            Response::error('Failed to get error logs');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // RFID QUEUE STATUS
    // ═══════════════════════════════════════════════════════════════════════════
    
    public function getRfidQueueStatus(): void {
        try {
            // Check if queue table exists
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='rfid_offline_queue'");
            $tableExists = $stmt->fetch();
            
            if (!$tableExists) {
                Response::success('', [
                    'queue_count' => 0,
                    'last_sync' => null,
                    'sync_errors' => 0,
                    'last_error' => null
                ]);
                return;
            }
            
            // Get pending count
            $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM rfid_offline_queue WHERE synced = 0");
            $pending = $stmt->fetch()['count'] ?? 0;
            
            // Get last sync info
            $stmt = $this->pdo->query("
                SELECT MAX(created_at) as last_sync
                FROM rfid_offline_queue
                WHERE synced = 1
            ");
            $lastSync = $stmt->fetch()['last_sync'] ?? null;
            
            // Get sync errors
            $stmt = $this->pdo->query("
                SELECT COUNT(*) as count FROM rfid_offline_queue
                WHERE sync_attempts > 0 AND synced = 0
            ");
            $syncErrors = $stmt->fetch()['count'] ?? 0;
            
            // Get last error message
            $stmt = $this->pdo->query("
                SELECT error_message, created_at
                FROM rfid_offline_queue
                WHERE error_message IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
            ");
            $lastError = $stmt->fetch();
            
            Response::success('', [
                'queue_count' => (int)$pending,
                'last_sync' => $lastSync,
                'sync_errors' => (int)$syncErrors,
                'last_error' => $lastError ? $lastError['error_message'] : null
            ]);
        } catch (Exception $e) {
            error_log('getRfidQueueStatus error: ' . $e->getMessage());
            Response::error('Failed to get queue status');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SQL QUERY (ADMIN ONLY)
    // ═══════════════════════════════════════════════════════════════════════════
    
    public function adminSqlQuery(): void {
        $input = json_decode(file_get_contents('php://input'), true);
        $query = trim($input['query'] ?? '');
        
        if (empty($query)) {
            Response::error('Query is required');
            return;
        }
        
        // Security: Only allow SELECT, INSERT, UPDATE, DELETE (no DROP, ALTER, etc.)
        $allowedPrefixes = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH'];
        $queryUpper = strtoupper(substr($query, 0, 20));
        
        $isAllowed = false;
        foreach ($allowedPrefixes as $prefix) {
            if (strpos($queryUpper, $prefix) === 0) {
                $isAllowed = true;
                break;
            }
        }
        
        if (!$isAllowed) {
            Response::error('Query type not allowed. Only SELECT, INSERT, UPDATE, DELETE permitted');
            return;
        }
        
        // Additional security: block dangerous keywords
        $forbidden = ['DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'EXEC', 'EXECUTE'];
        foreach ($forbidden as $word) {
            if (stripos($query, $word) !== false) {
                Response::error("Forbidden keyword detected: $word");
                return;
            }
        }
        
        try {
            $stmt = $this->pdo->query($query);
            
            // Check if query returns data (SELECT)
            if (strpos(strtoupper($query), 'SELECT') === 0 || strpos(strtoupper($query), 'WITH') === 0) {
                $data = $stmt->fetchAll();
                Response::success('', [
                    'data' => $data,
                    'row_count' => count($data)
                ]);
            } else {
                // For INSERT/UPDATE/DELETE
                $affected = $stmt->rowCount();
                Response::success('', [
                    'affected_rows' => $affected
                ]);
            }
            
            // Log the SQL query
            $this->logActivity('admin', "SQL Query executed: " . substr($query, 0, 100));
            
        } catch (Exception $e) {
            error_log('adminSqlQuery error: ' . $e->getMessage());
            Response::error('Query failed: ' . $e->getMessage());
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // USER STATISTICS
    // ═══════════════════════════════════════════════════════════════════════════
    
    public function getUserStats(): void {
        try {
            $stats = [];
            
            // Total users
            $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM users WHERE status = 'active'");
            $stats['total'] = $stmt->fetch()['count'] ?? 0;
            
            // By role
            $stmt = $this->pdo->query("SELECT role, COUNT(*) as count FROM users WHERE status = 'active' GROUP BY role");
            $byRole = $stmt->fetchAll();
            
            foreach ($byRole as $row) {
                $stats[$row['role'] . 's'] = $row['count'];
            }
            
            // Active sessions
            $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM sessions WHERE expires_at > datetime('now','localtime')");
            $stats['active_sessions'] = $stmt->fetch()['count'] ?? 0;
            
            Response::success('', $stats);
        } catch (Exception $e) {
            error_log('getUserStats error: ' . $e->getMessage());
            Response::error('Failed to get user statistics');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SYSTEM STATISTICS
    // ═══════════════════════════════════════════════════════════════════════════
    
    public function getSystemStats(): void {
        try {
            $stats = [];
            
            // Database file size
            $dbPath = $this->pdo->query("PRAGMA database_list")->fetch()['file'] ?? '';
            if ($dbPath && file_exists($dbPath)) {
                $size = filesize($dbPath);
                $stats['db_size'] = $this->formatBytes($size);
            } else {
                $stats['db_size'] = 'Unknown';
            }
            
            // Attendance count
            $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM attendance");
            $stats['attendance_count'] = $stmt->fetch()['count'] ?? 0;
            
            // Payment count
            $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM payment_logs");
            $stats['payment_count'] = $stmt->fetch()['count'] ?? 0;
            
            // Active sessions
            $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM sessions WHERE expires_at > datetime('now','localtime')");
            $stats['active_sessions'] = $stmt->fetch()['count'] ?? 0;
            
            // Error count (24h) - check if activity_logs exists
            $stats['error_count'] = 0;
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_logs'");
            if ($stmt->fetch()) {
                $stmt = $this->pdo->query("
                    SELECT COUNT(*) as count FROM activity_logs
                    WHERE (action LIKE '%error%' OR action LIKE '%failed%')
                      AND created_at > datetime('now','localtime','-24 hours')
                ");
                $stats['error_count'] = $stmt->fetch()['count'] ?? 0;
            }
            
            // Server time
            $stmt = $this->pdo->query("SELECT datetime('now','localtime') as server_time");
            $stats['server_time'] = $stmt->fetch()['server_time'];
            
            // Uptime (approximate based on first activity log if table exists)
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_logs'");
            if ($stmt->fetch()) {
                $stmt = $this->pdo->query("
                    SELECT MIN(created_at) as first_log FROM activity_logs
                ");
                $firstLog = $stmt->fetch()['first_log'];
                if ($firstLog) {
                    $stats['first_activity'] = $firstLog;
                }
            }
            
            Response::success('', $stats);
        } catch (Exception $e) {
            error_log('getSystemStats error: ' . $e->getMessage());
            Response::error('Failed to get system statistics');
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    private function logActivity(string $userId, string $description): void {
        try {
            // Check if activity_logs table exists
            $stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_logs'");
            if (!$stmt->fetch()) {
                return; // Table doesn't exist
            }
            
            $stmt = $this->pdo->prepare("
                INSERT INTO activity_logs (user_id, action, description, created_at, ip_address)
                VALUES (?, 'console_action', ?, datetime('now','localtime'), ?)
            ");
            $stmt->execute([$userId, $description, $_SERVER['REMOTE_ADDR'] ?? 'console']);
        } catch (Exception $e) {
            error_log('logActivity error: ' . $e->getMessage());
        }
    }
    
    private function formatTimeAgo(string $timestamp): string {
        $time = strtotime($timestamp);
        $now = time();
        $diff = $now - $time;
        
        if ($diff < 60) return 'Just now';
        if ($diff < 3600) return floor($diff / 60) . ' min ago';
        if ($diff < 86400) return floor($diff / 3600) . ' hours ago';
        return date('M j, H:i', $time);
    }
    
    private function formatBytes(int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB'];
        $unitIndex = 0;
        $size = $bytes;
        
        while ($size >= 1024 && $unitIndex < count($units) - 1) {
            $size /= 1024;
            $unitIndex++;
        }
        
        return round($size, 2) . ' ' . $units[$unitIndex];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEAR ALL CACHES
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Clear all client-side caches by bumping data versions + global cache version.
     * This causes all connected clients to detect version changes and refresh their data,
     * and forces a full cache clear on the next page load.
     */
    public function clearAllCaches(): void {
        try {
            $now = time();

            // 0) Ensure data_versions table exists (self-heal, doesn't depend on migrations)
            $this->pdo->exec("CREATE TABLE IF NOT EXISTS data_versions (
                data_type     TEXT PRIMARY KEY,
                last_modified INTEGER NOT NULL DEFAULT 0,
                version       INTEGER NOT NULL DEFAULT 1,
                updated_at    INTEGER NOT NULL DEFAULT 0
            )");

            // 1) Bump ALL existing data_versions so every client refreshes its data
            $stmt = $this->pdo->query("SELECT data_type, version FROM data_versions");
            $types = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $bumped = 0;
            foreach ($types as $row) {
                $newVersion = $row['version'] + 1;
                $upd = $this->pdo->prepare("
                    UPDATE data_versions
                    SET last_modified = ?, version = ?, updated_at = ?
                    WHERE data_type = ?
                ");
                $upd->execute([$now, $newVersion, $now, $row['data_type']]);
                $bumped++;
            }

            // 2) Increment (or create) a global cache_version entry.
            //    Clients check this value on load — if it changed, they wipe
            //    their entire localStorage cache and hard-reload.
            $stmt = $this->pdo->prepare("SELECT version FROM data_versions WHERE data_type = 'global_cache'");
            $stmt->execute();
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $newGlobalVersion = $existing['version'] + 1;
                $upd = $this->pdo->prepare("
                    UPDATE data_versions
                    SET last_modified = ?, version = ?, updated_at = ?
                    WHERE data_type = 'global_cache'
                ");
                $upd->execute([$now, $newGlobalVersion, $now]);
            } else {
                $this->pdo->prepare("
                    INSERT INTO data_versions (data_type, last_modified, version, updated_at)
                    VALUES ('global_cache', ?, 1, ?)
                ")->execute([$now, $now]);
                $newGlobalVersion = 1;
            }

            // 3) Log the action
            $this->logActivity($_SESSION['user_id'] ?? 'admin', 'Cache clear: bumped ' . $bumped . ' data versions, global_cache v' . $newGlobalVersion);

            Response::success('All caches cleared. ' . $bumped . ' data versions bumped, global cache version is now ' . $newGlobalVersion . '. All connected clients will refresh.', [
                'versions_bumped' => $bumped,
                'global_cache_version' => $newGlobalVersion,
                'timestamp' => $now
            ]);
        } catch (Exception $e) {
            error_log('clearAllCaches error: ' . $e->getMessage());
            Response::error('Failed to clear caches: ' . $e->getMessage());
        }
    }
}
