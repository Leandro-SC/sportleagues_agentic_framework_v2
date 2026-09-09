# Security Baseline

## Prioridades críticas

1. Tenant isolation / Broken Access Control.
2. Predicciones después del lock.
3. Escalamiento owner/admin/member.
4. Alteración de resultados oficiales/scoring.
5. Exposición de service-role key o secretos.
6. Uploads de logos/banners no validados.
7. Deep links/códigos de invitación predecibles o abusables.
8. XSS en nombres, branding y contenido renderizado en flyers.
9. Rate limits/abuso en join, auth y generación intensiva.
10. Logs con PII/tokens.

## Reglas

- RLS por defecto en tablas expuestas.
- Funciones `SECURITY DEFINER` solo cuando sean imprescindibles, con `search_path` controlado y autorización interna.
- Validar ownership/role en operaciones administrativas.
- No aceptar timestamps del cliente como fuente de verdad para lock.
- Storage con buckets/policies mínimos.
- Sanitizar SVG o prohibirlo si no existe pipeline seguro.
- No almacenar credenciales de pago en el MVP.
