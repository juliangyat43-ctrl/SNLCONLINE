<?php
/**
 * Migration script to add school year support
 * Run this once to add school_year columns and settings
 */

require_once __DIR__ . '/../Database.php';

$pdo = Database::connect();

// Add school_year column to enrollments table
$pdo->exec("ALTER TABLE enrollments ADD COLUMN school_year TEXT DEFAULT '2025-2026'");

// Add school_year column to attendance table
$pdo->exec("ALTER TABLE attendance ADD COLUMN school_year TEXT DEFAULT '2025-2026'");

// Add school_year column to leave_requests table
$pdo->exec("ALTER TABLE leave_requests ADD COLUMN school_year TEXT DEFAULT '2025-2026'");

// Add school_year column to financial_records table
$pdo->exec("ALTER TABLE financial_records ADD COLUMN school_year TEXT DEFAULT '2025-2026'");

// Add school_year column to grades table
$pdo->exec("ALTER TABLE grades ADD COLUMN school_year TEXT DEFAULT '2025-2026'");

// Create school_years table for managing academic years
$pdo->exec("
    CREATE TABLE IF NOT EXISTS school_years (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year TEXT NOT NULL UNIQUE,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_current INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
");

// Insert current school year
$currentDate = date('Y-m-d');
$currentYear = date('Y');
$nextYear = $currentYear + 1;
$schoolYear = "$currentYear-$nextYear";

// Determine start and end dates (Philippine school year typically June-March)
$startDate = "$currentYear-06-01";
$endDate = "$nextYear-03-31";

$pdo->exec("
    INSERT OR IGNORE INTO school_years (school_year, start_date, end_date, is_current)
    VALUES ('$schoolYear', '$startDate', '$endDate', 1)
");

// Add current_school_year setting to global_settings
$pdo->exec("
    INSERT OR IGNORE INTO global_settings (setting_key, setting_value)
    VALUES ('current_school_year', '$schoolYear')
");

echo "School year support added successfully.\n";
echo "Current school year set to: $schoolYear\n";
echo "Please update existing records with appropriate school_year values as needed.\n";
