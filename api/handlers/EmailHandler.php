<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

/**
 * EmailHandler - Email notification system
 * 
 * Sends automated emails for:
 * - Enrollment approvals
 * - Payment reminders
 * - Attendance alerts
 * - Announcement broadcasts
 * - Grade updates
 * - Leave request status
 */
class EmailHandler {
    use HandlerHelpers;
    private $pdo;
    private $fromEmail;
    private $fromName;
    private $enabled;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
        $this->fromEmail = 'noreply@snlc.edu.ph'; // Change to your school email
        $this->fromName = 'St. Nazareth Learning Center';
        $this->enabled = true; // Set to false to disable all emails
        
        $this->ensureEmailTables();
    }

    private function ensureEmailTables(): void {
        // Email queue table
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS email_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            to_email TEXT NOT NULL,
            to_name TEXT,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            error_message TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            sent_at TEXT
        )");

        // Notification preferences table
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS notification_preferences (
            user_id INTEGER PRIMARY KEY,
            email_announcements BOOLEAN DEFAULT 1,
            email_attendance BOOLEAN DEFAULT 1,
            email_payments BOOLEAN DEFAULT 1,
            email_grades BOOLEAN DEFAULT 1,
            email_leaves BOOLEAN DEFAULT 1,
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )");

        // Email templates table
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS email_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_key TEXT UNIQUE NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            variables TEXT,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        // Insert default templates
        $this->insertDefaultTemplates();
    }

    private function insertDefaultTemplates(): void {
        $templates = [
            [
                'key' => 'enrollment_approved',
                'subject' => 'Welcome to SNLC - Enrollment Approved',
                'body' => "Dear {{parent_name}},\n\nWe are pleased to inform you that the enrollment for {{student_name}} has been approved!\n\nLogin Credentials:\nEmail: {{parent_email}}\nPassword: {{password}}\n\nYou can now access the parent portal at: {{portal_url}}\n\nWelcome to the SNLC family!\n\nBest regards,\nSt. Nazareth Learning Center",
                'variables' => 'parent_name, student_name, parent_email, password, portal_url'
            ],
            [
                'key' => 'payment_reminder',
                'subject' => 'Payment Reminder - {{student_name}}',
                'body' => "Dear {{parent_name}},\n\nThis is a friendly reminder that a payment is due for {{student_name}}.\n\nAmount Due: ₱{{amount}}\nDue Date: {{due_date}}\nCurrent Balance: ₱{{balance}}\n\nPlease visit the school office or use the online payment portal to settle your account.\n\nThank you for your prompt attention to this matter.\n\nBest regards,\nSNLC Finance Office",
                'variables' => 'parent_name, student_name, amount, due_date, balance'
            ],
            [
                'key' => 'attendance_alert',
                'subject' => 'Attendance Alert - {{student_name}}',
                'body' => "Dear {{parent_name}},\n\nThis is to inform you that {{student_name}} was marked {{status}} on {{date}}.\n\nTime: {{time}}\nStatus: {{status}}\n\nIf you have any questions, please contact the school office.\n\nBest regards,\nSNLC Attendance Office",
                'variables' => 'parent_name, student_name, status, date, time'
            ],
            [
                'key' => 'announcement',
                'subject' => '{{announcement_title}}',
                'body' => "Dear SNLC Community,\n\n{{announcement_content}}\n\nPosted on: {{date}}\n\nFor more information, please visit the parent portal or contact the school office.\n\nBest regards,\nSt. Nazareth Learning Center",
                'variables' => 'announcement_title, announcement_content, date'
            ],
            [
                'key' => 'grade_update',
                'subject' => 'Grade Update - {{student_name}}',
                'body' => "Dear {{parent_name}},\n\nGrades have been updated for {{student_name}} for {{quarter}}.\n\nPlease log in to the parent portal to view the detailed grade report.\n\nBest regards,\nSNLC Academic Office",
                'variables' => 'parent_name, student_name, quarter'
            ],
            [
                'key' => 'leave_approved',
                'subject' => 'Leave Request Approved - {{student_name}}',
                'body' => "Dear {{parent_name}},\n\nYour leave request for {{student_name}} has been approved.\n\nLeave Type: {{leave_type}}\nDates: {{start_date}} to {{end_date}}\nReason: {{reason}}\n\nBest regards,\nSNLC Administration",
                'variables' => 'parent_name, student_name, leave_type, start_date, end_date, reason'
            ],
            [
                'key' => 'leave_rejected',
                'subject' => 'Leave Request Update - {{student_name}}',
                'body' => "Dear {{parent_name}},\n\nWe regret to inform you that your leave request for {{student_name}} could not be approved at this time.\n\nLeave Type: {{leave_type}}\nDates: {{start_date}} to {{end_date}}\n\nPlease contact the school office if you have any questions.\n\nBest regards,\nSNLC Administration",
                'variables' => 'parent_name, student_name, leave_type, start_date, end_date'
            ]
        ];

        foreach ($templates as $template) {
            $stmt = $this->pdo->prepare("
                INSERT OR IGNORE INTO email_templates (template_key, subject, body, variables)
                VALUES (?, ?, ?, ?)
            ");
            $stmt->execute([
                $template['key'],
                $template['subject'],
                $template['body'],
                $template['variables']
            ]);
        }
    }

    /**
     * Queue an email for sending
     */
    private function queueEmail(string $toEmail, string $toName, string $subject, string $body): bool {
        if (!$this->enabled) {
            error_log("Email system disabled - would have sent to: $toEmail");
            return false;
        }

        if (empty($toEmail) || !filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
            error_log("Invalid email address: $toEmail");
            return false;
        }

        $stmt = $this->pdo->prepare("
            INSERT INTO email_queue (to_email, to_name, subject, body)
            VALUES (?, ?, ?, ?)
        ");
        
        return $stmt->execute([$toEmail, $toName, $subject, $body]);
    }

    /**
     * Send enrollment approval email
     */
    public function sendEnrollmentApproval(string $parentEmail, string $parentName, string $studentName, string $password): bool {
        $template = $this->getTemplate('enrollment_approved');
        
        $variables = [
            '{{parent_name}}' => $parentName,
            '{{student_name}}' => $studentName,
            '{{parent_email}}' => $parentEmail,
            '{{password}}' => $password,
            '{{portal_url}}' => 'https://snlc.edu.ph/parent.html' // Change to your actual URL
        ];

        $subject = str_replace(array_keys($variables), array_values($variables), $template['subject']);
        $body = str_replace(array_keys($variables), array_values($variables), $template['body']);

        return $this->queueEmail($parentEmail, $parentName, $subject, $body);
    }

    /**
     * Send payment reminder
     */
    public function sendPaymentReminder(string $parentEmail, string $parentName, string $studentName, float $amount, string $dueDate, float $balance): bool {
        if (!$this->checkPreference($parentEmail, 'email_payments')) {
            return false;
        }

        $template = $this->getTemplate('payment_reminder');
        
        $variables = [
            '{{parent_name}}' => $parentName,
            '{{student_name}}' => $studentName,
            '{{amount}}' => number_format($amount, 2),
            '{{due_date}}' => $dueDate,
            '{{balance}}' => number_format($balance, 2)
        ];

        $subject = str_replace(array_keys($variables), array_values($variables), $template['subject']);
        $body = str_replace(array_keys($variables), array_values($variables), $template['body']);

        return $this->queueEmail($parentEmail, $parentName, $subject, $body);
    }

    /**
     * Send attendance alert
     */
    public function sendAttendanceAlert(string $parentEmail, string $parentName, string $studentName, string $status, string $date, string $time): bool {
        if (!$this->checkPreference($parentEmail, 'email_attendance')) {
            return false;
        }

        $template = $this->getTemplate('attendance_alert');
        
        $variables = [
            '{{parent_name}}' => $parentName,
            '{{student_name}}' => $studentName,
            '{{status}}' => $status,
            '{{date}}' => $date,
            '{{time}}' => $time
        ];

        $subject = str_replace(array_keys($variables), array_values($variables), $template['subject']);
        $body = str_replace(array_keys($variables), array_values($variables), $template['body']);

        return $this->queueEmail($parentEmail, $parentName, $subject, $body);
    }

    /**
     * Broadcast announcement to all parents
     */
    public function broadcastAnnouncement(string $title, string $content): int {
        $template = $this->getTemplate('announcement');
        
        $variables = [
            '{{announcement_title}}' => $title,
            '{{announcement_content}}' => $content,
            '{{date}}' => date('F j, Y')
        ];

        $subject = str_replace(array_keys($variables), array_values($variables), $template['subject']);
        $body = str_replace(array_keys($variables), array_values($variables), $template['body']);

        // Get all parents with email notification enabled
        $stmt = $this->pdo->query("
            SELECT DISTINCT u.parent_email, u.full_name
            FROM users u
            LEFT JOIN notification_preferences np ON u.user_id = np.user_id
            WHERE u.role = 'student' 
              AND u.status = 'active'
              AND u.parent_email IS NOT NULL
              AND u.parent_email != ''
              AND (np.email_announcements IS NULL OR np.email_announcements = 1)
        ");

        $count = 0;
        while ($row = $stmt->fetch()) {
            if ($this->queueEmail($row['parent_email'], $row['full_name'], $subject, $body)) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * Process email queue (call this from a cron job)
     */
    public function processQueue(int $limit = 10): array {
        $stmt = $this->pdo->prepare("
            SELECT * FROM email_queue
            WHERE status = 'pending' AND attempts < 3
            ORDER BY created_at ASC
            LIMIT ?
        ");
        $stmt->execute([$limit]);
        $emails = $stmt->fetchAll();

        $sent = 0;
        $failed = 0;

        foreach ($emails as $email) {
            if ($this->sendEmail($email)) {
                $sent++;
                $this->markEmailSent($email['id']);
            } else {
                $failed++;
                $this->markEmailFailed($email['id'], 'Failed to send');
            }
        }

        return ['sent' => $sent, 'failed' => $failed];
    }

    /**
     * Actually send the email using PHP mail()
     */
    private function sendEmail(array $email): bool {
        $headers = [
            'From: ' . $this->fromName . ' <' . $this->fromEmail . '>',
            'Reply-To: ' . $this->fromEmail,
            'X-Mailer: PHP/' . phpversion(),
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8'
        ];

        $success = mail(
            $email['to_email'],
            $email['subject'],
            $email['body'],
            implode("\r\n", $headers)
        );

        if ($success) {
            error_log("Email sent to: {$email['to_email']} - Subject: {$email['subject']}");
        } else {
            error_log("Failed to send email to: {$email['to_email']}");
        }

        return $success;
    }

    private function markEmailSent(int $id): void {
        $this->pdo->prepare("
            UPDATE email_queue
            SET status = 'sent', sent_at = datetime('now','localtime')
            WHERE id = ?
        ")->execute([$id]);
    }

    private function markEmailFailed(int $id, string $error): void {
        $this->pdo->prepare("
            UPDATE email_queue
            SET attempts = attempts + 1,
                error_message = ?,
                status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE status END
            WHERE id = ?
        ")->execute([$error, $id]);
    }

    private function getTemplate(string $key): array {
        $stmt = $this->pdo->prepare("SELECT * FROM email_templates WHERE template_key = ?");
        $stmt->execute([$key]);
        return $stmt->fetch() ?: ['subject' => '', 'body' => ''];
    }

    private function checkPreference(string $email, string $preference): bool {
        // Allowlist to prevent SQL injection — only known column names permitted
        $allowed = ['email_announcements','email_attendance','email_payments','email_grades','email_leaves'];
        if (!in_array($preference, $allowed, true)) {
            return true; // unknown preference — default to sending
        }

        $stmt = $this->pdo->prepare("
            SELECT np.*
            FROM users u
            LEFT JOIN notification_preferences np ON u.user_id = np.user_id
            WHERE u.parent_email = ?
        ");
        $stmt->execute([$email]);
        $result = $stmt->fetch();
        
        // Default to true if no preference set
        return $result === false || !isset($result[$preference]) || $result[$preference] === null || $result[$preference] == 1;
    }

    /**
     * API endpoint to get notification preferences
     */
    public function getPreferences(): void {
        // Use token-based auth to resolve user ID (not $_SESSION which is empty for token auth)
        $auth = Router::requireAuth($this->pdo);
        $userId = $auth['user_id'] ?? ($_SESSION['user_id'] ?? 0);
        
        $stmt = $this->pdo->prepare("
            SELECT * FROM notification_preferences WHERE user_id = ?
        ");
        $stmt->execute([$userId]);
        $prefs = $stmt->fetch();

        if (!$prefs) {
            // Return defaults
            $prefs = [
                'email_announcements' => 1,
                'email_attendance' => 1,
                'email_payments' => 1,
                'email_grades' => 1,
                'email_leaves' => 1
            ];
        }

        Response::success('Preferences loaded', $prefs);
    }

    /**
     * API endpoint to update notification preferences
     */
    public function updatePreferences(): void {
        // Use token-based auth to resolve user ID (not $_SESSION which is empty for token auth)
        $auth = Router::requireAuth($this->pdo);
        $userId = $auth['user_id'] ?? ($_SESSION['user_id'] ?? 0);
        
        $announcements = intval($_POST['email_announcements'] ?? 1);
        $attendance = intval($_POST['email_attendance'] ?? 1);
        $payments = intval($_POST['email_payments'] ?? 1);
        $grades = intval($_POST['email_grades'] ?? 1);
        $leaves = intval($_POST['email_leaves'] ?? 1);

        $stmt = $this->pdo->prepare("
            INSERT INTO notification_preferences 
            (user_id, email_announcements, email_attendance, email_payments, email_grades, email_leaves, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
            ON CONFLICT(user_id) DO UPDATE SET
                email_announcements = excluded.email_announcements,
                email_attendance = excluded.email_attendance,
                email_payments = excluded.email_payments,
                email_grades = excluded.email_grades,
                email_leaves = excluded.email_leaves,
                updated_at = excluded.updated_at
        ");

        $stmt->execute([$userId, $announcements, $attendance, $payments, $grades, $leaves]);

        Response::success('Preferences updated successfully');
    }
}
