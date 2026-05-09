<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

class StudentHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function getStudentProfile(): void {
        $userId = intval($_GET['user_id'] ?? 0);

        if ($userId !== (int)$_SESSION['user_id'] && $_SESSION['role'] !== 'admin') {
            Response::error('Access denied');
        }

        // Whitelist of allowed columns for security
        $allowedUserColumns = [
            'user_id', 'username', 'full_name', 'role', 'parent_email',
            'grade', 'section', 'class_type', 'status', 'created_at',
            'contact_number', 'address', 'dob', 'gender', 'guardian_name',
            'relationship', 'grades_locked', 'grades_data', 'payments_data'
        ];
        
        $allowedFinancialColumns = [
            'tuition_fee', 'misc_fee', 'amount_paid', 'payment_plan', 'next_payment_date'
        ];
        
        // Build column arrays using only whitelisted column names
        $userColumns = [];
        foreach ($allowedUserColumns as $col) {
            if ($this->hasColumn('users', $col)) {
                $userColumns[] = 'u.' . $col;
            } else {
                $defaults = [
                    'contact_number' => "'' AS contact_number",
                    'address' => "'' AS address",
                    'dob' => "'' AS dob",
                    'gender' => "'' AS gender",
                    'guardian_name' => "'' AS guardian_name",
                    'relationship' => "'' AS relationship",
                    'grades_locked' => '0 AS grades_locked',
                    'grades_data' => "'' AS grades_data",
                    'payments_data' => "'' AS payments_data"
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
                    'misc_fee' => '0 AS misc_fee',
                    'payment_plan' => "'Monthly' AS payment_plan",
                    'next_payment_date' => "'' AS next_payment_date"
                ];
                $financialColumns[] = $defaults[$col] ?? "'' AS {$col}";
            }
        }

        $stmt = $this->pdo->prepare("
            SELECT " . implode(', ', array_merge($userColumns, $financialColumns)) . "
            FROM users u
            LEFT JOIN financial_records f ON u.user_id = f.user_id
            WHERE u.user_id = ?
        ");
        $stmt->execute([$userId]);
        $user = $stmt->fetch();

        if (!$user) {
            Response::error('User not found');
        }

        $stmt = $this->pdo->prepare("SELECT * FROM grades WHERE user_id = ? ORDER BY subject");
        $stmt->execute([$userId]);
        $grades = $stmt->fetchAll();

        Response::success('', [
            'profile' => $user,
            'financial' => [
                'tuition_fee'       => floatval($user['tuition_fee'] ?? 0),
                'misc_fee'          => floatval($user['misc_fee'] ?? 0),
                'amount_paid'       => floatval($user['amount_paid'] ?? 0),
                'payment_plan'      => $user['payment_plan'] ?? 'Monthly',
                'next_payment_date' => $user['next_payment_date'] ?? '',
            ],
            'grades' => $grades,
        ]);
    }

    public function getStudentAttendance(): void {
        $userId = intval($_GET['user_id'] ?? 0);

        if ($userId !== (int)$_SESSION['user_id'] && $_SESSION['role'] !== 'admin') {
            Response::error('Access denied');
        }

        $stmt = $this->pdo->prepare("
            SELECT a.*, '' as day_name
            FROM attendance a
            WHERE a.user_id = ?
            ORDER BY a.date DESC
            LIMIT 100
        ");
        $stmt->execute([$userId]);
        Response::success('', $stmt->fetchAll());
    }

    public function updateContact(): void {
        $userId  = intval($_POST['user_id'] ?? $_SESSION['user_id']);
        if ($userId !== (int)$_SESSION['user_id'] && $_SESSION['role'] !== 'admin') {
            Response::error('Access denied');
        }

        $email   = $this->sanitize($_POST['email']   ?? '');
        $phone   = $this->sanitize($_POST['phone']   ?? '');
        $address = $this->sanitize($_POST['address'] ?? '');

        $stmt = $this->pdo->prepare(
            "UPDATE users SET parent_email = ?, contact_number = ?, address = ? WHERE user_id = ?"
        );
        $stmt->execute([$email, $phone, $address, $userId]);

        $this->logActivity($userId, 'Contact info updated');
        Response::success('Contact information updated successfully');
    }
}
