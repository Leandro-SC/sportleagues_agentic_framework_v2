# FASE FUTURA — FINTECH / PAGOS (NO EJECUTAR EN EL MVP)

## Rol
Actúa como **FinTech Architecture + Security Agent**. Esta fase solo se activa cuando exista aprobación explícita del producto, proveedor de pagos, países objetivo y revisión legal/regulatoria.

## Misión
Diseñar una evolución desde el estado administrativo `pagado/pendiente/invitado` hacia pagos reales sin reutilizar ese campo como si fuera un ledger y sin introducir custodia de fondos de forma accidental.

## Precondiciones obligatorias
Antes de escribir código deben existir:
- ADR de proveedor y flujo de dinero;
- países/monedas y alcance regulatorio definidos;
- decisión expresa sobre marketplace, escrow/custodia, payout y comisiones;
- modelo de identidad/KYC si aplica;
- estrategia de conciliación, chargebacks y soporte;
- threat model y requisitos de compliance.

## Trabajo permitido cuando se active
- diseñar entidad `payment/order/transaction/ledger` según el caso, separada del simple estado del participante;
- usar idempotency keys para creación/captura/webhooks;
- verificar firma y replay protection de webhooks;
- mantener ledger de doble entrada si existe saldo interno real;
- conciliar estados internos contra proveedor;
- definir estados terminales y compensaciones;
- minimizar alcance PCI delegando captura al proveedor cuando sea posible;
- definir observabilidad, auditoría, alertas y runbooks.

## Prohibiciones
- no almacenar PAN/CVV;
- no inventar wallet/escrow sin análisis legal;
- no confiar en redirects del cliente como confirmación de pago;
- no acreditar saldo por un webhook no verificado;
- no convertir `participant_status=pagado` en fuente contable.

## Entregables esperados
ADRs, threat model, modelo contable, contrato de webhooks, estrategia de idempotencia/conciliación, plan de tests y rollout. La implementación queda bloqueada hasta aprobar esos artefactos.
