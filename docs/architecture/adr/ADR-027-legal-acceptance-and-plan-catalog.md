# ADR-027 — Consentimiento legal versionado y catálogo de planes

- Estado: **Accepted para QA** (2026-10-24). Revisión legal, identidad del responsable y precios finales son obligatorios antes de producción.
- Relacionados: ADR-008, ADR-017, ADR-026; AGENTS.md §§5 y 12.

## Decisión

1. Los documentos públicos de Privacidad y Términos tienen una versión vigente. Antes de entrar a zonas autenticadas, la aplicación exige aceptarlos explícitamente y guarda solamente usuario, documento, versión y fecha; no guarda IP, dispositivo ni una copia de la sesión.
2. El servidor registra aceptaciones solo para las dos versiones vigentes. Una nueva versión vuelve a requerir aceptación en la UI. La aceptación contractual no sustituye RLS ni los permisos de las RPC.
3. El catálogo comercial es global y editable por Superadmin mediante RPC: FREE comienza en S/ 0; PRO mensual para organización en S/ 19.90; PRO anual promocional en S/ 199.00 (equivalente a diez meses); y PRO para una sola quiniela en S/ 9.90 por mes. No hay cobro, renovación, tarjeta ni cambio automático de entitlement.
4. Un owner/admin puede solicitar PRO para uno de sus tenants. La solicitud queda pendiente hasta que un operador/Superadmin la revise; crear la solicitud nunca cambia el plan.

## Seguridad y límites

- `legal_acceptances` es append-only y solo el propio usuario puede leer sus filas.
- Las ofertas públicas no exponen datos de clientes. Solo Superadmin puede editar precio, moneda, período y beneficios.
- Las solicitudes se autorizan a partir de `auth.uid()` y la membresía activa; nunca de un `tenant_id` confiado por el cliente.
- Los textos son borradores operativos, inspirados en prácticas de concursos de pronósticos y en la Ley peruana 29733. No constituyen asesoría legal. Antes de producción debe completarse responsable, jurisdicción, correo de contacto, retención, edad mínima y revisión profesional.

## Consecuencias

La app puede enseñar planes y recibir solicitudes sin incorporar dinero real. Cambiar un plan sigue siendo una acción administrativa externa y auditada, no un pago. La interfaz Superadmin puede consumir `update_plan_offer` y `review_plan_change_request` cuando se habilite de forma separada.
