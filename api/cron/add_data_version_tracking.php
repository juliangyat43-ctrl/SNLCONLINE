<?php
/**
 * Add data version tracking table for real-time sync
 * This table tracks the last modification time for each data type
 */
require_once __DIR__ . '/../Database.php';

try {
    $pdo = Database::connect();
    
    // Create data_versions table
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS data_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_type TEXT NOT NULL UNIQUE,
            last_modified INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        )
    ");
    
    // Initialize version tracking for key data types
    $dataTypes = [
        'users' => time(),
        'attendance' => time(),
        'financial_records' => time(),
        'leaves' => time(),
        'announcements' => time(),
        'enrollments' => time()
    ];
    
    $stmt = $pdo->prepare("INSERT OR IGNORE INTO data_versions (data_type, last_modified, version, updated_at) VALUES (?, ?, 1, ?)");
    
    foreach ($dataTypes as $dataType => $timestamp) {
        $stmt->execute([$dataType, $timestamp, $timestamp]);
    }
    
    // Create indexes for performance
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_data_versions_type ON data_versions(data_type)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_data_versions_modified ON data_versions(last_modified)");
    
    echo "SUCCESS: Data version tracking table created and initialized.\n";
    
} catch (PDOException $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
