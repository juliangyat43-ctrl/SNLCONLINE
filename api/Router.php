<?php
require_once __DIR__ . '/Response.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/handlers/AuthHandler.php';
require_once __DIR__ . '/handlers/StudentHandler.php';
require_once __DIR__ . '/handlers/AttendanceHandler.php';
require_once __DIR__ . '/handlers/LeaveHandler.php';
require_once __DIR__ . '/handlers/EnrollmentHandler.php';
require_once __DIR__ . '/handlers/AnnouncementHandler.php';
require_once __DIR__ . '/handlers/FinancialHandler.php';
require_once __DIR__ . '/handlers/AdminHandler.php';
require_once __DIR__ . '/handlers/RfidHandler.php';
require_once __DIR__ . '/handlers/RfidSettingsHandler.php';
require_once __DIR__ . '/handlers/RfidBackupHandler.php';
require_once __DIR__ . '/handlers/UserDataHandler.php';
require_once __DIR__ . '/handlers/CalendarHandler.php';
require_once __DIR__ . '/handlers/GlobalSettingsHandler.php';
require_once __DIR__ . '/handlers/EmailHandler.php';
require_once __DIR__ . '/handlers/ConsoleHandler.php';
require_once __DIR__ . '/DataVersion.php';

class Router {
    const PUBLIC_ROUTE = 0;
    const AUTH_ROUTE   = 1;
    const ADMIN_ROUTE  = 2;

