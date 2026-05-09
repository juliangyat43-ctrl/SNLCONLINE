<?php
/**
 * Session Cleanup Script for SNLC Attendance System
 * 
 * This script removes expired session tokens from the database
 * to prevent the sessions table from growing indefinitely.
 * 
 * Usage: php api/cron/cleanup_sessions.php
 * Cron: 0 */6 * * * php /path/to/api/cron/cleanup_sessions.php (runs every 6 hours)
 */

require_once __DIR__ . '/../Database.php';

try {
    $pdo = Database::connect();
    
    // Delete sessions that have expired (expires_at is in the past)
    $stmt = $pdo->prepare("
        DELETE FROM sessions 
        WHERE expires_at < datetime('now','localtime')
    ");
    $deletedCount = $stmt->execute();
    
    if ($deletedCount) {
        $deletedCount = $stmt->rowCount();
        error_log("Session cleanup: Deleted $deletedCount expired session(s)");
    } else {
        error_log("Session cleanup: No expired sessions found");
    }
    
    // Optional: Clean up old login attempts (older than 24 hours)
    $stmt = $pdo->prepare("
        DELETE FROM login_attempts 
        WHERE attempt_time < datetime('now','localtime','-24 hours')
    ");
    $stmt->execute();
    $attemptsDeleted = $stmt->rowCount();
    
    if ($attemptsDeleted > 0) {
        error_log("Session cleanup: Deleted $attemptsDeleted old login attempt(s)");
    }
    
    exit(0);
    
} catch (Exception $e) {
    error_log("Session cleanup failed: " . $e->getMessage());
    exit(1);
}
