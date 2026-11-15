#!/usr/bin/env bash
# Verificación MANUAL (no corre en CI) de la serialización del cupo de public.exportar_clientes con dos sesiones.
#
# SOLO LECTURA REVERSIBLE (apta para dev): la sesión A toma el cupo de una persona administradora real y lo retiene 8 s
# dentro de una transacción; la sesión B, de la MISMA persona, debe quedar esperando el advisory lock hasta que A termina.
# Ambas sesiones terminan con rollback: no queda ningún dato ni se cambia ninguna función ni constante. El lock es por
# organización y persona, así que solo se serializa a esa persona (otras personas no se bloquean).
# Los topes bajos se prueban en pgTAP (supabase/tests/database/clientes_exportar_actividad_ventana.test.sql), no aquí.
#
# Conexión: PSQL es el comando que abre psql como superusuario y lee SQL por stdin (-q -At). Ejemplos:
#   PSQL='docker exec -i supabase_db_<proyecto> psql -U postgres -q -At' supabase/tests/manual/exportar_clientes_concurrencia.sh
#   PSQL='ssh root@<host> docker exec -i supabase_db_<proyecto> psql -U postgres -q -At' supabase/tests/manual/exportar_clientes_concurrencia.sh
# Salida: 0 = serializado; 1 = no serializó o una sesión falló; 2 = el entorno no está listo (faltan migraciones o datos).
set -uo pipefail
PSQL="${PSQL:?definí PSQL (ver el encabezado)}"
EXPORTA="select count(*) from public.exportar_clientes(null, null, false, null, 1)"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

como() { # $1 = user id: abre una sesión como esa persona (rol authenticated)
  echo "select set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true); set local role authenticated;"
}

LISTA=$($PSQL <<< "select to_regclass('private.clientes_exportaciones_entregas') is not null;" 2>"$TMP/err") || { echo "No se pudo consultar la base:"; cat "$TMP/err"; exit 2; }
if [ "$LISTA" != "t" ]; then echo "Faltan las migraciones 20270344… en este entorno"; exit 2; fi

# Persona administradora real con clientes en su organización (no se modifica nada).
U=$($PSQL <<< "select uo.user_id from usuarios_organizacion uo where uo.rol_id = 'administrador'
  and exists (select 1 from clientes c where c.organizacion_id = uo.organizacion_id) limit 1;" 2>"$TMP/err") || { cat "$TMP/err"; exit 2; }
[ -n "$U" ] || { echo "No hay una persona administradora con clientes para probar"; exit 2; }

sesion() { # $1 = nombre, resto = SQL intermedio; el stderr se conserva y se muestra si hay un error real
  local n="$1"; shift
  { echo "begin;"; como "$U"; echo "$EXPORTA;"; printf '%s\n' "$@"; echo "rollback;"; } | $PSQL >"$TMP/$n.out" 2>"$TMP/$n.err"
  echo $? > "$TMP/$n.rc"
}

# Sesión A: retiene el cupo 8 s. Sesión B: misma persona; si el lock funciona no termina hasta que A haga rollback.
sesion A "select pg_sleep(8);" &
sleep 2
( T0=$(date +%s); sesion B; echo $(( $(date +%s) - T0 )) > "$TMP/B.dur" ) &
sleep 4
# Sesión C: a los 4 s B debe estar esperando un advisory lock.
ESPERAN=$($PSQL <<< "select count(*) from pg_locks where locktype = 'advisory' and not granted;" 2>"$TMP/errC") || { cat "$TMP/errC"; exit 1; }
wait
for n in A B; do
  if [ "$(cat "$TMP/$n.rc")" != "0" ] || grep -qi "error" "$TMP/$n.err" "$TMP/$n.out"; then
    echo "La sesión $n falló:"; cat "$TMP/$n.err" "$TMP/$n.out"; exit 1
  fi
done
DUR=$(cat "$TMP/B.dur")
echo "esperando el advisory lock a los 4 s: $ESPERAN (esperado 1); duración de B: ${DUR}s (esperado >= 6)"
if [ "$ESPERAN" = "1" ] && [ "$DUR" -ge 6 ]; then echo "OK: la segunda sesión de la misma persona quedó serializada"; exit 0; fi
echo "FALLÓ: la segunda sesión no esperó al cupo de la primera"; exit 1
