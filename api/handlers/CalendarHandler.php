<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/HandlerHelpers.php';

class CalendarHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    /**
     * GET action=get_calendar_events
     * Optional params: year (int), month (int 1-12)
     * Returns all events for the given month.
     */
    public function getCalendarEvents(): void {
        $year  = isset($_GET['year'])  ? intval($_GET['year'])  : intval(date('Y'));
        $month = isset($_GET['month']) ? intval($_GET['month']) : intval(date('n'));

        // Zero-pad month to 2 digits for strftime comparison
        $monthPadded = str_pad((string)$month, 2, '0', STR_PAD_LEFT);
        $yearStr     = (string)$year;

        $stmt = $this->pdo->prepare("
            SELECT id, event_date, title, type, created_at, updated_at
            FROM calendar_events
            WHERE strftime('%Y', event_date) = :year
              AND strftime('%m', event_date) = :month
            ORDER BY event_date ASC
        ");
        $stmt->execute([':year' => $yearStr, ':month' => $monthPadded]);
        $events = $stmt->fetchAll();

        Response::success('', $events);
    }

    /**
     * POST action=add_calendar_event
     * Required: event_date (YYYY-MM-DD), title (1-200 chars), type (Holiday|Academic|School Event)
     * Returns: { id: <new_id> }
     */
    public function addCalendarEvent(): void {
        $eventDate = $this->sanitize($_POST['event_date'] ?? '');
        $title     = $this->sanitize($_POST['title']      ?? '');
        $type      = $this->sanitize($_POST['type']       ?? '');

        // Validate event_date
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $eventDate)) {
            Response::error('event_date must be in YYYY-MM-DD format');
        }

        // Validate title
        if ($title === '') {
            Response::error('title is required');
        }
        if (strlen($title) > 200) {
            Response::error('title must be 200 characters or fewer');
        }

        // Validate type
        $allowedTypes = ['Holiday', 'Academic', 'School Event'];
        if (!in_array($type, $allowedTypes, true)) {
            Response::error('type must be one of: Holiday, Academic, School Event');
        }

        $stmt = $this->pdo->prepare("
            INSERT INTO calendar_events (event_date, title, type, created_at, updated_at)
            VALUES (?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
        ");
        $stmt->execute([$eventDate, $title, $type]);
        $newId = $this->pdo->lastInsertId();

        Response::success('Event added', ['id' => (int)$newId]);
    }

    /**
     * POST action=update_calendar_event
     * Required: id (int > 0), title (1-200 chars), type (Holiday|Academic|School Event)
     * Returns success or error if no row matched.
     */
    public function updateCalendarEvent(): void {
        $id    = intval($_POST['id']    ?? 0);
        $title = $this->sanitize($_POST['title'] ?? '');
        $type  = $this->sanitize($_POST['type']  ?? '');

        if ($id <= 0) {
            Response::error('id must be a positive integer');
        }

        if ($title === '') {
            Response::error('title is required');
        }
        if (strlen($title) > 200) {
            Response::error('title must be 200 characters or fewer');
        }

        $allowedTypes = ['Holiday', 'Academic', 'School Event'];
        if (!in_array($type, $allowedTypes, true)) {
            Response::error('type must be one of: Holiday, Academic, School Event');
        }

        $stmt = $this->pdo->prepare("
            UPDATE calendar_events
            SET title = ?, type = ?, updated_at = datetime('now','localtime')
            WHERE id = ?
        ");
        $stmt->execute([$title, $type, $id]);

        if ($stmt->rowCount() === 0) {
            Response::error('Event not found');
        }

        Response::success('Event updated');
    }

    /**
     * POST action=delete_calendar_event
     * Required: id (int > 0)
     * Returns success or error if no row matched.
     */
    public function deleteCalendarEvent(): void {
        $id = intval($_POST['id'] ?? 0);

        if ($id <= 0) {
            Response::error('id must be a positive integer');
        }

        $stmt = $this->pdo->prepare("DELETE FROM calendar_events WHERE id = ?");
        $stmt->execute([$id]);

        if ($stmt->rowCount() === 0) {
            Response::error('Event not found');
        }

        Response::success('Event deleted');
    }
}
