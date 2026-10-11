#!/usr/bin/env bash
# Happy path HTTP + negativos de la Edge Function `branding-asset` en QA, con JWT real de Admin 2.
# Runbook: docs/operations/PHASE-05-HTTP-HAPPY-PATHS.md
#
# Variables requeridas:
#   SUPABASE_URL        https://<ref>.supabase.co del proyecto QA
#   SUPABASE_ANON_KEY   anon key pública del proyecto QA
#   ADMIN2_JWT          access_token vigente de la sesión de Admin 2 (no se imprime)
#   TENANT_B_ID         UUID del tenant que administra Admin 2 (debe tener plan `pro`)
# Variables opcionales:
#   TENANT_A_ID         UUID de un tenant que Admin 2 NO administra (activa el negativo cross-tenant)
#   QA_ORIGIN           origen permitido por CORS (por defecto https://sportleagues-qa.vercel.app)
#
# Restauración: antes de cualquier cambio se respalda y verifica el logo activo de TENANT_B_ID.
# Al terminar (éxito, error o interrupción) se restaura el estado previo. El lifecycle no permite
# reactivar un asset reemplazado, así que el logo original se vuelve a cargar por el mismo flujo
# autorizado: queda como un asset nuevo con la misma imagen re-normalizada a WebP. Si no había
# logo, se retira el de prueba con `remove_branding_asset`. Banner y colores no se modifican.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_tools
require_env SUPABASE_URL SUPABASE_ANON_KEY ADMIN2_JWT TENANT_B_ID
QA_ORIGIN="${QA_ORIGIN:-https://sportleagues-qa.vercel.app}"
SUPABASE_URL="${SUPABASE_URL%/}"
FUNCTION_URL="$SUPABASE_URL/functions/v1/branding-asset"
FIXTURE="$SCRIPT_DIR/../../supabase/tests/fixtures/branding/qa-logo-512.png"
BACKUP_KEEP_DIR="$SCRIPT_DIR/../../supabase/.temp/qa-branding-backup"
[ -f "$FIXTURE" ] || { echo "ERROR: no existe el fixture $FIXTURE" >&2; exit 2; }
FIXTURE="$(native_path "$FIXTURE")"

# Validación local del JWT sin imprimirlo: formato, rol y al menos 10 minutos de vigencia, para que
# la restauración final no se quede sin sesión.
JWT_STATE="$(ADMIN2_JWT="$ADMIN2_JWT" node -e '
  const parts = (process.env.ADMIN2_JWT ?? "").split(".")
  if (parts.length !== 3) { console.log("malformed"); process.exit(0) }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    if (payload.role !== "authenticated") console.log("role:" + payload.role)
    else if (!payload.exp || payload.exp * 1000 < Date.now() + 600000) console.log("expira-en-menos-de-10-min")
    else console.log("ok")
  } catch { console.log("malformed") }
')"
if [ "$JWT_STATE" != "ok" ]; then
  echo "ERROR: ADMIN2_JWT no es utilizable ($JWT_STATE). Obtén un access_token nuevo (ver runbook)." >&2
  exit 2
fi

ANON_HEADERS="$(header_file anon "apikey: $SUPABASE_ANON_KEY")"
USER_HEADERS="$(header_file user "apikey: $SUPABASE_ANON_KEY" "Authorization: Bearer $ADMIN2_JWT")"
BAD_JWT_HEADERS="$(header_file badjwt "apikey: $SUPABASE_ANON_KEY" "Authorization: Bearer invalid.jwt.token")"
BODY="$QA_TMP_DIR/body.json"
RESPONSE_HEADERS="$QA_TMP_DIR/response-headers.txt"
NOT_AN_IMAGE="$QA_TMP_DIR/not-an-image.png"
printf 'esto no es una imagen\n' > "$NOT_AN_IMAGE"
NOT_AN_IMAGE="$(native_path "$NOT_AN_IMAGE")"
BACKUP_FILE="$(native_path "$QA_TMP_DIR/original-logo.bin")"
RANDOM_ASSET_ID="$(node -e 'process.stdout.write(crypto.randomUUID())')"

