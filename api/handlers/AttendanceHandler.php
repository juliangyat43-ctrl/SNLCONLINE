<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../DataVersion.php';
require_once __DIR__ . '/../SchoolYear.php';
require_once __DIR__ . '/HandlerHelpers.php';

class AttendanceHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function getAllAttendance(): void {
        $fromDate = $_GET['from_date'] ?? null;
        $toDate   = $_GET['to_date']   ?? null;

        $schoolYear = new SchoolYear($this->pdo);
        $currentYear = $schoolYear->getCurrentSchoolYear();

        $sql    = "SELECT a.*, u.full_name, u.user_code FROM attendance a
                   LEFT JOIN users u ON a.user_id = u.user_id
                   WHERE (a.school_year = ? OR a.school_year IS NULL)";
        $params = [$currentYear];


        if ($fromDate && $this->validateDate($fromDate)) {
            $sql     .= " AND a.date >= ?";
            $params[] = $fromDate;
        }
        if ($toDate && $this->validateDate($toDate)) {
            $sql     .= " AND a.date <= ?";
            $params[] = $toDate;
        }

        $sql .= " ORDER BY a.date DESC, a.time_in DESC LIMIT 500";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        Response::success('', $stmt->fetchAll());
    }

    public function addAttendance(): void {
        $userId      = intval($_POST['user_id'] ?? 0);
        $date        = $this->sanitize($_POST['date'] ?? '');
        $timeIn      = !empty($_POST['time_in'])  ? $this->sanitize($_POST['time_in'])  : null;
        $timeOut     = !empty($_POST['time_out']) ? $this->sanitize($_POST['time_out']) : null;
        $status      = $this->sanitize($_POST['status'] ?? 'Present');
        $lateMinutes = intval($_POST['late_minutes'] ?? 0);

        if (!$userId) {
            Response::error('Valid user ID required');
        }
        
        if (empty($date) || !$this->validateDate($date)) {
            Response::error('Valid date required (YYYY-MM-DD format)');
        }
        
        // Prevent future dates
        if (strtotime($date) > strtotime('today')) {
            Response::error('Attendance date cannot be in the future');
        }
        
        // Validate time formats if provided
        if ($timeIn && !$this->validateTime($timeIn)) {
            Response::error('Invalid time_in format (use HH:MM format)');
        }
        if ($timeOut && !$this->validateTime($timeOut)) {
            Response::error('Invalid time_out format (use HH:MM format)');
        }
        
        // Validate late minutes
        if ($lateMinutes < 0 || $lateMinutes > 480) { // Max 8 hours late
            Response::error('Invalid late minutes value');
        }
        
        // Validate user exists
        $stmt = $this->pdo->prepare("SELECT user_id FROM users WHERE user_id = ?");
        $stmt->execute([$userId]);
        if (!$stmt->fetch()) {
            Response::error('User not found');
        }

        // Prevent duplicate attendance records for the same user on the same day
        $dup = $this->pdo->prepare("SELECT id FROM attendance WHERE user_id = ? AND date = ? LIMIT 1");
        $dup->execute([$userId, $date]);
        if ($dup->fetch()) {
            Response::error('An attendance record already exists for this student on ' . $date . '. Use edit instead.');
        }

        // Get current school year
        $schoolYear = new SchoolYear($this->pdo);
        $currentSchoolYear = $schoolYear->getCurrentSchoolYear();

        $stmt = $this->pdo->prepare("
            INSERT INTO attendance (user_id, date, time_in, time_out, status, late_minutes, created_at, school_year)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)
        ");
        $stmt->execute([$userId, $date, $timeIn, $timeOut, $status, $lateMinutes, $currentSchoolYear]);

        DataVersion::updateVersion('attendance');
        $this->logActivity($_SESSION['user_id'], "Attendance added for user $userId");
        Response::success('Attendance record saved');
    }

    public function updateAttendance(): void {
        $userId      = intval($_POST['user_id'] ?? 0);
        $date        = $this->sanitize($_POST['date'] ?? '');
        $timeIn      = !empty($_POST['time_in'])  ? $this->sanitize($_POST['time_in'])  : null;
        $timeOut     = !empty($_POST['time_out']) ? $this->sanitize($_POST['time_out']) : null;
        $status      = $this->sanitize($_POST['status'] ?? 'Present');
        $lateMinutes = intval($_POST['late_minutes'] ?? 0);
        $attId       = intval($_POST['id'] ?? 0);

        if (!$userId) {
            Response::error('Valid user ID required');
        }
        
        if (empty($date) || !$this->validateDate($date)) {
            Response::error('Valid date required (YYYY-MM-DD format)');
        }
        
        // Prevent future dates
        if (strtotime($date) > strtotime('today')) {
            Response::error('Attendance date cannot be in the future');
        }
        
        // Validate time formats if provided
        if ($timeIn && !$this->validateTime($timeIn)) {
            Response::error('Invalid time_in format (use HH:MM format)');
        }
        if ($timeOut && !$this->validateTime($timeOut)) {
            Response::error('Invalid time_out format (use HH:MM format)');
        }
        
        // Validate late minutes
        if ($lateMinutes < 0 || $lateMinutes > 480) {
            Response::error('Invalid late minutes value');
        }
        
        if (!$attId) {
            Response::error('Attendance ID required for update');
        }
        
        // Validate user exists
        $stmt = $this->pdo->prepare("SELECT user_id FROM users WHERE user_id = ?");
        $stmt->execute([$userId]);
        if (!$stmt->fetch()) {
            Response::error('User not found');
        }

        $stmt = $this->pdo->prepare("
            UPDATE attendance
            SET user_id = ?, date = ?, time_in = ?, time_out = ?, status = ?, late_minutes = ?
            WHERE id = ?
        ");
        $stmt->execute([$userId, $date, $timeIn, $timeOut, $status, $lateMinutes, $attId]);

        DataVersion::updateVersion('attendance');
        $this->logActivity($_SESSION['user_id'], "Attendance updated for user $userId");
        Response::success('Attendance record saved');
    }

    public function deleteAttendance(): void {
        $attId = intval($_POST['att_id'] ?? 0);
        if (!$attId) {
            Response::error('Attendance ID required');
        }

        $this->pdo->prepare("DELETE FROM attendance WHERE id = ?")->execute([$attId]);

        DataVersion::updateVersion('attendance');
        $this->logActivity($_SESSION['user_id'], "Attendance record deleted: ID $attId");
        Response::success('Record deleted');
    }
}
