<?php
/**
 * Data deduplication and consistency helper
 * Ensures data stays consistent between duplicate columns in different tables
 */
require_once __DIR__ . '/Database.php';

class DataDeduplicator {
    
    /**
     * Sync financial data from financial_records to users table
     * This ensures the duplicate columns stay in sync
     */
    public static function syncFinancialToUsers(PDO $pdo, int $userId): void {
        try {
            // Check if user exists
            $stmt = $pdo->prepare("SELECT user_id FROM users WHERE user_id = ?");
            $stmt->execute([$userId]);
            if (!$stmt->fetch()) {
                return; // User doesn't exist, nothing to sync
            }
            
            // Get financial data from financial_records
            $stmt = $pdo->prepare("SELECT tuition_fee, amount_paid, payment_plan FROM financial_records WHERE user_id = ?");
            $stmt->execute([$userId]);
            $financial = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($financial) {
                // Update users table with financial data
                $sql = "UPDATE users SET tuition_fee = ?, amount_paid = ?";
                $params = [$financial['tuition_fee'], $financial['amount_paid']];
                
                // Add payment_plan if column exists in users table
                $checkPlan = $pdo->query("PRAGMA table_info(users)");
                $hasPaymentPlan = false;
                while ($col = $checkPlan->fetch(PDO::FETCH_ASSOC)) {
                    if ($col['name'] === 'payment_plan') {
                        $hasPaymentPlan = true;
                        break;
                    }
                }
                
                if ($hasPaymentPlan && isset($financial['payment_plan'])) {
                    $sql .= ", payment_plan = ?";
                    $params[] = $financial['payment_plan'];
                }
                
                $sql .= " WHERE user_id = ?";
                $params[] = $userId;
                
                $pdo->prepare($sql)->execute($params);
            }
        } catch (PDOException $e) {
            error_log("Failed to sync financial data for user $userId: " . $e->getMessage());
        }
    }
    
    /**
     * Sync user data to financial_records if needed
     * This is called when user data is updated to ensure financial_records exists
     */
    public static function ensureFinancialRecord(PDO $pdo, int $userId, string $role): void {
        try {
            if ($role !== 'student') {
                return; // Only students need financial records
            }
            
            // Check if financial record exists
            $stmt = $pdo->prepare("SELECT id FROM financial_records WHERE user_id = ?");
            $stmt->execute([$userId]);
            if ($stmt->fetch()) {
                return; // Already exists
            }
            
            // Get financial data from users table
            $stmt = $pdo->prepare("SELECT tuition_fee, amount_paid, payment_plan FROM users WHERE user_id = ?");
            $stmt->execute([$userId]);
            $userData = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($userData) {
                $tuitionFee = $userData['tuition_fee'] ?? 13000; // Default
                $amountPaid = $userData['amount_paid'] ?? 0;
                $paymentPlan = $userData['payment_plan'] ?? 'monthly';
                
                // Check if payment_plan column exists in financial_records
                $checkPlan = $pdo->query("PRAGMA table_info(financial_records)");
                $hasPaymentPlan = false;
                while ($col = $checkPlan->fetch(PDO::FETCH_ASSOC)) {
                    if ($col['name'] === 'payment_plan') {
                        $hasPaymentPlan = true;
                        break;
                    }
                }
                
                if ($hasPaymentPlan) {
                    $stmt = $pdo->prepare("
                        INSERT INTO financial_records (user_id, tuition_fee, amount_paid, payment_plan, created_at)
                        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
                    ");
                    $stmt->execute([$userId, $tuitionFee, $amountPaid, $paymentPlan]);
                } else {
                    $stmt = $pdo->prepare("
                        INSERT INTO financial_records (user_id, tuition_fee, amount_paid, created_at)
                        VALUES (?, ?, ?, datetime('now', 'localtime'))
                    ");
                    $stmt->execute([$userId, $tuitionFee, $amountPaid]);
                }
            }
        } catch (PDOException $e) {
            error_log("Failed to ensure financial record for user $userId: " . $e->getMessage());
        }
    }
    
    /**
     * Clean up duplicate data by removing redundant columns
     * This is a maintenance function to be run periodically
     */
    public static function cleanupDuplicateData(PDO $pdo): array {
        $results = [
            'users_synced' => 0,
            'financial_records_created' => 0,
            'errors' => []
        ];
        
        try {
            // Sync all financial data from financial_records to users
            $stmt = $pdo->query("SELECT DISTINCT user_id FROM financial_records");
            $userIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
            
            foreach ($userIds as $userId) {
                self::syncFinancialToUsers($pdo, $userId);
                $results['users_synced']++;
            }
            
            // Ensure all students have financial records
            $stmt = $pdo->query("SELECT user_id, role FROM users WHERE role = 'student'");
            $students = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            foreach ($students as $student) {
                self::ensureFinancialRecord($pdo, $student['user_id'], $student['role']);
                $results['financial_records_created']++;
            }
            
        } catch (PDOException $e) {
            $results['errors'][] = $e->getMessage();
        }
        
        return $results;
    }
}