# Lee el logo activo del tenant en LOGO_ID, LOGO_PATH, LOGO_BYTES, LOGO_W, LOGO_H, LOGO_MIME.
# Devuelve 1 si la consulta falla; LOGO_ID vacío significa "sin logo activo".
read_active_logo() {
  local status fields
  status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/get_active_branding_assets" \
    -H @"$USER_HEADERS" -H 'Content-Type: application/json' -d "{\"p_tenant_id\":\"$TENANT_B_ID\"}")" || return 1
  [ "$status" = "200" ] || return 1
  fields="$(node -e '
    const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    if (!Array.isArray(rows)) process.exit(1)
    const row = rows.find((r) => r.asset_kind === "logo")
    process.stdout.write(row ? [row.asset_id, row.storage_path, row.byte_size, row.width, row.height, row.mime_type].join("|") : "|||||")
  ' "$BODY")" || return 1
  IFS='|' read -r LOGO_ID LOGO_PATH LOGO_BYTES LOGO_W LOGO_H LOGO_MIME <<< "$fields"
}

# Devuelve "bytes|mime-detectado|sha256" de un archivo local.
inspect_file() {
  node -e '
    const bytes = require("fs").readFileSync(process.argv[1])
    const ascii = (a, b) => bytes.subarray(a, b).toString("latin1")
    const type = bytes[0] === 0x89 && ascii(1, 4) === "PNG" ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg"
      : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" ? "image/webp" : "unknown"
    const sha = require("crypto").createHash("sha256").update(bytes).digest("hex")
    process.stdout.write([bytes.length, type, sha].join("|"))
  ' "$1"
}

keep_backup() {
  local ext="${ORIGINAL_MIME#image/}" target
  mkdir -p "$BACKUP_KEEP_DIR"
  target="$BACKUP_KEEP_DIR/logo-original-$(date -u +%Y%m%dT%H%M%SZ).$ext"
  cp "$BACKUP_FILE" "$target"
  echo "ACCIÓN MANUAL: restaura el logo desde /admin con el respaldo guardado en"
  echo "               supabase/.temp/qa-branding-backup/$(basename "$target") (carpeta ignorada por Git)."
}

RESTORE_DONE=0
restore_branding() {
  set +e
  [ "$RESTORE_DONE" = 1 ] && return 0
  RESTORE_DONE=1
  echo "------------------------------------------------------------------"
  echo "Restauración del branding previo"

  if ! read_active_logo; then
    report Z1 "Leer logo activo tras la prueba" "ok" "consulta-fallida"
    [ -n "$ORIGINAL_ID" ] && keep_backup
    return 1
  fi

  if [ -z "$ORIGINAL_ID" ]; then
    if [ -z "$LOGO_ID" ]; then
      report Z1 "Tenant sin logo previo: nada que restaurar" "sin-logo" "sin-logo"
      return 0
    fi
    local status
    status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/remove_branding_asset" \
      -H @"$USER_HEADERS" -H 'Content-Type: application/json' \
      -d "{\"p_tenant_id\":\"$TENANT_B_ID\",\"p_asset_kind\":\"logo\"}")"
    report Z1 "Retirar logo de prueba" "200" "${status:-error-de-red}"
    local after="logo-presente"
    if read_active_logo && [ -z "$LOGO_ID" ]; then after="sin-logo"; fi
    report Z2 "Tenant vuelve a quedar sin logo" "sin-logo" "$after"
    if [ "$after" != "sin-logo" ]; then
      echo "ACCIÓN MANUAL: retira el logo de prueba desde /admin."
      return 1
    fi
    return 0
  fi

  if [ "$LOGO_ID" = "$ORIGINAL_ID" ]; then
    report Z1 "El logo original sigue activo: nada que restaurar" "original-activo" "original-activo"
    return 0
  fi

  local status restore_id
  status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/begin_branding_asset" \
    -H @"$USER_HEADERS" -H 'Content-Type: application/json' \
    -d "{\"p_tenant_id\":\"$TENANT_B_ID\",\"p_asset_kind\":\"logo\"}")"
  restore_id="$(json_field "$BODY" id)"
  if [ "$status" != "200" ] || [ -z "$restore_id" ]; then
    report Z1 "Crear asset de restauración" "200" "${status:-error-de-red} $(json_field "$BODY" message)"
    keep_backup
    return 1
  fi
  status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$USER_HEADERS" \
    -H "Origin: $QA_ORIGIN" -F "asset_id=$restore_id" -F "file=@$BACKUP_FILE;type=$ORIGINAL_MIME")"
  report Z1 "Volver a cargar el logo original" "200 active" "${status:-error-de-red} $(json_field "$BODY" status)$(json_field "$BODY" code)"

  local verified="no-restaurado"
  if read_active_logo && [ "$LOGO_ID" = "$restore_id" ]; then verified="$LOGO_MIME ${LOGO_W}x${LOGO_H}"; fi
  report Z2 "Logo original activo de nuevo" "image/webp ${ORIGINAL_W}x${ORIGINAL_H}" "$verified"
  if [ "$verified" != "image/webp ${ORIGINAL_W}x${ORIGINAL_H}" ]; then keep_backup; return 1; fi
}

