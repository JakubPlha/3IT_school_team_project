<?php

declare(strict_types=1);

require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'ok' => false,
        'message' => 'Method not allowed.'
    ]);
    exit;
}

$payload = json_decode(file_get_contents('php://input'), true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'message' => 'Invalid JSON payload.'
    ]);
    exit;
}

$action = strtoupper(trim((string)($payload['action'] ?? '')));

try {
    $db = getDatabaseConnection();

    if ($action === 'REGISTER') {
        $username = trim((string)($payload['username'] ?? ''));
        $password = (string)($payload['password'] ?? '');

        if ($username === '' || $password === '') {
            throw new RuntimeException('Username and password are required.', 400);
        }

        if (!preg_match('/^[a-zA-Z0-9_]{3,24}$/', $username)) {
            throw new RuntimeException('Username must be 3-24 chars: letters, numbers, underscore.', 400);
        }

        $statement = $db->prepare('SELECT id FROM players WHERE username = :username LIMIT 1');
        $statement->execute([':username' => $username]);
        if ($statement->fetch()) {
            throw new RuntimeException('Username already exists.', 409);
        }

        $insert = $db->prepare(
            'INSERT INTO players (username, password_hash, level, created_at)
             VALUES (:username, :password_hash, 1, :created_at)'
        );
        $insert->execute([
            ':username' => $username,
            ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
            ':created_at' => (new DateTimeImmutable())->format(DateTimeInterface::ATOM)
        ]);

        echo json_encode([
            'ok' => true,
            'message' => 'Registration successful.',
            'user' => [
                'username' => $username,
                'level' => 1
            ]
        ]);
        exit;
    }

    if ($action === 'LOGIN') {
        $username = trim((string)($payload['username'] ?? ''));
        $password = (string)($payload['password'] ?? '');

        if ($username === '' || $password === '') {
            throw new RuntimeException('Username and password are required.', 400);
        }

        $statement = $db->prepare(
            'SELECT username, password_hash, level
             FROM players
             WHERE username = :username
             LIMIT 1'
        );
        $statement->execute([':username' => $username]);
        $row = $statement->fetch();

        if (!$row || !password_verify($password, $row['password_hash'])) {
            throw new RuntimeException('Invalid credentials.', 401);
        }

        echo json_encode([
            'ok' => true,
            'message' => 'Login successful.',
            'user' => [
                'username' => $row['username'],
                'level' => (int)$row['level']
            ]
        ]);
        exit;
    }

    if ($action === 'UPDATE_LEVEL') {
        $username = trim((string)($payload['username'] ?? ''));
        $level = (int)($payload['level'] ?? 1);

        if ($username === '') {
            throw new RuntimeException('Username is required.', 400);
        }

        if ($level < 1) {
            throw new RuntimeException('Level must be at least 1.', 400);
        }

        $update = $db->prepare(
            'UPDATE players
             SET level = :level
             WHERE username = :username'
        );
        $update->execute([
            ':level' => $level,
            ':username' => $username
        ]);

        if ($update->rowCount() < 1) {
            throw new RuntimeException('User not found.', 404);
        }

        echo json_encode([
            'ok' => true,
            'message' => 'Progress updated.',
            'user' => [
                'username' => $username,
                'level' => $level
            ]
        ]);
        exit;
    }

    throw new RuntimeException('Unknown action.', 400);
} catch (RuntimeException $error) {
    $statusCode = $error->getCode();
    if ($statusCode < 100 || $statusCode > 599) {
        $statusCode = 400;
    }

    http_response_code($statusCode);
    echo json_encode([
        'ok' => false,
        'message' => $error->getMessage()
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'message' => 'Internal server error.'
    ]);
}
