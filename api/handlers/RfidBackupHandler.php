<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

/**
 * RfidBackupHandler - Automatic backup and restore of RFID assignments
 * 
 * Prevents loss of RFID UIDs when redeploying or updating the system.
 * Automatically backs up to rfid_backups/ folder as JSON files.
 */
class RfidBackupHandler {
    use HandlerHelpers;
    private $pdo;
    private $backupDir;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
        $this->backupDir = __DIR__ . '/../../rfid_backups/';
        $this->ensureBackupDir();
    }

    private function ensureBackupDir(): void {
        if (!is_dir($this->backupDir)) {
            mkdir($this->backupDir, 0755, true);
        }
    }

    /**
     * AUTO-BACKUP: Called automatically whenever RFID UID is assigned/changed
     * Creates timestamped backup + latest.json
     */
    public function autoBackup(): void {
        try {
            $stmt = $this->pdo->query("
                SELECT user_id, user_code, full_name, rfid_uid, grade, section, role, status
                FROM users 
                WHERE rfid_uid IS NOT NULL AND rfid_uid != ''
                ORDER BY user_id
            ");
            $assignments = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $backup = [
                'backup_date' => date('Y-m-d H:i:s'),
                'total_assignments' => count($assignments),
                'assignments' => $assignments
            ];

            // Save timestamped backup
            $timestamp = date('Y-m-d_His');
            $timestampFile = $this->backupDir . "rfid_backup_{$timestamp}.json";
            file_put_contents($timestampFile, json_encode($backup, JSON_PRETTY_PRINT));

            // Save as latest.json (for quick restore)
            $latestFile = $this->backupDir . 'latest.json';
            file_put_contents($latestFile, json_encode($backup, JSON_PRETTY_PRINT));

            // Keep only last 30 backups
            $this->cleanOldBackups(30);

            Response::success('RFID assignments backed up', [
                'total' => count($assignments),
                'file' => basename($timestampFile)
            ]);
        } catch (Exception $e) {
            Response::error('Backup failed: ' . $e->getMessage());
        }
    }

    /**
     * RESTORE: Restore RFID assignments from backup
     * Only updates users that exist in the database
     */
    public function restore(): void {
        $filename = $this->sanitize($_POST['filename'] ?? 'latest.json');
        $filepath = $this->backupDir . $filename;

        if (!file_exists($filepath)) {
            Response::error('Backup file not found: ' . $filename);
        }

        try {
            $backup = json_decode(file_get_contents($filepath), true);
            if (!$backup || !isset($backup['assignments'])) {
                Response::error('Invalid backup file format');
            }

            $restored = 0;
            $skipped = 0;
            $errors = [];

            $this->pdo->beginTransaction();

            foreach ($backup['assignments'] as $assignment) {
                $userId = intval($assignment['user_id']);
                $rfidUid = $assignment['rfid_uid'];

                // Check if user still exists
                $check = $this->pdo->prepare("SELECT user_id FROM users WHERE user_id = ?");
                $check->execute([$userId]);
                
                if ($check->fetch()) {
                    // Update RFID UID
                    $update = $this->pdo->prepare("UPDATE users SET rfid_uid = ? WHERE user_id = ?");
                    $update->execute([$rfidUid, $userId]);
                    $restored++;
                } else {
                    $skipped++;
                    $errors[] = "User ID {$userId} ({$assignment['full_name']}) not found";
                }
            }

            $this->pdo->commit();

            Response::success('RFID assignments restored', [
                'restored' => $restored,
                'skipped' => $skipped,
                'errors' => $errors,
                'from_backup' => $backup['backup_date']
            ]);
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Restore failed: ' . $e->getMessage());
        }
    }

    /**
     * LIST: Get all available backups
     */
    public function listBackups(): void {
        $files = glob($this->backupDir . 'rfid_backup_*.json');
        $backups = [];

        foreach ($files as $file) {
            $content = json_decode(file_get_contents($file), true);
            $backups[] = [
                'filename' => basename($file),
                'date' => $content['backup_date'] ?? 'Unknown',
                'total' => $content['total_assignments'] ?? 0,
                'size' => filesize($file),
                'path' => $file
            ];
        }

        // Sort by date descending
        usort($backups, function($a, $b) {
            return strcmp($b['date'], $a['date']);
        });

        Response::success('', [
            'backups' => $backups,
            'latest' => file_exists($this->backupDir . 'latest.json') ? 'latest.json' : null
        ]);
    }

    /**
     * EXPORT: Download backup as JSON file
     */
    public function export(): void {
        $filename = $this->sanitize($_GET['filename'] ?? 'latest.json');
        $filepath = $this->backupDir . $filename;

        if (!file_exists($filepath)) {
            Response::error('Backup file not found');
        }

        header('Content-Type: application/json');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        readfile($filepath);
        exit;
    }

    /**
     * IMPORT: Upload and restore from JSON file
     */
    public function import(): void {
        if (!isset($_FILES['backup_file']) || $_FILES['backup_file']['error'] !== UPLOAD_ERR_OK) {
            Response::error('No file uploaded or upload error');
        }

        $tmpFile = $_FILES['backup_file']['tmp_name'];
        $backup = json_decode(file_get_contents($tmpFile), true);

        if (!$backup || !isset($backup['assignments'])) {
            Response::error('Invalid backup file format');
        }

        // Save uploaded file to backup directory
        $timestamp = date('Y-m-d_His');
        $filename = "rfid_backup_imported_{$timestamp}.json";
        $filepath = $this->backupDir . $filename;
        move_uploaded_file($tmpFile, $filepath);

        // Restore from the imported file
        $_POST['filename'] = $filename;
        $this->restore();
    }

    /**
     * COMPARE: Compare current assignments with backup
     */
    public function compare(): void {
        $filename = $this->sanitize($_GET['filename'] ?? 'latest.json');
        $filepath = $this->backupDir . $filename;

        if (!file_exists($filepath)) {
            Response::error('Backup file not found');
        }

        $backup = json_decode(file_get_contents($filepath), true);
        
        // Get current assignments
        $stmt = $this->pdo->query("
            SELECT user_id, user_code, full_name, rfid_uid
            FROM users 
            WHERE rfid_uid IS NOT NULL AND rfid_uid != ''
        ");
        $current = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Build comparison
        $backupMap = [];
        foreach ($backup['assignments'] as $a) {
            $backupMap[$a['user_id']] = $a['rfid_uid'];
        }

        $currentMap = [];
        foreach ($current as $c) {
            $currentMap[$c['user_id']] = $c['rfid_uid'];
        }

        $missing = []; // In backup but not in current
        $added = [];   // In current but not in backup
        $changed = []; // Different RFID UID

        foreach ($backupMap as $userId => $rfidUid) {
            if (!isset($currentMap[$userId])) {
                $missing[] = [
                    'user_id' => $userId,
                    'rfid_uid' => $rfidUid,
                    'name' => $backup['assignments'][array_search($userId, array_column($backup['assignments'], 'user_id'))]['full_name']
                ];
            } elseif ($currentMap[$userId] !== $rfidUid) {
                $changed[] = [
                    'user_id' => $userId,
                    'old_rfid' => $rfidUid,
                    'new_rfid' => $currentMap[$userId],
                    'name' => $backup['assignments'][array_search($userId, array_column($backup['assignments'], 'user_id'))]['full_name']
                ];
            }
        }

        foreach ($currentMap as $userId => $rfidUid) {
            if (!isset($backupMap[$userId])) {
                $user = array_values(array_filter($current, fn($c) => $c['user_id'] == $userId))[0];
                $added[] = [
                    'user_id' => $userId,
                    'rfid_uid' => $rfidUid,
                    'name' => $user['full_name']
                ];
            }
        }

        Response::success('', [
            'backup_date' => $backup['backup_date'],
            'missing' => $missing,
            'added' => $added,
            'changed' => $changed,
            'summary' => [
                'backup_total' => count($backupMap),
                'current_total' => count($currentMap),
                'missing_count' => count($missing),
                'added_count' => count($added),
                'changed_count' => count($changed)
            ]
        ]);
    }

    /**
     * Clean old backups, keep only the most recent N files
     */
    private function cleanOldBackups(int $keep = 30): void {
        $files = glob($this->backupDir . 'rfid_backup_*.json');
        if (count($files) <= $keep) return;

        // Sort by modification time, oldest first
        usort($files, function($a, $b) {
            return filemtime($a) - filemtime($b);
        });

        // Delete oldest files
        $toDelete = array_slice($files, 0, count($files) - $keep);
        foreach ($toDelete as $file) {
            unlink($file);
        }
    }
}