# Hook de salida inesperada (error de red, fallo de comando o Ctrl+C).
restore_on_unexpected_exit() {
  echo "SALIDA INESPERADA: se intenta restaurar el branding previo."
  restore_branding
  local rc=$?
  summary
  return "$rc"
}

echo "branding-asset — QA $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "------------------------------------------------------------------"

# B1 — Respaldo verificado del logo activo. Si falla, se aborta sin modificar QA.
if ! read_active_logo; then
  report B1 "Respaldo del logo activo" "ok" "consulta-fallida"
  echo "ABORTADO: no se pudo leer el branding actual; no se realizó ningún cambio en QA."
  summary
  exit 1
fi
ORIGINAL_ID="$LOGO_ID"
ORIGINAL_MIME="$LOGO_MIME"
ORIGINAL_W="$LOGO_W"
ORIGINAL_H="$LOGO_H"
if [ -z "$ORIGINAL_ID" ]; then
  report B1 "Respaldo del logo activo" "ok" "ok" "el tenant no tiene logo activo"
else
  status="$(curl -sS -o "$BACKUP_FILE" -w '%{http_code}' \
    "$SUPABASE_URL/storage/v1/object/authenticated/branding-assets/$LOGO_PATH" -H @"$USER_HEADERS")"
  backup_state="descarga-$status"
  if [ "$status" = "200" ]; then
    IFS='|' read -r backup_bytes backup_type backup_sha <<< "$(inspect_file "$BACKUP_FILE")"
    curl -sS -o "$BODY" "$SUPABASE_URL/rest/v1/branding_assets?select=sha256&id=eq.$ORIGINAL_ID" -H @"$USER_HEADERS" || true
    expected_sha="$(json_field "$BODY" sha256)"
    if [ "$backup_bytes" != "$LOGO_BYTES" ]; then backup_state="tamaño-distinto"
    elif [ "$backup_type" != "$LOGO_MIME" ]; then backup_state="tipo-distinto"
    elif [ -n "$expected_sha" ] && [ "$expected_sha" != "$backup_sha" ]; then backup_state="sha256-distinto"
    else backup_state="ok"
    fi
  fi
  report B1 "Respaldo del logo activo" "ok" "$backup_state" \
    "$ORIGINAL_MIME ${ORIGINAL_W}x${ORIGINAL_H}, sha256 $([ -n "${expected_sha:-}" ] && echo verificado || echo no-disponible)"
  if [ "$backup_state" != "ok" ]; then
    echo "ABORTADO: el respaldo no es íntegro; no se realizó ningún cambio en QA."
    summary
    exit 1
  fi
fi

# A partir de aquí cualquier salida restaura el branding previo.
QA_EXIT_HOOK=restore_on_unexpected_exit

# A1 — Preflight CORS desde el origen QA permitido.
status="$(curl -sS -o "$BODY" -D "$RESPONSE_HEADERS" -w '%{http_code}' -X OPTIONS "$FUNCTION_URL" \
  -H "Origin: $QA_ORIGIN" -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization, content-type, apikey')"
allow_origin="$(grep -i '^access-control-allow-origin:' "$RESPONSE_HEADERS" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)"
report A1 "Preflight CORS origen QA" "204 $QA_ORIGIN" "$status ${allow_origin:-<sin header>}"

# A2 — Sin Authorization: debe rechazarse (gateway o función).
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$ANON_HEADERS" \
  -F "asset_id=$RANDOM_ASSET_ID" -F "file=@$FIXTURE;type=image/png")"
report A2 "Sin JWT de usuario" "401" "$status"

# A3 — JWT inválido.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$BAD_JWT_HEADERS" \
  -F "asset_id=$RANDOM_ASSET_ID" -F "file=@$FIXTURE;type=image/png")"
report A3 "JWT inválido" "401" "$status"

