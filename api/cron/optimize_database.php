<?php
/**
 * Database optimization migration script
 * Adds critical indexes and constraints for performance and data integrity
 */

require_once __DIR__ . '/../Database.php';

$pdo = Database::connect();

try {
    // Add unique constraint on user_code to prevent race conditions
    echo "Adding unique constraint on user_code...\n";
    $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_code ON users(user_code) WHERE user_code IS NOT NULL");
    
    // Add unique constraint on username to prevent duplicates
    echo "Adding unique constraint on username...\n";
    $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");
    
    // Add index on rfid_uid for faster RFID lookups
    echo "Adding index on rfid_uid...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_users_rfid_uid ON users(rfid_uid) WHERE rfid_uid IS NOT NULL");
    
    // Add composite index on attendance for common queries
    echo "Adding composite index on attendance (user_id, date)...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date)");
    
    // Add index on attendance date for sorting
    echo "Adding index on attendance date...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)");
    
    // Add index on enrollments status for filtering
    echo "Adding index on enrollments status...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_enrollments_status ON enrollments(status)");
    
    // Add index on enrollments username for lookups
    echo "Adding index on enrollments username...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_enrollments_username ON enrollments(username)");
    
    // Add index on financial_records user_id for joins
    echo "Adding index on financial_records user_id...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_financial_user_id ON financial_records(user_id)");
    
    // Add index on sessions for cleanup performance
    echo "Adding index on sessions expires_at...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)");
    
    // Add index on login_attempts for rate limiting performance
    echo "Adding index on login_attempts identifier...\n";
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier, attempt_time)");
    
    echo "Database optimization completed successfully!\n";
    
} catch (Exception $e) {
    echo "Error during migration: " . $e->getMessage() . "\n";
    exit(1);
}
