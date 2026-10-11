<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Models\TicketModel;
use Throwable;

/**
 * Verificador público de tickets.
 *
 * Permite buscar tickets por código, teléfono o nombre.
 */
class VerifierController extends BaseController
{
    /**
     * Muestra buscador y detalle de ticket.
     *
     * @param Request $request Petición HTTP.
     * @param Response $response Respuesta HTTP.
     * @return void
     */
    public function index(Request $request, Response $response): void
    {
        $searchQuery = trim((string)(
            $_GET['q']
            ?? $_GET['ticket_code']
            ?? $_GET['code']
            ?? ''
        ));

        $searchType = trim((string)($_GET['type'] ?? 'auto'));
        $ticketId = (int)($_GET['ticket_id'] ?? 0);

        $ticket = null;
        $items = [];
        $matches = [];
        $error = null;
        $rank = null;

        try {
            $ticketModel = new TicketModel();

            if ($ticketId > 0) {
                $data = $ticketModel->getVerifierDataByTicketId($ticketId);

                if (!$data) {
                    $error = 'No se encontró el ticket seleccionado.';
                } else {
                    $ticket = $data['ticket'];
                    $items = $data['items'];
                    $rank = $data['rank'];
                    $searchQuery = (string)($ticket['ticket_code'] ?? $searchQuery);
                }
            } elseif ($searchQuery !== '') {
                $matches = $ticketModel->searchForVerifier($searchQuery, $searchType);

                if ($matches === []) {
                    $error = 'No se encontró ningún ticket con esos datos.';
                } elseif (count($matches) === 1) {
                    $data = $ticketModel->getVerifierDataByTicketId((int)$matches[0]['id']);

                    if ($data) {
                        $ticket = $data['ticket'];
                        $items = $data['items'];
                        $rank = $data['rank'];
                    }
                }
            }
        } catch (Throwable $e) {
            error_log('Error VerifierController@index: ' . $e->getMessage());
            $error = 'No se pudo verificar el ticket en este momento.';
        }

        $this->render('verifier/index', [
            'pageTitle' => 'Verificador de tickets',
            'metaDescription' => 'Verifica tu ticket de quiniela, consulta tus puntos, resultados y posición en el ranking.',
            'ticketCode' => $searchQuery,
            'searchQuery' => $searchQuery,
            'searchType' => $searchType,
            'ticket' => $ticket,
            'items' => $items,
            'matches' => $matches,
            'error' => $error,
            'rank' => $rank,
        ]);
    }
}