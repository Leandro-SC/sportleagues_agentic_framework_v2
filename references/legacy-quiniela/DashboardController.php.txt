<?php

declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;
use Throwable;

/**
 * Dashboard administrativo.
 *
 * Muestra KPIs operativos y actividad reciente.
 * El filtro de fechas aplica sobre tickets.created_at.
 */
class DashboardController extends BaseAdminController
{
    private PDO $pdo;

    /**
     * Inicializa conexión.
     *
     * @return void
     */
    private function boot(): void
    {
        if (!isset($this->pdo)) {
            $this->pdo = Database::getConnection();
        }
    }

    /**
     * Muestra dashboard principal.
     *
     * @param Request $request Petición HTTP.
     * @param Response $response Respuesta HTTP.
     * @return void
     */
    public function index(Request $request, Response $response): void
    {
        $this->requireAdmin();
        $this->boot();

        $filters = $this->getDateFilters();

        try {
            $ticketStats = $this->getTicketStats($filters);

            $stats = array_merge([
                'total_rounds' => $this->countTable('rounds'),
                'open_rounds' => $this->countRoundsByStatus(['OPEN']),
                'closed_rounds' => $this->countRoundsByStatus(['CLOSED', 'FINISHED']),
                'total_matches' => $this->countTable('matches'),
                'total_players' => $this->countTable('players'),
                'total_teams' => $this->countTable('teams'),
                'total_leagues' => $this->countTable('leagues'),
            ], $ticketStats);

            $recentTickets = $this->getRecentTickets($filters);
            $activeRounds = $this->getActiveRounds();
            $recentMatches = $this->getRecentMatches();

            $paidAmount = array_sum($ticketStats['amount_by_currency']);

            $this->render('admin/dashboard/index', [
                'pageTitle' => 'Admin · Dashboard',
                'stats' => $stats,
                'money' => [
                    'total_collected' => $paidAmount,
                    'paid_amount' => $paidAmount,
                    'pending_amount' => 0,
                ],
                'recentTickets' => $recentTickets,
                'activeRounds' => $activeRounds,
                'recentMatches' => $recentMatches,
                'filters' => $filters,
            ]);
        } catch (Throwable $e) {
            error_log('Error DashboardController@index: ' . $e->getMessage());

            $this->render('admin/dashboard/index', [
                'pageTitle' => 'Admin · Dashboard',
                'stats' => [
                    'total_tickets' => 0,
                    'paid_tickets' => 0,
                    'pending_tickets' => 0,
                    'cancelled_tickets' => 0,
                    'rejected_tickets' => 0,
                    'amount_by_currency' => [],
                ],
                'money' => [
                    'total_collected' => 0,
                    'paid_amount' => 0,
                    'pending_amount' => 0,
                ],
                'recentTickets' => [],
                'activeRounds' => [],
                'recentMatches' => [],
                'filters' => $filters,
                'error' => 'No se pudo cargar el dashboard.',
            ]);
        }
    }

    /**
     * Obtiene filtros de fecha desde query string.
     *
     * @return array{from:string,to:string,has_filter:bool}
     */
    private function getDateFilters(): array
    {
        $from = trim((string)($_GET['from'] ?? ''));
        $to = trim((string)($_GET['to'] ?? ''));

        if (!$this->isValidDate($from)) {
            $from = '';
        }

        if (!$this->isValidDate($to)) {
            $to = '';
        }

        /*
         * Si el usuario invierte el rango, lo corregimos automáticamente.
         * Esto evita consultas vacías por error de selección.
         */
        if ($from !== '' && $to !== '' && $from > $to) {
            [$from, $to] = [$to, $from];
        }

        return [
            'from' => $from,
            'to' => $to,
            'has_filter' => $from !== '' || $to !== '',
        ];
    }

    /**
     * Valida fecha en formato YYYY-MM-DD.
     *
     * @param string $date Fecha.
     * @return bool
     */
    private function isValidDate(string $date): bool
    {
        if ($date === '') {
            return false;
        }

        $parsed = date_create_from_format('Y-m-d', $date);

        return $parsed !== false && $parsed->format('Y-m-d') === $date;
    }

