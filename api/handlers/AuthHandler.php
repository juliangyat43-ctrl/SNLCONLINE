<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../RateLimiter.php';
require_once __DIR__ . '/HandlerHelpers.php';

class AuthHandler {
    use HandlerHelpers;
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
        $this->ensureSessionsTable();
    }

    private function ensureSessionsTable(): void {
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            role       TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )");
    }

    private function createSessionToken(int $userId, string $role): string {
        $token = bin2hex(random_bytes(32));
        $this->pdo->prepare("
            INSERT INTO sessions (token, user_id, role, expires_at)
            VALUES (?, ?, ?, datetime('now','localtime','+24 hours'))
        ")->execute([$token, $userId, $role]);
        return $token;
    }

    public function login(): void {
        $username = $this->sanitize($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';
        $role     = $this->sanitize($_POST['role'] ?? 'student');
        
        // Get client IP for rate limiting
        $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

        if (empty($username) || empty($password)) {
            Response::error('Email/Username and password required');
        }
        
        // Apply rate limiting based on IP and username
        $identifier = $clientIp . ':' . strtolower($username);
        $rateLimiter = new RateLimiter($this->pdo, $identifier, 'login');
        $limitCheck = $rateLimiter->checkLimit();
        
        if (!$limitCheck['allowed']) {
            $retryMinutes = ceil($limitCheck['retry_after'] / 60);
            Response::error("Too many login attempts. Please try again in $retryMinutes minute(s).");
        }

        // For parent/student login, allow login with email OR username
        // For admin login, only allow username
        if ($role === 'student') {
            // Try to find user by email first (for parents), then by username
            $stmt = $this->pdo->prepare(
                "SELECT user_id, username, password, role, full_name, parent_email, status, permissions
                 FROM users WHERE LOWER(parent_email) = LOWER(?) OR LOWER(username) = LOWER(?)"
            );
            $stmt->execute([$username, $username]);
        } else {
            // Admin login - username only
            $stmt = $this->pdo->prepare(
                "SELECT user_id, username, password, role, full_name, parent_email, status, permissions
                 FROM users WHERE LOWER(username) = LOWER(?)"
            );
            $stmt->execute([$username]);
        }
        
        $user = $stmt->fetch();

        if (!$user) {
            $rateLimiter->recordFailure($clientIp, $username);
            $this->logActivity(null, "Login failed - Invalid credentials: $username", 'Failed');
            Response::error('Invalid credentials.');
        }

        $allowedRoles = ($role === 'admin') ? ['admin', 'teacher'] : ['student'];
        if (!in_array(strtolower($user['role']), $allowedRoles)) {
            $rateLimiter->recordFailure($clientIp, $username);
            $tabName = ($role === 'student') ? 'Parent' : 'Administrator';
            $this->logActivity($user['user_id'], "Login failed - Role mismatch (Tab: $tabName, Actual: {$user['role']})", 'Failed');
            Response::error("This account is registered as a " . ucfirst($user['role']) . ". Please select the correct tab.");
        }

        if ($user['status'] !== 'active') {
            $rateLimiter->recordFailure($clientIp, $username);
            $this->logActivity($user['user_id'], "Login failed - Account disabled", 'Failed');
            Response::error('Account is disabled. Contact admin.');
        }

        $valid = false;
        if (password_verify($password, $user['password'])) {
            $valid = true;
        } elseif ($password === $user['password']) {
            $hashed = password_hash($password, PASSWORD_DEFAULT);
            $this->pdo->prepare("UPDATE users SET password = ? WHERE user_id = ?")->execute([$hashed, $user['user_id']]);
            $valid = true;
        }

        if (!$valid) {
            $rateLimiter->recordFailure($clientIp, $username);
            $this->logActivity($user['user_id'], "Login failed - Invalid credentials: $username", 'Failed');
            Response::error('Invalid credentials.');
        }

        $_SESSION['user_id'] = $user['user_id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['role']     = $user['role'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        $sessionToken = $this->createSessionToken((int)$user['user_id'], $user['role']);

        // Clear rate limit on successful login
        $rateLimiter->recordSuccess();
        
        $this->logActivity($user['user_id'], 'User Login');
        Response::success('Login successful', [
            'user_id'       => (int)$user['user_id'],
            'full_name'     => $user['full_name'],
            'username'      => $user['username'],
            'role'          => $user['role'],
            'parent_email'  => $user['parent_email'],
            'session_token' => $sessionToken,
            'csrf_token'    => $_SESSION['csrf_token'],
            'id'            => (int)$user['user_id'],
            'name'          => $user['full_name'],
            'permissions'   => json_decode($user['permissions'] ?? '[]', true) ?: [],
        ]);
    }

    public function sessionStatus(): void {
        $auth = Router::requireAuth($this->pdo);

        $stmt = $this->pdo->prepare('SELECT user_id, username, role, full_name, parent_email, permissions FROM users WHERE user_id = ? LIMIT 1');
        $stmt->execute([$auth['user_id']]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            session_destroy();
            Response::error('Session expired or account disabled');
        }

        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        Response::success('Session active', [
            'user_id'      => (int)$row['user_id'],
            'username'     => $row['username'],
            'role'         => $row['role'],
            'full_name'    => $row['full_name'],
            'parent_email' => $row['parent_email'],
            'csrf_token'   => $_SESSION['csrf_token'],
            'id'           => (int)$row['user_id'],
            'name'         => $row['full_name'],
            'permissions'  => json_decode($row['permissions'] ?? '[]', true) ?: [],
        ]);
    }

    public function logout(): void {
        $token = $_SERVER['HTTP_X_SESSION_TOKEN'] ?? ($_POST['session_token'] ?? '');
        if (!empty($token)) {
            $this->pdo->prepare("DELETE FROM sessions WHERE token = ?")->execute([$token]);
        }
        if (isset($_SESSION['user_id'])) {
            $this->logActivity($_SESSION['user_id'], 'User Logout');
        }
        session_destroy();
        Response::success('Logged out successfully');
    }

    public function forgotPassword(): void {
        $username = $this->sanitize($_POST['username'] ?? '');
        if (empty($username)) {
            Response::error('Username is required');
        }
        $stmt = $this->pdo->prepare("SELECT user_id FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        if ($user) {
            $this->logActivity($user['user_id'], "Password reset requested for: $username", 'Info');
        }
        Response::success('If that username exists, the administrator has been notified. Please contact the school office to reset your password.');
    }
}
