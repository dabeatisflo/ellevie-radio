<?php

declare(strict_types=1);

/**
 * Minimal RFC 8291 / RFC 8292 Web Push implementation for the iPhone PWA.
 *
 * The VAPID private key is generated once and stored in the private settings
 * table. Subscription keys are only accepted over the authenticated listener
 * API and notification failures never interrupt a saved Studio reply.
 */

function web_push_base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function web_push_base64url_decode(string $value): string
{
    if ($value === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
        throw new InvalidArgumentException('Invalid base64url value.');
    }
    $padding = (4 - (strlen($value) % 4)) % 4;
    $decoded = base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
    if ($decoded === false) {
        throw new InvalidArgumentException('Invalid base64url value.');
    }
    return $decoded;
}

function web_push_coordinate(string $value): string
{
    $value = ltrim($value, "\0");
    if (strlen($value) > 32) {
        throw new RuntimeException('Invalid P-256 coordinate.');
    }
    return str_pad($value, 32, "\0", STR_PAD_LEFT);
}

function web_push_public_bytes(array $details): string
{
    $ec = $details['ec'] ?? null;
    if (!is_array($ec) || !is_string($ec['x'] ?? null) || !is_string($ec['y'] ?? null)) {
        throw new RuntimeException('P-256 public key details are unavailable.');
    }
    return "\x04" . web_push_coordinate($ec['x']) . web_push_coordinate($ec['y']);
}

function web_push_public_pem(string $publicBytes): string
{
    if (strlen($publicBytes) !== 65 || $publicBytes[0] !== "\x04") {
        throw new InvalidArgumentException('Invalid P-256 public key.');
    }
    // SubjectPublicKeyInfo for id-ecPublicKey on prime256v1, followed by the
    // uncompressed 65-byte point.
    $prefix = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200');
    if ($prefix === false) {
        throw new RuntimeException('Unable to encode the P-256 public key.');
    }
    $der = $prefix . $publicBytes;
    return "-----BEGIN PUBLIC KEY-----\n"
        . chunk_split(base64_encode($der), 64, "\n")
        . "-----END PUBLIC KEY-----\n";
}

function web_push_hkdf(string $salt, string $inputKeyMaterial, string $info, int $length): string
{
    $prk = hash_hmac('sha256', $inputKeyMaterial, $salt, true);
    $output = '';
    $previous = '';
    for ($counter = 1; strlen($output) < $length; $counter++) {
        if ($counter > 255) {
            throw new RuntimeException('HKDF output is too long.');
        }
        $previous = hash_hmac('sha256', $previous . $info . chr($counter), $prk, true);
        $output .= $previous;
    }
    return substr($output, 0, $length);
}

function web_push_vapid_keys(): array
{
    static $cached;
    if (is_array($cached)) {
        return $cached;
    }
    if (!function_exists('openssl_pkey_new') || !defined('OPENSSL_KEYTYPE_EC')) {
        throw new RuntimeException('OpenSSL EC support is required for iPhone notifications.');
    }

    ensure_web_push_schema();
    $load = static function (): ?array {
        $statement = db()->prepare(
            "SELECT setting_key, setting_value FROM settings
             WHERE setting_key IN ('web_push_vapid_private', 'web_push_vapid_public')"
        );
        $statement->execute();
        $values = [];
        foreach ($statement->fetchAll() as $row) {
            $values[(string) $row['setting_key']] = (string) $row['setting_value'];
        }
        $private = $values['web_push_vapid_private'] ?? '';
        $public = $values['web_push_vapid_public'] ?? '';
        if ($private === '' || $public === '') {
            return null;
        }
        $decoded = web_push_base64url_decode($public);
        $privateKey = openssl_pkey_get_private($private);
        $details = $privateKey === false ? false : openssl_pkey_get_details($privateKey);
        if (strlen($decoded) !== 65 || $decoded[0] !== "\x04" || !is_array($details)
            || !hash_equals($decoded, web_push_public_bytes($details))) {
            throw new RuntimeException('Stored Web Push keys are invalid.');
        }
        return ['private' => $private, 'public' => $public];
    };

    $existing = $load();
    if ($existing !== null) {
        return $cached = $existing;
    }

    $pdo = db();
    $lockName = 'ellevie_web_push_vapid_v1';
    $lock = $pdo->prepare('SELECT GET_LOCK(?, 10)');
    $lock->execute([$lockName]);
    if ((int) $lock->fetchColumn() !== 1) {
        throw new RuntimeException('Unable to prepare iPhone notification keys.');
    }

    try {
        $existing = $load();
        if ($existing !== null) {
            return $cached = $existing;
        }

        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'prime256v1',
        ]);
        if ($key === false || !openssl_pkey_export($key, $privatePem)) {
            throw new RuntimeException('Unable to generate iPhone notification keys.');
        }
        $details = openssl_pkey_get_details($key);
        if (!is_array($details)) {
            throw new RuntimeException('Unable to read iPhone notification keys.');
        }
        $public = web_push_base64url_encode(web_push_public_bytes($details));
        $save = $pdo->prepare(
            'INSERT INTO settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = VALUES(updated_at)'
        );
        $timestamp = now();
        $save->execute(['web_push_vapid_private', $privatePem, $timestamp]);
        $save->execute(['web_push_vapid_public', $public, $timestamp]);
        return $cached = ['private' => $privatePem, 'public' => $public];
    } finally {
        $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}

