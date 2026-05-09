<?php
/**
 * Rate Limiter Class
 * 
 * Provides rate limiting functionality for API endpoints
 * to prevent brute force attacks and abuse.
 */

class RateLimiter {
    private $pdo;
    private $identifier;
    private $limitType;
    
    public function __construct(PDO $pdo, string $identifier, string $limitType = 'login') {
        $this->pdo = $pdo;
        $this->identifier = $identifier;
        $this->limitType = $limitType;
    }
    
    /**
     * Check if the identifier has exceeded the rate limit
     * 
     * @return array ['allowed' => bool, 'remaining' => int, 'retry_after' => int|null]
     */
    public function checkLimit(): array {
        $config = $this->getLimitConfig();
        if (!$config) {
            // If no config found, allow by default
            return ['allowed' => true, 'remaining' => PHP_INT_MAX, 'retry_after' => null];
        }
        
        $maxAttempts = $config['max_attempts'];
        $windowMinutes = $config['window_minutes'];
        $lockoutMinutes = $config['lockout_minutes'];
        
        // Clean up old attempts first
        $this->cleanupOldAttempts($windowMinutes);
        
        // Check if currently locked out
        $lockoutInfo = $this->checkLockout($lockoutMinutes);
        if ($lockoutInfo['locked']) {
            return [
                'allowed' => false,
                'remaining' => 0,
                'retry_after' => $lockoutInfo['retry_after']
            ];
        }
        
        // Count recent attempts within the window
        $recentAttempts = $this->countRecentAttempts($windowMinutes);
        $remaining = max(0, $maxAttempts - $recentAttempts);
        
        if ($recentAttempts >= $maxAttempts) {
            // Trigger lockout
            $this->triggerLockout($lockoutMinutes);
            return [
                'allowed' => false,
                'remaining' => 0,
                'retry_after' => $lockoutMinutes * 60
            ];
        }
        
        return [
            'allowed' => true,
            'remaining' => $remaining,
            'retry_after' => null
        ];
    }
    
    /**
     * Record a failed attempt
     */
    public function recordFailure(string $ipAddress = null, string $username = null): void {
        $stmt = $this->pdo->prepare("
            INSERT INTO login_attempts (identifier, attempt_type, ip_address, username, success)
            VALUES (?, 'failed', ?, ?, 0)
        ");
        $stmt->execute([$this->identifier, $ipAddress, $username]);
    }
    
    /**
     * Record a successful attempt (clears the rate limit)
     */
    public function recordSuccess(): void {
        // Clear all recent attempts for this identifier on success
        $stmt = $this->pdo->prepare("
            DELETE FROM login_attempts 
            WHERE identifier = ? AND attempt_time > datetime('now', '-1 hour')
        ");
        $stmt->execute([$this->identifier]);
    }
    
    /**
     * Get rate limit configuration from database
     */
    private function getLimitConfig(): ?array {
        $stmt = $this->pdo->prepare("
            SELECT max_attempts, window_minutes, lockout_minutes 
            FROM rate_limits 
            WHERE limit_type = ?
        ");
        $stmt->execute([$this->limitType]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }
    
    /**
     * Clean up attempts older than the window
     */
    private function cleanupOldAttempts(int $windowMinutes): void {
        $stmt = $this->pdo->prepare("
            DELETE FROM login_attempts 
            WHERE attempt_time < datetime('now', '-' || ? || ' minutes')
        ");
        $stmt->execute([$windowMinutes]);
    }
    
    /**
     * Check if the identifier is currently locked out
     */
    private function checkLockout(int $lockoutMinutes): array {
        // Check if there were max_attempts in the window and if the last attempt was recent
        $stmt = $this->pdo->prepare("
            SELECT COUNT(*) as count, MAX(attempt_time) as last_attempt
            FROM login_attempts 
            WHERE identifier = ? 
            AND attempt_time > datetime('now', '-' || ? || ' minutes')
        ");
        $stmt->execute([$this->identifier, $lockoutMinutes]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$result || $result['count'] == 0) {
            return ['locked' => false, 'retry_after' => null];
        }
        
        $config = $this->getLimitConfig();
        if ($result['count'] >= $config['max_attempts']) {
            // Calculate time until lockout expires
            $lastAttempt = new DateTime($result['last_attempt']);
            $lockoutUntil = clone $lastAttempt;
            $lockoutUntil->modify("+{$lockoutMinutes} minutes");
            $now = new DateTime();
            
            if ($now < $lockoutUntil) {
                $retryAfter = $lockoutUntil->getTimestamp() - $now->getTimestamp();
                return ['locked' => true, 'retry_after' => $retryAfter];
            }
        }
        
        return ['locked' => false, 'retry_after' => null];
    }
    
    /**
     * Count recent attempts within the time window
     */
    private function countRecentAttempts(int $windowMinutes): int {
        $stmt = $this->pdo->prepare("
            SELECT COUNT(*) as count
            FROM login_attempts 
            WHERE identifier = ? 
            AND attempt_time > datetime('now', '-' || ? || ' minutes')
        ");
        $stmt->execute([$this->identifier, $windowMinutes]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        return (int)($result['count'] ?? 0);
    }
    
    /**
     * Trigger a lockout by recording additional failed attempts
     */
    private function triggerLockout(int $lockoutMinutes): void {
        // This is handled implicitly by checkLockout on the next request
        // The lockout is based on having max_attempts in the window
    }
}
