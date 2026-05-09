<?php
require_once __DIR__ . '/../Response.php';
require_once __DIR__ . '/../DataVersion.php';
require_once __DIR__ . '/HandlerHelpers.php';

class AnnouncementHandler {
    use HandlerHelpers;

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function getAnnouncements(): void {
        $stmt = $this->pdo->query(
            "SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100"
        );
        Response::success('', $stmt->fetchAll());
    }

    public function addAnnouncement(): void {
        $title   = $this->sanitize($_POST['title']   ?? '');
        $content = $this->sanitize($_POST['content'] ?? '');
        $type    = $this->sanitize($_POST['type']    ?? 'info');

        if (empty($title) || empty($content)) {
            Response::error('Title and content required');
        }

        $stmt = $this->pdo->prepare(
            "INSERT INTO announcements (title, content, type, created_at)
             VALUES (?, ?, ?, datetime('now', 'localtime'))"
        );
        $stmt->execute([$title, $content, $type]);

        DataVersion::updateVersion('announcements');
        $this->logActivity($_SESSION['user_id'], "Added announcement: $title");
        Response::success('Announcement posted');
    }

    public function deleteAnnouncement(): void {
        $id = intval($_POST['id'] ?? 0);
        $this->pdo->prepare("DELETE FROM announcements WHERE id = ?")->execute([$id]);

        DataVersion::updateVersion('announcements');
        $this->logActivity($_SESSION['user_id'], "Deleted announcement ID $id");
        Response::success('Announcement deleted');
    }
}
