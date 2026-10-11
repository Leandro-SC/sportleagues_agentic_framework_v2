<?php

declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Controllers\Admin\BaseAdminController;
use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use App\Services\RankingService;
use PDO;
use Throwable;

class TicketAdminController extends BaseAdminController
{
    private PDO $pdo;
    private RankingService $rankingService;

    private function boot(): void
    {
        if (!isset($this->pdo)) {
            $this->pdo = Database::getConnection();
        }

        if (!isset($this->rankingService)) {
            $this->rankingService = new RankingService();
        }
    }

    public function index(Request $request, Response $response): void
    {
        $this->requireAdmin();
        $this->boot();

        $roundId = (int)($_GET['round_id'] ?? 0);
        $status = trim((string)($_GET['status'] ?? ''));
        $from = trim((string)($_GET['from'] ?? ''));
        $to = trim((string)($_GET['to'] ?? ''));
        $q = trim((string)($_GET['q'] ?? ''));

        $where = [];
        $params = [];

        if ($roundId > 0) {
            $where[] = 't.round_id = :round_id';
            $params[':round_id'] = $roundId;
        }

        if ($status !== '' && $status !== 'ALL') {
            $where[] = 't.status = :status';
            $params[':status'] = $status;
        }

        if ($from !== '') {
            $where[] = 't.created_at >= :from';
            $params[':from'] = $from . ' 00:00:00';
        }

        if ($to !== '') {
            $where[] = 't.created_at <= :to';
            $params[':to'] = $to . ' 23:59:59';
        }

        if ($q !== '') {
            $where[] = '(t.ticket_code LIKE :q OR t.user_name LIKE :q OR t.phone LIKE :q)';
            $params[':q'] = '%' . $q . '%';
        }

        $sql = '
            SELECT
                t.*,
                r.name AS matchday_name,
                r.name AS round_name,
                r.round_number AS matchday_number,
                l.name AS league_name,
                ps.status AS payment_status,
                ps.net_amount,
                ps.session_token
            FROM tickets t
            INNER JOIN rounds r ON r.id = t.round_id
            INNER JOIN leagues l ON l.id = r.league_id
            LEFT JOIN purchase_sessions ps ON ps.id = t.purchase_session_id
        ';

        if ($where !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }

        $sql .= ' ORDER BY t.created_at DESC, t.id DESC';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $tickets = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $rounds = $this->getRoundsForFilter();

        $filters = [
            'round_id' => $roundId,
            'status' => $status,
            'from' => $from,
            'to' => $to,
            'q' => $q,
        ];

        $this->render('admin/tickets/index', [
            'pageTitle' => 'Tickets',
            'tickets' => $tickets,
            'rounds' => $rounds,
            'filters' => $filters,
        ]);
    }

    public function show(Request $request, Response $response): void
    {
        $this->requireAdmin();
        $this->boot();

        $id = (int)($_GET['id'] ?? 0);

        if ($id <= 0) {
            $_SESSION['flash_error'] = 'Ticket no especificado.';
            header('Location: /admin/tickets');
            exit;
        }

        $ticket = $this->getTicketDetail($id);

        if (!$ticket) {
            $_SESSION['flash_error'] = 'Ticket no encontrado.';
            header('Location: /admin/tickets');
            exit;
        }

        $items = $this->getTicketItems($id);

        $this->render('admin/tickets/show', [
            'pageTitle' => 'Detalle ticket',
            'ticket' => $ticket,
            'items' => $items,
        ]);
    }

    public function updateStatus(Request $request, Response $response): void
    {
        $this->requireAdmin();
        $this->requireValidCsrf();
        $this->boot();

        if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
            header('Location: /admin/tickets');
            exit;
        }

        $ticketId = (int)($_POST['ticket_id'] ?? 0);
        $status = strtoupper(trim((string)($_POST['status'] ?? '')));

