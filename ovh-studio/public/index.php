<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/app/bootstrap.php';

$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
$path = rtrim($path, '/') ?: '/';
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
secure_headers($path);

try {
    if ($path === '/api/config' && $method === 'GET') {
        ensure_account_voice_schema();
        $listener = current_listener_user();
        json_response([
            'ok' => true,
            'formToken' => issue_form_token(),
            'messageMaxLength' => max(2, (int) (app_config()['message_max_length'] ?? 500)),
            'voiceMaxSeconds' => VOICE_MAX_SECONDS,
            'account' => $listener ? listener_public_user($listener) : null,
        ]);
    }

    if ($path === '/api/account/register' && $method === 'POST') {
        require_allowed_origin();
        register_listener();
    }
    if ($path === '/api/account/login' && $method === 'POST') {
        require_allowed_origin();
        listener_login();
    }
    if ($path === '/api/account/logout' && $method === 'POST') {
        require_allowed_origin();
        logout_listener();
        json_response(['ok' => true]);
    }

    if ($path === '/api/messages' && $method === 'POST') {
        require_allowed_origin();
        submit_message();
    }
    if ($path === '/api/voice-messages' && $method === 'POST') {
        require_allowed_origin();
        submit_voice_message();
    }
    if ($path === '/api/conversation' && $method === 'POST') {
        require_allowed_origin();
        list_conversation();
    }
    if ($path === '/api/listener/push-subscription' && in_array($method, ['POST', 'DELETE'], true)) {
        require_allowed_origin();
        $listener = require_listener_user();
        update_listener_push_subscription($listener, $method === 'POST');
    }
    if ($path === '/api/install' && $method === 'POST') {
        require_allowed_origin();
        install_studio();
    }
    if ($path === '/api/studio/login' && $method === 'POST') {
        require_allowed_origin();
        studio_login();
    }
    if ($path === '/api/studio/logout' && $method === 'POST') {
        require_allowed_origin();
        logout_studio();
        json_response(['ok' => true]);
    }
    if ($path === '/api/studio/password' && $method === 'POST') {
        require_allowed_origin();
        change_studio_password();
    }
    if ($path === '/api/studio/push-subscription' && $method === 'POST') {
        require_allowed_origin();
        require_studio_session();
        update_studio_push_subscription(true);
    }
    if ($path === '/api/studio/push-subscription' && $method === 'DELETE') {
        require_allowed_origin();
        require_studio_session();
        update_studio_push_subscription(false);
    }
    if ($path === '/api/studio/claims' && $method === 'POST') {
        require_allowed_origin();
        claim_studio_conversation(require_studio_session());
    }
    if ($path === '/api/studio/claims' && $method === 'DELETE') {
        require_allowed_origin();
        release_studio_conversation(require_studio_session());
    }
    if ($path === '/api/studio/messages' && $method === 'GET') {
        list_studio_messages(require_studio_session());
    }
    if (preg_match('#^/api/studio/messages/([a-f0-9-]{36})$#', $path, $match) && $method === 'PATCH') {
        require_allowed_origin();
        require_studio_session();
        update_studio_message($match[1]);
    }
    if (preg_match('#^/api/studio/messages/([a-f0-9-]{36})/reply$#', $path, $match) && $method === 'POST') {
        require_allowed_origin();
        reply_to_message($match[1], require_studio_session());
    }
    if (preg_match('#^/api/voice/([a-f0-9-]{36})$#', $path, $match) && in_array($method, ['GET', 'HEAD'], true)) {
        stream_voice_clip($match[1], $method === 'HEAD');
    }
    if (str_starts_with($path, '/api/')) {
        json_response(['ok' => false, 'error' => 'Introuvable.'], 404);
    }

    if (!in_array($method, ['GET', 'HEAD'], true)) {
        http_response_code(405);
        exit('Method Not Allowed');
    }

    $pages = [
        '/' => 'envoyer.html',
        '/envoyer' => 'envoyer.html',
        '/studio' => 'studio.html',
        '/confidentialite' => 'confidentialite.html',
        '/installation' => 'installation.html',
    ];
    if (!isset($pages[$path])) {
        http_response_code(404);
        exit('Introuvable.');
    }
    header('Content-Type: text/html; charset=utf-8');
    if ($method === 'GET') {
        readfile(__DIR__ . '/' . $pages[$path]);
    }
} catch (Throwable $error) {
    error_log('Ellevie studio error: ' . $error->getMessage());
    $publicMessage = 'Une erreur temporaire est survenue.';
    if ($error instanceof PDOException) {
        $driverCode = isset($error->errorInfo[1]) ? (int) $error->errorInfo[1] : 0;
        if (in_array($driverCode, [1044, 1045], true)) {
            $publicMessage = 'La connexion à la base de données a été refusée. Vérifiez le mot de passe MySQL dans la configuration.';
        } elseif ($driverCode === 1146) {
            $publicMessage = "Les tables de la base de données sont absentes. Réimportez le fichier schema.sql.";
        } elseif (str_contains(strtolower($error->getMessage()), 'could not find driver')) {
            $publicMessage = "Le pilote MySQL n'est pas activé sur cet hébergement.";
        }
    }
    json_response(['ok' => false, 'error' => $publicMessage], 500);
}

