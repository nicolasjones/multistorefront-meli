#!/usr/bin/env bash
# Verificación MANUAL (no corre en CI) de la serialización del cupo de public.exportar_clientes con dos sesiones.
#
# Dos modos:
#   (por defecto) SOLO LECTURA REVERSIBLE: la sesión A toma el cupo de una persona real (transacción abierta que se
#     revierte) y la sesión B, de la MISMA persona, debe quedar bloqueada en el advisory lock hasta que A termina.
#     Sirve contra dev: todo lo que se escribe en tablas private se revierte con rollback; no queda ningún dato.
#   --con-escritura: prueba el tope de verdad (dos exportaciones simultáneas de la misma persona contra topes bajos). Necesita
#     confirmar (commit) datos propios, por eso SOLO se usa contra un stack desechable (nunca dev, stg ni prd): crea una
#     organización y una persona de prueba, baja los topes con `create or replace private.tope_exportacion_clientes`
#     (ventana 5) y al final borra todo lo creado y restaura los topes (50000 y 200000).
#
# Conexión: PSQL es el comando que abre psql como superusuario y lee SQL por stdin (-q -At). Ejemplos:
#   PSQL='docker exec -i supabase_db_<proyecto> psql -U postgres -q -At' supabase/tests/manual/exportar_clientes_concurrencia.sh
#   PSQL='ssh root@<host> docker exec -i supabase_db_<proyecto> psql -U postgres -q -At' supabase/tests/manual/exportar_clientes_concurrencia.sh
set -uo pipefail
PSQL="${PSQL:?definí PSQL (ver el encabezado)}"
MODO="${1:-}"
EXPORTA="select count(*) from public.exportar_clientes(null, null, false, null, 1)"

como() { # $1 = user id: abre una sesión como esa persona (rol authenticated)
  echo "select set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true); set local role authenticated;"
}

if [ "$MODO" != "--con-escritura" ]; then
  # Persona real con permiso de exportar y organización con clientes (no se modifica nada).
  U=$($PSQL <<< "select uo.user_id from usuarios_organizacion uo where uo.rol_id = 'administrador'
    and exists (select 1 from clientes c where c.organizacion_id = uo.organizacion_id) limit 1;")
  [ -n "$U" ] || { echo "No hay una persona administradora con clientes para probar"; exit 2; }
  A_FIN=$(mktemp); B_FIN=$(mktemp)
  # Sesión A: toma el cupo y lo retiene 8 s dentro de la transacción; al final se revierte.
  ( { echo "begin;"; como "$U"; echo "$EXPORTA;"; echo "select pg_sleep(8);"; echo "rollback;"; } | $PSQL >/dev/null 2>&1; date +%s > "$A_FIN" ) &
  sleep 2
  # Sesión B: misma persona; si el lock funciona no termina hasta que A haga rollback.
  ( T0=$(date +%s); { echo "begin;"; como "$U"; echo "$EXPORTA;"; echo "rollback;"; } | $PSQL >/dev/null 2>&1; echo $(( $(date +%s) - T0 )) > "$B_FIN" ) &
  sleep 4
  # Sesión C: a los 4 s B debe estar esperando un advisory lock.
  ESPERAN=$($PSQL <<< "select count(*) from pg_locks where locktype = 'advisory' and not granted;")
  wait
  DUR=$(cat "$B_FIN")
  echo "esperando el advisory lock a los 4 s: $ESPERAN (esperado 1); duración de B: ${DUR}s (esperado >= 6)"
  if [ "$ESPERAN" = "1" ] && [ "$DUR" -ge 6 ]; then echo "OK: la segunda sesión de la misma persona quedó serializada"; exit 0; fi
  echo "FALLÓ: la segunda sesión no esperó al cupo de la primera"; exit 1
fi

# --- Modo con escritura (solo stack desechable) ---
ORG=aaaaaaaa-0000-0000-0000-00000000c0c0; U=aaaaaaaa-0000-0000-0000-00000000c0c1
limpiar() { $PSQL <<< "delete from private.clientes_exportaciones_entregas where organizacion_id = '$ORG';
  delete from private.clientes_exportaciones_ventana where organizacion_id = '$ORG';
  delete from public.registro_actividad where organizacion_id = '$ORG';
  delete from public.clientes where organizacion_id = '$ORG';
  delete from public.usuarios_organizacion where organizacion_id = '$ORG';
  delete from auth.users where id = '$U'; delete from public.organizaciones where id = '$ORG';
  create or replace function private.tope_exportacion_clientes(p_periodo text) returns integer language sql immutable set search_path = ''
    as \$\$ select case p_periodo when 'ventana' then 50000 when 'dia' then 200000 end; \$\$;" >/dev/null 2>&1; }
trap limpiar EXIT
$PSQL <<< "insert into public.organizaciones (id, nombre) values ('$ORG', 'Prueba concurrencia');
  insert into auth.users (id, email) values ('$U', 'concurrencia@example.com');
  insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id) values ('$U', '$ORG', 'administrador');
  insert into public.clientes (organizacion_id, numero, nombre, tipo) values ('$ORG', 9001, 'Uno', 'minorista'), ('$ORG', 9002, 'Dos', 'minorista'), ('$ORG', 9003, 'Tres', 'minorista');
  create or replace function private.tope_exportacion_clientes(p_periodo text) returns integer language sql immutable set search_path = ''
    as \$\$ select case p_periodo when 'ventana' then 5 when 'dia' then 5 end; \$\$;" >/dev/null || { echo "No se pudo preparar la prueba"; exit 2; }
# Cada exportación declara el total (3 clientes + el de la organización por defecto si existe); dos simultáneas no caben en el tope de 5.
R1=$(mktemp); R2=$(mktemp)
corre() { { echo "begin;"; como "$U"; echo "$EXPORTA;"; echo "commit;"; } | $PSQL 2>&1 | grep -c "tope_acumulado" > "$1"; }
corre "$R1" & corre "$R2" & wait
RECHAZOS=$(( $(cat "$R1") + $(cat "$R2") ))
ENTREGADAS=$($PSQL <<< "select coalesce(sum(filas), 0) from private.clientes_exportaciones_entregas where organizacion_id = '$ORG';")
echo "rechazos por tope_acumulado: $RECHAZOS (esperado 1); filas entregadas: $ENTREGADAS (esperado <= 5)"
if [ "$RECHAZOS" -eq 1 ] && [ "$ENTREGADAS" -le 5 ]; then echo "OK: los topes no se superan con dos sesiones simultáneas"; exit 0; fi
echo "FALLÓ: el tope se superó o las dos exportaciones pasaron"; exit 1
