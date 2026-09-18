<?php

declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Robots-Tag: noindex, nofollow, noarchive');

readfile(__DIR__ . '/index.html');