    /** @var array<string, array{0:string,1:string,2:int}> */
    private static $routes = [
        // Auth
        'login'           => ['AuthHandler', 'login',          self::PUBLIC_ROUTE],
        'logout'          => ['AuthHandler', 'logout',         self::PUBLIC_ROUTE],
        'forgot_password' => ['AuthHandler', 'forgotPassword', self::PUBLIC_ROUTE],
        'session_status'  => ['AuthHandler', 'sessionStatus',  self::PUBLIC_ROUTE],

        // Student
        'get_student_profile'    => ['StudentHandler', 'getStudentProfile',    self::AUTH_ROUTE],
        'get_student_attendance' => ['StudentHandler', 'getStudentAttendance', self::AUTH_ROUTE],
        'update_contact'         => ['StudentHandler', 'updateContact',        self::AUTH_ROUTE],
        'upload_own_profile_pic' => ['StudentHandler', 'uploadOwnProfilePic',  self::AUTH_ROUTE],

        // Leave
        'get_leave_history'   => ['LeaveHandler', 'getLeaveHistory',  self::AUTH_ROUTE],
        'submit_leave'        => ['LeaveHandler', 'submitLeave',       self::AUTH_ROUTE],
        'get_all_leaves'      => ['LeaveHandler', 'getAllLeaves',       self::ADMIN_ROUTE],
        'update_leave_status' => ['LeaveHandler', 'updateLeaveStatus', self::ADMIN_ROUTE],

        // Attendance
        'add_attendance'     => ['AttendanceHandler', 'addAttendance',    self::ADMIN_ROUTE],
        'update_attendance'  => ['AttendanceHandler', 'updateAttendance', self::ADMIN_ROUTE],
        'delete_attendance'  => ['AttendanceHandler', 'deleteAttendance', self::ADMIN_ROUTE],
        'get_all_attendance' => ['AttendanceHandler', 'getAllAttendance',  self::ADMIN_ROUTE],
        'rfid_tap'           => ['RfidHandler', 'tap',                    self::PUBLIC_ROUTE],
        'rfid_heartbeat'     => ['RfidSettingsHandler', 'heartbeat',      self::PUBLIC_ROUTE],
        'get_rfid_settings'  => ['RfidSettingsHandler', 'getRfidSettings',  self::ADMIN_ROUTE],
        'save_rfid_settings' => ['RfidSettingsHandler', 'saveRfidSettings', self::ADMIN_ROUTE],
        
        // RFID Backup & Restore
        'rfid_backup_auto'    => ['RfidBackupHandler', 'autoBackup',   self::ADMIN_ROUTE],
        'rfid_backup_restore' => ['RfidBackupHandler', 'restore',      self::ADMIN_ROUTE],
        'rfid_backup_list'    => ['RfidBackupHandler', 'listBackups',  self::ADMIN_ROUTE],
        'rfid_backup_export'  => ['RfidBackupHandler', 'export',       self::ADMIN_ROUTE],
        'rfid_backup_import'  => ['RfidBackupHandler', 'import',       self::ADMIN_ROUTE],
        'rfid_backup_compare' => ['RfidBackupHandler', 'compare',      self::ADMIN_ROUTE],

        // Enrollment
        'submit_enrollment'  => ['EnrollmentHandler', 'submitEnrollment',  self::PUBLIC_ROUTE],
        'get_enrollments'    => ['EnrollmentHandler', 'getEnrollments',    self::ADMIN_ROUTE],
        'approve_enrollment' => ['EnrollmentHandler', 'approveEnrollment', self::ADMIN_ROUTE],
        'reject_enrollment'  => ['EnrollmentHandler', 'rejectEnrollment',  self::ADMIN_ROUTE],
        'delete_enrollment'  => ['EnrollmentHandler', 'deleteEnrollment',  self::ADMIN_ROUTE],

        // Announcements
        'get_announcements'   => ['AnnouncementHandler', 'getAnnouncements',  self::PUBLIC_ROUTE],
        'add_announcement'    => ['AnnouncementHandler', 'addAnnouncement',   self::ADMIN_ROUTE],
        'delete_announcement' => ['AnnouncementHandler', 'deleteAnnouncement',self::ADMIN_ROUTE],

        // Financial
        'record_payment'        => ['FinancialHandler', 'recordPayment',       self::ADMIN_ROUTE],
        'update_financial_plan' => ['FinancialHandler', 'updateFinancialPlan', self::ADMIN_ROUTE],

        // Admin
        'get_admin_stats'      => ['AdminHandler', 'getAdminStats',     self::ADMIN_ROUTE],
        'get_all_users'        => ['AdminHandler', 'getAllUsers',        self::ADMIN_ROUTE],
        'add_user'             => ['AdminHandler', 'addUser',           self::ADMIN_ROUTE],
        'update_user'          => ['AdminHandler', 'updateUser',        self::ADMIN_ROUTE],
        'update_user_status'   => ['AdminHandler', 'updateUserStatus',  self::ADMIN_ROUTE],
        'upload_profile_pic'   => ['AdminHandler', 'uploadProfilePic',  self::ADMIN_ROUTE],
        'delete_profile_pic'   => ['AdminHandler', 'deleteProfilePic',  self::ADMIN_ROUTE],
        'toggle_no_show'       => ['AdminHandler', 'toggleNoShow',      self::ADMIN_ROUTE],
        'update_grades_data'   => ['AdminHandler', 'updateGradesData',  self::ADMIN_ROUTE],
        'update_payments_data' => ['AdminHandler', 'updatePaymentsData',self::ADMIN_ROUTE],
        'delete_user'          => ['AdminHandler', 'deleteUser',        self::ADMIN_ROUTE],
        'get_chart_data'       => ['AdminHandler', 'getChartData',      self::ADMIN_ROUTE],
        'get_recent_activity'  => ['AdminHandler', 'getRecentActivity', self::ADMIN_ROUTE],
        'update_grade'         => ['AdminHandler', 'updateGrade',       self::AUTH_ROUTE],
        'get_profile_photos'   => ['AdminHandler', 'getProfilePhotos',  self::PUBLIC_ROUTE],
        'get_students_for_rfid'=> ['AdminHandler', 'getStudentsForRfid',self::PUBLIC_ROUTE],

        // Calendar
        'get_calendar_events'   => ['CalendarHandler', 'getCalendarEvents',   self::AUTH_ROUTE],
        'add_calendar_event'    => ['CalendarHandler', 'addCalendarEvent',    self::ADMIN_ROUTE],
        'update_calendar_event' => ['CalendarHandler', 'updateCalendarEvent', self::ADMIN_ROUTE],
        'delete_calendar_event' => ['CalendarHandler', 'deleteCalendarEvent', self::ADMIN_ROUTE],

        // Global Settings
        'get_global_settings'   => ['GlobalSettingsHandler', 'getGlobalSettings', self::AUTH_ROUTE],
        'set_global_fees'       => ['GlobalSettingsHandler', 'setGlobalFees',     self::ADMIN_ROUTE],

        // User Data Export/Import
        'export_all_users'      => ['UserDataHandler', 'exportAllUsers',    self::ADMIN_ROUTE],
        'download_user_export'  => ['UserDataHandler', 'downloadExport',    self::ADMIN_ROUTE],
        'import_users'          => ['UserDataHandler', 'importUsers',       self::ADMIN_ROUTE],
        'export_single_user'    => ['UserDataHandler', 'exportSingleUser',  self::ADMIN_ROUTE],
        'list_user_exports'     => ['UserDataHandler', 'listExports',       self::ADMIN_ROUTE],

        // Email Notifications
        'get_notification_prefs'    => ['EmailHandler', 'getPreferences',      self::AUTH_ROUTE],
        'update_notification_prefs' => ['EmailHandler', 'updatePreferences',   self::AUTH_ROUTE],
        'process_email_queue'       => ['EmailHandler', 'processQueue',        self::ADMIN_ROUTE],

        // System Console (Admin Monitoring)
        'check_rfid_status'     => ['ConsoleHandler', 'checkRfidStatus',    self::ADMIN_ROUTE],
        'check_user_session'    => ['ConsoleHandler', 'checkUserSession',   self::ADMIN_ROUTE],
        'admin_logout_user'     => ['ConsoleHandler', 'adminLogoutUser',    self::ADMIN_ROUTE],
        'get_active_sessions'   => ['ConsoleHandler', 'getActiveSessions',  self::ADMIN_ROUTE],
        'get_error_logs'        => ['ConsoleHandler', 'getErrorLogs',       self::ADMIN_ROUTE],
        'get_rfid_queue_status' => ['ConsoleHandler', 'getRfidQueueStatus', self::ADMIN_ROUTE],
        'admin_sql_query'       => ['ConsoleHandler', 'adminSqlQuery',      self::ADMIN_ROUTE],
        'get_user_stats'        => ['ConsoleHandler', 'getUserStats',       self::ADMIN_ROUTE],
        'get_system_stats'      => ['ConsoleHandler', 'getSystemStats',     self::ADMIN_ROUTE],
        'clear_all_caches'      => ['ConsoleHandler', 'clearAllCaches',     self::ADMIN_ROUTE],
    ];

