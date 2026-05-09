<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

class GlobalSettingsHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    /**
     * GET action=get_global_settings
     * Returns: { global_tuition_fee, global_misc_fee }
     */
    public function getGlobalSettings(): void {
        $stmt = $this->pdo->query("
            SELECT setting_key, setting_value
            FROM global_settings
            WHERE setting_key IN ('global_tuition_fee', 'global_misc_fee')
        ");
        $rows = $stmt->fetchAll();

        $result = [
            'global_tuition_fee' => '13000',
            'global_misc_fee'    => '0',
        ];
        foreach ($rows as $row) {
            $result[$row['setting_key']] = $row['setting_value'];
        }

        Response::success('', $result);
    }

    /**
     * POST action=set_global_fees
     * Required: tuition_fee (numeric >= 0), misc_fee (numeric >= 0)
     * Upserts global_settings and bulk-updates all financial_records rows.
     * Returns: { updated_count: N }
     */
    public function setGlobalFees(): void {
        $tuitionRaw = $_POST['tuition_fee'] ?? '';
        $miscRaw    = $_POST['misc_fee']    ?? '';

        // Validate: must be numeric
        if (!is_numeric($tuitionRaw)) {
            Response::error('tuition_fee must be a numeric value');
        }
        if (!is_numeric($miscRaw)) {
            Response::error('misc_fee must be a numeric value');
        }

        $tuitionFee = floatval($tuitionRaw);
        $miscFee    = floatval($miscRaw);

        // Validate: must be >= 0
        if ($tuitionFee < 0) {
            Response::error('tuition_fee must be 0 or greater');
        }
        if ($miscFee < 0) {
            Response::error('misc_fee must be 0 or greater');
        }

        try {
            $this->pdo->beginTransaction();

            // Upsert global_tuition_fee
            $this->pdo->prepare("
                INSERT INTO global_settings (setting_key, setting_value, updated_at)
                VALUES ('global_tuition_fee', ?, datetime('now','localtime'))
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at    = excluded.updated_at
            ")->execute([(string)$tuitionFee]);

            // Upsert global_misc_fee
            $this->pdo->prepare("
                INSERT INTO global_settings (setting_key, setting_value, updated_at)
                VALUES ('global_misc_fee', ?, datetime('now','localtime'))
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at    = excluded.updated_at
            ")->execute([(string)$miscFee]);

            // Bulk-update all financial_records rows
            $updateStmt = $this->pdo->prepare("
                UPDATE financial_records SET tuition_fee = ?, misc_fee = ?
            ");
            $updateStmt->execute([$tuitionFee, $miscFee]);
            $updatedCount = $updateStmt->rowCount();

            $this->pdo->commit();
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Failed to update fees: ' . $e->getMessage());
        }

        Response::success('Global fees updated', ['updated_count' => $updatedCount]);
    }
}
