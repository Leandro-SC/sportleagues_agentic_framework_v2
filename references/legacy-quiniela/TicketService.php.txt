<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Database;
use App\Models\TicketModel;
use PDO;
use RuntimeException;

class TicketService
{
    private PDO $pdo;
    private TicketModel $ticketModel;

    public function __construct()
    {
        $this->pdo = Database::getConnection();
        $this->ticketModel = new TicketModel();
    }

    public function createFromRequest(array $payload): array
    {
        $name = trim((string)($payload['name'] ?? $payload['user_name'] ?? ''));
        $phone = trim((string)($payload['phone'] ?? ''));
        $tickets = $payload['tickets'] ?? [];
        $roundId = (int)($payload['round_id'] ?? 0);

        if ($name === '') {
            throw new RuntimeException('El nombre es obligatorio.');
        }

        if ($phone === '') {
            throw new RuntimeException('El teléfono es obligatorio.');
        }

        if ($roundId <= 0) {
            $roundId = $this->resolveOpenRoundId((string)($payload['league'] ?? 'liga-mx'));
        }

        if (!is_array($tickets) || $tickets === []) {
            throw new RuntimeException('Debes enviar al menos una quiniela.');
        }

        $createdTickets = [];

        foreach ($tickets as $ticketEntry) {
            $selections = $ticketEntry['selections'] ?? [];

            if (!is_array($selections) || $selections === []) {
                continue;
            }

            $items = $this->normalizeSelections($selections);

            $ticketId = $this->ticketModel->createTicket([
                'round_id' => $roundId,
                'user_name' => $name,
                'phone' => $phone,
                'country_code' => $payload['country_code'] ?? ($_SESSION['geo_country_code'] ?? 'MX'),
                'currency' => $payload['currency'] ?? ($_SESSION['geo_currency'] ?? 'MXN'),
                'total_amount' => (float)($ticketEntry['amount'] ?? 0),
                'promotion_id' => $payload['promotion_id'] ?? null,
                'discount_amount' => (float)($payload['discount_amount'] ?? 0),
                'ip_address' => $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0',
                'items' => $items,
            ]);

            $ticket = $this->ticketModel->getById($ticketId);

            $createdTickets[] = [
                'id' => $ticketId,
                'code' => $ticket['ticket_code'] ?? '',
                'sequence' => $ticketEntry['sequence'] ?? '',
                'amount' => (float)($ticketEntry['amount'] ?? 0),
            ];
        }

        if ($createdTickets === []) {
            throw new RuntimeException('No se crearon tickets válidos.');
        }

        return [
            'round_id' => $roundId,
            'league_name' => $this->getLeagueNameByRound($roundId),
            'tickets' => $createdTickets,
        ];
    }

    private function resolveOpenRoundId(string $leagueSlug): int
    {
        $stmt = $this->pdo->prepare('
            SELECT r.id
            FROM rounds r
            INNER JOIN leagues l ON l.id = r.league_id
            WHERE l.slug = :slug
              AND r.status = "OPEN"
              AND r.open_at <= NOW()
              AND r.close_at >= NOW()
            ORDER BY r.close_at ASC
            LIMIT 1
        ');

        $stmt->execute([
            ':slug' => $leagueSlug !== '' ? $leagueSlug : 'liga-mx',
        ]);

        $roundId = $stmt->fetchColumn();

        if ($roundId === false) {
            throw new RuntimeException('No hay jornada abierta disponible.');
        }

        return (int)$roundId;
    }

    private function getLeagueNameByRound(int $roundId): string
    {
        $stmt = $this->pdo->prepare('
            SELECT l.name
            FROM rounds r
            INNER JOIN leagues l ON l.id = r.league_id
            WHERE r.id = :round_id
            LIMIT 1
        ');

        $stmt->execute([
            ':round_id' => $roundId,
        ]);

        $name = $stmt->fetchColumn();

        return $name !== false ? (string)$name : 'Liga';
    }

    private function normalizeSelections(array $selections): array
    {
        $items = [];

        foreach ($selections as $selection) {
            $matchId = (int)($selection['match_id'] ?? 0);
            $pick = strtoupper(trim((string)($selection['pick'] ?? $selection['selection'] ?? '')));

            if ($matchId <= 0) {
                throw new RuntimeException('Existe un partido inválido en la quiniela.');
            }

            if (!in_array($pick, ['L', 'E', 'V'], true)) {
                throw new RuntimeException('Existe un pronóstico inválido. Solo se permite L, E o V.');
            }

            $items[] = [
                'match_id' => $matchId,
                'selection' => $pick,
            ];
        }

        return $items;
    }
}