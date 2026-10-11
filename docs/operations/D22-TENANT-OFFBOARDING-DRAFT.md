# D22 — Borrador de procedimiento de baja, anonimización y retención

Estado: **borrador operativo; no aprobado ni ejecutable**. Requiere ADR de privacidad/retención, revisión legal y decisión
del responsable de tratamiento. No fija plazos: estos deben derivarse de la jurisdicción, contrato, obligaciones fiscales y
litigios aplicables.

## Principios

- La baja es lógica primero: impedir acceso, nuevas escrituras e invitaciones sin borrar evidencia competitiva, financiera o de auditoría.
- Separar identificadores de PII. Los hechos inmutables conservan el UUID técnico y motivo de preservación; la PII se anonimiza o purga solo cuando el ADR/legal lo permita.
- Nunca borrar en cascada `audit_log`, resultados oficiales, scoring, pagos manuales ni futuros libros financieros. Las correcciones son hechos compensatorios.
- Toda exportación, hold, anonimización, restauración o purga se audita con actor, autorización, alcance, timestamp y hash del manifiesto, sin PII en logs.

## Flujo propuesto

1. Verificar autoridad, tenant, alcance y cuentas compartidas; abrir expediente de baja sin recopilar PII adicional.
2. Determinar holds legales, obligaciones fiscales/contables y periodos aplicables. Un hold congela la purga, no necesariamente la baja de acceso.
3. Exportar solo los datos autorizados mediante canal cifrado; registrar manifiesto/hash. Nunca incluir datos de otros tenants ni pronósticos privados no revelados.
4. Suspender tenant, membresías y sesiones; revocar claves, enlaces, dominios, Storage y sincronizaciones.
5. Anonimizar PII por lote controlado; preservar integridad referencial, RLS, auditoría y evidencia financiera.
6. Tras vencer requisitos aprobados y sin hold, purgar por operador de servidor con backup verificable, recuperación y doble aprobación; conservar solo evidencia mínima exigida.
7. Verificar no-login, aislamiento tenant, secretos revocados, integridad de auditoría/finanzas y reporte de cierre.

## Bloqueos para automatizar

- ADR de privacidad/retención: base legal, jurisdicción, categorías de PII, responsables, retención y legal hold.
- Diseño de estados de baja y mapa de PII; no se añaden tablas/campos en esta remediación.
- Pruebas Cloud sintéticas de aislamiento, recuperación y preservación de integridad financiera.