function web_push_der_length(string $der, int &$offset): int
{
    if (!isset($der[$offset])) {
        throw new RuntimeException('Invalid DER signature.');
    }
    $first = ord($der[$offset++]);
    if (($first & 0x80) === 0) {
        return $first;
    }
    $count = $first & 0x7f;
    if ($count < 1 || $count > 4 || strlen($der) < $offset + $count) {
        throw new RuntimeException('Invalid DER signature length.');
    }
    $length = 0;
    for ($index = 0; $index < $count; $index++) {
        $length = ($length << 8) | ord($der[$offset++]);
    }
    return $length;
}

function web_push_der_signature_to_raw(string $der): string
{
    $offset = 0;
    if (!isset($der[$offset]) || ord($der[$offset++]) !== 0x30) {
        throw new RuntimeException('Invalid ECDSA signature.');
    }
    $sequenceLength = web_push_der_length($der, $offset);
    if ($sequenceLength !== strlen($der) - $offset) {
        throw new RuntimeException('Invalid ECDSA signature length.');
    }
    $values = [];
    for ($index = 0; $index < 2; $index++) {
        if (!isset($der[$offset]) || ord($der[$offset++]) !== 0x02) {
            throw new RuntimeException('Invalid ECDSA signature value.');
        }
        $length = web_push_der_length($der, $offset);
        $integer = substr($der, $offset, $length);
        $offset += $length;
        $integer = ltrim($integer, "\0");
        if (strlen($integer) > 32) {
            throw new RuntimeException('Invalid ECDSA signature coordinate.');
        }
        $values[] = str_pad($integer, 32, "\0", STR_PAD_LEFT);
    }
    if ($offset !== strlen($der)) {
        throw new RuntimeException('Invalid ECDSA signature data.');
    }
    return $values[0] . $values[1];
}

