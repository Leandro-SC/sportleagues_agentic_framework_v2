import { createCspReportHandler } from './_core.ts'

// F-06. Receptor PÚBLICO y sin secretos de reportes CSP (report-uri / Reporting API). NO desplegada: ver
// docs/operations/CSP-REPORTING-AND-ENFORCEMENT.md. Requiere `verify_jwt = false` (los navegadores no envían JWT).
// CSP_REPORT_ALLOWED_ORIGINS (opcional): orígenes de la app, solo para el preflight de `report-to`; con `report-uri` no hace falta.
const allowedOrigins = (Deno.env.get('CSP_REPORT_ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean)

Deno.serve(createCspReportHandler({ allowedOrigins }))
