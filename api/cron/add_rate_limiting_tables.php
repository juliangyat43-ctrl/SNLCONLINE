<?php
/**
 * Migration script to add rate limiting tables
 * Run this once to create the necessary tables for rate limiting
 */

require_once __DIR__ . '/../Database.php';

$pdo = Database::connect();

// Create login_attempts table for tracking failed login attempts
$pdo->exec("
    CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        attempt_type TEXT NOT NULL DEFAULT 'ip',
        ip_address TEXT,
        username TEXT,
        attempt_time TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        success INTEGER DEFAULT 0
    )
");

// Create index for faster lookups
$pdo->exec("CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier, attempt_time)");
$pdo->exec("CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempt_time)");

// Create rate_limits table for configuration
$pdo->exec("
    CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        limit_type TEXT NOT NULL UNIQUE,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        window_minutes INTEGER NOT NULL DEFAULT 15,
        lockout_minutes INTEGER NOT NULL DEFAULT 30,
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
");

// Insert default rate limit configurations
$pdo->exec("
    INSERT OR IGNORE INTO rate_limits (limit_type, max_attempts, window_minutes, lockout_minutes)
    VALUES 
    ('login', 5, 15, 30),
    ('enrollment', 3, 60, 60)
");

echo "Rate limiting tables created successfully.\n";
