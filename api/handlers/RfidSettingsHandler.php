<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

class RfidSettingsHandler {
    use HandlerHelpers;
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
        $this->ensureRfidSettingsTable();
    }

    private function ensureRfidSettingsTable(): void {
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS rfid_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )");
    }

    /**
     * POST action=rfid_heartbeat  (PUBLIC — called by the Java terminal every 30s)
     * Stores the terminal's IP and a timestamp so the website can show real status.
     */
    public function heartbeat(): void {
        $this->verifyApiKey();
        // Prefer the IP sent by the Java program; fall back to the request IP
        $ip = $this->sanitize($_POST['ip'] ?? '');
        if (empty($ip)) {
            $ip = $_SERVER['HTTP_X_FORWARDED_FOR']
                ?? $_SERVER['REMOTE_ADDR']
                ?? 'unknown';
            // X-Forwarded-For can be a comma-separated list; take the first
            $ip = trim(explode(',', $ip)[0]);
        }

        // Upsert last_heartbeat_at — store as UTC so seconds_ago calculation is timezone-safe
        $this->pdo->prepare("
            INSERT INTO rfid_settings (setting_key, setting_value, updated_at)
            VALUES ('last_heartbeat_at', datetime('now'), datetime('now'))
            ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_at    = excluded.updated_at
        ")->execute([]);

        // Upsert last_heartbeat_ip
        $this->pdo->prepare("
            INSERT INTO rfid_settings (setting_key, setting_value, updated_at)
            VALUES ('last_heartbeat_ip', ?, datetime('now'))
            ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_at    = excluded.updated_at
        ")->execute([$ip]);

        Response::success('', ['received_at' => gmdate('Y-m-d H:i:s'), 'ip' => $ip]);
    }

    public function getRfidSettings(): void {
        try {
            $stmt = $this->pdo->query("SELECT setting_key, setting_value FROM rfid_settings WHERE setting_key IN ('whitelist_ips','last_heartbeat_at','last_heartbeat_ip')");
            $rows = $stmt->fetchAll();

            $whitelist       = [];
            $lastHeartbeat   = null;
            $lastHeartbeatIp = null;

            foreach ($rows as $row) {
                if ($row['setting_key'] === 'whitelist_ips' && !empty($row['setting_value'])) {
                    $whitelist = json_decode($row['setting_value'], true) ?: [];
                } elseif ($row['setting_key'] === 'last_heartbeat_at') {
                    $lastHeartbeat = $row['setting_value'];
                } elseif ($row['setting_key'] === 'last_heartbeat_ip') {
                    $lastHeartbeatIp = $row['setting_value'];
                }
            }

            // Determine ready status based on heartbeat age.
            // Both time() and the stored value are UTC — compare directly.
            $ready = false;
            $secondsAgo = null;
            if ($lastHeartbeat) {
                // strtotime handles both "2026-05-07 13:00:00" (UTC) correctly
                $heartbeatTs = strtotime($lastHeartbeat);
                if ($heartbeatTs !== false && $heartbeatTs > 0) {
                    $secondsAgo = time() - $heartbeatTs;
                    // Sanity check: if secondsAgo is negative or impossibly large, treat as offline
                    if ($secondsAgo < 0 || $secondsAgo > 86400 * 365) {
                        $secondsAgo = null;
                    } else {
                        $ready = $secondsAgo <= 90;
                    }
                }
            }

            Response::success('', [
                'whitelist'        => $whitelist,
                'count'            => count($whitelist),
                'ready'            => $ready,
                'last_heartbeat'   => $lastHeartbeat,
                'last_heartbeat_ip'=> $lastHeartbeatIp,
                'seconds_ago'      => $secondsAgo,
            ]);
        } catch (Exception $e) {
            Response::error('Failed to load RFID settings: ' . $e->getMessage());
        }
    }

    public function saveRfidSettings(): void {
        $operation = $this->sanitize($_POST['operation'] ?? '');
        $ipAddress = $this->sanitize($_POST['ip_address'] ?? '');
        $label     = $this->sanitize($_POST['label'] ?? '');

        if (empty($operation) || empty($ipAddress)) {
            Response::error('Operation and IP address are required');
        }

        // Validate IP address format
        if (!filter_var($ipAddress, FILTER_VALIDATE_IP)) {
            Response::error('Invalid IP address format');
        }

        try {
            // Get current whitelist
            $stmt = $this->pdo->query("SELECT setting_value FROM rfid_settings WHERE setting_key = 'whitelist_ips'");
            $row = $stmt->fetch();
            
            $whitelist = [];
            if ($row && !empty($row['setting_value'])) {
                $whitelist = json_decode($row['setting_value'], true) ?: [];
            }

            // Normalize whitelist to array of objects {ip, label}
            $normalized = [];
            foreach ($whitelist as $entry) {
                if (is_array($entry) && isset($entry['ip'])) {
                    $normalized[] = $entry;
                } else {
                    // Old format: plain string IP
                    $normalized[] = ['ip' => (string)$entry, 'label' => ''];
                }
            }
            $whitelist = $normalized;

            // Perform operation
            if ($operation === 'add') {
                // Check if IP already exists
                foreach ($whitelist as $entry) {
                    if ($entry['ip'] === $ipAddress) {
                        Response::error('IP address already in whitelist');
                    }
                }
                $whitelist[] = ['ip' => $ipAddress, 'label' => $label];
                $message = 'IP address added to whitelist';
            } elseif ($operation === 'remove') {
                $found = false;
                foreach ($whitelist as $key => $entry) {
                    if ($entry['ip'] === $ipAddress) {
                        unset($whitelist[$key]);
                        $found = true;
                        break;
                    }
                }
                if (!$found) {
                    Response::error('IP address not found in whitelist');
                }
                $whitelist = array_values($whitelist); // Re-index array
                $message = 'IP address removed from whitelist';
            } else {
                Response::error('Invalid operation. Use "add" or "remove"');
            }

            // Save updated whitelist
            $jsonWhitelist = json_encode($whitelist);
            $stmt = $this->pdo->prepare("
                INSERT INTO rfid_settings (setting_key, setting_value, updated_at)
                VALUES ('whitelist_ips', ?, datetime('now'))
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at
            ");
            $stmt->execute([$jsonWhitelist]);

            Response::success('', [
                'message'   => $message,
                'whitelist' => $whitelist,
                'count'     => count($whitelist),
            ]);
        } catch (Exception $e) {
            Response::error('Failed to save RFID settings: ' . $e->getMessage());
        }
    }
}
