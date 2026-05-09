<?php
/**
 * SNLC Attendance System — API Entry Point
 * Drop-in replacement for Api.php (rewritten transparently via .htaccess)
 */

// Start output buffering immediately so any stray output (BOM, notices, warnings)
// does not corrupt the JSON response or trigger "headers already sent" errors.
ob_start();

error_reporting(0);
ini_set('display_errors', 0);
header('Content-Type: application/json');

// Keep API responses JSON-only even for uncaught fatals/runtime errors.
register_shutdown_function(static function (): void {
    $lastError = error_get_last();
    if (!$lastError) {
        return;
    }
    $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if (!in_array($lastError['type'], $fatalTypes, true)) {
        return;
    }
    // Discard any partial output so the JSON is the only thing sent.
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'success' => false,
        'message' => 'A fatal server error occurred.',
        'data' => null,
        'error' => 'A fatal server error occurred.',
    ]);
});

// ── CORS ──
$allowed_origins = [
    'http://localhost',
    'http://127.0.0.1',
    'https://www.snlc.edu.ph',
    'https://snlc.edu.ph',
    'http://www.snlc.edu.ph',
    'http://snlc.edu.ph',
    'https://OnlineSnlc.bond',
    'https://www.onlinesnlc.bond',
    'http://OnlineSnlc.bond',
    'http://www.onlinesnlc.bond',
];
if (isset($_SERVER['HTTP_ORIGIN']) && in_array($_SERVER['HTTP_ORIGIN'], $allowed_origins)) {
    header("Access-Control-Allow-Origin: {$_SERVER['HTTP_ORIGIN']}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Session-Token, X-CSRF-Token, X-API-Key');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    while (ob_get_level() > 0) { ob_end_clean(); }
    exit(0);
}

// ── SESSION ──
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// ── TIMEZONE ──
// Set to Asia/Manila (UTC+8) so all date()/time() calls and SQLite
// datetime('now','localtime') use Philippine Standard Time.
date_default_timezone_set('Asia/Manila');

require_once __DIR__ . '/Response.php';

// ── JSON BODY → $_POST ──
$json_input = file_get_contents('php://input');
if ($json_input) {
    $json_data = json_decode($json_input, true);
    if (is_array($json_data)) {
        $_POST = array_merge($_POST, $json_data);
    }
}

$action = $_GET['action'] ?? ($_POST['action'] ?? '');

// Handle ping without loading DB/router code. This keeps the endpoint working even if
// PDO/SQLite extensions are missing or the database is misconfigured.
if ($action === 'ping') {
    $pdoLoaded = class_exists('PDO');
    $pdoDrivers = $pdoLoaded ? PDO::getAvailableDrivers() : [];
    $sqlite3Loaded = extension_loaded('sqlite3');
    $pdoSqliteLoaded = extension_loaded('pdo_sqlite');
    
    $allOk = $pdoLoaded && $sqlite3Loaded && $pdoSqliteLoaded && in_array('sqlite', $pdoDrivers);
    
    Response::success('OK', [
        'php_version' => PHP_VERSION,
        'pdo_loaded' => $pdoLoaded,
        'pdo_drivers' => $pdoDrivers,
        'sqlite3_loaded' => $sqlite3Loaded,
        'pdo_sqlite_loaded' => $pdoSqliteLoaded,
        'ready' => $allOk,
        'message' => $allOk ? 'All extensions loaded' : 'SQLite extensions not available - see setup guide'
    ]);
}

// Hard-fail early with a clear JSON error instead of a fatal parse/runtime error.
if (!class_exists('PDO')) {
    Response::error('Server misconfiguration: PHP PDO extension is not enabled. Contact your hosting provider or see LOCAL_SETUP.md for local development.');
}
if (!extension_loaded('pdo_sqlite') && !extension_loaded('sqlite3')) {
    Response::error('Server misconfiguration: SQLite extensions are not enabled (pdo_sqlite, sqlite3). For Hostinger: Enable in PHP Selector. For local development: See LOCAL_SETUP.md');
}

require_once __DIR__ . '/Router.php';

try {
    Router::dispatch($action);
} catch (PDOException $e) {
    error_log('SNLC API PDOException: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString());
    Response::error('A database error occurred. Please try again. [' . $e->getMessage() . ']');
} catch (Throwable $e) {
    error_log('SNLC API Exception: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString());
    Response::error('An error occurred. Please try again. [' . $e->getMessage() . ']');
}
