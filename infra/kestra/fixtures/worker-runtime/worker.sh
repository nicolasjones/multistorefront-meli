#!/usr/bin/env sh
set -eu
case "${FIXTURE_RESULT:-success}" in
  success) printf '%s\n' 'WORKER_OK' ; exit 0 ;;
  technical-failure) printf '%s\n' 'FALLA_TECNICA_SANITIZADA' >&2; exit 42 ;;
  invalid-credential) printf '%s\n' 'CREDENCIAL_INVALIDA:fixture' >&2; exit 78 ;;
  *) printf '%s\n' 'RESULTADO_FIXTURE_DESCONOCIDO' >&2; exit 2 ;;
esac
