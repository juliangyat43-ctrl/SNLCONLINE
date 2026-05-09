<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

class RfidHandler {
    use HandlerHelpers;
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function tap(): void {
        $rfidUid = $this->sanitize($_POST['rfid_uid'] ?? '');
        if (empty($rfidUid)) {
            Response::error('rfid_uid is required');
        }

        // ── IP WHITELIST CHECK ──────────────────────────────────────────────
        // Only enforce if the whitelist has entries. Empty whitelist = open access
        // (allows initial setup before any IPs are configured).
        $wlStmt = $this->pdo->query(
            "SELECT setting_value FROM rfid_settings WHERE setting_key = 'whitelist_ips'"
        );
        $wlRow = $wlStmt ? $wlStmt->fetch() : null;
        if ($wlRow && !empty($wlRow['setting_value'])) {
            $whitelist = json_decode($wlRow['setting_value'], true) ?: [];
            if (!empty($whitelist)) {
                $requestIp = trim(explode(',',
                    $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '')[0]);
                // Extract just the IP from whitelist entries (supports both plain strings
                // and {ip, label} objects after the label fix)
                $allowedIps = array_map(function($entry) {
                    return is_array($entry) ? ($entry['ip'] ?? '') : (string)$entry;
                }, $whitelist);
                if (!in_array($requestIp, $allowedIps, true)) {
                    Response::error('Scanner IP not authorized: ' . $requestIp, null, 403);
                }
            }
        }

        // ── API SECRET KEY CHECK ───────────────────────────────────────────
        $this->verifyApiKey();

        $stmt = $this->pdo->prepare(
            "SELECT user_id, user_code, full_name, role, status, class_type, grade, section
               FROM users WHERE rfid_uid = ? LIMIT 1"
        );
        $stmt->execute([$rfidUid]);
        $user = $stmt->fetch();

        if (!$user) {
            Response::error('RFID card not registered. Contact the admin.');
        }
        if ($user['status'] !== 'active') {
            Response::error('Account inactive. Contact the admin.');
        }

        $userId = (int)$user['user_id'];

        // date() and datetime('now','localtime') now use Asia/Manila
        // because date_default_timezone_set() is called in api/index.php
        $today   = date('Y-m-d');
        $nowTime = date('H:i:s');

        // Allow offline replay to supply the original tap time
        // SyncManager sends tap_time=HH:mm:ss when replaying queued records
        $tapTimeRaw = $this->sanitize($_POST['tap_time'] ?? '');
        if (!empty($tapTimeRaw) && preg_match('/^\d{2}:\d{2}:\d{2}$/', $tapTimeRaw)) {
            $nowTime = $tapTimeRaw;
        }
        // Also allow tap_date for replays that happened on a different calendar day
        $tapDateRaw = $this->sanitize($_POST['tap_date'] ?? '');
        if (!empty($tapDateRaw) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $tapDateRaw)) {
            $today = $tapDateRaw;
        }

        // BEGIN TRANSACTION to prevent race conditions
        $this->pdo->beginTransaction();
        
