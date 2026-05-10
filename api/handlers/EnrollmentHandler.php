<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../RateLimiter.php';
require_once __DIR__ . '/../SchoolYear.php';
require_once __DIR__ . '/HandlerHelpers.php';

class EnrollmentHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function submitEnrollment(): void {
        $fullName      = $this->sanitize($_POST['fullName']       ?? '');
        $username      = $this->sanitize($_POST['username']       ?? '');
        $gradeLevel    = $this->sanitize($_POST['gradeLevel']     ?? '');
        $parentEmail   = $this->sanitize($_POST['parentEmail']    ?? '');
        $contactNumber = $this->sanitize($_POST['contactNumber']  ?? '');
        $address       = $this->sanitize($_POST['address']        ?? '');
        $dob           = $this->sanitize($_POST['dob']            ?? '');
        $gender        = $this->sanitize($_POST['gender']         ?? '');
        $guardianName  = $this->sanitize($_POST['guardian_name']  ?? '');
        $relationship  = $this->sanitize($_POST['relationship']   ?? '');
        $password      = $_POST['password'] ?? ''; // Don't sanitize password

        // Validate required fields
        if (empty($fullName)) {
            Response::error('Student full name is required.');
        }
        if (empty($username)) {
            Response::error('Email / username is required.');
        }
        if (empty($gradeLevel)) {
            Response::error('Grade level is required.');
        }
        if (empty($parentEmail) || !filter_var($parentEmail, FILTER_VALIDATE_EMAIL)) {
            Response::error('A valid parent email address is required.');
        }
        
        // Apply rate limiting based on IP and email (after validation)
        $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $identifier = $clientIp . ':' . strtolower($parentEmail);
        $rateLimiter = new RateLimiter($this->pdo, $identifier, 'enrollment');
        $limitCheck = $rateLimiter->checkLimit();
        
        if (!$limitCheck['allowed']) {
            $retryMinutes = ceil($limitCheck['retry_after'] / 60);
            Response::error("Too many enrollment attempts. Please try again in $retryMinutes minute(s).");
        }
        if (empty($contactNumber)) {
            Response::error('Contact number is required.');
        }
        if (empty($address)) {
            Response::error('Home address is required.');
        }
        if (empty($password) || strlen($password) < 6) {
            Response::error('Password must be at least 6 characters long.');
        }

