<?php
/**
 * accounts_bank.php
 * Returns a JSON list of demo / seed accounts.
 * This is a READ-ONLY fallback — it does NOT write to the database.
 * The frontend uses this when the primary API is unreachable so the
 * parent portal can still display something meaningful.
 *
 * To add real accounts, edit the $accounts array below OR manage them
 * through the admin panel (they will be stored in snlc_database.sqlite).
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// ── Seed / demo accounts ─────────────────────────────────────────────────────
// These mirror what is seeded in Database.php so offline mode stays consistent.
// Passwords are NOT stored here — this endpoint is for display data only.
$accounts = [
    [
        'user_id'      => 1,
        'username'     => 'admin',
        'full_name'    => 'Administrator',
        'role'         => 'admin',
        'grade'        => null,
        'section'      => null,
        'status'       => 'active',
        'parent_email' => null,
    ],
    [
        'user_id'      => 2,
        'username'     => 'student1',
        'full_name'    => 'Juan dela Cruz',
        'role'         => 'student',
        'grade'        => 'Grade 6',
        'section'      => 'St. Matthew',
        'status'       => 'active',
        'parent_email' => 'parent1@example.com',
    ],
    [
        'user_id'      => 3,
        'username'     => 'student2',
        'full_name'    => 'Maria Santos',
        'role'         => 'student',
        'grade'        => 'Grade 5',
        'section'      => 'St. Luke',
        'status'       => 'active',
        'parent_email' => 'parent2@example.com',
    ],
    [
        'user_id'      => 4,
        'username'     => 'teacher1',
        'full_name'    => 'Ma. Teresa Reyes',
        'role'         => 'teacher',
        'grade'        => null,
        'section'      => null,
        'status'       => 'active',
        'parent_email' => null,
    ],
];

// ── Optional: filter by role via ?role=student ────────────────────────────────
$roleFilter = isset($_GET['role']) ? strtolower(trim($_GET['role'])) : null;
if ($roleFilter) {
    $accounts = array_values(array_filter($accounts, fn($a) => $a['role'] === $roleFilter));
}

echo json_encode([
    'success' => true,
    'source'  => 'accounts_bank',
    'data'    => $accounts,
]);