    public static function dispatch(string $action): void {
        if ($action === 'ping') {
            Response::success('OK', ['server_time' => date('Y-m-d H:i:s')]);
            return;
        }

        if ($action === 'get_data_versions') {
            Response::success('', DataVersion::getAllVersions());
            return;
        }

        if ($action === 'check_data_updates') {
            $since = isset($_GET['since']) ? intval($_GET['since']) : 0;
            Response::success('', DataVersion::hasUpdatesSince($since));
            return;
        }

        if ($action === '') {
            Response::error('Missing action');
        }

        if (!array_key_exists($action, self::$routes)) {
            Response::error('Invalid action: ' . htmlspecialchars($action));
        }

        $pdo = Database::connect();

        [$class, $method, $authLevel] = self::$routes[$action];

        // Validate CSRF token for POST requests (except PUBLIC_ROUTE)
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && $authLevel !== self::PUBLIC_ROUTE) {
            self::validateCsrfToken();
        }

        if ($authLevel === self::ADMIN_ROUTE) {
            self::requireAdminOrPermission($pdo, $action);
        } elseif ($authLevel === self::AUTH_ROUTE) {
            self::requireAuth($pdo);
        }

        $handler = new $class($pdo);
        $handler->$method();
    }

    /**
     * Authenticate request. Tries token first (X-Session-Token header),
     * then falls back to PHP session for backward compatibility.
     */
    public static function requireAuth(PDO $pdo): array {
        // ── Token-based auth (primary, v12+) ──────────────────────────────
        $token = $_SERVER['HTTP_X_SESSION_TOKEN'] ?? ($_POST['session_token'] ?? '');

        if (!empty($token)) {
            $stmt = $pdo->prepare("
                SELECT s.user_id, s.role, u.status, u.full_name, u.username, u.permissions
                FROM sessions s
                JOIN users u ON u.user_id = s.user_id
                WHERE s.token = ?
                  AND s.expires_at > datetime('now','localtime')
            ");
            $stmt->execute([$token]);
            $user = $stmt->fetch();

            if ($user && $user['status'] === 'active') {
                // Sliding expiry: extend session by 24h on each valid request
                $pdo->prepare("
                    UPDATE sessions
                    SET expires_at = datetime('now','localtime','+24 hours')
                    WHERE token = ?
                ")->execute([$token]);
                return $user;
            }
            // Token present but invalid — don't fall through to session auth
            Response::error('Session expired - Please login again', null, 401, 'token_expired');
        }

        // ── PHP session fallback (legacy / SSR clients) ───────────────────
        if (!isset($_SESSION['user_id'])) {
            Response::error('Unauthorized - Please login', null, 401);
        }

        $stmt = $pdo->prepare("SELECT user_id, role, status, permissions FROM users WHERE user_id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch();

        if (!$user || $user['status'] !== 'active') {
            session_destroy();
            Response::error('Session expired or account disabled', null, 401);
        }

        return $user;
    }

    public static function requireAdminOrPermission(PDO $pdo, string $action): array {
        $user = self::requireAuth($pdo);
        if ($user['role'] === 'admin') {
            return $user;
        }
        if ($user['role'] === 'teacher') {
            $actionMap = [
                'add_attendance' => 'attendance', 'update_attendance' => 'attendance', 'delete_attendance' => 'attendance', 'get_all_attendance' => 'attendance',
                'update_grades_data' => 'grades',
                'get_all_users' => 'users', 'add_user' => 'users', 'update_user' => 'users', 'delete_user' => 'users',
                'record_payment' => 'financials', 'update_financial_plan' => 'financials',
                'get_enrollments' => 'enrollments', 'approve_enrollment' => 'enrollments', 'reject_enrollment' => 'enrollments', 'delete_enrollment' => 'enrollments',
                'add_announcement' => 'announcements', 'delete_announcement' => 'announcements',
                'get_all_leaves' => 'leaves', 'update_leave_status' => 'leaves',
                'get_rfid_settings' => 'rfid', 'save_rfid_settings' => 'rfid',
                'export_all_users' => 'users', 'import_users' => 'users', 'export_single_user' => 'users', 'list_user_exports' => 'users',
                'add_calendar_event' => 'announcements', 'update_calendar_event' => 'announcements', 'delete_calendar_event' => 'announcements'
            ];
            
            if (isset($actionMap[$action])) {
                $requiredPerm = $actionMap[$action];
                $perms = json_decode($user['permissions'] ?? '[]', true) ?: [];
                if (in_array($requiredPerm, $perms)) {
                    return $user;
                }
            }
            
            // Allow basic read actions for dashboard/general loading if they are a teacher
            $basicActions = ['get_admin_stats', 'get_chart_data', 'get_recent_activity', 'get_all_users'];
            if (in_array($action, $basicActions)) {
                return $user;
            }
        }
        Response::error('Admin or specific permission required', null, 403, 'not_admin');
        // Response::error() calls exit(), but return to satisfy static analysis
        return [];
    }

    /**
     * Validate CSRF token for POST requests
     */
    private static function validateCsrfToken(): void {
        // Get CSRF token from header or POST body
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf_token'] ?? '');
        
        if (empty($token)) {
            Response::error('CSRF token missing', null, 403, 'csrf_missing');
        }
        
        // Get expected token from session
        if (!isset($_SESSION['csrf_token'])) {
            Response::error('Session expired - please login again', null, 403, 'csrf_session_expired');
        }
        
        $expectedToken = $_SESSION['csrf_token'];
        
        // Use timing-safe comparison to prevent timing attacks
        if (!hash_equals($expectedToken, $token)) {
            Response::error('Invalid CSRF token', null, 403, 'csrf_invalid');
        }
    }
}
