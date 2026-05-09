<?php
/**
 * Data version tracking for real-time sync
 * Helps clients detect when data has changed
 */
require_once __DIR__ . '/Database.php';

class DataVersion {
    
    /**
     * Ensure the data_versions table exists (self-heal, doesn't depend on migrations)
     */
    private static function ensureTable(PDO $pdo): void {
        try {
            $pdo->exec("CREATE TABLE IF NOT EXISTS data_versions (
                data_type     TEXT PRIMARY KEY,
                last_modified INTEGER NOT NULL DEFAULT 0,
                version       INTEGER NOT NULL DEFAULT 1,
                updated_at    INTEGER NOT NULL DEFAULT 0
            )");
        } catch (PDOException $e) {
            error_log("Failed to create data_versions table: " . $e->getMessage());
        }
    }
    
    /**
     * Update the version for a specific data type
     * Call this whenever data is modified
     */
    public static function updateVersion(string $dataType): void {
        try {
            $pdo = Database::connect();
            self::ensureTable($pdo);
            $now = time();
            
            // Check if data type exists
            $stmt = $pdo->prepare("SELECT version FROM data_versions WHERE data_type = ?");
            $stmt->execute([$dataType]);
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($existing) {
                // Update existing record
                $newVersion = $existing['version'] + 1;
                $stmt = $pdo->prepare("
                    UPDATE data_versions 
                    SET last_modified = ?, version = ?, updated_at = ? 
                    WHERE data_type = ?
                ");
                $stmt->execute([$now, $newVersion, $now, $dataType]);
            } else {
                // Insert new record
                $stmt = $pdo->prepare("
                    INSERT INTO data_versions (data_type, last_modified, version, updated_at) 
                    VALUES (?, ?, 1, ?)
                ");
                $stmt->execute([$dataType, $now, $now]);
            }
        } catch (PDOException $e) {
            // Log error but don't fail the operation
            error_log("Failed to update data version for $dataType: " . $e->getMessage());
        }
    }
    
    /**
     * Get current versions for all data types
     */
    public static function getAllVersions(): array {
        try {
            $pdo = Database::connect();
            self::ensureTable($pdo);
            $stmt = $pdo->query("SELECT data_type, last_modified, version FROM data_versions");
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            error_log("Failed to get data versions: " . $e->getMessage());
            return [];
        }
    }
    
    /**
     * Check if any data has been modified since a given timestamp
     */
    public static function hasUpdatesSince(int $sinceTimestamp): array {
        try {
            $pdo = Database::connect();
            self::ensureTable($pdo);
            $stmt = $pdo->prepare("
                SELECT data_type, last_modified, version 
                FROM data_versions 
                WHERE last_modified > ?
            ");
            $stmt->execute([$sinceTimestamp]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            error_log("Failed to check for updates: " . $e->getMessage());
            return [];
        }
    }
    
    /**
     * Get version for a specific data type
     */
    public static function getVersion(string $dataType): ?array {
        try {
            $pdo = Database::connect();
            self::ensureTable($pdo);
            $stmt = $pdo->prepare("SELECT data_type, last_modified, version FROM data_versions WHERE data_type = ?");
            $stmt->execute([$dataType]);
            return $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            error_log("Failed to get data version for $dataType: " . $e->getMessage());
            return null;
        }
    }
}
