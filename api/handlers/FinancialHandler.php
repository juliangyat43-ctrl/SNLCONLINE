<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../DataVersion.php';
require_once __DIR__ . '/../DataDeduplicator.php';
require_once __DIR__ . '/../SchoolYear.php';
require_once __DIR__ . '/HandlerHelpers.php';

class FinancialHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function recordPayment(): void {
        $userId        = intval($_POST['user_id'] ?? 0);
        $amount        = floatval($_POST['amount'] ?? 0);
        $paymentMethod = $this->sanitize($_POST['payment_method'] ?? 'Cash');
        $reference     = $this->sanitize($_POST['reference']      ?? '');

        if (!$userId) {
            Response::error('Valid user ID required');
        }
        
        if ($amount <= 0) {
            Response::error('Payment amount must be greater than zero');
        }
        
        // Prevent absurdly large payments (security measure)
        if ($amount > 1000000) {
            Response::error('Payment amount exceeds maximum allowed limit');
        }
        
        // Validate user exists
        $stmt = $this->pdo->prepare("SELECT user_id FROM users WHERE user_id = ?");
        $stmt->execute([$userId]);
        if (!$stmt->fetch()) {
            Response::error('User not found');
        }

        // BEGIN TRANSACTION to prevent race conditions
        $this->pdo->beginTransaction();
        
        try {
            $schoolYear = new SchoolYear($this->pdo);
            $currentYear = $schoolYear->getCurrentSchoolYear();
            $this->pdo->prepare(
                "UPDATE financial_records SET amount_paid = amount_paid + ? WHERE user_id = ? AND school_year = ?"
            )->execute([$amount, $userId, $currentYear]);

            $this->pdo->prepare("
                INSERT INTO payment_logs (user_id, amount, payment_method, reference, created_at)
                VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
            ")->execute([$userId, $amount, $paymentMethod, $reference]);

            // Sync financial data to users table for consistency
            DataDeduplicator::syncFinancialToUsers($this->pdo, $userId);
            
            $this->pdo->commit();

            DataVersion::updateVersion('financial_records');
            $this->logActivity($_SESSION['user_id'], "Payment recorded: ₱$amount for user $userId");
            Response::success('Payment recorded successfully');
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log("Payment recording failed for user $userId: " . $e->getMessage());
            Response::error('Failed to record payment. Please try again.');
        }
    }

