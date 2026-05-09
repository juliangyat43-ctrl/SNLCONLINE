<?php
class Response {
    public static function success(string $message = '', $data = null): void {
        while (ob_get_level() > 0) { ob_end_clean(); }
        if (!headers_sent()) {
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['success' => true, 'message' => $message, 'data' => $data, 'error' => null]);
        exit;
    }

    public static function error(string $message = '', $data = null, int $httpStatus = 200, string $errorCode = ''): void {
        while (ob_get_level() > 0) { ob_end_clean(); }
        if (!headers_sent()) {
            header('Content-Type: application/json; charset=utf-8');
            if ($httpStatus !== 200) {
                http_response_code($httpStatus);
            }
        }
        echo json_encode([
            'success'    => false,
            'message'    => $message,
            'data'       => $data,
            'error'      => $message,
            'error_code' => $errorCode ?: null,
        ]);
        exit;
    }
}