        // Check if email/username already exists as an active user
        $stmt = $this->pdo->prepare("SELECT username FROM users WHERE username = ?");
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            Response::error('This email is already registered. Please use a different email or go to the login page.');
        }

        // Check if already has a pending enrollment with same email
        $stmt = $this->pdo->prepare(
            "SELECT enrollment_id FROM enrollments WHERE username = ? AND status = 'Pending'"
        );
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            Response::error('A pending enrollment already exists for this email. Please wait for admin approval or contact the school.');
        }

        // Hash password before storing (security fix - no longer plain text)
        $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
        
        // Get current school year
        $schoolYear = new SchoolYear($this->pdo);
        $currentSchoolYear = $schoolYear->getCurrentSchoolYear();
        
        $stmt = $this->pdo->prepare("
            INSERT INTO enrollments
                (full_name, username, grade_level, parent_email, contact_number, address,
                 dob, gender, guardian_name, relationship, chosen_password, status, created_at, school_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', datetime('now', 'localtime'), ?)
        ");
        $stmt->execute([
            $fullName, $username, $gradeLevel, $parentEmail, $contactNumber,
            $address, $dob, $gender, $guardianName, $relationship, $hashedPassword, $currentSchoolYear
        ]);

        // Clear rate limit on successful enrollment submission
        $rateLimiter->recordSuccess();

        Response::success(
            'Pre-enrollment submitted successfully! Please wait for admin approval.',
            ['enrollment_id' => $this->pdo->lastInsertId()]
        );
    }

    public function getEnrollments(): void {
        $schoolYear = new SchoolYear($this->pdo);
        $currentYear = $schoolYear->getCurrentSchoolYear();

        $stmt = $this->pdo->prepare("SELECT * FROM enrollments WHERE (school_year = ? OR school_year IS NULL) ORDER BY created_at DESC");
        $stmt->execute([$currentYear]);
        Response::success('Enrollments fetched', $stmt->fetchAll());
    }

    private function generateDefaultPassword(?string $fullName): string {
        $name = trim((string)$fullName);
        $firstToken = '';
        if ($name !== '') {
            $parts = preg_split('/\s+/', $name);
            $firstToken = $parts[0] ?? '';
        }
        $base = preg_replace('/[^a-zA-Z0-9]/', '', $firstToken ?? '');
        if ($base === '') {
            $base = 'Student';
        }
        return $base . 'SNLC';
    }

    private function generateUniqueUserCode(): string {
        $maxAttempts = 20;
        for ($i = 0; $i < $maxAttempts; $i++) {
            $candidate = 'STD-' . mt_rand(1000, 9999);
            $stmt = $this->pdo->prepare("SELECT 1 FROM users WHERE user_code = ? LIMIT 1");
            $stmt->execute([$candidate]);
            if (!$stmt->fetch()) {
                return $candidate;
            }
        }
        // Fallback to timestamp-based code if all random codes are taken
        return 'STD-' . strtoupper(substr(uniqid('', true), -6));
    }

    public function approveEnrollment(): void {
        $id = intval($_POST['id'] ?? 0);
        if (!$id) {
            Response::error('Enrollment ID required');
        }

        $stmt = $this->pdo->prepare("SELECT * FROM enrollments WHERE enrollment_id = ?");
        $stmt->execute([$id]);
        $enrollment = $stmt->fetch();

        if (!$enrollment) {
            Response::error('Enrollment not found');
        }
        if ($enrollment['status'] !== 'Pending') {
            Response::error('Enrollment already processed');
        }

        $stmt = $this->pdo->prepare("SELECT username FROM users WHERE username = ?");
        $stmt->execute([$enrollment['username']]);
        if ($stmt->fetch()) {
            Response::error('Username already taken by another user.');
        }

        // Use the password chosen by parent during enrollment
        $chosenPassword = $enrollment['chosen_password'] ?? '';
        if (empty($chosenPassword)) {
            // Fallback to auto-generated password if none was provided (for old enrollments)
            $chosenPassword = $this->generateDefaultPassword($enrollment['full_name'] ?? '');
            $hashedPassword = password_hash($chosenPassword, PASSWORD_DEFAULT);
        } else {
            // Check if password is already hashed (new enrollments) or plain text (old enrollments)
            if (password_get_info($chosenPassword)['algo'] === null) {
                // Plain text password (old enrollment) - hash it now
                $hashedPassword = password_hash($chosenPassword, PASSWORD_DEFAULT);
            } else {
                // Already hashed (new enrollment) - use directly
                $hashedPassword = $chosenPassword;
                // For email notification, we need to inform that password was already set
                $chosenPassword = '[password set during enrollment]';
            }
        }
        $userCode = $this->generateUniqueUserCode();

        try {
            $this->pdo->beginTransaction();

            $stmt = $this->pdo->prepare("
                INSERT INTO users
                    (user_code, username, password, full_name, role, grade, parent_email,
                     contact_number, address, dob, gender, guardian_name, relationship,
                     status, created_at)
                VALUES (?, ?, ?, ?, 'student', ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now', 'localtime'))
            ");
            $stmt->execute([
                $userCode, $enrollment['username'], $hashedPassword, $enrollment['full_name'],
                $enrollment['grade_level'], $enrollment['parent_email'],
                $enrollment['contact_number'], $enrollment['address'], $enrollment['dob'],
                $enrollment['gender'], $enrollment['guardian_name'], $enrollment['relationship'],
            ]);
            $newUserId = $this->pdo->lastInsertId();

            $this->pdo->prepare("
                INSERT INTO financial_records (user_id, tuition_fee, misc_fee, amount_paid, created_at)
                VALUES (?, 0, 0, 0, datetime('now', 'localtime'))
            ")->execute([$newUserId]);

            $this->pdo->prepare(
                "UPDATE enrollments SET status = 'Approved' WHERE enrollment_id = ?"
            )->execute([$id]);

            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log("Approve enrollment transaction failed: " . $e->getMessage());
            Response::error('Approval failed. No changes were made.');
        }

        $this->logActivity($_SESSION['user_id'] ?? null, "Approved enrollment for {$enrollment['full_name']}");
        
        // Send email notification (without password for security)
        try {
            require_once __DIR__ . '/EmailHandler.php';
            $emailHandler = new EmailHandler($this->pdo);
            $emailHandler->sendEnrollmentApproval(
                $enrollment['parent_email'],
                $enrollment['guardian_name'] ?? 'Parent/Guardian',
                $enrollment['full_name'],
                '' // Password no longer included in email for security
            );
        } catch (Exception $e) {
            error_log("Failed to send enrollment email: " . $e->getMessage());
            // Don't fail the approval if email fails
        }
        
        Response::success(
            'Enrollment approved. Student account created.',
            [
                'username' => $enrollment['username'],
                'full_name' => $enrollment['full_name'],
                'password_set' => 'Password set during enrollment (not included for security)',
                'email_sent' => 'Notification email queued'
            ]
        );
    }

    public function rejectEnrollment(): void {
        $id = intval($_POST['id'] ?? 0);
        if (!$id) {
            Response::error('Enrollment ID required');
        }

        $stmt = $this->pdo->prepare("SELECT status FROM enrollments WHERE enrollment_id = ?");
        $stmt->execute([$id]);
        $enrollment = $stmt->fetch();
        if (!$enrollment) {
            Response::error('Enrollment not found');
        }
        if ($enrollment['status'] !== 'Pending') {
            Response::error('Only pending enrollments can be rejected.');
        }

        $this->pdo->prepare(
            "UPDATE enrollments SET status = 'Rejected' WHERE enrollment_id = ?"
        )->execute([$id]);

        $this->logActivity($_SESSION['user_id'] ?? null, "Rejected enrollment ID $id");
        Response::success('Enrollment rejected.');
    }

    public function deleteEnrollment(): void {
        $id = intval($_POST['id'] ?? 0);
        if (!$id) {
            Response::error('Enrollment ID required');
        }

        $stmt = $this->pdo->prepare("SELECT 1 FROM enrollments WHERE enrollment_id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            Response::error('Enrollment not found');
        }

        $this->pdo->prepare(
            "DELETE FROM enrollments WHERE enrollment_id = ?"
        )->execute([$id]);

        $this->logActivity($_SESSION['user_id'] ?? null, "Deleted enrollment ID $id");
        Response::success('Enrollment permanently deleted.');
    }
}
