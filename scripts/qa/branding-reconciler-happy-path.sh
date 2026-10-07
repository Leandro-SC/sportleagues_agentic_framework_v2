#!/usr/bin/env bash
# Happy path HTTP + negativos de la Edge Function interna `branding-reconciler` en QA.
# Runbook: docs/operations/PHASE-05-HTTP-HAPPY-PATHS.md
#
# Variables requeridas:
#   SUPABASE_URL                 https://<ref>.supabase.co del proyecto QA
#   BRANDING_RECONCILER_SECRET   credencial interna configurada en QA (no se imprime)
#
# Efecto en QA: ejecuta dos corridas reales de reconciliación (hasta 50 assets cada una), con la
# misma política conservadora del Cron futuro.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_tools
require_env SUPABASE_URL BRANDING_RECONCILER_SECRET
SUPABASE_URL="${SUPABASE_URL%/}"
FUNCTION_URL="$SUPABASE_URL/functions/v1/branding-reconciler"

WRONG_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
SECRET_HEADER="$(header_file secret "x-reconciler-secret: $BRANDING_RECONCILER_SECRET")"
BEARER_HEADER="$(header_file bearer "Authorization: Bearer $BRANDING_RECONCILER_SECRET")"
WRONG_HEADER="$(header_file wrong "x-reconciler-secret: $WRONG_SECRET")"
BODY="$QA_TMP_DIR/body.json"

run_summary() {
  printf 'processed=%s deleted=%s skipped=%s errors=%s inconsistencies=%s' \
    "$(json_field "$BODY" processed)" "$(json_field "$BODY" deleted)" "$(json_field "$BODY" skipped)" \
    "$(json_field "$BODY" errors)" "$(json_field "$BODY" inconsistencies)"
}

echo "branding-reconciler — QA $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "------------------------------------------------------------------"

# R1 — Método distinto de POST.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X GET "$FUNCTION_URL" -H @"$SECRET_HEADER")"
report R1 "GET no permitido" "405 METHOD_NOT_ALLOWED" "$status $(json_field "$BODY" code)"

# R2 — Sin credencial.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL")"
report R2 "Sin credencial" "401 UNAUTHORIZED" "$status $(json_field "$BODY" code)"

# R3 — Credencial incorrecta.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$WRONG_HEADER")"
report R3 "Credencial incorrecta" "401 UNAUTHORIZED" "$status $(json_field "$BODY" code)"

# R4 — Corrida autorizada con x-reconciler-secret.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$SECRET_HEADER" --max-time 60)"
report R4 "Corrida autorizada (x-reconciler-secret)" "200 errors=0" "$status errors=$(json_field "$BODY" errors)" "$(run_summary)"

# R5 — Segunda corrida con Bearer: debe ser segura e idempotente.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$BEARER_HEADER" --max-time 60)"
report R5 "Segunda corrida (Bearer)" "200 errors=0" "$status errors=$(json_field "$BODY" errors)" "$(run_summary)"

summary
