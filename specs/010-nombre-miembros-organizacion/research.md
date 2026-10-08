# Research: Nombre visible entre miembros de una organización

## Decisión 1 — Mecanismo de exposición de nombre/apellido

**Decisión**: Nueva función `security definer` `public.listar_miembros_organizacion()`
(sin parámetros) que, solo si el llamador cumple
`private.puede_gestionar_membresias(v_organizacion_id)` (administrador o
superadmin con esa organización activa — Clarifications de spec 010),
devuelve `(user_id uuid, rol_id text, created_at timestamptz, nombre text,
apellido text)` para todos los miembros de `private.organizacion_id()` (la
organización efectiva del llamador, ya resuelve el caso superadmin de spec
003/004); si no cumple ese chequeo, devuelve conjunto vacío. No se toca
ninguna policy de `perfiles_usuario`.

**Rationale**:
- El chequeo de rol vive **dentro** de la función, no solo en
  `accessControlProvider.ts` del frontend: al ser `security definer` con
  `grant execute to authenticated`, cualquier persona autenticada podría
  invocar la RPC directo (sin pasar por la pantalla ni por el menú), así
  que el control de acceso real tiene que estar en el cuerpo de la
  función — el gateo del frontend es solo UX (oculta el ítem de menú a
  quien de todos modos no podría hacer nada útil con la pantalla).
- `perfiles_usuario_select_titular` (spec 008) es intencionalmente
  self-only para proteger *todos* los campos de la tabla, incluido
  `foto_path` y cualquier campo personal futuro (FR-005: "ningún otro campo
  ... cambia de regla de acceso"). RLS es por fila, no por columna: ampliar
  esa policy a "mismo organización" expondría automáticamente cualquier
  columna que la tabla tenga hoy o adquiera después, violando FR-005 de
  forma silenciosa en el futuro.
- Una función puntual que selecciona explícitamente `nombre, apellido` dentro
  de su cuerpo es la única forma de que la ampliación de acceso quede
  literalmente acotada a esos dos campos, sin depender de una disciplina de
  no agregar columnas sensibles después.
- El test pgTAP existente de spec 008
  (`supabase/tests/database/perfil_usuario.test.sql:82`, "un integrante de
  la misma organización no puede leer el perfil ajeno") sigue siendo válido
  sin cambios porque no se toca la policy de la tabla — reduce el riesgo de
  regresión sobre una spec ya cerrada.
- Sigue el patrón ya establecido en el repo para lecturas puntuales
  cross-fila mediadas por una función (`private.organizacion_id()`,
  `private.puede_gestionar_membresias`, la policy `fotos_perfil_select` de
  spec 008 que ya cruza a `usuarios_organizacion` de otra persona sin pasar
  por `perfiles_usuario`).
- **Extensibilidad deliberada**: al ser una lista explícita de columnas
  (`select nombre, apellido from ...`, no `select *`), agregar en el futuro
  otro campo de `perfiles_usuario` a esta visibilidad cruzada exige tocar
  esta función línea por línea — nunca queda expuesto "de arrastre" solo
  por agregarse a la tabla. Cada ampliación futura sigue requiriendo su
  propia decisión explícita (spec), consistente con el Principio II de la
  constitución. Este criterio — lista blanca en una función puntual, nunca
  ampliar la policy de fila de `perfiles_usuario` — aplica como convención
  para cualquier spec futura que amplíe qué campos de esa tabla se vuelven
  visibles entre compañeros de organización.

**Alternativas consideradas**:
- *Ampliar `perfiles_usuario_select_titular` a "mismo organización" +
  restringir columnas con `GRANT SELECT (nombre, apellido, user_id)` a
  `authenticated`*: rechazada — los grants de columna en Postgres son por
  rol, no por fila; no hay forma de que el mismo rol `authenticated` tenga
  "todas las columnas para su propia fila" y "solo nombre/apellido para las
  demás" sin una función o vista intermedia. Terminaría exponiendo
  `foto_path` a organización o quitándoselo también al titular.
- *Vista `security_invoker`*: rechazada por el mismo motivo — una vista
  `security_invoker` hereda las RLS de la tabla base, así que necesitaría
  la misma policy ampliada que la alternativa anterior.

## Decisión 2 — Sin precondición pendiente sobre `usuarios_organizacion`

**Decisión**: `listar_miembros_organizacion()` no necesita ampliar el
acceso a `usuarios_organizacion` en absoluto — solo la usa como fuente del
`user_id`/`rol_id`/`created_at` ya visibles hoy para su único llamador
(quien administra membresías).

**Rationale**: La pantalla de miembros es exclusiva de quien administra
membresías (administrador o superadmin con organización activa) —
Clarifications de spec 010. `usuarios_organizacion_select` (spec 005) ya
deja ver a esa persona toda fila de su organización vía
`private.puede_gestionar_membresias()`, así que no hay precondición que
resolver: la única regla de acceso que esta spec efectivamente amplía es
la lectura de `nombre`/`apellido` de `perfiles_usuario` (self-only hoy,
Decisión 1). Las RPCs de escritura de spec 005 (`cambiar_rol_miembro`,
`remover_miembro`) tampoco se ven afectadas — siguen dependiendo
exclusivamente de `private.puede_gestionar_membresias()` dentro de su
propio cuerpo, no de la policy de `select`.

## Decisión 3 — Consumo desde el frontend

**Decisión**: `apps/web/src/pages/miembros/list.tsx` reemplaza
`useTable<Miembro>({ resource: 'usuarios_organizacion' })` por una consulta
directa a la función nueva vía `supabaseClient.rpc('listar_miembros_organizacion')`
en estado local (mismo patrón ya usado en el propio archivo para
`FotoMiembro` y para las RPCs de cambio de rol/remoción), refrescando tras
cada mutación en vez de `tableQuery.refetch()`. La pantalla muestra
`nombre`/`apellido` en dos columnas separadas ("Apellido", "Nombre" — ajuste
pedido por el usuario), cada una con su propio texto explícito ("Sin
apellido completado" / "Sin nombre completado") cuando el valor es `null`
(Assumptions de spec 010: el texto exacto es un detalle de redacción, no una
decisión de negocio).

**Rationale**: Refine's `useTable` asume un resource CRUD estándar del data
provider (`usuarios_organizacion`); una función de solo lectura con forma
propia (columnas combinadas de dos tablas) no encaja ahí sin una capa
adicional. El propio componente ya mezcla `useTable` con llamadas directas
a `supabaseClient` para otras necesidades (foto, RPCs de mutación), así que
sumar una lectura directa más es consistente con el estilo ya presente en
el archivo y no introduce una dependencia nueva.

**Alternativas consideradas**:
- *`useCustom` de Refine apuntando a la función*: viable, pero no aporta
  sobre la llamada directa dado que el archivo ya usa `supabaseClient`
  directamente para todo lo que no es CRUD tabular; se prefiere consistencia
  interna sobre introducir un segundo estilo de fetch en el mismo archivo.

## Resumen de NEEDS CLARIFICATION

Ninguno pendiente: la Technical Context no tiene incógnitas de
lenguaje/dependencias/plataforma (el stack ya está fijado por specs
anteriores), y las dos decisiones de diseño de arriba son técnicas, no de
negocio — no requieren una nueva sesión de `/speckit-clarify`.