    /**
     * Construye filtro SQL por fecha de tickets.
     *
     * El filtro aplica sobre tickets.created_at porque representa cuándo
     * el usuario generó el ticket.
     *
     * @param array{from:string,to:string,has_filter?:bool} $filters Filtros.
     * @param string $alias Alias de tickets.
     * @return array{sql:string,params:array<string,string>}
     */
    private function buildTicketDateWhere(array $filters, string $alias = 't'): array
    {
        $where = [];
        $params = [];

        if (($filters['from'] ?? '') !== '') {
            $where[] = "{$alias}.created_at >= :from_date";
            $params[':from_date'] = $filters['from'] . ' 00:00:00';
        }

        if (($filters['to'] ?? '') !== '') {
            $where[] = "{$alias}.created_at <= :to_date";
            $params[':to_date'] = $filters['to'] . ' 23:59:59';
        }

        return [
            'sql' => $where !== [] ? ' WHERE ' . implode(' AND ', $where) : '',
            'params' => $params,
        ];
    }

    /**
     * Cuenta registros de una tabla permitida.
     *
     * @param string $table Tabla.
     * @return int
     */
    private function countTable(string $table): int
    {
        $allowed = [
            'rounds',
            'matches',
            'players',
            'teams',
            'leagues',
        ];

        if (!in_array($table, $allowed, true)) {
            return 0;
        }

        $stmt = $this->pdo->query("SELECT COUNT(*) FROM {$table}");

        return $stmt ? (int)$stmt->fetchColumn() : 0;
    }

