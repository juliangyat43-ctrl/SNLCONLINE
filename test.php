<?php
$pdo = new PDO('sqlite:c:\Users\bobby\Desktop\ex\_public_html_live\api\database.sqlite');
$stmt = $pdo->query("SELECT username, password FROM users WHERE role='admin' LIMIT 1");
$row = $stmt->fetch(PDO::FETCH_ASSOC);
echo "Admin Username: " . $row['username'] . "\n";
echo "Admin Password: " . $row['password'] . "\n";
