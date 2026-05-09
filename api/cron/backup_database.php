<?php
/**
 * Database Backup Script for SNLC Attendance System
 * 
 * This script creates automated backups of the SQLite database
 * with rotation to keep only the last 30 days of backups.
 * 
 * Usage: php api/cron/backup_database.php
 * Cron: 0 2 * * * php /path/to/api/cron/backup_database.php (runs daily at 2 AM)
 */

// Configuration
$databaseFile = dirname(__DIR__) . '/../snlc_database.sqlite';
$backupDir = dirname(__DIR__) . '/../backups';
$keepDays = 30; // Keep backups for 30 days

// Create backup directory if it doesn't exist
if (!is_dir($backupDir)) {
    mkdir($backupDir, 0755, true);
}

// Check if database file exists
if (!file_exists($databaseFile)) {
    error_log("Database file not found: $databaseFile");
    exit(1);
}

// Generate backup filename with timestamp
$timestamp = date('Y-m-d_H-i-s');
$backupFile = $backupDir . '/snlc_database_backup_' . $timestamp . '.sqlite';

// Copy database file to backup location
if (!copy($databaseFile, $backupFile)) {
    error_log("Failed to create backup: $backupFile");
    exit(1);
}

// Set appropriate permissions
chmod($backupFile, 0644);

// Log successful backup
error_log("Database backup created: $backupFile");

// Clean up old backups (rotation)
$files = glob($backupDir . '/snlc_database_backup_*.sqlite');
$cutoffTime = time() - ($keepDays * 86400); // $keepDays days in seconds

$deletedCount = 0;
foreach ($files as $file) {
    if (filemtime($file) < $cutoffTime) {
        if (unlink($file)) {
            $deletedCount++;
            error_log("Deleted old backup: $file");
        } else {
            error_log("Failed to delete old backup: $file");
        }
    }
}

// Log summary
$totalBackups = count(glob($backupDir . '/snlc_database_backup_*.sqlite'));
error_log("Backup cleanup completed. Deleted $deletedCount old backups. Total backups: $totalBackups");

exit(0);
