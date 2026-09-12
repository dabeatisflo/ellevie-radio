<?php

declare(strict_types=1);

const SESSION_COOKIE = 'ellevie_studio_session';
const LISTENER_SESSION_COOKIE = 'ellevie_listener_session';
const FORM_COOKIE = 'ellevie_form_token';
const SESSION_SECONDS = 43200;
const LISTENER_SESSION_SECONDS = 15552000;
const STUDIO_CLAIM_SECONDS = 600;
const VOICE_MAX_SECONDS = 30;
const VOICE_MAX_BYTES = 3145728;

require_once __DIR__ . '/filter.php';

function app_config(): array
{
    static $config;
    if ($config !== null) {
        return $config;
    }
    $path = dirname(__DIR__) . '/config.local.php';
    if (!is_file($path)) {
        throw new RuntimeException('Configuration manquante. Copiez config.example.php vers config.local.php.');
    }
    $loaded = require $path;
    if (!is_array($loaded)) {
        throw new RuntimeException('Configuration invalide.');
    }
    $config = $loaded;
    return $config;
}

function db(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $database = app_config()['database'] ?? [];
    foreach (['host', 'name', 'user', 'password'] as $key) {
        if (!isset($database[$key]) || str_starts_with((string) $database[$key], 'UW_OVH_')) {
            throw new RuntimeException('Configuration de la base de données incomplète.');
        }
    }
    $host = (string) $database['host'];
    $port = (int) ($database['port'] ?? 3306);
    $name = (string) $database['name'];
    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    $pdo = new PDO($dsn, (string) $database['user'], (string) $database['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function now(): int
{
    return time();
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function request_json(): array
{
    if (!str_contains(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
        json_response(['ok' => false, 'error' => "Le format de la requête n'est pas accepté."], 415);
    }
    $declaredLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($declaredLength > 12000) {
        json_response(['ok' => false, 'error' => 'Requête trop volumineuse.'], 413);
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 12000) {
        json_response(['ok' => false, 'error' => 'Requête trop volumineuse.'], 413);
    }
    try {
        $data = json_decode($raw === '' ? '{}' : $raw, true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        json_response(['ok' => false, 'error' => 'Requête invalide.'], 400);
    }
    return is_array($data) ? $data : [];
}

function request_origin_is_allowed(): bool
{
    $origin = rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/');
    $expected = rtrim((string) (app_config()['base_url'] ?? ''), '/');
    return $origin !== '' && $expected !== '' && hash_equals($expected, $origin);
}

function require_allowed_origin(): void
{
    if (!request_origin_is_allowed()) {
        json_response(['ok' => false, 'error' => 'Origine non autorisée.'], 403);
    }
}

function secure_headers(string $path): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    $microphone = ($path === '/' || $path === '/envoyer') ? '(self)' : '()';
    header("Permissions-Policy: camera=(), microphone={$microphone}, geolocation=(), payment=()");
    header("Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob:");
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    if (str_starts_with($path, '/api/') || str_starts_with($path, '/studio') || str_starts_with($path, '/installation')
        || $path === '/' || $path === '/envoyer') {
        header('Cache-Control: no-store');
        header('X-Robots-Tag: noindex, nofollow');
    }
}

function cookie_options(int $expires): array
{
    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ];
}

function random_token(int $bytes = 32): string
{
    return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
}

function issue_form_token(): string
{
    $token = random_token();
    setcookie(FORM_COOKIE, $token, cookie_options(now() + 3600));
    return $token;
}

function require_form_token(array $input): void
{
    $cookie = (string) ($_COOKIE[FORM_COOKIE] ?? '');
    $submitted = (string) ($input['formToken'] ?? '');
    if ($cookie === '' || $submitted === '' || !hash_equals($cookie, $submitted)) {
        json_response(['ok' => false, 'error' => 'La vérification de sécurité a expiré. Rechargez la page.'], 400);
    }
}

function client_hash(string $purpose): string
{
    $secret = (string) (app_config()['ip_hash_secret'] ?? '');
    if (strlen($secret) < 32 || str_starts_with($secret, 'VERVANG_')) {
        throw new RuntimeException('IP hash secret is not configured.');
    }
    $ip = (string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $agent = (string) ($_SERVER['HTTP_USER_AGENT'] ?? 'unknown');
    return hash_hmac('sha256', $purpose . "\n" . $ip . "\n" . $agent, $secret);
}

function rate_limit(string $key, string $bucket, int $maximum, int $windowSeconds): bool
{
    $timestamp = now();
    $reset = $timestamp + max(1, $windowSeconds);
    $statement = db()->prepare(
        'INSERT INTO rate_limits (rate_key, bucket, request_count, reset_at) VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           request_count = IF(reset_at <= ?, 1, request_count + 1),
           reset_at = IF(reset_at <= ?, VALUES(reset_at), reset_at)'
    );
    $statement->execute([$key, $bucket, $reset, $timestamp, $timestamp]);
    $check = db()->prepare('SELECT request_count, reset_at FROM rate_limits WHERE rate_key = ? AND bucket = ?');
    $check->execute([$key, $bucket]);
    $row = $check->fetch();
    return $row && (int) $row['request_count'] <= $maximum;
}

function seconds_until_utc_midnight(): int
{
    $tomorrow = new DateTimeImmutable('tomorrow', new DateTimeZone('UTC'));
    return max(1, $tomorrow->getTimestamp() - now());
}

function admin_password_hash(): ?string
{
    $statement = db()->prepare("SELECT setting_value FROM settings WHERE setting_key = 'admin_password_hash' LIMIT 1");
    $statement->execute();
    $row = $statement->fetch();
    return $row ? (string) $row['setting_value'] : null;
}

function validate_new_password(string $password): ?string
{
    if (strlen($password) < 10 || strlen($password) > 128) {
        return 'Le nouveau mot de passe doit contenir entre 10 et 128 caractères.';
    }
    if (!preg_match('/[a-z]/', $password) || !preg_match('/[A-Z]/', $password)
        || !preg_match('/\d/', $password)) {
        return 'Utilisez au moins une minuscule, une majuscule et un chiffre.';
    }
    return null;
}

function make_password_hash(string $password): string
{
    $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    $hash = password_hash($password, $algorithm);
    if ($hash === false) {
        throw new RuntimeException('Password hashing failed.');
    }
    return $hash;
}

function normalize_email(string $email): string
{
    return strtolower(trim($email));
}

function listener_public_user(array $user): array
{
    return [
        'id' => (string) $user['id'],
        'displayName' => (string) $user['display_name'],
        'email' => (string) $user['email'],
    ];
}

function create_listener_session(string $userId, ?PDO $connection = null): void
{
    $pdo = $connection ?? db();
    $token = random_token();
    $hash = hash('sha256', $token);
    $timestamp = now();
    $statement = $pdo->prepare(
        'INSERT INTO listener_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    );
    $statement->execute([$hash, $userId, $timestamp, $timestamp + LISTENER_SESSION_SECONDS]);
    setcookie(LISTENER_SESSION_COOKIE, $token, cookie_options($timestamp + LISTENER_SESSION_SECONDS));
}

function current_listener_user(): ?array
{
    ensure_account_voice_schema();
    $token = (string) ($_COOKIE[LISTENER_SESSION_COOKIE] ?? '');
    if ($token === '') {
        return null;
    }
    $hash = hash('sha256', $token);
    $statement = db()->prepare(
        'SELECT users.id, users.display_name, users.email, users.conversation_hash, listener_sessions.expires_at
         FROM listener_sessions
         INNER JOIN users ON users.id = listener_sessions.user_id
         WHERE listener_sessions.token_hash = ? LIMIT 1'
    );
    $statement->execute([$hash]);
    $user = $statement->fetch();
    if (!$user || (int) $user['expires_at'] <= now()) {
        if ($user) {
            $delete = db()->prepare('DELETE FROM listener_sessions WHERE token_hash = ?');
            $delete->execute([$hash]);
        }
        setcookie(LISTENER_SESSION_COOKIE, '', cookie_options(1));
        return null;
    }
    return $user;
}

function require_listener_user(): array
{
    $user = current_listener_user();
    if ($user === null) {
        json_response(['ok' => false, 'error' => 'Connectez-vous pour écrire au studio.'], 401);
    }
    return $user;
}

function logout_listener(): void
{
    ensure_account_voice_schema();
    $token = (string) ($_COOKIE[LISTENER_SESSION_COOKIE] ?? '');
    if ($token !== '') {
        $statement = db()->prepare('DELETE FROM listener_sessions WHERE token_hash = ?');
        $statement->execute([hash('sha256', $token)]);
    }
    setcookie(LISTENER_SESSION_COOKIE, '', cookie_options(1));
}

function studio_session_is_valid(): bool
{
    ensure_collaboration_push_schema();
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token === '') {
        return false;
    }
    $statement = db()->prepare('SELECT expires_at FROM studio_sessions WHERE token_hash = ? LIMIT 1');
    $statement->execute([hash('sha256', $token)]);
    $session = $statement->fetch();
    return $session && (int) $session['expires_at'] > now();
}

function voice_storage_directory(): string
{
    return dirname(__DIR__) . '/storage/voice-clips';
}

function create_studio_session(string $operatorName, ?PDO $connection = null): array
{
    ensure_collaboration_push_schema();
    $pdo = $connection ?? db();
    $token = random_token();
    $hash = hash('sha256', $token);
    $timestamp = now();
    $statement = $pdo->prepare(
        'INSERT INTO studio_sessions (token_hash, operator_name, created_at, expires_at) VALUES (?, ?, ?, ?)'
    );
    $statement->execute([$hash, $operatorName, $timestamp, $timestamp + SESSION_SECONDS]);
    setcookie(SESSION_COOKIE, $token, cookie_options($timestamp + SESSION_SECONDS));
    return ['token_hash' => $hash, 'operator_name' => $operatorName];
}

function require_studio_session(): array
{
    ensure_collaboration_push_schema();
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token === '') {
        json_response(['ok' => false, 'error' => 'Connexion requise.'], 401);
    }
    $hash = hash('sha256', $token);
    $statement = db()->prepare(
        'SELECT token_hash, operator_name, expires_at FROM studio_sessions WHERE token_hash = ? LIMIT 1'
    );
    $statement->execute([$hash]);
    $session = $statement->fetch();
    if (!$session || (int) $session['expires_at'] <= now()) {
        if ($session) {
            $delete = db()->prepare('DELETE FROM studio_sessions WHERE token_hash = ?');
            $delete->execute([$hash]);
        }
        setcookie(SESSION_COOKIE, '', cookie_options(1));
        json_response(['ok' => false, 'error' => 'Session expirée.'], 401);
    }
    return [
        'token_hash' => $hash,
        'operator_name' => (string) ($session['operator_name'] ?: 'Studio'),
    ];
}

function logout_studio(): void
{
    ensure_collaboration_push_schema();
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token !== '') {
        $tokenHash = hash('sha256', $token);
        $release = db()->prepare('DELETE FROM studio_claims WHERE session_token_hash = ?');
        $release->execute([$tokenHash]);
        $statement = db()->prepare('DELETE FROM studio_sessions WHERE token_hash = ?');
        $statement->execute([$tokenHash]);
    }
    setcookie(SESSION_COOKIE, '', cookie_options(1));
}

function cleanup_expired_data(): void
{
    ensure_account_voice_schema();
    ensure_studio_push_schema();
    ensure_collaboration_push_schema();
    $timestamp = now();
    $retentionDays = max(1, (int) (app_config()['retention_days'] ?? 30));
    $cutoff = $timestamp - ($retentionDays * 86400);
    $expiredFiles = db()->prepare('SELECT storage_name FROM voice_clips WHERE created_at < ?');
    $expiredFiles->execute([$cutoff]);
    foreach ($expiredFiles->fetchAll() as $file) {
        $name = basename((string) $file['storage_name']);
        $path = voice_storage_directory() . '/' . $name;
        if ($name !== '' && is_file($path)) {
            @unlink($path);
        }
    }
    $queries = [
        ['DELETE FROM voice_clips WHERE created_at < ?', [$cutoff]],
        ['DELETE FROM replies WHERE created_at < ?', [$cutoff]],
        ['DELETE FROM messages WHERE created_at < ?', [$cutoff]],
        ['DELETE FROM rate_limits WHERE reset_at < ?', [$timestamp]],
        ['DELETE FROM studio_sessions WHERE expires_at < ?', [$timestamp]],
        ['DELETE FROM listener_sessions WHERE expires_at < ?', [$timestamp]],
        ['DELETE FROM blocked_senders WHERE created_at < ?', [$timestamp - (90 * 86400)]],
        ['DELETE FROM audit_log WHERE created_at < ?', [$timestamp - (90 * 86400)]],
        ['DELETE FROM studio_push_subscriptions WHERE enabled = 0 AND updated_at < ?', [$timestamp - (30 * 86400)]],
        ['DELETE FROM listener_push_subscriptions WHERE enabled = 0 AND updated_at < ?', [$timestamp - (30 * 86400)]],
        ['DELETE FROM studio_claims WHERE expires_at < ?', [$timestamp]],
    ];
    foreach ($queries as [$sql, $params]) {
        $statement = db()->prepare($sql);
        $statement->execute($params);
    }
}

function ensure_studio_push_schema(): void
{
    static $ready = false;
    if ($ready) {
        return;
    }

    db()->exec(
        'CREATE TABLE IF NOT EXISTS studio_push_subscriptions (
            token_hash CHAR(64) NOT NULL PRIMARY KEY,
            expo_token VARCHAR(255) NOT NULL,
            platform ENUM(\'android\', \'ios\') NOT NULL DEFAULT \'android\',
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            created_at BIGINT UNSIGNED NOT NULL,
            updated_at BIGINT UNSIGNED NOT NULL,
            UNIQUE KEY uq_studio_push_token (expo_token),
            INDEX idx_studio_push_enabled (enabled, updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $ready = true;
}

function ensure_collaboration_push_schema(): void
{
    static $ready = false;
    if ($ready) {
        return;
    }

    $pdo = db();
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS listener_push_subscriptions (
            token_hash CHAR(64) NOT NULL PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            expo_token VARCHAR(255) NOT NULL,
            platform ENUM(\'android\', \'ios\') NOT NULL DEFAULT \'android\',
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            created_at BIGINT UNSIGNED NOT NULL,
            updated_at BIGINT UNSIGNED NOT NULL,
            UNIQUE KEY uq_listener_push_token (expo_token),
            INDEX idx_listener_push_user (user_id, enabled, updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS studio_claims (
            conversation_key_hash CHAR(64) NOT NULL PRIMARY KEY,
            conversation_key VARCHAR(191) NOT NULL,
            session_token_hash CHAR(64) NOT NULL,
            operator_name VARCHAR(40) NOT NULL,
            claimed_at BIGINT UNSIGNED NOT NULL,
            expires_at BIGINT UNSIGNED NOT NULL,
            UNIQUE KEY uq_studio_claim_conversation (conversation_key),
            INDEX idx_studio_claim_session (session_token_hash),
            INDEX idx_studio_claim_expiry (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $operatorColumn = $pdo->query("SHOW COLUMNS FROM studio_sessions LIKE 'operator_name'")->fetch();
    if (!$operatorColumn) {
        $pdo->exec("ALTER TABLE studio_sessions ADD COLUMN operator_name VARCHAR(40) NOT NULL DEFAULT 'Studio' AFTER token_hash");
    }
    $replyOperatorColumn = $pdo->query("SHOW COLUMNS FROM replies LIKE 'operator_name'")->fetch();
    if (!$replyOperatorColumn) {
        $pdo->exec("ALTER TABLE replies ADD COLUMN operator_name VARCHAR(40) NOT NULL DEFAULT 'Studio' AFTER body");
    }
    $ready = true;
}

function ensure_account_voice_schema(): void
{
    static $ready = false;
    if ($ready) {
        return;
    }

    ensure_reply_schema();
    $pdo = db();
    $version = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'account_voice_schema_version' LIMIT 1")->fetchColumn();
    if ((string) $version === '1') {
        $ready = true;
        return;
    }

    $lockName = 'ellevie_account_voice_schema_v1';
    $lock = $pdo->prepare('SELECT GET_LOCK(?, 10)');
    $lock->execute([$lockName]);
    if ((int) $lock->fetchColumn() !== 1) {
        throw new RuntimeException('Impossible de préparer les comptes et messages vocaux. Réessayez dans un instant.');
    }

    try {
        $version = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'account_voice_schema_version' LIMIT 1")->fetchColumn();
        if ((string) $version !== '1') {
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS users (
                    id CHAR(36) NOT NULL PRIMARY KEY,
                    display_name VARCHAR(40) NOT NULL,
                    email VARCHAR(191) NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    conversation_hash CHAR(64) NOT NULL,
                    created_at BIGINT UNSIGNED NOT NULL,
                    updated_at BIGINT UNSIGNED NOT NULL,
                    UNIQUE KEY uq_users_email (email),
                    UNIQUE KEY uq_users_conversation (conversation_hash)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS listener_sessions (
                    token_hash CHAR(64) NOT NULL PRIMARY KEY,
                    user_id CHAR(36) NOT NULL,
                    created_at BIGINT UNSIGNED NOT NULL,
                    expires_at BIGINT UNSIGNED NOT NULL,
                    INDEX idx_listener_sessions_user (user_id),
                    INDEX idx_listener_sessions_expiry (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS voice_clips (
                    id CHAR(36) NOT NULL PRIMARY KEY,
                    message_id CHAR(36) NOT NULL,
                    user_id CHAR(36) NOT NULL,
                    storage_name VARCHAR(100) NOT NULL,
                    mime_type VARCHAR(60) NOT NULL,
                    size_bytes INT UNSIGNED NOT NULL,
                    duration_seconds SMALLINT UNSIGNED NOT NULL,
                    created_at BIGINT UNSIGNED NOT NULL,
                    UNIQUE KEY uq_voice_message (message_id),
                    UNIQUE KEY uq_voice_storage (storage_name),
                    INDEX idx_voice_user_created (user_id, created_at),
                    INDEX idx_voice_created (created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );

            $column = $pdo->query("SHOW COLUMNS FROM messages LIKE 'user_id'")->fetch();
            if (!$column) {
                $pdo->exec('ALTER TABLE messages ADD COLUMN user_id CHAR(36) NULL AFTER conversation_hash');
            }
            $index = $pdo->query("SHOW INDEX FROM messages WHERE Key_name = 'idx_messages_user_created'")->fetch();
            if (!$index) {
                $pdo->exec('ALTER TABLE messages ADD INDEX idx_messages_user_created (user_id, created_at)');
            }

            $saveVersion = $pdo->prepare(
                "INSERT INTO settings (setting_key, setting_value, updated_at) VALUES ('account_voice_schema_version', '1', ?)
                 ON DUPLICATE KEY UPDATE setting_value = '1', updated_at = VALUES(updated_at)"
            );
            $saveVersion->execute([now()]);
        }
        $ready = true;
    } finally {
        $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}

function ensure_reply_schema(): void
{
    static $ready = false;
    if ($ready) {
        return;
    }

    $pdo = db();
    $version = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'reply_schema_version' LIMIT 1")->fetchColumn();
    if ((string) $version === '1') {
        $ready = true;
        return;
    }

    $lockName = 'ellevie_reply_schema_v1';
    $lock = $pdo->prepare('SELECT GET_LOCK(?, 10)');
    $lock->execute([$lockName]);
    if ((int) $lock->fetchColumn() !== 1) {
        throw new RuntimeException('Impossible de préparer la fonction de réponse. Réessayez dans un instant.');
    }

    try {
        $version = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'reply_schema_version' LIMIT 1")->fetchColumn();
        if ((string) $version !== '1') {
            $column = $pdo->query("SHOW COLUMNS FROM messages LIKE 'conversation_hash'")->fetch();
            if (!$column) {
                $pdo->exec('ALTER TABLE messages ADD COLUMN conversation_hash CHAR(64) NULL AFTER message_hash');
            }

            $index = $pdo->query("SHOW INDEX FROM messages WHERE Key_name = 'idx_messages_conversation'")->fetch();
            if (!$index) {
                $pdo->exec('ALTER TABLE messages ADD INDEX idx_messages_conversation (conversation_hash, created_at)');
            }

            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS replies (
                    id CHAR(36) NOT NULL PRIMARY KEY,
                    message_id CHAR(36) NOT NULL,
                    conversation_hash CHAR(64) NOT NULL,
                    body VARCHAR(500) NOT NULL,
                    created_at BIGINT UNSIGNED NOT NULL,
                    INDEX idx_replies_message (message_id, created_at),
                    INDEX idx_replies_conversation (conversation_hash, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
            );

            $saveVersion = $pdo->prepare(
                "INSERT INTO settings (setting_key, setting_value, updated_at) VALUES ('reply_schema_version', '1', ?)
                 ON DUPLICATE KEY UPDATE setting_value = '1', updated_at = VALUES(updated_at)"
            );
            $saveVersion->execute([now()]);
        }
        $ready = true;
    } finally {
        $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}

function conversation_hash(array $input): string
{
    $token = strtolower(trim((string) ($input['conversationToken'] ?? '')));
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        json_response(['ok' => false, 'error' => 'La conversation a expiré. Rechargez la page.'], 400);
    }
    return hash('sha256', $token);
}

function uuid_v4(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}
