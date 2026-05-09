<?php
/**
 * Migration: Add chosen_password column to enrollments table
 * Run this once to update the database schema
 */

require_once __DIR__ . '/Database.php';

try {
    $pdo = Database::getInstance();
    
    // Check if column already exists
    $stmt = $pdo->query("PRAGMA table_info(enrollments)");
    $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $hasColumn = false;
    
    foreach ($columns as $col) {
        if ($col['name'] === 'chosen_password') {
            $hasColumn = true;
            break;
        }
    }
    
    if (!$hasColumn) {
        echo "Adding chosen_password column to enrollments table...\n";
        $pdo->exec("ALTER TABLE enrollments ADD COLUMN chosen_password TEXT");
        echo "✓ Column added successfully!\n";
    } else {
        echo "✓ Column already exists, no migration needed.\n";
    }
    
    echo "\nMigration completed successfully!\n";
    
} catch (Exception $e) {
    echo "✗ Migration failed: " . $e->getMessage() . "\n";
    exit(1);
}