    /**
     * Cuenta jornadas por estado.
     *
     * @param array<int,string> $statuses Estados permitidos.
     * @return int
     */
    private function countRoundsByStatus(array $statuses): int
    {
        $allowedStatuses = [
            'DRAFT',
            'OPEN',
            'CLOSED',
            'FINISHED',
            'CANCELLED',
        ];

        $safeStatuses = array_values(array_filter(
            $statuses,
            static fn (string $status): bool => in_array($status, $allowedStatuses, true)
        ));

        if ($safeStatuses === []) {
            return 0;
        }

        $placeholders = [];

        foreach ($safeStatuses as $index => $status) {
            $placeholders[] = ':status_' . $index;
        }

        $stmt = $this->pdo->prepare('
            SELECT COUNT(*)
            FROM rounds
            WHERE status IN (' . implode(',', $placeholders) . ')
        ');

        foreach ($safeStatuses as $index => $status) {
            $stmt->bindValue(':status_' . $index, $status);
        }

        $stmt->execute();

        return (int)$stmt->fetchColumn();
    }

    /**
     * Obtiene estadísticas de tickets respetando rango de fechas.
     *
     * @param array{from:string,to:string,has_filter?:bool} $filters Filtros.
     * @return array<string,mixed>
     */
    private function getTicketStats(array $filters): array
    {
        $dateWhere = $this->buildTicketDateWhere($filters, 't');

        $stmt = $this->pdo->prepare('
            SELECT
                COUNT(*) AS total_tickets,
                COALESCE(SUM(CASE WHEN t.status = "PAID" THEN 1 ELSE 0 END), 0) AS paid_tickets,
                COALESCE(SUM(CASE WHEN t.status = "PENDING" THEN 1 ELSE 0 END), 0) AS pending_tickets,
                COALESCE(SUM(CASE WHEN t.status = "CANCELLED" THEN 1 ELSE 0 END), 0) AS cancelled_tickets,
                COALESCE(SUM(CASE WHEN t.status = "REJECTED" THEN 1 ELSE 0 END), 0) AS rejected_tickets
            FROM tickets t
            ' . $dateWhere['sql']
        );

        $stmt->execute($dateWhere['params']);

        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

        $moneyStmt = $this->pdo->prepare('
            SELECT
                t.currency,
                COALESCE(SUM(t.total_amount), 0) AS amount
            FROM tickets t
            ' . $dateWhere['sql'] . '
            ' . ($dateWhere['sql'] === '' ? 'WHERE' : 'AND') . ' t.status = "PAID"
            GROUP BY t.currency
            ORDER BY t.currency ASC
        ');

        $moneyStmt->execute($dateWhere['params']);

        $amountByCurrency = [];

        foreach (($moneyStmt->fetchAll(PDO::FETCH_ASSOC) ?: []) as $moneyRow) {
            $currency = (string)($moneyRow['currency'] ?? 'USD');
            $amountByCurrency[$currency] = (float)($moneyRow['amount'] ?? 0);
        }

        return [
            'total_tickets' => (int)($row['total_tickets'] ?? 0),
            'paid_tickets' => (int)($row['paid_tickets'] ?? 0),
            'pending_tickets' => (int)($row['pending_tickets'] ?? 0),
            'cancelled_tickets' => (int)($row['cancelled_tickets'] ?? 0),
            'rejected_tickets' => (int)($row['rejected_tickets'] ?? 0),
            'amount_by_currency' => $amountByCurrency,
        ];
    }

    /**
     * Obtiene últimos tickets respetando rango de fechas.
     *
     * @param array{from:string,to:string,has_filter?:bool} $filters Filtros.
     * @return array<int,array<string,mixed>>
     */
    private function getRecentTickets(array $filters): array
    {
        $dateWhere = $this->buildTicketDateWhere($filters, 't');

        $stmt = $this->pdo->prepare('
            SELECT
                t.id,
                t.ticket_code,
                t.round_ticket_number,
                t.user_name,
                t.phone,
                t.total_amount,
                t.currency,
                t.status,
                t.points,
                t.created_at,
                r.name AS round_name,
                r.round_number,
                l.name AS league_name
            FROM tickets t
            INNER JOIN rounds r
                ON r.id = t.round_id
            INNER JOIN leagues l
                ON l.id = r.league_id
            ' . $dateWhere['sql'] . '
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT 10
        ');

        $stmt->execute($dateWhere['params']);

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Obtiene jornadas activas.
     *
     * @return array<int,array<string,mixed>>
     */
    private function getActiveRounds(): array
    {
        $stmt = $this->pdo->query('
            SELECT
                r.id,
                r.name,
                r.round_number,
                r.status,
                r.open_at,
                r.close_at,
                r.ticket_cost_mxn,
                r.ticket_cost_usd,
                l.name AS league_name,
                COUNT(DISTINCT m.id) AS total_matches,
                COUNT(DISTINCT t.id) AS total_tickets,
                COALESCE(SUM(CASE WHEN t.status = "PAID" THEN t.total_amount ELSE 0 END), 0) AS total_collected
            FROM rounds r
            INNER JOIN leagues l
                ON l.id = r.league_id
            LEFT JOIN matches m
                ON m.round_id = r.id
            LEFT JOIN tickets t
                ON t.round_id = r.id
            WHERE r.status = "OPEN"
            GROUP BY
                r.id,
                r.name,
                r.round_number,
                r.status,
                r.open_at,
                r.close_at,
                r.ticket_cost_mxn,
                r.ticket_cost_usd,
                l.name
            ORDER BY r.close_at ASC
            LIMIT 10
        ');

        return $stmt ? ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    }

    /**
     * Obtiene partidos recientes.
     *
     * @return array<int,array<string,mixed>>
     */
    private function getRecentMatches(): array
    {
        $stmt = $this->pdo->query('
            SELECT
                m.id,
                m.round_id,
                m.kickoff_at,
                m.status,
                m.home_score,
                m.away_score,
                m.result_outcome,
                ht.name AS home_team_name,
                at.name AS away_team_name,
                r.name AS round_name,
                l.name AS league_name
            FROM matches m
            INNER JOIN teams ht
                ON ht.id = m.home_team_id
            INNER JOIN teams at
                ON at.id = m.away_team_id
            INNER JOIN rounds r
                ON r.id = m.round_id
            INNER JOIN leagues l
                ON l.id = r.league_id
            ORDER BY m.kickoff_at DESC, m.id DESC
            LIMIT 10
        ');

        return $stmt ? ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    }
}