<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

/**
 * UserDataHandler - Complete user data export/import system
 * 
 * Exports ALL user data including:
 * - Basic info (name, username, role, etc.)
 * - RFID UIDs
 * - Grades data
 * - Payment data
 * - Financial records
 * - Profile photos (as base64)
 */
class UserDataHandler {
    use HandlerHelpers;
    private $pdo;
    private $backupDir;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
        $this->backupDir = __DIR__ . '/../../user_data_backups/';
        $this->ensureBackupDir();
    }

    private function ensureBackupDir(): void {
        if (!is_dir($this->backupDir)) {
            mkdir($this->backupDir, 0755, true);
        }
    }

    /**
     * EXPORT ALL USERS - Complete data export
     */
    public function exportAllUsers(): void {
        try {
            // Get all users with all columns
            $stmt = $this->pdo->query("
                SELECT * FROM users ORDER BY user_id
            ");
            $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // Get financial records
            $stmt = $this->pdo->query("
                SELECT * FROM financial_records ORDER BY user_id
            ");
            $financials = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $financialMap = [];
            foreach ($financials as $f) {
                $financialMap[$f['user_id']] = $f;
            }

            // Build complete export
            $export = [
                'export_date' => date('Y-m-d H:i:s'),
                'total_users' => count($users),
                'users' => []
            ];

            foreach ($users as $user) {
                $userId = $user['user_id'];
                
                // Get profile photo as base64
                $photoPath = __DIR__ . '/../../Profile_pic/' . $userId . '.jpg';
                $photoBase64 = null;
                if (file_exists($photoPath)) {
                    $photoBase64 = base64_encode(file_get_contents($photoPath));
                }

                $export['users'][] = [
                    'user_data' => $user,
                    'financial_data' => $financialMap[$userId] ?? null,
                    'profile_photo' => $photoBase64
                ];
            }

            // Save to file
            $timestamp = date('Y-m-d_His');
            $filename = "users_export_{$timestamp}.json";
            $filepath = $this->backupDir . $filename;
            file_put_contents($filepath, json_encode($export, JSON_PRETTY_PRINT));

            // Also save as latest.json
            file_put_contents($this->backupDir . 'latest.json', json_encode($export, JSON_PRETTY_PRINT));

            Response::success('User data exported', [
                'filename' => $filename,
                'total_users' => count($users),
                'file_size' => filesize($filepath)
            ]);
        } catch (Exception $e) {
            Response::error('Export failed: ' . $e->getMessage());
        }
    }

    /**
     * DOWNLOAD EXPORT - Send JSON file to browser
     */
    public function downloadExport(): void {
        $filename = basename($this->sanitize($_GET['filename'] ?? 'latest.json'));
        $filepath = $this->backupDir . $filename;

        if (!file_exists($filepath)) {
            Response::error('Export file not found');
        }

        header('Content-Type: application/json');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($filepath));
        readfile($filepath);
        exit;
    }

    /**
     * IMPORT USERS - Restore from JSON file
     */
    public function importUsers(): void {
        // Debug: Log all received data
        error_log('Import request received');
        error_log('FILES: ' . print_r($_FILES, true));
        error_log('POST: ' . print_r($_POST, true));
        
        if (!isset($_FILES['import_file'])) {
            Response::error('No file uploaded. Please select a JSON file.');
        }
        
        if ($_FILES['import_file']['error'] !== UPLOAD_ERR_OK) {
            $errorMessages = [
                UPLOAD_ERR_INI_SIZE => 'File exceeds upload_max_filesize in php.ini',
                UPLOAD_ERR_FORM_SIZE => 'File exceeds MAX_FILE_SIZE in HTML form',
                UPLOAD_ERR_PARTIAL => 'File was only partially uploaded',
                UPLOAD_ERR_NO_FILE => 'No file was uploaded',
                UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
                UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk',
                UPLOAD_ERR_EXTENSION => 'File upload stopped by extension'
            ];
            $errorCode = $_FILES['import_file']['error'];
            $errorMsg = $errorMessages[$errorCode] ?? 'Unknown upload error';
            Response::error("Upload error: $errorMsg (code: $errorCode)");
        }

        $tmpFile = $_FILES['import_file']['tmp_name'];
        
        if (!file_exists($tmpFile)) {
            Response::error('Uploaded file not found on server');
        }
        
        $content = file_get_contents($tmpFile);
        
        if (empty($content)) {
            Response::error('Uploaded file is empty');
        }
        
        error_log('File content length: ' . strlen($content));
        
        $import = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            Response::error('Invalid JSON format: ' . json_last_error_msg());
        }

        if (!$import || !isset($import['users'])) {
            $keys = $import ? array_keys($import) : [];
            Response::error('Invalid import file format. Expected format: {"users": [...]}. Found keys: ' . implode(', ', $keys));
        }
        
        if (!is_array($import['users'])) {
            Response::error('Invalid import file: "users" must be an array');
        }
        
        if (empty($import['users'])) {
            Response::error('Import file contains no users');
        }

        $mode = $this->sanitize($_POST['import_mode'] ?? 'update'); // 'update' or 'replace'
        
        error_log("Import mode: $mode, Users count: " . count($import['users']));

        try {
            $this->pdo->beginTransaction();

            $imported = 0;
            $updated = 0;
            $skipped = 0;
            $errors = [];

            foreach ($import['users'] as $index => $userData) {
                try {
                    if (!isset($userData['user_data'])) {
                        $errors[] = "User at index $index: missing 'user_data' field";
                        continue;
                    }
                    
                    $user = $userData['user_data'];
                    $financial = $userData['financial_data'] ?? null;
                    $photo = $userData['profile_photo'] ?? null;
                    
                    if (!isset($user['user_id'])) {
                        $errors[] = "User at index $index: missing 'user_id'";
                        continue;
                    }

                    // Check if user exists
                    $stmt = $this->pdo->prepare("SELECT user_id FROM users WHERE user_id = ?");
                    $stmt->execute([$user['user_id']]);
                    $exists = $stmt->fetch();

                    if ($exists) {
                        if ($mode === 'update') {
                            // Update existing user
                            $this->updateUserFromImport($user);
                            if ($financial) {
                                $this->updateFinancialFromImport($financial);
                            }
                            if ($photo) {
                                $this->saveProfilePhoto($user['user_id'], $photo);
                            }
                            $updated++;
                        } else {
                            $skipped++;
                        }
                    } else {
                        // Insert new user
                        $this->insertUserFromImport($user);
                        if ($financial) {
                            $this->insertFinancialFromImport($financial);
                        }
                        if ($photo) {
                            $this->saveProfilePhoto($user['user_id'], $photo);
                        }
                        $imported++;
                    }
                } catch (Exception $e) {
                    $userId = $user['user_id'] ?? 'unknown';
                    $errors[] = "User ID $userId: " . $e->getMessage();
                    error_log("Import error for user $userId: " . $e->getMessage());
                    // Continue with next user
                }
            }

            $this->pdo->commit();
            
            error_log("Import completed: imported=$imported, updated=$updated, skipped=$skipped, errors=" . count($errors));

            Response::success('Import completed', [
                'imported' => $imported,
                'updated' => $updated,
                'skipped' => $skipped,
                'errors' => $errors,
                'total_processed' => $imported + $updated + $skipped
            ]);
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log('Import transaction failed: ' . $e->getMessage());
            Response::error('Import failed: ' . $e->getMessage());
        }
    }

    /**
     * EXPORT SINGLE USER - Export one user's complete data
     */
    public function exportSingleUser(): void {
        $userId = intval($_GET['user_id'] ?? 0);
        if (!$userId) {
            Response::error('User ID required');
        }

        try {
            // Get user data
            $stmt = $this->pdo->prepare("SELECT * FROM users WHERE user_id = ?");
            $stmt->execute([$userId]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$user) {
                Response::error('User not found');
            }

            // Get financial data
            $stmt = $this->pdo->prepare("SELECT * FROM financial_records WHERE user_id = ?");
            $stmt->execute([$userId]);
            $financial = $stmt->fetch(PDO::FETCH_ASSOC);

            // Get profile photo
            $photoPath = __DIR__ . '/../../Profile_pic/' . $userId . '.jpg';
            $photoBase64 = null;
            if (file_exists($photoPath)) {
                $photoBase64 = base64_encode(file_get_contents($photoPath));
            }

            $export = [
                'export_date' => date('Y-m-d H:i:s'),
                'user_data' => $user,
                'financial_data' => $financial,
                'profile_photo' => $photoBase64
            ];

            // Send as download
            $filename = 'user_' . $user['user_code'] . '_' . date('Y-m-d') . '.json';
            header('Content-Type: application/json');
            header('Content-Disposition: attachment; filename="' . $filename . '"');
            echo json_encode($export, JSON_PRETTY_PRINT);
            exit;
        } catch (Exception $e) {
            Response::error('Export failed: ' . $e->getMessage());
        }
    }

    /**
     * LIST EXPORTS - Get all available export files
     */
    public function listExports(): void {
        $files = glob($this->backupDir . 'users_export_*.json');
        $exports = [];

        foreach ($files as $file) {
            $content = json_decode(file_get_contents($file), true);
            $exports[] = [
                'filename' => basename($file),
                'date' => $content['export_date'] ?? 'Unknown',
                'total_users' => $content['total_users'] ?? 0,
                'size' => filesize($file)
            ];
        }

        // Sort by date descending
        usort($exports, function($a, $b) {
            return strcmp($b['date'], $a['date']);
        });

        Response::success('', [
            'exports' => $exports,
            'latest' => file_exists($this->backupDir . 'latest.json') ? 'latest.json' : null
        ]);
    }

    // ─── HELPER METHODS ──────────────────────────────────────────────────────

    private function updateUserFromImport(array $user): void {
        $sets = [
            'username = ?', 'password = ?', 'full_name = ?', 'role = ?',
            'parent_email = ?', 'grade = ?', 'section = ?', 'class_type = ?',
            'status = ?'
        ];
        $params = [
            $user['username'],
            $user['password'], // Already hashed
            $user['full_name'],
            $user['role'],
            $user['parent_email'],
            $user['grade'],
            $user['section'],
            $user['class_type'],
            $user['status'],
        ];

        // Only include migration-added columns if they exist in the schema
        $optionalCols = [
            'rfid_uid'      => $user['rfid_uid'] ?? null,
            'contact_number'=> $user['contact_number'] ?? '',
            'grades_locked' => $user['grades_locked'] ?? 0,
            'grades_data'   => $user['grades_data'] ?? '',
            'payments_data' => $user['payments_data'] ?? '',
        ];
        foreach ($optionalCols as $col => $val) {
            if ($this->hasColumn('users', $col)) {
                $sets[] = "$col = ?";
                $params[] = $val;
            }
        }

        $params[] = $user['user_id'];
        $sql = "UPDATE users SET " . implode(', ', $sets) . " WHERE user_id = ?";
        $this->pdo->prepare($sql)->execute($params);
    }

    private function insertUserFromImport(array $user): void {
        $cols = [
            'user_id', 'user_code', 'username', 'password', 'full_name', 'role',
            'parent_email', 'grade', 'section', 'class_type', 'status', 'created_at'
        ];
        $params = [
            $user['user_id'],
            $user['user_code'],
            $user['username'],
            $user['password'], // Already hashed
            $user['full_name'],
            $user['role'],
            $user['parent_email'],
            $user['grade'],
            $user['section'],
            $user['class_type'],
            $user['status'],
            $user['created_at'] ?? date('Y-m-d H:i:s'),
        ];

        // Only include migration-added columns if they exist in the schema
        $optionalCols = [
            'rfid_uid'      => $user['rfid_uid'] ?? null,
            'contact_number'=> $user['contact_number'] ?? '',
            'grades_locked' => $user['grades_locked'] ?? 0,
            'grades_data'   => $user['grades_data'] ?? '',
            'payments_data' => $user['payments_data'] ?? '',
        ];
        foreach ($optionalCols as $col => $val) {
            if ($this->hasColumn('users', $col)) {
                $cols[] = $col;
                $params[] = $val;
            }
        }

        $placeholders = implode(', ', array_fill(0, count($cols), '?'));
        $sql = "INSERT INTO users (" . implode(', ', $cols) . ") VALUES ($placeholders)";
        $this->pdo->prepare($sql)->execute($params);
    }

    private function updateFinancialFromImport(array $financial): void {
        $stmt = $this->pdo->prepare("SELECT id FROM financial_records WHERE user_id = ?");
        $stmt->execute([$financial['user_id']]);
        
        if ($stmt->fetch()) {
            $sql = "UPDATE financial_records SET 
                    tuition_fee = ?, amount_paid = ?, payment_plan = ?, next_payment_date = ?
                    WHERE user_id = ?";
            $this->pdo->prepare($sql)->execute([
                $financial['tuition_fee'],
                $financial['amount_paid'],
                $financial['payment_plan'] ?? 'Monthly',
                $financial['next_payment_date'] ?? null,
                $financial['user_id']
            ]);
        } else {
            $this->insertFinancialFromImport($financial);
        }
    }

    private function insertFinancialFromImport(array $financial): void {
        $sql = "INSERT INTO financial_records 
                (user_id, tuition_fee, amount_paid, payment_plan, next_payment_date, created_at)
                VALUES (?, ?, ?, ?, ?, ?)";
        $this->pdo->prepare($sql)->execute([
            $financial['user_id'],
            $financial['tuition_fee'],
            $financial['amount_paid'],
            $financial['payment_plan'] ?? 'Monthly',
            $financial['next_payment_date'] ?? null,
            $financial['created_at'] ?? date('Y-m-d H:i:s')
        ]);
    }

    private function saveProfilePhoto(int $userId, string $base64): void {
        $photoDir = __DIR__ . '/../../Profile_pic/';
        if (!is_dir($photoDir)) {
            mkdir($photoDir, 0755, true);
        }
        
        $photoPath = $photoDir . $userId . '.jpg';
        $imageData = base64_decode($base64);
        file_put_contents($photoPath, $imageData);
    }
}