# A4 — Origen no permitido con JWT válido.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$USER_HEADERS" \
  -H 'Origin: https://evil.example' -F "asset_id=$RANDOM_ASSET_ID" -F "file=@$FIXTURE;type=image/png")"
report A4 "Origen no permitido" "403 FORBIDDEN" "$status $(json_field "$BODY" code)"

# A5 — asset_id inexistente con JWT válido.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$USER_HEADERS" \
  -H "Origin: $QA_ORIGIN" -F "asset_id=$RANDOM_ASSET_ID" -F "file=@$FIXTURE;type=image/png")"
report A5 "Asset inexistente" "404 ASSET_NOT_FOUND" "$status $(json_field "$BODY" code)"

# A6 — Cross-tenant: Admin 2 no puede iniciar un asset en un tenant que no administra.
if [ -n "${TENANT_A_ID:-}" ]; then
  status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/begin_branding_asset" \
    -H @"$USER_HEADERS" -H 'Content-Type: application/json' \
    -d "{\"p_tenant_id\":\"$TENANT_A_ID\",\"p_asset_kind\":\"logo\"}")"
  report A6 "begin_branding_asset en tenant ajeno" "403 not authorized" "$status $(json_field "$BODY" message)"
else
  skip A6 "Cross-tenant (define TENANT_A_ID para ejecutarlo)"
fi

# A7 — Crear asset pending en el tenant propio (requiere plan PRO).
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$SUPABASE_URL/rest/v1/rpc/begin_branding_asset" \
  -H @"$USER_HEADERS" -H 'Content-Type: application/json' \
  -d "{\"p_tenant_id\":\"$TENANT_B_ID\",\"p_asset_kind\":\"logo\"}")"
ASSET_ID="$(json_field "$BODY" id)"
ASSET_STATUS="$(json_field "$BODY" status)"
report A7 "begin_branding_asset tenant propio" "200 pending" "$status ${ASSET_STATUS:-$(json_field "$BODY" message)}"
if [ "$status" != "200" ] || [ -z "$ASSET_ID" ]; then
  echo "BLOQUEO: no se pudo crear el asset pending; se omiten A8–A11."
  echo "         Si el mensaje es 'pro branding is required', el tenant no tiene plan pro."
  QA_EXIT_HOOK=""
  restore_branding || true
  summary
  exit 1
fi

# A8 — Archivo que no es imagen sobre el asset pending (no debe consumir el asset).
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$USER_HEADERS" \
  -H "Origin: $QA_ORIGIN" -F "asset_id=$ASSET_ID" -F "file=@$NOT_AN_IMAGE;type=image/png")"
report A8 "Archivo no imagen" "415 INVALID_IMAGE_TYPE" "$status $(json_field "$BODY" code)"

# A9 — Happy path: carga real, normalización WebP, metadata y activación.
status="$(curl -sS -o "$BODY" -D "$RESPONSE_HEADERS" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$USER_HEADERS" \
  -H "Origin: $QA_ORIGIN" -F "asset_id=$ASSET_ID" -F "file=@$FIXTURE;type=image/png")"
allow_origin="$(grep -i '^access-control-allow-origin:' "$RESPONSE_HEADERS" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)"
returned_id="$(json_field "$BODY" asset_id)"
id_match="id-distinto"; [ "$returned_id" = "$ASSET_ID" ] && id_match="id-ok"
report A9 "Carga y activación del logo" "200 active id-ok" "$status $(json_field "$BODY" status) $id_match" \
  "cors=${allow_origin:-ninguno} code=$(json_field "$BODY" code)"

# A10 — Replay del mismo asset: ya no está pending.
status="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$FUNCTION_URL" -H @"$USER_HEADERS" \
  -H "Origin: $QA_ORIGIN" -F "asset_id=$ASSET_ID" -F "file=@$FIXTURE;type=image/png")"
report A10 "Replay del asset activo" "409 INVALID_ASSET_STATE" "$status $(json_field "$BODY" code)"

# A11 — El asset de prueba es el logo activo del tenant y quedó normalizado a WebP.
active_check="consulta-fallida"
if read_active_logo; then
  active_check="no-activo"
  [ "$LOGO_ID" = "$ASSET_ID" ] && active_check="logo $LOGO_MIME ${LOGO_W}x${LOGO_H}"
fi
report A11 "Logo de prueba activo y en WebP" "logo image/webp 512x512" "$active_check"

QA_EXIT_HOOK=""
restore_branding || true
summary
