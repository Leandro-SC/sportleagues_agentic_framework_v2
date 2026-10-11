<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Database;
use PDO;

class RankingService
{
    private PDO $pdo;

    public function __construct()
    {
        $this->pdo = Database::getConnection();
    }

    public function recomputeRound(int $roundId): array
    {
        $matches = $this->getMatchesByRound($roundId);

        if ($matches === []) {
            return $this->emptySummary($roundId);
        }

        $resultsByMatch = [];

        foreach ($matches as $match) {
            $status = strtoupper((string)($match['status'] ?? ''));

            if (in_array($status, ['CANCELLED', 'POSTPONED'], true)) {
                continue;
            }

            $outcome = (string)($match['result_outcome'] ?? '');

            if ($outcome === '') {
                continue;
            }

            $resultsByMatch[(int)$match['id']] = $outcome;
        }

        $tickets = $this->getPaidTicketsByRound($roundId);

        if ($tickets === []) {
            return $this->emptySummary($roundId);
        }

        $maxPoints = 0;
        $pointsByTicketId = [];
        $totalCollected = 0.0;

        foreach ($tickets as $ticket) {
            $ticketId = (int)$ticket['id'];
            $totalCollected += (float)$ticket['total_amount'];

            $items = $this->getTicketItems($ticketId);

            $points = 0;

            foreach ($items as $item) {
                $matchId = (int)$item['match_id'];
                $selection = (string)$item['selection'];

                if (isset($resultsByMatch[$matchId]) && $selection === $resultsByMatch[$matchId]) {
                    $points++;
                }
            }

            $pointsByTicketId[$ticketId] = $points;
            $maxPoints = max($maxPoints, $points);

            $this->updateTicketPoints($ticketId, $points);
        }

        $firstWinners = [];
        $secondWinners = [];
        $secondPoints = 0;

        if ($maxPoints > 0) {
            foreach ($pointsByTicketId as $ticketId => $points) {
                if ($points === $maxPoints) {
                    $firstWinners[] = $ticketId;
                }
            }

            foreach ($pointsByTicketId as $points) {
                if ($points < $maxPoints && $points > $secondPoints) {
                    $secondPoints = $points;
                }
            }

            if ($secondPoints > 0) {
                foreach ($pointsByTicketId as $ticketId => $points) {
                    if ($points === $secondPoints) {
                        $secondWinners[] = $ticketId;
                    }
                }
            }
        }

        $roundConfig = $this->getRoundConfig($roundId);

        $firstPct = (float)($roundConfig['first_place_percent'] ?? 30.00) / 100.0;
        $secondPct = (float)($roundConfig['second_place_percent'] ?? 15.00) / 100.0;

        $firstPrizeTotal = $totalCollected * $firstPct;
        $secondPrizeTotal = $totalCollected * $secondPct;

        $firstPrizeEach = $firstWinners !== [] ? $firstPrizeTotal / count($firstWinners) : 0.0;
        $secondPrizeEach = $secondWinners !== [] ? $secondPrizeTotal / count($secondWinners) : 0.0;

        $this->refreshRoundTicketScores(
            $roundId,
            $tickets,
            $pointsByTicketId,
            $firstWinners,
            $secondWinners,
            $firstPrizeEach,
            $secondPrizeEach
        );

        return [
            'round_id' => $roundId,
            'round_id' => $roundId,
            'total_collected' => $totalCollected,
            'first_prize_total' => $firstPrizeTotal,
            'second_prize_total' => $secondPrizeTotal,
            'first_prize_each' => $firstPrizeEach,
            'second_prize_each' => $secondPrizeEach,
            'first_winners' => $firstWinners,
            'second_winners' => $secondWinners,
        ];
    }