function register_listener(): never
{
    ensure_account_voice_schema();
    $input = request_json();
    require_form_token($input);
    if (!rate_limit(client_hash('listener-register'), 'listener-register', 5, 3600)) {
        json_response(['ok' => false, 'error' => 'Trop de créations de compte. Réessayez plus tard.'], 429);
    }

    $displayName = trim(preg_replace('/\s+/u', ' ', (string) ($input['displayName'] ?? '')) ?? '');
    $email = normalize_email((string) ($input['email'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    $nameLength = function_exists('mb_strlen') ? mb_strlen($displayName) : strlen($displayName);
    if ($nameLength < 2 || $nameLength > 40) {
        json_response(['ok' => false, 'error' => 'Le prénom doit contenir entre 2 et 40 caractères.'], 400);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 191) {
        json_response(['ok' => false, 'error' => 'Saisissez une adresse e-mail valide.'], 400);
    }
    if ($error = validate_new_password($password)) {
        json_response(['ok' => false, 'error' => $error], 400);
    }
    if (($input['privacyAccepted'] ?? false) !== true) {
        json_response(['ok' => false, 'error' => 'Acceptez la politique de confidentialité pour créer le compte.'], 400);
    }

    $existing = db()->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
    $existing->execute([$email]);
    if ($existing->fetch()) {
        json_response(['ok' => false, 'error' => 'Un compte existe déjà avec cette adresse e-mail.'], 409);
    }

    $legacyToken = strtolower(trim((string) ($input['conversationToken'] ?? '')));
    $conversationHash = preg_match('/^[a-f0-9]{64}$/', $legacyToken)
        ? hash('sha256', $legacyToken)
        : hash('sha256', random_token());
    $usedConversation = db()->prepare('SELECT id FROM users WHERE conversation_hash = ? LIMIT 1');
    $usedConversation->execute([$conversationHash]);
    if ($usedConversation->fetch()) {
        $conversationHash = hash('sha256', random_token());
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $userId = uuid_v4();
        $timestamp = now();
        $insert = $pdo->prepare(
            'INSERT INTO users (id, display_name, email, password_hash, conversation_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $userId, $displayName, $email, make_password_hash($password), $conversationHash, $timestamp, $timestamp,
        ]);
        $migrate = $pdo->prepare('UPDATE messages SET user_id = ? WHERE conversation_hash = ? AND user_id IS NULL');
        $migrate->execute([$userId, $conversationHash]);
        create_listener_session($userId, $pdo);
        $pdo->commit();
    } catch (PDOException $error) {
        $pdo->rollBack();
        $driverCode = isset($error->errorInfo[1]) ? (int) $error->errorInfo[1] : 0;
        if ($driverCode === 1062) {
            json_response(['ok' => false, 'error' => 'Un compte existe déjà avec cette adresse e-mail.'], 409);
        }
        throw $error;
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }

    json_response([
        'ok' => true,
        'account' => ['id' => $userId, 'displayName' => $displayName, 'email' => $email],
        'message' => 'Votre compte Ellevie est prêt.',
    ], 201);
}

function listener_login(): never
{
    ensure_account_voice_schema();
    $input = request_json();
    require_form_token($input);
    $email = normalize_email((string) ($input['email'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    $rateKey = hash('sha256', client_hash('listener-login') . "\n" . $email);
    if (!rate_limit($rateKey, 'listener-login', 10, 900)) {
        json_response(['ok' => false, 'error' => 'Trop de tentatives. Réessayez dans 15 minutes.'], 429);
    }

    $statement = db()->prepare(
        'SELECT id, display_name, email, password_hash, conversation_hash FROM users WHERE email = ? LIMIT 1'
    );
    $statement->execute([$email]);
    $user = $statement->fetch();
    if (!$user || !password_verify($password, (string) $user['password_hash'])) {
        json_response(['ok' => false, 'error' => 'Adresse e-mail ou mot de passe incorrect.'], 401);
    }
    if (password_needs_rehash((string) $user['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
        $update = db()->prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?');
        $update->execute([make_password_hash($password), now(), $user['id']]);
    }
    create_listener_session((string) $user['id']);
    cleanup_expired_data();
    json_response(['ok' => true, 'account' => listener_public_user($user)]);
}

function submit_message(): never
{
    $input = request_json();
    if (trim((string) ($input['website'] ?? '')) !== '') {
        json_response(['ok' => true, 'message' => 'Votre message a bien été transmis au studio.'], 202);
    }
    require_form_token($input);
    $user = require_listener_user();
    $input['displayName'] = (string) $user['display_name'];
    $conversationHash = (string) $user['conversation_hash'];
    $maxLength = max(2, (int) (app_config()['message_max_length'] ?? 500));
    $validation = validate_submission($input, $maxLength);
    if (!$validation['ok']) {
        json_response(['ok' => false, 'error' => $validation['error']], 400);
    }

    $senderHash = hash('sha256', 'listener:' . (string) $user['id']);
    if (!rate_limit($senderHash, 'security-check', 20, 60)) {
        json_response(['ok' => false, 'error' => 'Trop de tentatives. Merci de patienter.'], 429);
    }
    if (!rate_limit($senderHash, 'send-short', 5, 60)) {
        header('Retry-After: 60');
        json_response(['ok' => false, 'error' => 'Vous avez envoyé trop de messages. Merci de patienter avant de réessayer.'], 429);
    }
    if (!rate_limit($senderHash, 'send-day', 50, seconds_until_utc_midnight())) {
        json_response(['ok' => false, 'error' => 'La limite quotidienne de messages est atteinte. Merci de réessayer demain.'], 429);
    }

    $value = $validation['value'];
    $bodyAssessment = assess_message($value['body']);
    $nameAssessment = assess_message($value['displayName']);
    $reasons = array_values(array_unique(array_merge($bodyAssessment['reasons'], $nameAssessment['reasons'])));
    $status = $reasons === [] ? 'new' : 'quarantined';
    $messageHash = hash('sha256', normalize_for_filter($value['body']));
    $timestamp = now();

    $duplicate = db()->prepare(
        'SELECT id FROM messages WHERE sender_hash = ? AND message_hash = ? AND conversation_hash = ? AND created_at > ? LIMIT 1'
    );
    $duplicate->execute([$senderHash, $messageHash, $conversationHash, $timestamp - 3600]);
    if ($duplicate->fetch()) {
        json_response(['ok' => true, 'message' => 'Votre message a bien été transmis au studio.'], 202);
    }

    $blocked = db()->prepare('SELECT sender_hash FROM blocked_senders WHERE sender_hash = ? LIMIT 1');
    $blocked->execute([$senderHash]);
    if ($blocked->fetch()) {
        $status = 'quarantined';
        $reasons[] = 'expéditeur_bloqué';
    }

    $messageId = uuid_v4();
    $insert = db()->prepare(
        'INSERT INTO messages (id, display_name, body, source, status, filter_reasons, sender_hash, message_hash, conversation_hash, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $insert->execute([
        $messageId, $value['displayName'], $value['body'], $value['source'], $status,
        $reasons === [] ? null : json_encode(array_values(array_unique($reasons)), JSON_UNESCAPED_UNICODE),
        $senderHash, $messageHash, $conversationHash, $user['id'], $timestamp,
    ]);
    notify_studio_devices($messageId, $value['displayName'], $value['body'], false, $status);
    if (random_int(1, 50) === 1) {
        cleanup_expired_data();
    }
    json_response(['ok' => true, 'message' => 'Votre message a bien été transmis au studio.'], 201);
}

function submit_voice_message(): never
{
    ensure_account_voice_schema();
    require_form_token($_POST);
    $user = require_listener_user();
    $duration = (int) ceil((float) ($_POST['duration'] ?? 0));
    if ($duration < 1 || $duration > VOICE_MAX_SECONDS) {
        json_response(['ok' => false, 'error' => 'Le message vocal doit durer entre 1 et 30 secondes.'], 400);
    }
    if (!isset($_FILES['audio']) || !is_array($_FILES['audio'])) {
        json_response(['ok' => false, 'error' => 'Aucun enregistrement audio reçu.'], 400);
    }
    $upload = $_FILES['audio'];
    if ((int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response(['ok' => false, 'error' => "L'enregistrement n'a pas pu être transféré."], 400);
    }
    $size = (int) ($upload['size'] ?? 0);
    $temporaryPath = (string) ($upload['tmp_name'] ?? '');
    if ($size < 1 || $size > VOICE_MAX_BYTES || !is_uploaded_file($temporaryPath)) {
        json_response(['ok' => false, 'error' => 'Le message vocal est vide ou trop volumineux.'], 413);
    }

    $declaredType = strtolower(trim(explode(';', (string) ($upload['type'] ?? ''))[0]));
    $detectedType = '';
    if (function_exists('finfo_open')) {
        $info = finfo_open(FILEINFO_MIME_TYPE);
        if ($info !== false) {
            $detectedType = strtolower((string) finfo_file($info, $temporaryPath));
            finfo_close($info);
        }
    }
    $formats = [
        'audio/webm' => ['mime' => 'audio/webm', 'extension' => 'webm'],
        'video/webm' => ['mime' => 'audio/webm', 'extension' => 'webm'],
        'audio/mp4' => ['mime' => 'audio/mp4', 'extension' => 'm4a'],
        'video/mp4' => ['mime' => 'audio/mp4', 'extension' => 'm4a'],
        'audio/ogg' => ['mime' => 'audio/ogg', 'extension' => 'ogg'],
        'application/ogg' => ['mime' => 'audio/ogg', 'extension' => 'ogg'],
        'audio/mpeg' => ['mime' => 'audio/mpeg', 'extension' => 'mp3'],
        'audio/aac' => ['mime' => 'audio/aac', 'extension' => 'aac'],
        'audio/x-m4a' => ['mime' => 'audio/mp4', 'extension' => 'm4a'],
    ];
    $format = $formats[$detectedType] ?? $formats[$declaredType] ?? null;
    if ($format === null) {
        json_response(['ok' => false, 'error' => "Ce format d'enregistrement n'est pas accepté."], 415);
    }

    $senderHash = hash('sha256', 'listener:' . (string) $user['id']);
    if (!rate_limit($senderHash, 'voice-short', 5, 300)
        || !rate_limit($senderHash, 'voice-day', 20, seconds_until_utc_midnight())) {
        json_response(['ok' => false, 'error' => 'Vous avez envoyé trop de messages vocaux. Réessayez plus tard.'], 429);
    }
    $blocked = db()->prepare('SELECT sender_hash FROM blocked_senders WHERE sender_hash = ? LIMIT 1');
    $blocked->execute([$senderHash]);
    $isBlocked = (bool) $blocked->fetch();

    $directory = voice_storage_directory();
    if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
        throw new RuntimeException('Le dossier des messages vocaux ne peut pas être créé.');
    }
    $clipId = uuid_v4();
    $messageId = uuid_v4();
    $storageName = $clipId . '.' . $format['extension'];
    $destination = $directory . '/' . $storageName;
    if (!move_uploaded_file($temporaryPath, $destination)) {
        throw new RuntimeException("L'enregistrement n'a pas pu être sauvegardé.");
    }
    @chmod($destination, 0640);

    $timestamp = now();
    $status = $isBlocked ? 'quarantined' : 'new';
    $reasons = $isBlocked ? json_encode(['expéditeur_bloqué'], JSON_UNESCAPED_UNICODE) : null;
    $messageHash = hash_file('sha256', $destination) ?: hash('sha256', $clipId);
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $insertMessage = $pdo->prepare(
            'INSERT INTO messages (id, display_name, body, source, status, filter_reasons, sender_hash, message_hash, conversation_hash, user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $source = ($_POST['source'] ?? '') === 'app' ? 'app' : 'web';
        $insertMessage->execute([
            $messageId, $user['display_name'], 'Message vocal', $source, $status, $reasons, $senderHash,
            $messageHash, $user['conversation_hash'], $user['id'], $timestamp,
        ]);
        $insertClip = $pdo->prepare(
            'INSERT INTO voice_clips (id, message_id, user_id, storage_name, mime_type, size_bytes, duration_seconds, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $insertClip->execute([
            $clipId, $messageId, $user['id'], $storageName, $format['mime'], $size, $duration, $timestamp,
        ]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        if (is_file($destination)) {
            @unlink($destination);
        }
        throw $error;
    }

    notify_studio_devices($messageId, (string) $user['display_name'], 'Message vocal', true, $status);

    json_response(['ok' => true, 'message' => 'Votre message vocal a bien été transmis au studio.'], 201);
}

function update_studio_push_subscription(bool $enabled): never
{
    ensure_studio_push_schema();
    $input = request_json();
    $token = trim((string) ($input['token'] ?? ''));
    if (!preg_match('/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,220}\]$/', $token)) {
        json_response(['ok' => false, 'error' => 'Jeton de notification invalide.'], 400);
    }

    $tokenHash = hash('sha256', $token);
    if (!$enabled) {
        $delete = db()->prepare('DELETE FROM studio_push_subscriptions WHERE token_hash = ?');
        $delete->execute([$tokenHash]);
        json_response(['ok' => true, 'enabled' => false]);
    }

    $platform = strtolower((string) ($input['platform'] ?? 'android'));
    if (!in_array($platform, ['android', 'ios'], true)) {
        $platform = 'android';
    }
    $timestamp = now();
    $save = db()->prepare(
        'INSERT INTO studio_push_subscriptions (token_hash, expo_token, platform, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE expo_token = VALUES(expo_token), platform = VALUES(platform),
           enabled = 1, updated_at = VALUES(updated_at)'
    );
    $save->execute([$tokenHash, $token, $platform, $timestamp, $timestamp]);
    json_response(['ok' => true, 'enabled' => true]);
}

function update_listener_push_subscription(array $user, bool $enabled): never
{
    ensure_collaboration_push_schema();
    $input = request_json();
    $token = trim((string) ($input['token'] ?? ''));
    if (!preg_match('/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,220}\]$/', $token)) {
        json_response(['ok' => false, 'error' => 'Jeton de notification invalide.'], 400);
    }

    $tokenHash = hash('sha256', $token);
    if (!$enabled) {
        $delete = db()->prepare(
            'DELETE FROM listener_push_subscriptions WHERE token_hash = ? AND user_id = ?'
        );
        $delete->execute([$tokenHash, $user['id']]);
        json_response(['ok' => true, 'enabled' => false]);
    }

    $platform = strtolower((string) ($input['platform'] ?? 'android'));
    if (!in_array($platform, ['android', 'ios'], true)) {
        $platform = 'android';
    }
    $timestamp = now();
    $save = db()->prepare(
        'INSERT INTO listener_push_subscriptions
           (token_hash, user_id, expo_token, platform, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), expo_token = VALUES(expo_token),
           platform = VALUES(platform), enabled = 1, updated_at = VALUES(updated_at)'
    );
    $save->execute([$tokenHash, $user['id'], $token, $platform, $timestamp, $timestamp]);
    json_response(['ok' => true, 'enabled' => true]);
}

function notify_listener_devices(
    string $messageId,
    string $userId,
    string $operatorName,
    string $messageBody
): void {
    try {
        ensure_collaboration_push_schema();
        $statement = db()->prepare(
            'SELECT token_hash, expo_token FROM listener_push_subscriptions WHERE user_id = ? AND enabled = 1'
        );
        $statement->execute([$userId]);
        $devices = $statement->fetchAll();
        if ($devices === []) {
            return;
        }

        $cleanBody = trim(preg_replace('/\s+/u', ' ', $messageBody) ?? '');
        $cleanBody = function_exists('mb_substr') ? mb_substr($cleanBody, 0, 160) : substr($cleanBody, 0, 160);
        foreach (array_chunk($devices, 100) as $chunk) {
            $payloads = [];
            foreach ($chunk as $device) {
                $payloads[] = [
                    'to' => (string) $device['expo_token'],
                    'title' => 'Réponse de ' . $operatorName,
                    'body' => $cleanBody,
                    'sound' => 'default',
                    'priority' => 'high',
                    'channelId' => 'studio-replies',
                    'data' => [
                        'type' => 'studioReply',
                        'messageId' => $messageId,
                        'screen' => 'messages',
                    ],
                ];
            }
            $result = send_expo_push_request($payloads);
            disable_unregistered_push_tokens('listener_push_subscriptions', $chunk, $result);
        }
    } catch (Throwable $error) {
        // Une notification échouée ne doit jamais annuler une réponse déjà enregistrée.
        error_log('Ellevie listener push error: ' . $error->getMessage());
    }
}

function disable_unregistered_push_tokens(string $table, array $devices, array $result): void
{
    if (!in_array($table, ['studio_push_subscriptions', 'listener_push_subscriptions'], true)) {
        return;
    }
    $tickets = is_array($result['data'] ?? null) ? $result['data'] : [];
    foreach ($tickets as $position => $ticket) {
        if (!is_array($ticket) || ($ticket['status'] ?? '') !== 'error'
            || ($ticket['details']['error'] ?? '') !== 'DeviceNotRegistered'
            || !isset($devices[$position])) {
            continue;
        }
        $disable = db()->prepare("UPDATE {$table} SET enabled = 0, updated_at = ? WHERE token_hash = ?");
        $disable->execute([now(), $devices[$position]['token_hash']]);
    }
}

function notify_studio_devices(
    string $messageId,
    string $displayName,
    string $messageBody,
    bool $isVoice,
    string $status
): void {
    if ($status !== 'new') {
        return;
    }

    try {
        ensure_studio_push_schema();
        $statement = db()->query('SELECT token_hash, expo_token FROM studio_push_subscriptions WHERE enabled = 1');
        $devices = $statement->fetchAll();
        if ($devices === []) {
            return;
        }

        $cleanName = trim(preg_replace('/\s+/u', ' ', $displayName) ?? '') ?: 'Auditrice';
        $cleanBody = trim(preg_replace('/\s+/u', ' ', $messageBody) ?? '');
        if (function_exists('mb_substr')) {
            $cleanBody = mb_substr($cleanBody, 0, 160);
        } else {
            $cleanBody = substr($cleanBody, 0, 160);
        }

        foreach (array_chunk($devices, 100) as $chunk) {
            $payloads = [];
            foreach ($chunk as $device) {
                $payloads[] = [
                    'to' => (string) $device['expo_token'],
                    'title' => $isVoice ? 'Nieuwe voiceclip van ' . $cleanName : 'Nieuw bericht van ' . $cleanName,
                    'body' => $isVoice ? 'Tik om de voiceclip in Studio te openen.' : $cleanBody,
                    'sound' => 'default',
                    'priority' => 'high',
                    'channelId' => 'studio-messages',
                    'data' => ['messageId' => $messageId, 'screen' => 'studio'],
                ];
            }

            $result = send_expo_push_request($payloads);
            $tickets = is_array($result['data'] ?? null) ? $result['data'] : [];
            foreach ($tickets as $position => $ticket) {
                if (!is_array($ticket) || ($ticket['status'] ?? '') !== 'error') {
                    continue;
                }
                if (($ticket['details']['error'] ?? '') !== 'DeviceNotRegistered' || !isset($chunk[$position])) {
                    continue;
                }
                $disable = db()->prepare(
                    'UPDATE studio_push_subscriptions SET enabled = 0, updated_at = ? WHERE token_hash = ?'
                );
                $disable->execute([now(), $chunk[$position]['token_hash']]);
            }
        }
    } catch (Throwable $error) {
        // Een mislukte melding mag het bericht van de luisteraar nooit tegenhouden.
        error_log('Ellevie push error: ' . $error->getMessage());
    }
}

function send_expo_push_request(array $payloads): array
{
    $json = json_encode($payloads, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $url = 'https://exp.host/--/api/v2/push/send';
    $response = false;
    $status = 0;

    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        if ($handle === false) {
            throw new RuntimeException('Le service de notification ne peut pas être initialisé.');
        }
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => $json,
        ]);
        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($handle);
        curl_close($handle);
        if ($response === false) {
            throw new RuntimeException('Notification réseau: ' . $curlError);
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'timeout' => 5,
                'ignore_errors' => true,
                'header' => "Accept: application/json\r\nContent-Type: application/json\r\n",
                'content' => $json,
            ],
        ]);
        $response = file_get_contents($url, false, $context);
        foreach (($http_response_header ?? []) as $header) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $match)) {
                $status = (int) $match[1];
                break;
            }
        }
        if ($response === false) {
            throw new RuntimeException('Le service de notification est inaccessible.');
        }
    }

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException('Le service de notification a répondu avec le statut ' . $status . '.');
    }
    $decoded = json_decode((string) $response, true, 32, JSON_THROW_ON_ERROR);
    return is_array($decoded) ? $decoded : [];
}

