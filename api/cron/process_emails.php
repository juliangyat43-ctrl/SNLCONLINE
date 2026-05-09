<?php
// Email Queue Processor
// 
// Run this script via cron job every 5 minutes:
// */5 * * * * php /path/to/_public_html_live/api/cron/process_emails.php
// 
// Or manually: php process_emails.php

// Prevent web access
if (php_sapi_name() !== 'cli') {
    die('This script can only be run from command line');
}

require_once __DIR__ . '/../Database.php';
require_once __DIR__ . '/../handlers/EmailHandler.php';

try {
    $pdo = Database::connect();
    $emailHandler = new EmailHandler($pdo);
    
    echo "[" . date('Y-m-d H:i:s') . "] Processing email queue...\n";
    
    $result = $emailHandler->processQueue(20); // Process up to 20 emails
    
    echo "Sent: {$result['sent']}, Failed: {$result['failed']}\n";
    echo "Done.\n";
    
} catch (Exception $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