    private function getRoundConfig(int $roundId): array
    {
        $stmt = $this->pdo->prepare('
            SELECT
                total_pool_percent AS prize_pool_percent,
                first_place_percent,
                second_place_percent
            FROM round_prize_config
            WHERE round_id = :round_id
            LIMIT 1
        ');

        $stmt->execute([':round_id' => $roundId]);

        $config = $stmt->fetch(PDO::FETCH_ASSOC);

        return $config ?: [];
    }

    private function getMatchesByRound(int $roundId): array
    {
        $stmt = $this->pdo->prepare('
            SELECT
                id,
                status,
                result_outcome
            FROM matches
            WHERE round_id = :round_id
        ');

        $stmt->execute([':round_id' => $roundId]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    private function getPaidTicketsByRound(int $roundId): array
    {
        $stmt = $this->pdo->prepare('
            SELECT
                id,
                ticket_code,
                user_name,
                phone,
                total_amount,
                points,
                created_at
            FROM tickets
            WHERE round_id = :round_id
              AND status = "PAID"
            ORDER BY created_at ASC, id ASC
        ');

        $stmt->execute([':round_id' => $roundId]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    private function getTicketItems(int $ticketId): array
    {
        $stmt = $this->pdo->prepare('
            SELECT
                match_id,
                selection
            FROM ticket_items
            WHERE ticket_id = :ticket_id
        ');

        $stmt->execute([':ticket_id' => $ticketId]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    private function updateTicketPoints(int $ticketId, int $points): void
    {
        $stmt = $this->pdo->prepare('
            UPDATE tickets
            SET points = :points,
                updated_at = NOW()
            WHERE id = :id
        ');

        $stmt->execute([
            ':points' => $points,
            ':id' => $ticketId,
        ]);
    }

    private function refreshRoundTicketScores(
        int $roundId,
        array $tickets,
        array $pointsByTicketId,
        array $firstWinners,
        array $secondWinners,
        float $firstPrizeEach,
        float $secondPrizeEach
    ): void {
        $delete = $this->pdo->prepare('
            DELETE FROM round_ticket_scores
            WHERE round_id = :round_id
        ');

        $delete->execute([':round_id' => $roundId]);

        $insert = $this->pdo->prepare('
            INSERT INTO round_ticket_scores (
                round_id,
                ticket_id,
                phone,
                user_name,
                score,
                position,
                is_winner,
                prize_amount,
                created_at,
                updated_at
            )
            VALUES (
                :round_id,
                :ticket_id,
                :phone,
                :user_name,
                :score,
                :position,
                :is_winner,
                :prize_amount,
                NOW(),
                NOW()
            )
        ');

        $rankedTickets = $tickets;

        usort($rankedTickets, function (array $a, array $b) use ($pointsByTicketId): int {
            $pointsA = $pointsByTicketId[(int)$a['id']] ?? 0;
            $pointsB = $pointsByTicketId[(int)$b['id']] ?? 0;

            if ($pointsA === $pointsB) {
                return strcmp((string)$a['created_at'], (string)$b['created_at']);
            }

            return $pointsB <=> $pointsA;
        });

        $position = 1;

        foreach ($rankedTickets as $ticket) {
            $ticketId = (int)$ticket['id'];
            $score = (int)($pointsByTicketId[$ticketId] ?? 0);

            $isFirst = in_array($ticketId, $firstWinners, true);
            $isSecond = in_array($ticketId, $secondWinners, true);

            $insert->execute([
                ':round_id' => $roundId,
                ':ticket_id' => $ticketId,
                ':phone' => $ticket['phone'],
                ':user_name' => $ticket['user_name'],
                ':score' => $score,
                ':position' => $position,
                ':is_winner' => ($isFirst || $isSecond) ? 1 : 0,
                ':prize_amount' => $isFirst ? $firstPrizeEach : ($isSecond ? $secondPrizeEach : 0),
            ]);

            $position++;
        }
    }

    private function emptySummary(int $id): array
    {
        return [
            'round_id' => $id,
            'round_id' => $id,
            'total_collected' => 0.0,
            'first_prize_total' => 0.0,
            'second_prize_total' => 0.0,
            'first_prize_each' => 0.0,
            'second_prize_each' => 0.0,
            'first_winners' => [],
            'second_winners' => [],
        ];
    }

    public function getRoundRanking(int $roundId, string $status = 'PAID', ?string $search = null): array
    {
        $where = ['t.round_id = :round_id'];
        $params = [':round_id' => $roundId];

        if ($status !== 'ALL') {
            $where[] = 't.status = :status';
            $params[':status'] = $status;
        }

        if ($search) {
            $where[] = '(t.ticket_code LIKE :search OR t.user_name LIKE :search OR t.phone LIKE :search)';
            $params[':search'] = '%' . $search . '%';
        }

        $sql = '
            SELECT
                t.*,
                r.name AS round_name,
                COALESCE(l.name, "Sin Liga") AS league_name
            FROM tickets t
            INNER JOIN rounds r ON r.id = t.round_id
            INNER JOIN leagues l ON l.id = r.league_id
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY t.points DESC, t.created_at ASC
        ';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $rank = 1;

        foreach ($rows as &$row) {
            $row['rank'] = $rank++;
        }

        return $rows;
    }

    public function getRoundSummary(int $roundId): array
    {
        return $this->recomputeRound($roundId);
    }

    public function getRoundWinners(int $roundId, int $place): array
    {
        $summary = $this->recomputeRound($roundId);
        $ids = $place === 1 ? $summary['first_winners'] : $summary['second_winners'];

        if ($ids === []) {
            return [];
        }

        $in = implode(',', array_map('intval', $ids));

        return $this->pdo
            ->query("SELECT * FROM tickets WHERE id IN ($in)")
            ->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public function onTicketStatusChanged(int $ticketId): void
    {
        $stmt = $this->pdo->prepare('
            SELECT round_id
            FROM tickets
            WHERE id = :id
            LIMIT 1
        ');

        $stmt->execute([':id' => $ticketId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row) {
            $this->recomputeRound((int)$row['round_id']);
        }
    }

    public function getRoundSummaryCached(int $roundId): array
    {
        $cacheFile = __DIR__ . '/../../storage/cache/ranking_' . $roundId . '.json';

        if (is_file($cacheFile) && (time() - filemtime($cacheFile) < 60)) {
            $data = json_decode((string)file_get_contents($cacheFile), true);

            if (is_array($data)) {
                return $data;
            }
        }

        $data = $this->recomputeRound($roundId);

        if (!is_dir(dirname($cacheFile))) {
            mkdir(dirname($cacheFile), 0777, true);
        }

        file_put_contents($cacheFile, json_encode($data, JSON_UNESCAPED_UNICODE));

        return $data;
    }
}