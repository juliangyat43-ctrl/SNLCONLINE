<?php
/**
 * Database Backup Management Script
 * 
 * Provides utilities for managing database backups:
 * - List available backups
 * - Restore from backup
 * - Manual backup creation
 * 
 * Usage: php api/cron/backup_manager.php [list|restore|backup] [options]
 */

$databaseFile = dirname(__DIR__) . '/../snlc_database.sqlite';
$backupDir = dirname(__DIR__) . '/../backups';

function listBackups() {
    global $backupDir;
    $files = glob($backupDir . '/snlc_database_backup_*.sqlite');
    
    if (empty($files)) {
        echo "No backups found.\n";
        return;
    }
    
    // Sort by modification time (newest first)
    usort($files, function($a, $b) {
        return filemtime($b) - filemtime($a);
    });
    
    echo "Available backups (newest first):\n";
    echo str_repeat("-", 80) . "\n";
    printf("%-40s %-20s %-15s\n", "Filename", "Date", "Size");
    echo str_repeat("-", 80) . "\n";
    
    foreach ($files as $file) {
        $filename = basename($file);
        $date = date('Y-m-d H:i:s', filemtime($file));
        $size = formatSize(filesize($file));
        printf("%-40s %-20s %-15s\n", $filename, $date, $size);
    }
    
    echo str_repeat("-", 80) . "\n";
    echo "Total: " . count($files) . " backup(s)\n";
}

function createBackup() {
    global $databaseFile, $backupDir;
    
    if (!file_exists($databaseFile)) {
        echo "Error: Database file not found: $databaseFile\n";
        return false;
    }
    
    $timestamp = date('Y-m-d_H-i-s');
    $backupFile = $backupDir . '/snlc_database_backup_' . $timestamp . '.sqlite';
    
    if (!is_dir($backupDir)) {
        mkdir($backupDir, 0755, true);
    }
    
    if (copy($databaseFile, $backupFile)) {
        chmod($backupFile, 0644);
        echo "Backup created successfully: $backupFile\n";
        return true;
    } else {
        echo "Error: Failed to create backup\n";
        return false;
    }
}

function restoreBackup($backupFilename) {
    global $databaseFile, $backupDir;
    
    $backupPath = $backupDir . '/' . $backupFilename;
    
    if (!file_exists($backupPath)) {
        echo "Error: Backup file not found: $backupPath\n";
        return false;
    }
    
    // Create a backup of current database before restoring
    $currentBackup = $backupDir . '/snlc_database_before_restore_' . date('Y-m-d_H-i-s') . '.sqlite';
    if (file_exists($databaseFile)) {
        if (!copy($databaseFile, $currentBackup)) {
            echo "Warning: Failed to backup current database\n";
        } else {
            echo "Current database backed up to: $currentBackup\n";
        }
    }
    
    // Restore from backup
    if (copy($backupPath, $databaseFile)) {
        chmod($databaseFile, 0644);
        echo "Database restored successfully from: $backupPath\n";
        echo "Current database backup saved at: $currentBackup\n";
        return true;
    } else {
        echo "Error: Failed to restore database\n";
        return false;
    }
}

function formatSize($bytes) {
    $units = ['B', 'KB', 'MB', 'GB'];
    $bytes = max($bytes, 0);
    $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
    $pow = min($pow, count($units) - 1);
    $bytes /= pow(1024, $pow);
    return round($bytes, 2) . ' ' . $units[$pow];
}

// Command line interface
if ($argc < 2) {
    echo "Usage: php backup_manager.php [list|restore|backup] [options]\n";
    echo "\nCommands:\n";
    echo "  list              - List all available backups\n";
    echo "  backup            - Create a new backup\n";
    echo "  restore <filename> - Restore from a specific backup\n";
    echo "\nExamples:\n";
    echo "  php backup_manager.php list\n";
    echo "  php backup_manager.php backup\n";
    echo "  php backup_manager.php restore snlc_database_backup_2025-05-09_02-00-00.sqlite\n";
    exit(1);
}

$command = $argv[1];

switch ($command) {
    case 'list':
        listBackups();
        break;
    case 'backup':
        createBackup();
        break;
    case 'restore':
        if ($argc < 3) {
            echo "Error: Please specify backup filename\n";
            echo "Usage: php backup_manager.php restore <filename>\n";
            exit(1);
        }
        restoreBackup($argv[2]);
        break;
    default:
        echo "Error: Unknown command '$command'\n";
        exit(1);
}
