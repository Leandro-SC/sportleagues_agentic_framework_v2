#!/usr/bin/env bash
# Obtiene ADMIN2_JWT por el login oficial de Supabase Auth (correo + contraseña) sin imprimir ni
# guardar nada. DEBE ejecutarse con `source` para que la variable quede en tu shell:
#
#   export SUPABASE_URL=https://juoftaofzepxbrrxbkhx.supabase.co
#   read -rs SUPABASE_ANON_KEY; export SUPABASE_ANON_KEY      # Enter al terminar; no se muestra
#   source scripts/qa/login-admin2.sh
#
# Pide el correo y la contraseña de la cuenta de prueba "Admin 2" (nunca los pegues en un chat).
# Si la cuenta se creó con Magic Link y no tiene contraseña, créala primero con
# "¿Olvidaste tu contraseña?" en la app de QA.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then echo "ERROR: usa 'source scripts/qa/login-admin2.sh'" >&2; exit 2; fi
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then echo "ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY" >&2; return 2; fi

_qa_dir="$(mktemp -d)"; chmod 700 "$_qa_dir"
read -r -p "Correo de Admin 2: " _qa_email
read -r -s -p "Contraseña (no se muestra): " _qa_password; echo
(umask 077; QA_PW="$_qa_password" node -e 'process.stdout.write(JSON.stringify({email: process.argv[1].trim().toLowerCase(), password: process.env.QA_PW}))' "$_qa_email" > "$_qa_dir/body.json")
(umask 077; printf 'apikey: %s\n' "$SUPABASE_ANON_KEY" > "$_qa_dir/headers")
_qa_native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi }
_qa_status="$(curl -sS -o "$_qa_dir/resp.json" -w '%{http_code}' -X POST "${SUPABASE_URL%/}/auth/v1/token?grant_type=password" \
  -H @"$(_qa_native "$_qa_dir/headers")" -H 'Content-Type: application/json' --data @"$(_qa_native "$_qa_dir/body.json")")"
unset _qa_password _qa_email
if [ "$_qa_status" = "200" ]; then
  ADMIN2_JWT="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).access_token ?? "")' "$(_qa_native "$_qa_dir/resp.json")")"
  export ADMIN2_JWT
  echo "OK: ADMIN2_JWT cargado en esta shell (valor no impreso, caduca en ~1 hora)."
else
  echo "FAIL: el login devolvió HTTP $_qa_status (credenciales inválidas, correo sin confirmar o sin contraseña)." >&2
fi
rm -rf "$_qa_dir"; unset _qa_dir _qa_status