function stream_voice_clip(string $clipId, bool $headOnly): never
{
    ensure_account_voice_schema();
    $statement = db()->prepare(
        'SELECT voice_clips.storage_name, voice_clips.mime_type, voice_clips.size_bytes, voice_clips.user_id,
                messages.status
         FROM voice_clips INNER JOIN messages ON messages.id = voice_clips.message_id
         WHERE voice_clips.id = ? LIMIT 1'
    );
    $statement->execute([$clipId]);
    $clip = $statement->fetch();
    if (!$clip) {
        json_response(['ok' => false, 'error' => 'Message vocal introuvable.'], 404);
    }
    $listener = current_listener_user();
    $ownsClip = $listener && hash_equals((string) $clip['user_id'], (string) $listener['id']);
    if (!$ownsClip && !studio_session_is_valid()) {
        json_response(['ok' => false, 'error' => 'Connexion requise.'], 401);
    }

    $storageName = basename((string) $clip['storage_name']);
    $filePath = voice_storage_directory() . '/' . $storageName;
    if ($storageName === '' || !is_file($filePath)) {
        json_response(['ok' => false, 'error' => 'Fichier audio indisponible.'], 404);
    }
    $size = filesize($filePath);
    if ($size === false || $size < 1) {
        json_response(['ok' => false, 'error' => 'Fichier audio indisponible.'], 404);
    }

    // Volledige levering is betrouwbaarder voor korte MediaRecorder-clips.
    // De normale endpoint behoudt byte ranges voor compatibiliteit.
    $complete = (string) ($_GET['complete'] ?? '') === '1';
    $start = 0;
    $end = $size - 1;
    $range = $complete ? '' : (string) ($_SERVER['HTTP_RANGE'] ?? '');
    if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', $range, $match)) {
        if ($match[1] === '' && $match[2] !== '') {
            $suffix = min($size, max(1, (int) $match[2]));
            $start = $size - $suffix;
        } else {
            $start = max(0, (int) $match[1]);
            if ($match[2] !== '') {
                $end = min($end, (int) $match[2]);
            }
        }
        if ($start > $end || $start >= $size) {
            header("Content-Range: bytes */{$size}");
            http_response_code(416);
            exit;
        }
        http_response_code(206);
        header("Content-Range: bytes {$start}-{$end}/{$size}");
    }
    $length = $end - $start + 1;
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
    }
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    header('Content-Type: ' . (string) $clip['mime_type']);
    header($complete ? 'Accept-Ranges: none' : 'Accept-Ranges: bytes');
    header('Content-Length: ' . $length);
    header('Content-Disposition: inline; filename="message-vocal.' . pathinfo($storageName, PATHINFO_EXTENSION) . '"');
    header('Cache-Control: private, no-store, no-transform');
    header('Content-Encoding: identity');
    if ($headOnly) {
        exit;
    }

    if ($complete) {
        readfile($filePath);
        exit;
    }

    $handle = fopen($filePath, 'rb');
    if ($handle === false) {
        http_response_code(500);
        exit;
    }
    fseek($handle, $start);
    $remaining = $length;
    while ($remaining > 0 && !feof($handle)) {
        $chunk = fread($handle, min(8192, $remaining));
        if ($chunk === false || $chunk === '') {
            break;
        }
        echo $chunk;
        $remaining -= strlen($chunk);
    }
    fclose($handle);
    exit;
}