        try {
            // Use SELECT FOR UPDATE to lock the row (prevents race condition on simultaneous taps)
            $stmt = $this->pdo->prepare(
                "SELECT id, time_in, time_out, status FROM attendance
                  WHERE user_id = ? AND date = ? LIMIT 1"
            );
            $stmt->execute([$userId, $today]);
            $record = $stmt->fetch();

            if (!$record) {
                $isAfternoon = strtolower($user['class_type'] ?? '') === 'afternoon';
                $cutoff = $isAfternoon ? 14 * 60 : 8 * 60;
                $mins = (int)substr($nowTime, 0, 2) * 60 + (int)substr($nowTime, 3, 2);
                $status = $mins > $cutoff ? 'Late' : 'Present';
                $late = max(0, $mins - $cutoff);

                $this->pdo->prepare("
                    INSERT INTO attendance (user_id, date, time_in, status, late_minutes, created_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
                ")->execute([$userId, $today, $nowTime, $status, $late]);
                
                $this->pdo->commit();

                Response::success('TIME IN recorded', [
                    'action' => 'TIME IN',
                    'user_id' => $userId,
                    'full_name' => $user['full_name'],
                    'user_code' => $user['user_code'],
                    'grade' => $user['grade'],
                    'section' => $user['section'],
                    'time_in' => $nowTime,
                    'time_out' => null,
                    'status' => $status,
                ]);
            } elseif (empty($record['time_out'])) {
                // OFFLINE REPLAY PROTECTION: Check if this is a replay that would overwrite existing data
                // If we have a time_in from the record AND this is a replay (has tap_time in POST),
                // we should NOT overwrite the existing time_in with older data
                $isReplay = !empty($_POST['tap_time']) || !empty($_POST['tap_date']);
                if ($isReplay && !empty($record['time_in'])) {
                    // This is an offline replay but we already have attendance recorded
                    // Return success but don't modify data
                    $this->pdo->rollBack();
                    Response::success('TIME IN already recorded (synced)', [
                        'action' => 'TIME IN',
                        'user_id' => $userId,
                        'full_name' => $user['full_name'],
                        'user_code' => $user['user_code'],
                        'grade' => $user['grade'],
                        'section' => $user['section'],
                        'time_in' => $record['time_in'],
                        'time_out' => null,
                        'status' => $record['status'],
                        'sync_note' => 'Record already existed, no changes made'
                    ]);
                    return;
                }
                // Check for duplicate tap within 5 seconds (grace period)
                // Use ONLY server time for security - ignore user-supplied tap_time for duplicate detection
                $serverNow = time();
                $timeInSeconds = strtotime($today . ' ' . $record['time_in']);

                // Guard: if the tap happened within 5 seconds of time_in on server, treat as duplicate
                if ($serverNow - $timeInSeconds <= 5) {
                    $this->pdo->rollBack();
                    // Return the same success response to avoid confusing "already completed" error
                    Response::success('TIME IN recorded', [
                        'action' => 'TIME IN',
                        'user_id' => $userId,
                        'full_name' => $user['full_name'],
                        'user_code' => $user['user_code'],
                        'grade' => $user['grade'],
                        'section' => $user['section'],
                        'time_in' => $record['time_in'],
                        'time_out' => null,
                        'status' => $record['status'],
                    ]);
                    return;
                }

                // Require at least 60 seconds between time_in and time_out (using server time for security)
                $tapSeconds = strtotime($today . ' ' . $nowTime);
                if ($tapSeconds - $timeInSeconds < 60) {
                    $this->pdo->rollBack();
                    Response::success('TIME IN recorded (too soon for TIME OUT)', [
                        'action' => 'TIME IN',
                        'user_id' => $userId,
                        'full_name' => $user['full_name'],
                        'user_code' => $user['user_code'],
                        'grade' => $user['grade'],
                        'section' => $user['section'],
                        'time_in' => $record['time_in'],
                        'time_out' => null,
                        'status' => $record['status'],
                    ]);
                    return;
                }

                $isAfternoon = strtolower($user['class_type'] ?? '') === 'afternoon';
                // Morning class ends at 12:00 (12*60), Afternoon class ends at 17:00 (17*60)
                $endCutoff = $isAfternoon ? 17 * 60 : 12 * 60;
                $outMins = (int)substr($nowTime, 0, 2) * 60 + (int)substr($nowTime, 3, 2);
                $earlyOut = max(0, $endCutoff - $outMins);

                // Check if time_out already exists (prevent overwrite by replay)
                if (!empty($record['time_out'])) {
                    $this->pdo->rollBack();
                    Response::success('TIME OUT already recorded (synced)', [
                        'action' => 'TIME OUT',
                        'user_id' => $userId,
                        'full_name' => $user['full_name'],
                        'user_code' => $user['user_code'],
                        'grade' => $user['grade'],
                        'section' => $user['section'],
                        'time_in' => $record['time_in'],
                        'time_out' => $record['time_out'],
                        'status' => $record['status'],
                        'sync_note' => 'Record already completed, no changes made'
                    ]);
                    return;
                }
                
                $this->pdo->prepare(
                    "UPDATE attendance SET time_out = ?, early_out_minutes = ? WHERE id = ?"
                )->execute([$nowTime, $earlyOut, $record['id']]);
                
                $this->pdo->commit();

                Response::success('TIME OUT recorded', [
                    'action' => 'TIME OUT',
                    'user_id' => $userId,
                    'full_name' => $user['full_name'],
                    'user_code' => $user['user_code'],
                    'grade' => $user['grade'],
                    'section' => $user['section'],
                    'time_in' => $record['time_in'],
                    'time_out' => $nowTime,
                    'status' => $record['status'],
                ]);
            } else {
                $this->pdo->rollBack();
                Response::error('Attendance already completed for today.');
            }
        } catch (Exception $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            error_log('RFID tap error: ' . $e->getMessage());
            Response::error('Failed to record attendance. Please try again.');
        }
    }
}
