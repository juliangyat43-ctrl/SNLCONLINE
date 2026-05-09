<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../DataVersion.php';
require_once __DIR__ . '/../SchoolYear.php';
require_once __DIR__ . '/HandlerHelpers.php';

class LeaveHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function getLeaveHistory(): void {
        $userId = intval($_GET['user_id'] ?? 0);

        if ($userId !== (int)$_SESSION['user_id'] && $_SESSION['role'] !== 'admin') {
            Response::error('Access denied');
        }

        $stmt = $this->pdo->prepare(
            "SELECT * FROM leave_requests WHERE user_id = ? ORDER BY submitted_at DESC"
        );
        $stmt->execute([$userId]);
        Response::success('', $stmt->fetchAll());
    }

    public function submitLeave(): void {
        $userId    = intval($_POST['user_id'] ?? 0);

        if ($userId !== (int)$_SESSION['user_id'] && $_SESSION['role'] !== 'admin') {
            Response::error('Access denied');
        }

        $startDate = $this->sanitize($_POST['start_date'] ?? '');
        $endDate   = $this->sanitize($_POST['end_date']   ?? '');
        $leaveType = $this->sanitize($_POST['leave_type'] ?? '');
        $reason    = $this->sanitize($_POST['reason']     ?? '');

        if (empty($startDate) || empty($endDate) || empty($leaveType) || empty($reason)) {
            Response::error('All fields are required');
        }
        if (!$this->validateDate($startDate) || !$this->validateDate($endDate)) {
            Response::error('Invalid date format');
        }
        if (strtotime($endDate) < strtotime($startDate)) {
            Response::error('End date cannot be before start date');
        }

        // Get current school year
        $schoolYear = new SchoolYear($this->pdo);
        $currentSchoolYear = $schoolYear->getCurrentSchoolYear();

        $stmt = $this->pdo->prepare("
            INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, reason, status, school_year, submitted_at)
            VALUES (?, ?, ?, ?, ?, 'Pending', ?, datetime('now', 'localtime'))
        ");
        $stmt->execute([$userId, $startDate, $endDate, $leaveType, $reason, $currentSchoolYear]);

        DataVersion::updateVersion('leaves');
        $this->logActivity($userId, 'Leave Request Submitted');
        Response::success('Leave request submitted successfully');
    }

    public function getAllLeaves(): void {
        $stmt = $this->pdo->query("
            SELECT l.*, u.full_name as student_name
            FROM leave_requests l
            LEFT JOIN users u ON l.user_id = u.user_id
            ORDER BY l.submitted_at DESC
        ");
        Response::success('', $stmt->fetchAll());
    }

    public function updateLeaveStatus(): void {
        $leaveId = intval($_POST['leave_id'] ?? 0);
        $status  = $this->sanitize($_POST['status'] ?? '');

        if (!$leaveId) {
            Response::error('Leave request ID required');
        }
        if (!in_array($status, ['Approved', 'Rejected', 'Pending'])) {
            Response::error('Invalid status');
        }

        $stmt = $this->pdo->prepare(
            "UPDATE leave_requests SET status = ?, reviewed_at = datetime('now', 'localtime') WHERE id = ?"
        );
        $stmt->execute([$status, $leaveId]);
        if ($stmt->rowCount() < 1) {
            Response::error('Leave request not found');
        }

        DataVersion::updateVersion('leaves');
        $this->logActivity($_SESSION['user_id'], "Leave request $status: ID $leaveId");
        Response::success("Leave request $status");
    }
}