function list_conversation(): never
{
    request_json();
    $user = require_listener_user();
    ensure_collaboration_push_schema();
    $conversationHash = (string) $user['conversation_hash'];
    if (!rate_limit(hash('sha256', 'conversation:' . (string) $user['id']), 'conversation', 1000, 3600)) {
        json_response(['ok' => false, 'error' => 'Trop de demandes. Réessayez dans un instant.'], 429);
    }

    $retentionDays = max(1, (int) (app_config()['retention_days'] ?? 30));
    $since = now() - ($retentionDays * 86400);
    $statement = db()->prepare(
        "SELECT conversation.id, conversation.message_type, conversation.display_name, conversation.body,
                conversation.created_at, conversation.content_type, conversation.voice_id, conversation.voice_duration
         FROM (
           SELECT messages.id, 'listener' AS message_type, messages.display_name, messages.body, messages.created_at,
                  IF(voice_clips.id IS NULL, 'text', 'voice') AS content_type,
                  voice_clips.id AS voice_id, voice_clips.duration_seconds AS voice_duration
           FROM messages
           LEFT JOIN voice_clips ON voice_clips.message_id = messages.id
           WHERE (messages.user_id = ? OR messages.conversation_hash = ?) AND messages.created_at >= ?
           UNION ALL
           SELECT id, 'studio' AS message_type, operator_name AS display_name, body, created_at,
                  'text' AS content_type, NULL AS voice_id, NULL AS voice_duration
           FROM replies WHERE conversation_hash = ? AND created_at >= ?
         ) AS conversation
         ORDER BY conversation.created_at ASC
         LIMIT 200"
    );
    $statement->execute([$user['id'], $conversationHash, $since, $conversationHash, $since]);
    json_response([
        'ok' => true,
        'account' => listener_public_user($user),
        'messages' => $statement->fetchAll(),
    ]);
}

