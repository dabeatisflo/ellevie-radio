#!/usr/bin/env bash
set -euo pipefail

# The production filter and private configuration are deliberately not in Git.
printf '<?php\n' > ovh-studio/app/filter.php
cat > ovh-studio/config.local.php <<'PHP'
<?php
return [
    'database' => [
        'host' => '127.0.0.1', 'name' => 'ellevie_test',
        'user' => 'root', 'password' => 'test-password',
    ],
    'base_url' => 'http://127.0.0.1:8765',
    'ip_hash_secret' => 'a-valid-test-secret-which-is-at-least-thirty-two-characters',
];
PHP

php <<'PHP'
<?php
$pdo = new PDO('mysql:host=127.0.0.1;dbname=ellevie_test;charset=utf8mb4', 'root', 'test-password');
$schema = file_get_contents('ovh-studio/database/schema.sql');
// Simulate the database already running on OVH before this feature is deployed.
$schema = preg_replace(
    '/CREATE TABLE IF NOT EXISTS studio_users \(.*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n/s',
    '', $schema
);
$schema = str_replace('  studio_user_id CHAR(36) NULL,' . "\n", '', $schema);
$schema = str_replace('  INDEX idx_studio_sessions_user (studio_user_id),' . "\n", '', $schema);
$schema = str_replace('  INDEX idx_studio_push_user (studio_user_id),' . "\n", '', $schema);
foreach (explode(';', $schema) as $statement) {
    if (trim($statement) !== '') $pdo->exec($statement);
}
$insert = $pdo->prepare("INSERT INTO settings (setting_key, setting_value, updated_at) VALUES ('admin_password_hash', ?, ?)");
$insert->execute([password_hash('AdminSecret123', PASSWORD_DEFAULT), time()]);
PHP

php -S 127.0.0.1:8765 -t ovh-studio/public ovh-studio/public/index.php >/tmp/ellevie-php-test.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" || true; cat /tmp/ellevie-php-test.log' EXIT
for attempt in {1..20}; do
    if curl -s http://127.0.0.1:8765/studio >/dev/null; then break; fi
    sleep 1
done
python3 tests/studio-users.py
