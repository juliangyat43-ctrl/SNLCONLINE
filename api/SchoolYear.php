<?php
/**
 * School Year Management Class
 * 
 * Provides utilities for managing and working with academic school years
 */

class SchoolYear {
    private $pdo;
    
    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }
    
    /**
     * Get the current school year
     */
    public function getCurrentSchoolYear(): string {
        // Try to get from global_settings first
        try {
            $stmt = $this->pdo->prepare("
                SELECT setting_value FROM global_settings 
                WHERE setting_key = 'current_school_year'
            ");
            $stmt->execute();
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($result && !empty($result['setting_value'])) {
                return $result['setting_value'];
            }
        } catch (Exception $e) {
            // Fall back to default
        }
        
        // Fallback: calculate from current date
        return $this->calculateCurrentSchoolYear();
    }
    
    /**
     * Set the current school year
     */
    public function setCurrentSchoolYear(string $schoolYear): void {
        $this->pdo->prepare("
            INSERT OR REPLACE INTO global_settings (setting_key, setting_value, updated_at)
            VALUES ('current_school_year', ?, datetime('now','localtime'))
        ")->execute([$schoolYear]);
    }
    
    /**
     * Get all available school years
     */
    public function getAllSchoolYears(): array {
        $stmt = $this->pdo->query("
            SELECT school_year, start_date, end_date, is_current 
            FROM school_years 
            ORDER BY start_date DESC
        ");
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    
    /**
     * Add a new school year
     */
    public function addSchoolYear(string $schoolYear, string $startDate, string $endDate): void {
        $stmt = $this->pdo->prepare("
            INSERT INTO school_years (school_year, start_date, end_date, is_current)
            VALUES (?, ?, ?, 0)
        ");
        $stmt->execute([$schoolYear, $startDate, $endDate]);
    }
    
    /**
     * Set a school year as current
     */
    public function setCurrentSchoolYearByRecord(string $schoolYear): void {
        $this->pdo->beginTransaction();
        try {
            // Set all to non-current
            $this->pdo->exec("UPDATE school_years SET is_current = 0");
            
            // Set specified school year as current
            $stmt = $this->pdo->prepare("
                UPDATE school_years SET is_current = 1 WHERE school_year = ?
            ");
            $stmt->execute([$schoolYear]);
            
            // Update global settings
            $this->setCurrentSchoolYear($schoolYear);
            
            $this->pdo->commit();
        } catch (Exception $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }
    
    /**
     * Calculate current school year based on date
     * Philippine school year: June to March
     */
    private function calculateCurrentSchoolYear(): string {
        $currentMonth = (int)date('m');
        $currentYear = (int)date('Y');
        
        // If month is June or later, school year is current year to next year
        // If month is before June, school year is previous year to current year
        if ($currentMonth >= 6) {
            return "$currentYear-" . ($currentYear + 1);
        } else {
            return ($currentYear - 1) . "-$currentYear";
        }
    }
    
    /**
     * Validate school year format (YYYY-YYYY)
     */
    public static function validateSchoolYear(string $schoolYear): bool {
        return preg_match('/^\d{4}-\d{4}$/', $schoolYear) === 1;
    }
}