function install_studio(): never
{
    $input = request_json();
    $configuredKey = (string) (app_config()['install_key'] ?? '');
    if (strlen($configuredKey) < 32 || str_starts_with($configuredKey, 'VERVANG_')) {
        json_response(['ok' => false, 'error' => "La clé d'installation n'est pas configurée."], 500);
    }
    if (!hash_equals($configuredKey, (string) ($input['installKey'] ?? ''))) {
        json_response(['ok' => false, 'error' => "Clé d'installation incorrecte."], 401);
    }
    if (admin_password_hash() !== null) {
        json_response(['ok' => false, 'error' => 'Le studio est déjà installé.'], 409);
    }
    $password = (string) ($input['password'] ?? '');
    if ($password !== (string) ($input['confirmation'] ?? '')) {
        json_response(['ok' => false, 'error' => 'Les deux mots de passe ne correspondent pas.'], 400);
    }
    if ($error = validate_new_password($password)) {
        json_response(['ok' => false, 'error' => $error], 400);
    }
    $statement = db()->prepare(
        "INSERT INTO settings (setting_key, setting_value, updated_at) VALUES ('admin_password_hash', ?, ?)"
    );
    $statement->execute([make_password_hash($password), now()]);
    json_response(['ok' => true, 'message' => 'Installation terminée. Vous pouvez vous connecter au studio.']);
}

