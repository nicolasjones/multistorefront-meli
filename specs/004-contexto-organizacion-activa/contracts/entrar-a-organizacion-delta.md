# Contract: cambios sobre la RPC `entrar_a_organizacion` (spec 003)

Este archivo documenta solo el **delta** sobre el contrato original —
`specs/003-fundacion-multitenant/contracts/entrar-a-organizacion.md`. La
firma (`entrar_a_organizacion(org_id uuid)`), quién la llama, y el
`response` no cambian.

## Comportamiento nuevo (dentro de la función, `security definer`)

Se agrega un paso **antes** del `upsert` que ya existía:

0. Si ya existe una fila en `superadmin_organizacion_activa` para
   `auth.uid()` con una `organizacion_id` **distinta** a `org_id`, inserta
   en `superadmin_entradas` una fila con `accion = 'salida'`,
   `entrado_en = clock_timestamp()`, para esa organización anterior, antes
   de continuar con los pasos 1-3 ya descritos en el contrato original
   (que ahora insertan `accion = 'entrada'`, también con
   `entrado_en = clock_timestamp()`, en el paso 3, en vez de no distinguir
   acción ni usar `now()`).

Si no existía ninguna fila activa antes (primera vez que el superadmin
entra a alguna organización), el comportamiento es idéntico al original —
no hay salida que registrar.

**Por qué `clock_timestamp()` y no `now()`**: ambos inserts ocurren en la
misma transacción de la función; `now()` devuelve el inicio de la
transacción y sería idéntico en las dos filas, haciendo imposible
distinguir cuál fue la salida y cuál la entrada por fecha. Ver research.md.

Todo ocurre en la misma transacción de la función, igual que antes.

## Por qué

Ver `research.md` de esta spec ("Extender `entrar_a_organizacion` para
auditar la salida automática") y la Clarification Q2 de `spec.md`.
