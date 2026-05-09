<?php
/**
 * Shared utility functions for all handlers.
 */
trait HandlerHelpers {
    /** @var array<string, array<string, bool>> */
    private $tableColumnCache = [];

    protected function sanitize(string $value): string {
        return trim($value);
    }

    protected function validateDate(string $date): bool {
        $d = DateTime::createFromFormat('Y-m-d', $date);
        return $d && $d->format('Y-m-d') === $date;
    }

    protected function validateTime(string $time): bool {
        $d = DateTime::createFromFormat('H:i', $time);
        return $d && $d->format('H:i') === $time;
    }

    /**
     * @param int|null $userId
     */
    protected function logActivity($userId, string $action, string $status = 'Success'): void {
        try {
            $stmt = $this->pdo->prepare(
                "INSERT INTO activity_logs (user_id, action, status, created_at)
                 VALUES (?, ?, ?, datetime('now', 'localtime'))"
            );
            $stmt->execute([$userId, $action, $status]);
        } catch (Exception $e) {
            // Silent fail — don't break main operation
        }
    }

    protected function hasColumn(string $table, string $column): bool {
        if (!isset($this->tableColumnCache[$table])) {
            $this->tableColumnCache[$table] = [];
            try {
                $stmt = $this->pdo->query("PRAGMA table_info($table)");
                $rows = $stmt ? $stmt->fetchAll() : [];
                foreach ($rows as $row) {
                    if (isset($row['name'])) {
                        $this->tableColumnCache[$table][$row['name']] = true;
                    }
                }
            } catch (Exception $e) {
                // If schema introspection fails, default to conservative "missing".
            }
        }
        return isset($this->tableColumnCache[$table][$column]);
    }

    protected function verifyApiKey(): void {
        try {
            $secretStmt = $this->pdo->query(
                "SELECT setting_value FROM rfid_settings WHERE setting_key = 'api_secret_key'"
            );
            $secretRow = $secretStmt ? $secretStmt->fetch() : null;
            if ($secretRow && !empty($secretRow['setting_value'])) {
                $expectedKey = $secretRow['setting_value'];
                $providedKey = $_SERVER['HTTP_X_API_KEY'] ?? ($_POST['api_key'] ?? ($_GET['api_key'] ?? ''));
                if (!hash_equals($expectedKey, $providedKey)) {
                    Response::error('Invalid API key', null, 403);
                }
            }
        } catch (Exception $e) {
            // Ignore if table doesn't exist yet
        }
    }
}
