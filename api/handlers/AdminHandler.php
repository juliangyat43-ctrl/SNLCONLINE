<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../DataVersion.php';
require_once __DIR__ . '/../DataDeduplicator.php';
require_once __DIR__ . '/HandlerHelpers.php';

class AdminHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function getAdminStats(): void {
        $stats = [];

        $stmt = $this->pdo->query(
            "SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'active'"
        );
        $stats['students'] = intval($stmt->fetchColumn());

        $stmt = $this->pdo->query(
            "SELECT COUNT(*) FROM users WHERE role = 'teacher' AND status = 'active'"
        );
        $stats['teachers'] = intval($stmt->fetchColumn());

        $today = date('Y-m-d');
        $stmt  = $this->pdo->prepare(
            "SELECT COUNT(DISTINCT user_id) FROM attendance WHERE date = ? AND status IN ('Present', 'Late')"
        );
        $stmt->execute([$today]);
        $stats['today_attendance'] = intval($stmt->fetchColumn());

        $stmt = $this->pdo->query("SELECT COUNT(*) FROM enrollments WHERE status = 'Pending'");
        $stats['alerts'] = intval($stmt->fetchColumn());

        Response::success('', $stats);
    }

    public function getAllUsers(): void {
        // Whitelist of allowed columns for security
        $allowedUserColumns = [
            'user_id', 'username', 'full_name', 'role', 'parent_email', 'grade',
            'section', 'class_type', 'status', 'contact_number', 'grades_locked',
            'grades_data', 'payments_data', 'rfid_uid'
        ];
        
        $allowedFinancialColumns = [
            'tuition_fee', 'amount_paid', 'payment_plan', 'next_payment_date'
        ];
        
        // Build column arrays using only whitelisted column names
        $userColumns = [];
        foreach ($allowedUserColumns as $col) {
            if ($this->hasColumn('users', $col)) {
                $userColumns[] = 'u.' . $col;
            } else {
                // Provide default values for missing columns
                $defaults = [
                    'contact_number' => "'' AS contact_number",
                    'grades_locked' => '0 AS grades_locked',
                    'grades_data' => "'' AS grades_data",
                    'payments_data' => "'' AS payments_data",
                    'rfid_uid' => "'' AS rfid_uid"
                ];
                $userColumns[] = $defaults[$col] ?? "'' AS {$col}";
            }
        }
        
        $financialColumns = [];
        foreach ($allowedFinancialColumns as $col) {
            if ($this->hasColumn('financial_records', $col)) {
                $financialColumns[] = 'f.' . $col;
            } else {
                $defaults = [
                    'payment_plan' => "'Monthly' AS payment_plan",
                    'next_payment_date' => "'' AS next_payment_date"
                ];
                $financialColumns[] = $defaults[$col] ?? "'' AS {$col}";
            }
        }

        $schoolYear = new SchoolYear($this->pdo);
        $currentYear = $schoolYear->getCurrentSchoolYear();

        $stmt = $this->pdo->prepare("
            SELECT " . implode(', ', array_merge($userColumns, $financialColumns)) . "
            FROM users u
            LEFT JOIN financial_records f ON u.user_id = f.user_id AND (f.school_year = ? OR f.school_year IS NULL)
            ORDER BY
                CASE u.role WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 WHEN 'student' THEN 3 END,
                u.full_name
        ");
        $stmt->execute([$currentYear]);
        $users = $stmt->fetchAll();

        Response::success('', $users);
    }

    public function addUser(): void {
        $fullName   = $this->sanitize($_POST['full_name']    ?? '');
        $username   = $this->sanitize($_POST['username']     ?? '');
        $password   = $_POST['password'] ?? '';
        $role       = $this->sanitize($_POST['role']         ?? 'student');
        $parentEmail= $this->sanitize($_POST['parent_email'] ?? '');
        $grade      = $this->sanitize($_POST['grade']        ?? '');
        $section    = $this->sanitize($_POST['section']      ?? '');
        $classType  = $this->sanitize($_POST['class_type']   ?? '');
        $tuitionFee = floatval($_POST['tuition_fee'] ?? 0);
        $amountPaid = floatval($_POST['amount_paid'] ?? 0);
        $rfidUid    = $this->sanitize($_POST['rfid_uid']     ?? '');
        $status     = $this->sanitize($_POST['status']       ?? 'active');
        $permissions= $_POST['permissions'] ?? '[]';
        if (is_array($permissions)) {
            $permissions = json_encode($permissions);
        }

        if (empty($fullName) || empty($username) || empty($role)) {
            Response::error('Name, username, and role are required');
        }
        if (empty($password)) {
            Response::error('Password required for new users');
        }

        $stmt = $this->pdo->prepare("SELECT user_id FROM users WHERE username = ?");
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            Response::error('Username already exists');
        }

        $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
        // Generate a unique user code with better collision handling
        $userCode = null;
        $maxAttempts = 20;
        for ($i = 0; $i < $maxAttempts; $i++) {
            $candidate = 'STD-' . mt_rand(1000, 9999);
            $chk = $this->pdo->prepare("SELECT 1 FROM users WHERE user_code = ? LIMIT 1");
            $chk->execute([$candidate]);
            if (!$chk->fetch()) {
                $userCode = $candidate;
                break;
            }
        }
        if (!$userCode) {
            // Fallback to timestamp-based code if all random codes are taken
            $userCode = 'STD-' . strtoupper(substr(uniqid('', true), -6));
        }

        try {
            $this->pdo->beginTransaction();

            $stmt = $this->pdo->prepare("
                INSERT INTO users
                    (user_code, username, password, full_name, role, parent_email,
                     grade, section, class_type, status, rfid_uid, permissions, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ");
            $stmt->execute([
                $userCode, $username, $hashedPassword, $fullName, $role,
                $parentEmail, $grade, $section, $classType, $status, $rfidUid ?: null, $permissions
            ]);
            $newUserId = $this->pdo->lastInsertId();

            if ($role === 'student') {
                $this->pdo->prepare("
                    INSERT INTO financial_records (user_id, tuition_fee, amount_paid, created_at)
                    VALUES (?, ?, ?, datetime('now', 'localtime'))
                ")->execute([$newUserId, $tuitionFee, $amountPaid]);
                
                // Sync financial data to users table for consistency
                DataDeduplicator::syncFinancialToUsers($this->pdo, $newUserId);
            }

            $this->pdo->commit();
            
            // Update data version for sync
            DataVersion::updateVersion('users');
            if ($role === 'student') {
                DataVersion::updateVersion('financial_records');
            }
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log("User add transaction failed: " . $e->getMessage());
            Response::error('User addition failed. No changes were made.');
        }

        $this->logActivity($_SESSION['user_id'], "User Added: $fullName ($role)");
        Response::success('User added successfully', ['user_id' => $newUserId]);
    }

    public function updateUser(): void {
        $userId     = intval($_POST['user_id']    ?? 0);
        $fullName   = $this->sanitize($_POST['full_name']    ?? '');
        $username   = $this->sanitize($_POST['username']     ?? '');
        $password   = $_POST['password'] ?? '';
        $role       = $this->sanitize($_POST['role']         ?? 'student');
        $parentEmail= $this->sanitize($_POST['parent_email'] ?? '');
        $grade      = $this->sanitize($_POST['grade']        ?? '');
        $section    = $this->sanitize($_POST['section']      ?? '');
        $classType  = $this->sanitize($_POST['class_type']   ?? '');
        $contactNumber = $this->sanitize($_POST['contact_number'] ?? '');
        $tuitionFee = floatval($_POST['tuition_fee'] ?? 0);
        $amountPaid = floatval($_POST['amount_paid'] ?? 0);
        $paymentPlan= $this->sanitize($_POST['payment_plan'] ?? 'monthly');
        $rfidUid    = $this->sanitize($_POST['rfid_uid']     ?? '');
        $status     = $this->sanitize($_POST['status']       ?? 'active');
        $permissions= $_POST['permissions'] ?? '[]';
        if (is_array($permissions)) {
            $permissions = json_encode($permissions);
        }

        if (empty($fullName) || empty($username) || empty($role)) {
            Response::error('Name, username, and role are required');
        }

        $stmt = $this->pdo->prepare(
            "SELECT user_id FROM users WHERE username = ? AND user_id != ?"
        );
        $stmt->execute([$username, $userId]);
        if ($stmt->fetch()) {
            Response::error('Username already exists');
        }

        $sql    = "UPDATE users SET full_name = ?, username = ?, role = ?, parent_email = ?,
                   grade = ?, section = ?, class_type = ?, status = ?, contact_number = ?, rfid_uid = ?, permissions = ?";
        $params = [$fullName, $username, $role, $parentEmail, $grade, $section, $classType, $status, $contactNumber, $rfidUid ?: null, $permissions];

        if (!empty($password)) {
            $sql     .= ", password = ?";
            $params[] = password_hash($password, PASSWORD_DEFAULT);
        }

        $sql     .= " WHERE user_id = ?";
        $params[] = $userId;

        try {
            $this->pdo->beginTransaction();

            $this->pdo->prepare($sql)->execute($params);

            if ($role === 'student') {
                $check = $this->pdo->prepare("SELECT id FROM financial_records WHERE user_id = ?");
                $check->execute([$userId]);
                if ($check->fetch()) {
                    if ($this->hasColumn('financial_records', 'payment_plan')) {
                        $this->pdo->prepare(
                            "UPDATE financial_records SET tuition_fee = ?, amount_paid = ?, payment_plan = ? WHERE user_id = ?"
                        )->execute([$tuitionFee, $amountPaid, $paymentPlan, $userId]);
                    } else {
                        $this->pdo->prepare(
                            "UPDATE financial_records SET tuition_fee = ?, amount_paid = ? WHERE user_id = ?"
                        )->execute([$tuitionFee, $amountPaid, $userId]);
                    }
                } else {
                    if ($this->hasColumn('financial_records', 'payment_plan')) {
                        $this->pdo->prepare("
                            INSERT INTO financial_records (user_id, tuition_fee, amount_paid, payment_plan, created_at)
                            VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
                        ")->execute([$userId, $tuitionFee, $amountPaid, $paymentPlan]);
                    } else {
                        $this->pdo->prepare("
                            INSERT INTO financial_records (user_id, tuition_fee, amount_paid, created_at)
                            VALUES (?, ?, ?, datetime('now', 'localtime'))
                        ")->execute([$userId, $tuitionFee, $amountPaid]);
                    }
                }
                
                // Sync financial data to users table for consistency
                DataDeduplicator::syncFinancialToUsers($this->pdo, $userId);
            } else {
                $this->pdo->prepare(
                    "DELETE FROM financial_records WHERE user_id = ?"
                )->execute([$userId]);
            }

            $this->pdo->commit();
            
            // Update data version for sync
            DataVersion::updateVersion('users');
            if ($role === 'student') {
                DataVersion::updateVersion('financial_records');
            }
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log("User update transaction failed: " . $e->getMessage());
            Response::error('User update failed. No changes were made.');
        }

        // Auto-backup RFID assignments if RFID UID was changed (outside transaction)
        if (!empty($rfidUid)) {
            try {
                require_once __DIR__ . '/RfidBackupHandler.php';
                $backupHandler = new RfidBackupHandler($this->pdo);
                $backupHandler->autoBackup();
            } catch (Exception $e) {
                // Don't fail the update if backup fails
                error_log("RFID auto-backup failed: " . $e->getMessage());
            }
        }

        $this->logActivity($_SESSION['user_id'], "User Updated: $fullName");
        Response::success('User updated successfully');
    }

    public function updateUserStatus(): void {
        $userId = intval($_POST['user_id'] ?? 0);
        $status = $this->sanitize($_POST['status'] ?? 'active');

        if (!in_array($status, ['active', 'inactive'])) {
            Response::error('Invalid status');
        }

        $this->pdo->prepare(
            "UPDATE users SET status = ? WHERE user_id = ?"
        )->execute([$status, $userId]);

        DataVersion::updateVersion('users');
        $this->logActivity($_SESSION['user_id'], "User status changed to $status");
        Response::success('Status updated');
    }

    public function toggleNoShow(): void {
        $userId = intval($_POST['user_id'] ?? 0);
        $locked = intval($_POST['grades_locked'] ?? 0);

        $this->pdo->prepare(
            "UPDATE users SET grades_locked = ? WHERE user_id = ?"
        )->execute([$locked, $userId]);

        DataVersion::updateVersion('users');
        $statusStr = $locked ? 'locked' : 'unlocked';
        $this->logActivity($_SESSION['user_id'], "Grades access $statusStr for user $userId");
        Response::success("Grades access $statusStr");
    }

    public function updateGradesData(): void {
        $userId = intval($_POST['user_id'] ?? 0);
        $gradesData = $_POST['grades_data'] ?? '{}'; // Expect JSON string

        // Optional: sanitize JSON or let it be raw since it's admin.
        $this->pdo->prepare(
            "UPDATE users SET grades_data = ? WHERE user_id = ?"
        )->execute([$gradesData, $userId]);

        DataVersion::updateVersion('users');
        $this->logActivity($_SESSION['user_id'], "Updated grades data for user $userId");
        Response::success("Grades updated");
    }

    public function updatePaymentsData(): void {
        $userId = intval($_POST['user_id'] ?? 0);
        $paymentsData = $_POST['payments_data'] ?? '{}';

        if ($userId <= 0) {
            Response::error('Valid user ID required');
        }
        if (!$this->hasColumn('users', 'payments_data')) {
            Response::error('Payments tracking is not available in this database schema yet.');
        }

        $this->pdo->prepare(
            "UPDATE users SET payments_data = ? WHERE user_id = ?"
        )->execute([$paymentsData, $userId]);

        DataVersion::updateVersion('users');
        $this->logActivity($_SESSION['user_id'], "Updated payments data for user $userId");
        Response::success("Payments data updated");
    }

    public function uploadProfilePic(): void {
        $userId = intval($_POST['user_id'] ?? 0);
        if ($userId <= 0) {
            Response::error('Invalid user ID');
        }

        $exists = $this->pdo->prepare('SELECT 1 FROM users WHERE user_id = ?');
        $exists->execute([$userId]);
        if (!$exists->fetchColumn()) {
            Response::error('User not found');
        }

        if (!isset($_FILES['profile_pic']) || $_FILES['profile_pic']['error'] !== UPLOAD_ERR_OK) {
            Response::error('No file uploaded or upload error');
        }

        $file = $_FILES['profile_pic'];
        $maxBytes = 5 * 1024 * 1024;
        if (intval($file['size'] ?? 0) > $maxBytes) {
            Response::error('Image must be 5MB or smaller');
        }

        $tmp = $file['tmp_name'];

        /**
         * Server-side MIME validation:
         *   1. Primary: finfo_open / finfo_file (reads magic bytes, not client filename)
         *   2. Fallback: getimagesize (also reads file content)
         * Allowed MIME types: image/jpeg, image/png, image/gif, image/webp
         *
         * PNG→JPEG conversion:
         *   Uses GD imagecreatefromstring + imagejpeg at quality 88.
         *   Quality 88 balances file size and visual fidelity.
         *   Falls back to move_uploaded_file only when GD is unavailable.
         */
        $mime = null;
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            if ($fi) {
                $mime = finfo_file($fi, $tmp) ?: null;
                finfo_close($fi);
            }
        }
        if (!$mime) {
            $info = @getimagesize($tmp);
            $mime = is_array($info) && !empty($info['mime']) ? $info['mime'] : null;
        }

        $allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!in_array($mime, $allowed, true)) {
            Response::error('Only JPEG, PNG, GIF, or WebP images are allowed');
        }

        $uploadDir = __DIR__ . '/../../Profile_pic/';
        if (!is_dir($uploadDir) && !@mkdir($uploadDir, 0755, true)) {
            Response::error('Could not create Profile_pic directory (check server permissions)');
        }

        $targetPath = $uploadDir . $userId . '.jpg';
        $ok = false;

        if (function_exists('imagecreatefromstring') && function_exists('imagejpeg')) {
            // GD path: convert any supported format to JPEG at quality 88
            $data = @file_get_contents($tmp);
            if ($data === false || $data === '') {
                Response::error('Could not read uploaded file');
            }
            $im = @imagecreatefromstring($data);
            if ($im === false) {
                Response::error('Invalid or corrupted image');
            }
            if (@imagejpeg($im, $targetPath, 88)) {
                $ok = true;
            }
            imagedestroy($im);
        } else {
            // Fallback: GD unavailable — use move_uploaded_file (no format conversion)
            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'], true)) {
                Response::error('Only image files are allowed');
            }
            $ok = @move_uploaded_file($tmp, $targetPath);
        }

        if (!$ok) {
            Response::error('Failed to save profile picture');
        }

        $this->logActivity((int)$_SESSION['user_id'], "Profile picture updated for user $userId");
        Response::success('Profile picture updated successfully');
    }

    public function deleteProfilePic(): void {
        $userId = intval($_POST['user_id'] ?? 0);
        if ($userId <= 0) {
            Response::error('Invalid user ID');
        }

        $exists = $this->pdo->prepare('SELECT 1 FROM users WHERE user_id = ?');
        $exists->execute([$userId]);
        if (!$exists->fetchColumn()) {
            Response::error('User not found');
        }

        $path = __DIR__ . '/../../Profile_pic/' . $userId . '.jpg';
        if (is_file($path) && !@unlink($path)) {
            Response::error('Could not remove profile picture file');
        }

        $this->logActivity((int)$_SESSION['user_id'], "Profile picture removed for user $userId");
        Response::success('Profile picture removed');
    }

    public function deleteUser(): void {
        $userId = intval($_POST['user_id'] ?? 0);

        if (!$userId) {
            Response::error('User ID required');
        }

        if (isset($_SESSION['user_id']) && $userId == $_SESSION['user_id']) {
            Response::error('Cannot delete your own account');
        }

        $stmt = $this->pdo->prepare("SELECT full_name, role FROM users WHERE user_id = ?");
        $stmt->execute([$userId]);
        $target = $stmt->fetch();

        if (!$target) {
            Response::error('User not found');
        }
        if ($target['role'] === 'admin') {
            Response::error('Cannot delete an admin account');
        }

        // Properly wrap the whole block so beginTransaction failure is also caught
        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare("DELETE FROM payment_logs    WHERE user_id = ?")->execute([$userId]);
            $this->pdo->prepare("DELETE FROM activity_logs   WHERE user_id = ?")->execute([$userId]);
            $this->pdo->prepare("DELETE FROM leave_requests  WHERE user_id = ?")->execute([$userId]);
            $this->pdo->prepare("DELETE FROM attendance      WHERE user_id = ?")->execute([$userId]);
            $this->pdo->prepare("DELETE FROM grades          WHERE user_id = ?")->execute([$userId]);
            $this->pdo->prepare("DELETE FROM financial_records WHERE user_id = ?")->execute([$userId]);
            $this->pdo->prepare("DELETE FROM users           WHERE user_id = ?")->execute([$userId]);
            $this->pdo->commit();
            
            // Update data versions for sync
            DataVersion::updateVersion('users');
            DataVersion::updateVersion('attendance');
            DataVersion::updateVersion('financial_records');
            DataVersion::updateVersion('leaves');
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log("Delete user transaction failed: " . $e->getMessage());
            Response::error('Delete failed. No data was changed.');
        }

        $this->logActivity(
            $_SESSION['user_id'],
            "Permanently deleted user: {$target['full_name']} (ID $userId)"
        );
        Response::success('User permanently deleted');
    }

    public function getChartData(): void {
        $stmt = $this->pdo->query(
            "SELECT grade, COUNT(*) as count FROM users WHERE role = 'student'
             GROUP BY grade ORDER BY grade"
        );
        $enrollmentsByGrade = $stmt->fetchAll();

        $stmt = $this->pdo->query(
            "SELECT date, COUNT(DISTINCT user_id) as present_count
             FROM attendance WHERE status IN ('Present', 'Late')
             GROUP BY date ORDER BY date DESC LIMIT 7"
        );
        $attendanceTrends = array_reverse($stmt->fetchAll());

        Response::success('', [
            'enrollmentsByGrade' => $enrollmentsByGrade,
            'attendanceTrends'   => $attendanceTrends,
        ]);
    }

    public function getRecentActivity(): void {
        $stmt = $this->pdo->query("
            SELECT al.*, u.full_name as user_name
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.user_id
            ORDER BY al.created_at DESC
            LIMIT 50
        ");
        Response::success('', $stmt->fetchAll());
    }

    /**
     * GET action=get_students_for_rfid  (PUBLIC — called by the Java RFID terminal)
     * Returns all active users with RFID UIDs for offline student bank sync.
     */
    public function getStudentsForRfid(): void {
        $this->verifyApiKey();
        $stmt = $this->pdo->query("
            SELECT u.user_id, u.user_code, u.full_name, u.role,
                   u.grade, u.section, u.class_type, u.status, u.rfid_uid
            FROM users u
            WHERE u.status = 'active'
              AND u.rfid_uid IS NOT NULL
              AND u.rfid_uid != ''
            ORDER BY u.full_name
        ");
        Response::success('', $stmt->fetchAll());
    }

    /**
     * GET action=get_profile_photos  (PUBLIC — called by the Java RFID terminal)
     * Returns a list of all users that have a profile photo, with the file's
     * last-modified Unix timestamp so the terminal can decide whether to re-download.
     *
     * Response: { success: true, data: [ { user_id, modified_at }, ... ] }
     */
    public function getProfilePhotos(): void {
        $this->verifyApiKey();
        $photoDir = __DIR__ . '/../../Profile_pic/';
        $photos   = [];

        if (is_dir($photoDir)) {
            foreach (glob($photoDir . '*.jpg') as $file) {
                $basename = basename($file, '.jpg');
                if (ctype_digit($basename)) {
                    $photos[] = [
                        'user_id'     => (int)$basename,
                        'modified_at' => filemtime($file), // Unix timestamp
                    ];
                }
            }
        }

        Response::success('', $photos);
    }

    public function updateGrade(): void {
        if ($_SESSION['role'] !== 'teacher' && $_SESSION['role'] !== 'admin') {
            Response::error('Unauthorized');
        }

        $userId  = intval($_POST['user_id'] ?? 0);
        $subject = $this->sanitize($_POST['subject']  ?? '');
        $grade   = floatval($_POST['grade']   ?? 0);
        $units   = intval($_POST['units']    ?? 0);
        $remarks = $this->sanitize($_POST['remarks']  ?? '');

        if (!$userId || empty($subject)) {
            Response::error('User ID and subject required');
        }
        if ($grade < 0 || $grade > 100) {
            Response::error('Grade must be between 0 and 100');
        }

        $stmt = $this->pdo->prepare("SELECT id FROM grades WHERE user_id = ? AND subject = ?");
        $stmt->execute([$userId, $subject]);
        $existing = $stmt->fetch();

        if ($existing) {
            $this->pdo->prepare(
                "UPDATE grades SET grade = ?, units = ?, remarks = ? WHERE id = ?"
            )->execute([$grade, $units, $remarks, $existing['id']]);
        } else {
            $this->pdo->prepare("
                INSERT INTO grades (user_id, subject, grade, units, remarks, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ")->execute([$userId, $subject, $grade, $units, $remarks]);
        }

        $this->logActivity($_SESSION['user_id'], "Grade updated for user $userId - $subject");
        Response::success('Grade updated successfully');
    }
}
