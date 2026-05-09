<?php
/**
 * Add school_year column to major tables for proper academic year tracking
 * This ensures data can be filtered and analyzed by school year
 */
require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../SchoolYear.php';

try {
    $pdo = Database::connect();
    $schoolYear = new SchoolYear($pdo);
    $currentSchoolYear = $schoolYear->getCurrentSchoolYear();
    
    echo "Current school year: $currentSchoolYear\n";
    
    // List of tables to add school_year column
    $tables = [
        'financial_records',
        'leave_requests',
        'grades',
        'enrollments'
    ];
    
    foreach ($tables as $table) {
        // Check if table exists
        $stmt = $pdo->prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
        $stmt->execute([$table]);
        if (!$stmt->fetch()) {
            echo "SKIP: Table $table does not exist\n";
            continue;
        }
        
        // Check if column already exists
        $stmt = $pdo->query("PRAGMA table_info($table)");
        $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $columnExists = false;
        foreach ($columns as $col) {
            if ($col['name'] === 'school_year') {
                $columnExists = true;
                break;
            }
        }
        
        if ($columnExists) {
            echo "SKIP: Column school_year already exists in $table\n";
            continue;
        }
        
        // Add the column
        try {
            $pdo->exec("ALTER TABLE $table ADD COLUMN school_year TEXT");
            echo "SUCCESS: Added school_year column to $table\n";
            
            // Set default value for existing records to current school year
            $pdo->prepare("UPDATE $table SET school_year = ? WHERE school_year IS NULL")->execute([$currentSchoolYear]);
            echo "INFO: Set existing records in $table to school year $currentSchoolYear\n";
            
            // Create index for performance
            $pdo->exec("CREATE INDEX IF NOT EXISTS idx_{$table}_school_year ON $table(school_year)");
            echo "INFO: Created index on school_year for $table\n";
            
        } catch (PDOException $e) {
            echo "ERROR: Failed to add school_year to $table: " . $e->getMessage() . "\n";
        }
    }
    
    echo "\nSchool year context migration completed.\n";
    
} catch (PDOException $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