    public function updateFinancialPlan(): void {
        $userId           = intval($_POST['user_id'] ?? 0);
        $plan             = $this->sanitize($_POST['payment_plan'] ?? 'Monthly');
        $manualAmountPaid = isset($_POST['amount_paid']) ? floatval($_POST['amount_paid']) : null;

        if (!$userId) {
            Response::error('Valid user ID required');
        }
        
        if (!in_array($plan, ['Monthly', 'Quarterly', 'Annually'])) {
            Response::error('Invalid payment plan');
        }
        
        // Validate manual amount if provided
        if ($manualAmountPaid !== null) {
            if ($manualAmountPaid < 0) {
                Response::error('Amount paid cannot be negative');
            }
            if ($manualAmountPaid > 1000000) {
                Response::error('Amount paid exceeds maximum allowed limit');
            }
        }
        
        // Validate user exists
        $stmt = $this->pdo->prepare("SELECT user_id FROM users WHERE user_id = ?");
        $stmt->execute([$userId]);
        if (!$stmt->fetch()) {
            Response::error('User not found');
        }

        // Compute next payment date from today to avoid stale hardcoded schedule dates.
        $baseDate = new DateTime('today');
        if ($plan === 'Quarterly') {
            $baseDate->modify('+3 months');
        } elseif ($plan === 'Annually') {
            $baseDate->modify('+1 year');
        } else {
            $baseDate->modify('+1 month');
        }
        $nextDate = $baseDate->format('Y-m-d');

        // BEGIN TRANSACTION for atomic financial update
        $this->pdo->beginTransaction();
        
        try {
            $schoolYear = new SchoolYear($this->pdo);
            $currentYear = $schoolYear->getCurrentSchoolYear();
            $check = $this->pdo->prepare("SELECT id FROM financial_records WHERE user_id = ? AND school_year = ?");
            $check->execute([$userId, $currentYear]);
            $exists = $check->fetch();

            $hasPaymentPlan = $this->hasColumn('financial_records', 'payment_plan');
            $hasNextDate = $this->hasColumn('financial_records', 'next_payment_date');
            $hasLastDate = $this->hasColumn('financial_records', 'last_payment_date');

            if ($exists) {
                if ($manualAmountPaid !== null) {
                    $sets = ['amount_paid = ?'];
                    $params = [$manualAmountPaid];
                    if ($hasPaymentPlan) {
                        $sets[] = 'payment_plan = ?';
                        $params[] = $plan;
                    }
                    if ($hasNextDate) {
                        $sets[] = 'next_payment_date = ?';
                        $params[] = $nextDate;
                    }
                    if ($hasLastDate) {
                        $sets[] = "last_payment_date = datetime('now', 'localtime')";
                    }
                    $params[] = $userId;
                    $stmt = $this->pdo->prepare("UPDATE financial_records SET " . implode(', ', $sets) . " WHERE user_id = ? AND school_year = ?");
                    $params[] = $currentYear; $stmt->execute($params);
                } else {
                    $sets = [];
                    $params = [];
                    if ($hasPaymentPlan) {
                        $sets[] = 'payment_plan = ?';
                        $params[] = $plan;
                    }
                    if ($hasNextDate) {
                        $sets[] = 'next_payment_date = ?';
                        $params[] = $nextDate;
                    }
                    if (!empty($sets)) {
                        $params[] = $userId;
                        $stmt = $this->pdo->prepare("UPDATE financial_records SET " . implode(', ', $sets) . " WHERE user_id = ? AND school_year = ?");
                        $params[] = $currentYear; $stmt->execute($params);
                    }
                }
            } else {
                $paid = $manualAmountPaid ?? 0;
                // Look up global tuition fee from settings instead of hard-coding
                $globalTuition = 13000; // safe default
                try {
                    $gs = $this->pdo->query("SELECT setting_value FROM global_settings WHERE setting_key = 'global_tuition_fee'")->fetch();
                    if ($gs && is_numeric($gs['setting_value'])) {
                        $globalTuition = floatval($gs['setting_value']);
                    }
                } catch (Exception $e) { /* table may not exist yet — use default */ }

                // Get current school year
                $schoolYearObj = new SchoolYear($this->pdo);
                $currentSchoolYear = $schoolYearObj->getCurrentSchoolYear();

                if ($hasPaymentPlan && $hasNextDate) {
                    $stmt = $this->pdo->prepare("
                        INSERT INTO financial_records
                            (user_id, tuition_fee, amount_paid, payment_plan, next_payment_date, school_year, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                    ");
                    $stmt->execute([$userId, $globalTuition, $paid, $plan, $nextDate, $currentSchoolYear]);
                } elseif ($hasPaymentPlan) {
                    $stmt = $this->pdo->prepare("
                        INSERT INTO financial_records
                            (user_id, tuition_fee, amount_paid, payment_plan, school_year, created_at)
                        VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
                    ");
                    $stmt->execute([$userId, $globalTuition, $paid, $plan, $currentSchoolYear]);
                } else {
                    $stmt = $this->pdo->prepare("
                        INSERT INTO financial_records
                            (user_id, tuition_fee, amount_paid, school_year, created_at)
                        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
                    ");
                    $stmt->execute([$userId, $globalTuition, $paid, $currentSchoolYear]);
                }

                // Sync financial data to users table for consistency
                DataDeduplicator::syncFinancialToUsers($this->pdo, $userId);
            }
            
            $this->pdo->commit();

            DataVersion::updateVersion('financial_records');
            $this->logActivity($_SESSION['user_id'], "Updated financial plan for user ID $userId to $plan");
            Response::success('Financial plan updated');
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log("Financial plan update failed for user $userId: " . $e->getMessage());
            Response::error('Failed to update financial plan. Please try again.');
        }
    }
}
