#!/usr/bin/env bash
# Utilidades compartidas para los happy paths HTTP de QA (Fase 05).
# Reglas: nunca imprimir JWT, secretos ni cuerpos completos; los headers sensibles se pasan a curl
# desde archivos temporales con permisos 600 para que no aparezcan en la lista de procesos.

set -euo pipefail
set +x

QA_TMP_DIR="$(mktemp -d)"
chmod 700 "$QA_TMP_DIR"

# Hook opcional que se ejecuta al salir por cualquier vía (éxito, error, `exit` o Ctrl+C) antes de
# borrar los temporales. Un hook fallido fuerza un código de salida distinto de cero.
QA_EXIT_HOOK=""
qa_on_exit() {
  local rc=$?
  set +e
  if [ -n "$QA_EXIT_HOOK" ]; then
    local hook="$QA_EXIT_HOOK"
    QA_EXIT_HOOK=""
    "$hook" || rc=1
  fi
  rm -rf "$QA_TMP_DIR"
  exit "$rc"
}
trap qa_on_exit EXIT
trap 'exit 130' INT TERM

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

require_env() {
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      echo "ERROR: falta la variable de entorno $name" >&2
      exit 2
    fi
  done
}

require_tools() {
  local tool
  for tool in curl node; do
    command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: falta $tool en PATH" >&2; exit 2; }
  done
}

# En Git Bash, curl es un binario nativo de Windows y no entiende rutas MSYS (/c/..., /tmp/...).
native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# Escribe un archivo de headers (uno por línea) legible solo por el usuario actual.
# Uso: header_file <nombre> <línea de header>...
header_file() {
  local path="$QA_TMP_DIR/$1"
  shift
  (umask 077; printf '%s\n' "$@" > "$path")
  native_path "$path"
}

# Extrae un campo de primer nivel (o de la primera fila si es un array) de un JSON en archivo.
json_field() {
  node -e '
    const fs = require("fs")
    try {
      const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      const value = Array.isArray(raw) ? raw[0]?.[process.argv[2]] : raw?.[process.argv[2]]
      process.stdout.write(value === undefined || value === null ? "" : String(value))
    } catch { process.stdout.write("") }
  ' "$1" "$2"
}

# Imprime una línea de resultado. Uso: report <id> <descripción> <esperado> <obtenido> [detalle]
report() {
  local id="$1" description="$2" expected="$3" got="$4" detail="${5:-}"
  local verdict="FAIL"
  if [ "$expected" = "$got" ]; then verdict="PASS"; PASS_COUNT=$((PASS_COUNT + 1)); else FAIL_COUNT=$((FAIL_COUNT + 1)); fi
  printf '%-4s %-4s esperado=%-28s obtenido=%-28s %s%s\n' "$id" "$verdict" "$expected" "$got" "$description" "${detail:+ ($detail)}"
}

skip() {
  SKIP_COUNT=$((SKIP_COUNT + 1))
  printf '%-4s SKIP %s\n' "$1" "$2"
}

summary() {
  echo "------------------------------------------------------------------"
  echo "RESUMEN: PASS=$PASS_COUNT FAIL=$FAIL_COUNT SKIP=$SKIP_COUNT"
  [ "$FAIL_COUNT" -eq 0 ]
}
