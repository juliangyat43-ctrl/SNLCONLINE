<?php
require_once __DIR__ . '/Response.php';

class Database {
    /** @var PDO|null */
    private static $instance = null;

    public static function connect(): PDO {
        if (self::$instance !== null) {
            return self::$instance;
        }

        $dbFile = dirname(__DIR__) . '/snlc_database.sqlite';
        $isNew  = !file_exists($dbFile);

        if ($isNew && !is_writable(dirname($dbFile))) {
            Response::error('Database directory is not writable: ' . dirname($dbFile));
        }

        try {
            $pdo = new PDO(
                'sqlite:' . $dbFile,
                null,
                null,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
            // Enable foreign key constraints for data integrity
            $pdo->exec("PRAGMA foreign_keys = ON");
        } catch (PDOException $e) {
            Response::error('Database connection failed: ' . $e->getMessage());
        }

        if ($isNew) {
            self::createSchema($pdo);
        }

        self::runMigrations($pdo);

        self::$instance = $pdo;
        return $pdo;
    }

    private static function createSchema(PDO $pdo): void {
        $adminPassword = password_hash('admin123', PASSWORD_DEFAULT);

        $pdo->exec("
            CREATE TABLE IF NOT EXISTS users (
                user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_code      TEXT,
                username       TEXT UNIQUE,
                password       TEXT,
                full_name      TEXT,
                role           TEXT,
                parent_email   TEXT,
                grade          TEXT,
                section        TEXT,
                class_type     TEXT,
                status         TEXT DEFAULT 'active',
                contact_number TEXT,
                address        TEXT,
                dob            TEXT,
                gender         TEXT,
                guardian_name  TEXT,
                relationship   TEXT,
                created_at     TEXT,
                grades_locked  INTEGER DEFAULT 0,
                grades_data    TEXT
            );

            CREATE TABLE IF NOT EXISTS financial_records (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id          INTEGER,
                tuition_fee      REAL DEFAULT 0,
                misc_fee         REAL DEFAULT 0,
                amount_paid      REAL DEFAULT 0,
                created_at       TEXT
            );

            CREATE TABLE IF NOT EXISTS grades (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                subject    TEXT,
                grade      REAL,
                units      INTEGER,
                remarks    TEXT,
                created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS attendance (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER,
                date         TEXT,
                time_in      TEXT,
                time_out     TEXT,
                status       TEXT,
                late_minutes INTEGER DEFAULT 0,
                created_at   TEXT
            );

            CREATE TABLE IF NOT EXISTS leave_requests (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER,
                start_date   TEXT,
                end_date     TEXT,
                leave_type   TEXT,
                reason       TEXT,
                status       TEXT DEFAULT 'Pending',
                submitted_at TEXT,
                reviewed_at  TEXT
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                action     TEXT,
                status     TEXT,
                created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS payment_logs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id        INTEGER,
                amount         REAL,
                payment_method TEXT,
                reference      TEXT,
                created_at     TEXT
            );

            CREATE TABLE IF NOT EXISTS enrollments (
                enrollment_id  INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name      TEXT NOT NULL,
                username       TEXT NOT NULL,
                grade_level    TEXT,
                parent_email   TEXT,
                contact_number TEXT,
                address        TEXT,
                dob            TEXT,
                gender         TEXT,
                guardian_name  TEXT,
                relationship   TEXT,
                chosen_password TEXT,
                school_year    TEXT,
                status         TEXT DEFAULT 'Pending',
                created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                role       TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            INSERT INTO users (username, password, full_name, role, status, created_at)
            VALUES ('admin', '{$adminPassword}', 'System Admin', 'admin', 'active', datetime('now', 'localtime'));
        ");
    }

    private static function runMigrations(PDO $pdo): void {
        // Always-safe table creations
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS announcements (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL,
                content    TEXT NOT NULL,
                type       TEXT DEFAULT 'info',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        ");

        // Additive column migrations (idempotent)
        $safe = static function (PDO $pdo, string $sql): void {
            try { $pdo->exec($sql); } catch (PDOException $e) {}
        };

        $safe($pdo, "ALTER TABLE financial_records ADD COLUMN payment_plan TEXT DEFAULT 'Monthly'");
        $safe($pdo, "ALTER TABLE financial_records ADD COLUMN next_payment_date TEXT");
        $safe($pdo, "ALTER TABLE financial_records ADD COLUMN last_payment_date TEXT");
        $safe($pdo, "ALTER TABLE enrollments ADD COLUMN dob TEXT");
        $safe($pdo, "ALTER TABLE enrollments ADD COLUMN gender TEXT");
        $safe($pdo, "ALTER TABLE enrollments ADD COLUMN guardian_name TEXT");
        $safe($pdo, "ALTER TABLE enrollments ADD COLUMN relationship TEXT");
        $safe($pdo, "ALTER TABLE enrollments ADD COLUMN chosen_password TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN contact_number TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN address TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN dob TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN gender TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN guardian_name TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN relationship TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '[]'");
        // v2 migrations — grade tracking & payment schedule columns
        $safe($pdo, "ALTER TABLE users ADD COLUMN grades_locked INTEGER DEFAULT 0");
        $safe($pdo, "ALTER TABLE users ADD COLUMN grades_data TEXT");
        $safe($pdo, "ALTER TABLE users ADD COLUMN payments_data TEXT");
        // RFID integration columns
        $safe($pdo, "ALTER TABLE users ADD COLUMN rfid_uid TEXT");
        $safe($pdo, "ALTER TABLE attendance ADD COLUMN early_out_minutes INTEGER DEFAULT 0");
        $safe($pdo, "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_rfid_uid ON users(rfid_uid) WHERE rfid_uid IS NOT NULL");

        // v3 migrations — calendar events, global settings, rfid label
        $safe($pdo, "CREATE TABLE IF NOT EXISTS calendar_events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            event_date TEXT NOT NULL,
            title      TEXT NOT NULL,
            type       TEXT NOT NULL DEFAULT 'Academic',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )");
        $safe($pdo, "CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date)");
        $safe($pdo, "CREATE TABLE IF NOT EXISTS global_settings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key   TEXT NOT NULL UNIQUE,
            setting_value TEXT NOT NULL DEFAULT '',
            updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )");
        $safe($pdo, "INSERT OR IGNORE INTO global_settings (setting_key, setting_value) VALUES ('global_tuition_fee', '13000')");
        $safe($pdo, "INSERT OR IGNORE INTO global_settings (setting_key, setting_value) VALUES ('global_misc_fee', '0')");
        $safe($pdo, "CREATE TABLE IF NOT EXISTS rfid_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )");
        // ALTER TABLE rfid_settings ADD COLUMN label — wrapped in try/catch since SQLite
        // does not support IF NOT EXISTS for columns; this will silently fail if already added.
        $safe($pdo, "ALTER TABLE rfid_settings ADD COLUMN label TEXT DEFAULT ''");

        // v4 migrations — rate limiting tables
        $safe($pdo, "CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identifier TEXT NOT NULL,
            attempt_type TEXT DEFAULT 'failed',
            ip_address TEXT,
            username TEXT,
            success INTEGER DEFAULT 0,
            attempt_time TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )");
        $safe($pdo, "CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier, attempt_time)");

        $safe($pdo, "CREATE TABLE IF NOT EXISTS rate_limits (
            limit_type TEXT PRIMARY KEY,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            window_minutes INTEGER NOT NULL DEFAULT 15,
            lockout_minutes INTEGER NOT NULL DEFAULT 30,
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )");
        // Insert default rate limit configs
        $safe($pdo, "INSERT OR IGNORE INTO rate_limits (limit_type, max_attempts, window_minutes, lockout_minutes) VALUES ('login', 5, 15, 30)");
        $safe($pdo, "INSERT OR IGNORE INTO rate_limits (limit_type, max_attempts, window_minutes, lockout_minutes) VALUES ('enrollment', 3, 60, 60)");

        // v4 migrations — school years table
        $safe($pdo, "CREATE TABLE IF NOT EXISTS school_years (
            school_year TEXT PRIMARY KEY,
            start_date TEXT,
            end_date TEXT,
            is_current INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )");

        // v5 migrations — data version tracking for cache sync
        $safe($pdo, "CREATE TABLE IF NOT EXISTS data_versions (
            data_type     TEXT PRIMARY KEY,
            last_modified INTEGER NOT NULL DEFAULT 0,
            version       INTEGER NOT NULL DEFAULT 1,
            updated_at    INTEGER NOT NULL DEFAULT 0
        )");
    }
}