        if ($ticketId <= 0 || !in_array($status, ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'], true)) {
            $_SESSION['flash_error'] = 'Datos inválidos.';
            header('Location: /admin/tickets');
            exit;
        }

        $stmt = $this->pdo->prepare('
            SELECT status, purchase_session_id
            FROM tickets
            WHERE id = :id
            LIMIT 1
        ');

        $stmt->execute([
            ':id' => $ticketId,
        ]);

        $current = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$current) {
            $_SESSION['flash_error'] = 'Ticket no encontrado.';
            header('Location: /admin/tickets');
            exit;
        }

        if ((string)$current['status'] === $status) {
            $_SESSION['flash_success'] = 'El estado ya era ' . $status;
            header('Location: /admin/tickets');
            exit;
        }

        $paidAtSql = $status === 'PAID'
            ? 'paid_at = COALESCE(paid_at, NOW()),'
            : 'paid_at = NULL,';

        $updateTicket = $this->pdo->prepare("
            UPDATE tickets
            SET status = :status,
                {$paidAtSql}
                updated_at = NOW()
            WHERE id = :id
        ");

        $updateTicket->execute([
            ':status' => $status,
            ':id' => $ticketId,
        ]);

        $sessionId = (int)($current['purchase_session_id'] ?? 0);

        if ($sessionId > 0) {
            $sessionStatus = match ($status) {
                'PAID' => 'COMPLETED',
                'CANCELLED', 'REJECTED' => 'CANCELLED',
                default => 'OPEN',
            };
            $updateSession = $this->pdo->prepare('
                UPDATE purchase_sessions
                SET status = :status,
                    updated_at = NOW()
                WHERE id = :id
            ');

            $updateSession->execute([
                ':status' => $sessionStatus,
                ':id' => $sessionId,
            ]);
        }

        $this->rankingService->onTicketStatusChanged($ticketId);

        $_SESSION['flash_success'] = 'Estado actualizado correctamente.';
        header('Location: /admin/tickets');
        exit;
    }

    public function delete(Request $request, Response $response): void
    {
        $this->requireAdmin();
        $this->requireValidCsrf();
        $this->boot();

        $ticketId = (int)($_POST['ticket_id'] ?? 0);

        if ($ticketId <= 0) {
            $_SESSION['flash_error'] = 'Ticket inválido.';
            header('Location: /admin/tickets');
            exit;
        }

        try {
            $stmt = $this->pdo->prepare('
                SELECT round_id, purchase_session_id
                FROM tickets
                WHERE id = :id
                LIMIT 1
            ');

            $stmt->execute([
                ':id' => $ticketId,
            ]);

            $ticket = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$ticket) {
                $_SESSION['flash_error'] = 'Ticket no encontrado.';
                header('Location: /admin/tickets');
                exit;
            }

            $roundId = (int)$ticket['round_id'];
            $sessionId = (int)($ticket['purchase_session_id'] ?? 0);

            $this->pdo->beginTransaction();

            $deleteScores = $this->pdo->prepare('
                DELETE FROM round_ticket_scores
                WHERE ticket_id = :ticket_id
            ');
            $deleteScores->execute([
                ':ticket_id' => $ticketId,
            ]);

            $deleteItems = $this->pdo->prepare('
                DELETE FROM ticket_items
                WHERE ticket_id = :ticket_id
            ');
            $deleteItems->execute([
                ':ticket_id' => $ticketId,
            ]);

            $deleteTicket = $this->pdo->prepare('
                DELETE FROM tickets
                WHERE id = :id
            ');
            $deleteTicket->execute([
                ':id' => $ticketId,
            ]);

            if ($sessionId > 0) {
                $countStmt = $this->pdo->prepare('
                    SELECT COUNT(*)
                    FROM tickets
                    WHERE purchase_session_id = :session_id
                ');

                $countStmt->execute([
                    ':session_id' => $sessionId,
                ]);

                if ((int)$countStmt->fetchColumn() === 0) {
                    $deleteSession = $this->pdo->prepare('
                        DELETE FROM purchase_sessions
                        WHERE id = :id
                    ');

                    $deleteSession->execute([
                        ':id' => $sessionId,
                    ]);
                }
            }

            $this->pdo->commit();

            $this->rankingService->recomputeRound($roundId);

            $_SESSION['flash_success'] = 'Ticket eliminado permanentemente.';
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            error_log('Error eliminando ticket: ' . $e->getMessage());
            $_SESSION['flash_error'] = 'No se pudo eliminar el ticket.';
        }

        header('Location: /admin/tickets');
        exit;
    }

    private function getTicketDetail(int $id): ?array
    {
        $stmt = $this->pdo->prepare('
        SELECT
            t.*,
            t.player_id AS user_id,
            t.ip_address AS purchase_ip_address,
            t.country_code AS purchase_country,
            r.name AS matchday_name,
            r.name AS round_name,
            r.round_number AS matchday_number,
            l.name AS league_name,
            ps.session_token AS session_code,
            ps.session_token,
            COALESCE(ps.net_amount, t.total_amount) AS net_amount,
            COALESCE(ps.gross_amount, t.total_amount) AS gross_amount,
            COALESCE(ps.discount_amount, 0.00) AS discount_amount,
            COALESCE(ps.currency, t.currency) AS payment_currency,
            ps.status AS payment_status
        FROM tickets t
        INNER JOIN rounds r ON r.id = t.round_id
        INNER JOIN leagues l ON l.id = r.league_id
        LEFT JOIN purchase_sessions ps ON ps.id = t.purchase_session_id
        WHERE t.id = :id
        LIMIT 1
    ');

        $stmt->execute([
            ':id' => $id,
        ]);

        $ticket = $stmt->fetch(PDO::FETCH_ASSOC);

        return $ticket ?: null;
    }

    private function getTicketItems(int $ticketId): array
    {
        $stmt = $this->pdo->prepare('
            SELECT
                ti.selection,
                ti.result_outcome AS item_result_outcome,
                ti.points AS item_points,
                m.id AS match_id,
                m.home_score,
                m.away_score,
                m.status AS match_status,
                m.result_outcome,
                m.kickoff_at,
                ht.name AS local_team,
                at.name AS visitor_team,
                ht.logo_path AS local_logo,
                at.logo_path AS visitor_logo
            FROM ticket_items ti
            INNER JOIN matches m ON m.id = ti.match_id
            INNER JOIN teams ht ON ht.id = m.home_team_id
            INNER JOIN teams at ON at.id = m.away_team_id
            WHERE ti.ticket_id = :ticket_id
            ORDER BY m.kickoff_at ASC, m.id ASC
        ');

        $stmt->execute([
            ':ticket_id' => $ticketId,
        ]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    private function getRoundsForFilter(): array
    {
        $stmt = $this->pdo->query('
            SELECT
                r.id,
                r.name,
                r.round_number AS number,
                l.name AS league_name
            FROM rounds r
            INNER JOIN leagues l ON l.id = r.league_id
            ORDER BY r.created_at DESC, r.id DESC
        ');

        return $stmt ? ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    }
}