function web_push_vapid_authorization(string $endpoint, array $keys): string
{
    $parts = parse_url($endpoint);
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $host = strtolower((string) ($parts['host'] ?? ''));
    if ($scheme !== 'https' || $host === '') {
        throw new InvalidArgumentException('Invalid Web Push endpoint.');
    }
    $audience = $scheme . '://' . $host;
    if (isset($parts['port'])) {
        $audience .= ':' . (int) $parts['port'];
    }
    $header = web_push_base64url_encode(json_encode(
        ['typ' => 'JWT', 'alg' => 'ES256'],
        JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ));
    $payload = web_push_base64url_encode(json_encode([
        'aud' => $audience,
        'exp' => time() + 43200,
        'sub' => (string) (app_config()['web_push_subject'] ?? 'https://ellevie.fr'),
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    $input = $header . '.' . $payload;
    if (!openssl_sign($input, $signatureDer, $keys['private'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Unable to sign the Web Push request.');
    }
    $signature = web_push_base64url_encode(web_push_der_signature_to_raw($signatureDer));
    return 'vapid t=' . $input . '.' . $signature . ', k=' . $keys['public'];
}

function web_push_encrypt_payload(string $p256dh, string $auth, string $payload): string
{
    $userPublic = web_push_base64url_decode($p256dh);
    $authSecret = web_push_base64url_decode($auth);
    if (strlen($userPublic) !== 65 || $userPublic[0] !== "\x04" || strlen($authSecret) !== 16) {
        throw new InvalidArgumentException('Invalid Web Push subscription keys.');
    }

    $serverKey = openssl_pkey_new([
        'private_key_type' => OPENSSL_KEYTYPE_EC,
        'curve_name' => 'prime256v1',
    ]);
    if ($serverKey === false) {
        throw new RuntimeException('Unable to create a Web Push encryption key.');
    }
    $serverDetails = openssl_pkey_get_details($serverKey);
    if (!is_array($serverDetails)) {
        throw new RuntimeException('Unable to read the Web Push encryption key.');
    }
    $serverPublic = web_push_public_bytes($serverDetails);
    $peerKey = openssl_pkey_get_public(web_push_public_pem($userPublic));
    if ($peerKey === false) {
        throw new InvalidArgumentException('Invalid Web Push client key.');
    }
    $sharedSecret = openssl_pkey_derive($peerKey, $serverKey, 32);
    if (!is_string($sharedSecret) || strlen($sharedSecret) !== 32) {
        throw new RuntimeException('Unable to derive the Web Push secret.');
    }

    $keyInfo = "WebPush: info\0" . $userPublic . $serverPublic;
    $inputKeyMaterial = web_push_hkdf($authSecret, $sharedSecret, $keyInfo, 32);
    $salt = random_bytes(16);
    $contentKey = web_push_hkdf($salt, $inputKeyMaterial, "Content-Encoding: aes128gcm\0", 16);
    $nonce = web_push_hkdf($salt, $inputKeyMaterial, "Content-Encoding: nonce\0", 12);
    $plainText = $payload . "\x02";
    $recordSize = 4096;
    if (strlen($plainText) + 16 >= $recordSize) {
        throw new RuntimeException('Web Push payload is too large.');
    }
    $cipherText = openssl_encrypt(
        $plainText,
        'aes-128-gcm',
        $contentKey,
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        '',
        16
    );
    if ($cipherText === false || strlen($tag) !== 16) {
        throw new RuntimeException('Unable to encrypt the Web Push payload.');
    }
    return $salt . pack('N', $recordSize) . chr(strlen($serverPublic)) . $serverPublic . $cipherText . $tag;
}

function web_push_endpoint_allowed(string $endpoint): bool
{
    if (strlen($endpoint) < 20 || strlen($endpoint) > 2048 || filter_var($endpoint, FILTER_VALIDATE_URL) === false) {
        return false;
    }
    $parts = parse_url($endpoint);
    if (strtolower((string) ($parts['scheme'] ?? '')) !== 'https' || isset($parts['user']) || isset($parts['pass'])) {
        return false;
    }
    $host = strtolower(rtrim((string) ($parts['host'] ?? ''), '.'));
    if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false) {
        return false;
    }
    return $host === 'web.push.apple.com'
        || str_ends_with($host, '.push.apple.com')
        || $host === 'fcm.googleapis.com'
        || $host === 'updates.push.services.mozilla.com';
}

function web_push_send(string $endpoint, string $p256dh, string $auth, array $notification): int
{
    if (!web_push_endpoint_allowed($endpoint)) {
        throw new InvalidArgumentException('Unsupported Web Push endpoint.');
    }
    $payload = json_encode($notification, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (strlen($payload) > 3000) {
        throw new RuntimeException('Web Push notification is too large.');
    }
    $body = web_push_encrypt_payload($p256dh, $auth, $payload);
    $authorization = web_push_vapid_authorization($endpoint, web_push_vapid_keys());
    $headers = [
        'Authorization: ' . $authorization,
        'Content-Encoding: aes128gcm',
        'Content-Type: application/octet-stream',
        'TTL: 86400',
        'Urgency: normal',
    ];
    $status = 0;

    if (function_exists('curl_init')) {
        $handle = curl_init($endpoint);
        if ($handle === false) {
            throw new RuntimeException('Unable to initialize Web Push.');
        }
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => $body,
        ]);
        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($handle);
        curl_close($handle);
        if ($response === false) {
            throw new RuntimeException('Web Push network error: ' . $curlError);
        }
    } else {
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'timeout' => 8,
            'ignore_errors' => true,
            'header' => implode("\r\n", $headers) . "\r\n",
            'content' => $body,
        ]]);
        $response = file_get_contents($endpoint, false, $context);
        foreach (($http_response_header ?? []) as $header) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $match)) {
                $status = (int) $match[1];
                break;
            }
        }
        if ($response === false && $status === 0) {
            throw new RuntimeException('The Web Push service is unreachable.');
        }
    }
    return $status;
}