function studio_login(): never
{
    $input = request_json();
    $operatorName = trim(preg_replace('/\s+/u', ' ', (string) ($input['operatorName'] ?? '')) ?? '');
    $operatorLength = function_exists('mb_strlen') ? mb_strlen($operatorName) : strlen($operatorName);
    if ($operatorLength < 2 || $operatorLength > 40
        || preg_match('/[\x00-\x1F\x7F]/u', $operatorName)) {
        json_response(['ok' => false, 'error' => 'Saisissez votre prénom (2 à 40 caractères).'], 400);
    }
    $loginHash = client_hash('login');
    if (!rate_limit($loginHash, 'login', 8, 900)) {
        json_response(['ok' => false, 'error' => 'Trop de tentatives. Réessayez plus tard.'], 429);
    }
    $storedHash = admin_password_hash();
    if ($storedHash === null) {
        json_response(['ok' => false, 'error' => "Le studio n'est pas encore installé."], 503);
    }
    if (!password_verify((string) ($input['password'] ?? ''), $storedHash)) {
        json_response(['ok' => false, 'error' => 'Identifiants incorrects.'], 401);
    }
    cleanup_expired_data();
    create_studio_session($operatorName);
    json_response(['ok' => true, 'operatorName' => $operatorName]);
}

function change_studio_password(): never
{
    $session = require_studio_session();
    $input = request_json();
    if (!rate_limit(client_hash('password-change'), 'password-change', 5, 900)) {
        json_response(['ok' => false, 'error' => 'Trop de tentatives. Réessayez plus tard.'], 429);
    }
    $current = (string) ($input['currentPassword'] ?? '');
    $new = (string) ($input['newPassword'] ?? '');
    $confirmation = (string) ($input['confirmation'] ?? '');
    $storedHash = admin_password_hash();
    if ($storedHash === null || !password_verify($current, $storedHash)) {
        json_response(['ok' => false, 'error' => 'Le mot de passe actuel est incorrect.'], 401);
    }
    if ($new !== $confirmation) {
        json_response(['ok' => false, 'error' => 'Les deux nouveaux mots de passe ne correspondent pas.'], 400);
    }
    if (hash_equals($current, $new)) {
        json_response(['ok' => false, 'error' => 'Choisissez un mot de passe différent.'], 400);
    }
    if ($error = validate_new_password($new)) {
        json_response(['ok' => false, 'error' => $error], 400);
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare("UPDATE settings SET setting_value = ?, updated_at = ? WHERE setting_key = 'admin_password_hash'");
        $update->execute([make_password_hash($new), now()]);
        $pdo->exec('DELETE FROM studio_sessions');
        create_studio_session((string) $session['operator_name'], $pdo);
        $audit = $pdo->prepare("INSERT INTO audit_log (action, message_id, created_at) VALUES ('password:changed', NULL, ?)");
        $audit->execute([now()]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response(['ok' => true, 'message' => 'Votre mot de passe a été modifié. Les autres sessions ont été déconnectées.']);
}

function require_conversation_key(array $input): string
{
    $key = trim((string) ($input['conversationKey'] ?? ''));
    if (!preg_match('/^(?:user:[a-f0-9-]{36}|conversation:[a-f0-9]{64})$/', $key)) {
        json_response(['ok' => false, 'error' => 'Conversation invalide.'], 400);
    }
    return $key;
}

function claim_studio_conversation(array $session): never
{
    ensure_collaboration_push_schema();
    $conversationKey = require_conversation_key(request_json());
    $keyHash = hash('sha256', $conversationKey);
    $timestamp = now();
    $expiresAt = $timestamp + STUDIO_CLAIM_SECONDS;
    $save = db()->prepare(
        'INSERT INTO studio_claims
           (conversation_key_hash, conversation_key, session_token_hash, operator_name, claimed_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           session_token_hash = IF(expires_at <= VALUES(claimed_at)
             OR session_token_hash = VALUES(session_token_hash), VALUES(session_token_hash), session_token_hash),
           operator_name = IF(expires_at <= VALUES(claimed_at)
             OR session_token_hash = VALUES(session_token_hash), VALUES(operator_name), operator_name),
           claimed_at = IF(expires_at <= VALUES(claimed_at)
             OR session_token_hash = VALUES(session_token_hash), VALUES(claimed_at), claimed_at),
           expires_at = IF(expires_at <= VALUES(claimed_at)
             OR session_token_hash = VALUES(session_token_hash), VALUES(expires_at), expires_at)'
    );
    $save->execute([
        $keyHash,
        $conversationKey,
        $session['token_hash'],
        $session['operator_name'],
        $timestamp,
        $expiresAt,
    ]);

    $lookup = db()->prepare(
        'SELECT session_token_hash, operator_name, expires_at FROM studio_claims WHERE conversation_key_hash = ? LIMIT 1'
    );
    $lookup->execute([$keyHash]);
    $claim = $lookup->fetch();
    if (!$claim || !hash_equals((string) $claim['session_token_hash'], (string) $session['token_hash'])) {
        json_response([
            'ok' => false,
            'error' => sprintf('Cette conversation est déjà traitée par %s.', (string) ($claim['operator_name'] ?? 'une collègue')),
            'claimedBy' => (string) ($claim['operator_name'] ?? ''),
            'expiresAt' => (int) ($claim['expires_at'] ?? 0),
        ], 409);
    }
    json_response([
        'ok' => true,
        'claim' => [
            'conversationKey' => $conversationKey,
            'operatorName' => (string) $session['operator_name'],
            'expiresAt' => $expiresAt,
            'isMine' => true,
        ],
    ]);
}

function release_studio_conversation(array $session): never
{
    ensure_collaboration_push_schema();
    $conversationKey = require_conversation_key(request_json());
    $delete = db()->prepare(
        'DELETE FROM studio_claims WHERE conversation_key_hash = ? AND session_token_hash = ?'
    );
    $delete->execute([hash('sha256', $conversationKey), $session['token_hash']]);
    json_response(['ok' => true]);
}

function message_conversation_key(array $message): string
{
    if ((string) ($message['user_id'] ?? '') !== '') {
        return 'user:' . $message['user_id'];
    }
    return 'conversation:' . (string) ($message['conversation_hash'] ?? '');
}

function list_studio_messages(array $session): never
{
    ensure_account_voice_schema();
    ensure_collaboration_push_schema();
    $requested = (string) ($_GET['status'] ?? 'active');
    $limit = min(200, max(1, (int) ($_GET['limit'] ?? 100)));
    $valid = ['new', 'read', 'archived', 'quarantined', 'blocked'];
    $params = [];
    if (in_array($requested, $valid, true)) {
        $where = 'status = ?';
        $params[] = $requested;
    } elseif ($requested === 'all') {
        $where = '1 = 1';
    } else {
        $where = "status IN ('new', 'read')";
    }
    $statement = db()->prepare(
        "SELECT messages.id, messages.display_name, messages.body, messages.source, messages.status,
                messages.filter_reasons, messages.created_at, messages.reviewed_at,
                CASE
                    WHEN messages.user_id IS NOT NULL THEN CONCAT('user:', messages.user_id)
                    WHEN messages.conversation_hash IS NOT NULL THEN CONCAT('conversation:', messages.conversation_hash)
                    ELSE CONCAT('message:', messages.id)
                END AS conversation_key,
                (messages.conversation_hash IS NOT NULL) AS can_reply,
                IF(voice_clips.id IS NULL, 'text', 'voice') AS content_type,
                voice_clips.id AS voice_id, voice_clips.duration_seconds AS voice_duration
         FROM messages
         LEFT JOIN voice_clips ON voice_clips.message_id = messages.id
         WHERE {$where}
         ORDER BY messages.created_at DESC
         LIMIT {$limit}"
    );
    $statement->execute($params);
    $messages = $statement->fetchAll();
    foreach ($messages as &$message) {
        $decoded = $message['filter_reasons'] ? json_decode((string) $message['filter_reasons'], true) : [];
        $message['filter_reasons'] = is_array($decoded) ? $decoded : [];
        $message['can_reply'] = (bool) $message['can_reply'];
        $message['replies'] = [];
    }
    unset($message);
    if ($messages !== []) {
        $messageIds = array_column($messages, 'id');
        $placeholders = implode(',', array_fill(0, count($messageIds), '?'));
        $replies = db()->prepare(
            "SELECT id, message_id, body, operator_name, created_at FROM replies WHERE message_id IN ({$placeholders}) ORDER BY created_at DESC"
        );
        $replies->execute($messageIds);
        $positions = [];
        foreach ($messages as $position => $message) {
            $positions[$message['id']] = $position;
        }
        foreach ($replies->fetchAll() as $reply) {
            if (isset($positions[$reply['message_id']])) {
                $messages[$positions[$reply['message_id']]]['replies'][] = $reply;
            }
        }
    }
    $stats = db()->query(
        "SELECT
           SUM(status = 'new') AS new_count,
           SUM(status = 'quarantined') AS quarantined_count,
           SUM(status = 'archived') AS archived_count
         FROM messages"
    )->fetch();
    $claimStatement = db()->prepare(
        'SELECT conversation_key, session_token_hash, operator_name, expires_at
         FROM studio_claims WHERE expires_at > ? ORDER BY expires_at DESC'
    );
    $claimStatement->execute([now()]);
    $claims = [];
    foreach ($claimStatement->fetchAll() as $claim) {
        $claims[(string) $claim['conversation_key']] = [
            'operatorName' => (string) $claim['operator_name'],
            'expiresAt' => (int) $claim['expires_at'],
            'isMine' => hash_equals((string) $claim['session_token_hash'], (string) $session['token_hash']),
        ];
    }
    json_response([
        'ok' => true,
        'operatorName' => (string) $session['operator_name'],
        'messages' => $messages,
        'claims' => $claims,
        'stats' => [
            'new' => (int) ($stats['new_count'] ?? 0),
            'quarantined' => (int) ($stats['quarantined_count'] ?? 0),
            'archived' => (int) ($stats['archived_count'] ?? 0),
        ],
    ]);
}

function reply_to_message(string $messageId, array $session): never
{
    ensure_reply_schema();
    ensure_collaboration_push_schema();
    $input = request_json();
    $body = trim(str_replace(["\r\n", "\r"], "\n", (string) ($input['message'] ?? '')));
    $length = function_exists('mb_strlen') ? mb_strlen($body) : strlen($body);
    if ($length < 1 || $length > 500 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $body)) {
        json_response(['ok' => false, 'error' => 'La réponse doit contenir entre 1 et 500 caractères.'], 400);
    }

    $lookup = db()->prepare('SELECT id, user_id, conversation_hash, status FROM messages WHERE id = ? LIMIT 1');
    $lookup->execute([$messageId]);
    $message = $lookup->fetch();
    if (!$message) {
        json_response(['ok' => false, 'error' => 'Message introuvable.'], 404);
    }
    if ((string) ($message['conversation_hash'] ?? '') === '') {
        json_response(['ok' => false, 'error' => "Ce message est antérieur à la fonction de réponse. L'auditrice doit envoyer un nouveau message."], 409);
    }
    if ($message['status'] === 'blocked') {
        json_response(['ok' => false, 'error' => 'Impossible de répondre à un expéditeur bloqué.'], 409);
    }

    $conversationKey = message_conversation_key($message);
    $conversationKeyHash = hash('sha256', $conversationKey);
    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Verrouille la réservation jusqu'à la fin de l'envoi : deux opératrices
        // ne peuvent ainsi jamais valider une réponse au même instant.
        $claimLookup = $pdo->prepare(
            'SELECT session_token_hash, operator_name, expires_at
             FROM studio_claims WHERE conversation_key_hash = ? LIMIT 1 FOR UPDATE'
        );
        $claimLookup->execute([$conversationKeyHash]);
        $claim = $claimLookup->fetch();
        if (!$claim || (int) $claim['expires_at'] <= now()
            || !hash_equals((string) $claim['session_token_hash'], (string) $session['token_hash'])) {
            $claimedBy = $claim && (int) $claim['expires_at'] > now()
                ? (string) $claim['operator_name']
                : '';
            $pdo->rollBack();
            json_response([
                'ok' => false,
                'error' => $claimedBy !== ''
                    ? "Cette conversation est déjà traitée par {$claimedBy}."
                    : 'Rouvrez le champ de réponse pour réserver cette conversation.',
            ], 409);
        }

        $replyId = uuid_v4();
        $timestamp = now();
        $insert = $pdo->prepare(
            'INSERT INTO replies (id, message_id, conversation_hash, body, operator_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $replyId,
            $messageId,
            $message['conversation_hash'],
            $body,
            $session['operator_name'],
            $timestamp,
        ]);
        $update = $pdo->prepare("UPDATE messages SET status = 'read', reviewed_at = ? WHERE id = ?");
        $update->execute([$timestamp, $messageId]);
        $audit = $pdo->prepare("INSERT INTO audit_log (action, message_id, created_at) VALUES ('reply:sent', ?, ?)");
        $audit->execute([$messageId, $timestamp]);
        $release = $pdo->prepare(
            'DELETE FROM studio_claims WHERE conversation_key_hash = ? AND session_token_hash = ?'
        );
        $release->execute([$conversationKeyHash, $session['token_hash']]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    if ((string) ($message['user_id'] ?? '') !== '') {
        notify_listener_devices(
            $messageId,
            (string) $message['user_id'],
            (string) $session['operator_name'],
            $body
        );
    }
    json_response(['ok' => true, 'message' => 'Réponse envoyée.']);
}

function update_studio_message(string $messageId): never
{
    $input = request_json();
    $status = (string) ($input['status'] ?? '');
    if (!in_array($status, ['new', 'read', 'archived', 'blocked'], true)) {
        json_response(['ok' => false, 'error' => 'Action non autorisée.'], 400);
    }
    $lookup = db()->prepare('SELECT id, sender_hash FROM messages WHERE id = ? LIMIT 1');
    $lookup->execute([$messageId]);
    $message = $lookup->fetch();
    if (!$message) {
        json_response(['ok' => false, 'error' => 'Message introuvable.'], 404);
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare('UPDATE messages SET status = ?, reviewed_at = ? WHERE id = ?');
        $update->execute([$status, now(), $messageId]);
        $audit = $pdo->prepare('INSERT INTO audit_log (action, message_id, created_at) VALUES (?, ?, ?)');
        $audit->execute(['status:' . $status, $messageId, now()]);
        if ($status === 'blocked') {
            $block = $pdo->prepare(
                "INSERT INTO blocked_senders (sender_hash, created_at, reason) VALUES (?, ?, 'studio')
                 ON DUPLICATE KEY UPDATE created_at = VALUES(created_at), reason = 'studio'"
            );
            $block->execute([$message['sender_hash'], now()]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response(['ok' => true]);
}
