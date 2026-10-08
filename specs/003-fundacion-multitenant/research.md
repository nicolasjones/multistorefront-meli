# Research: Fundación multi-tenant

## Cómo el superadmin "entra" a una organización (el punto más delicado del diseño)

- **Decision**: una tabla `superadmin_organizacion_activa` (una fila por
  superadmin, con upsert al entrar) resuelve "en qué organización está
  operando ahora mismo" — separada de una tabla append-only
  `superadmin_entradas` que guarda el historial completo para auditoría.
  Una sola función `private.organizacion_id()` resuelve el contexto para
  cualquier usuario (miembro/admin desde `usuarios_organizacion`, o
  superadmin desde `superadmin_organizacion_activa`), y esa es la única
  función que usan todas las policies de RLS.
- **Rationale**: la arquitectura ya establecida (Refine hablando directo
  con PostgREST) es sin estado entre requests — no hay una sesión de
  servidor persistente donde guardar "en qué organización está el
  superadmin ahora". Una tabla resuelve esto de forma simple: cada request
  autenticado puede resolver el contexto con una consulta a una tabla,
  sin tocar el JWT ni el modelo de autenticación existente.
- **Alternatives considered**:
  - *Variable de sesión de Postgres* (`set_config`) — descartada: no
    persiste entre requests HTTP separados contra PostgREST/Supavisor, que
    no garantiza la misma conexión de base de datos entre llamadas.
  - *Claim custom en el JWT* (refrescar el token al "entrar") — técnicamente
    posible, pero exige tocar el flujo de autenticación (refresh de sesión)
    por una funcionalidad que hoy usa una sola persona; mucho más invasivo
    que una tabla para el beneficio que aporta hoy.

## Por qué el alta de organización necesita una Edge Function, no solo RPC de Postgres

- **Decision**: `crear-organizacion` es una Edge Function (Deno), no una
  función RPC de Postgres.
- **Rationale**: invitar por email (FR-009) es una llamada a la Auth Admin
  API de Supabase (`auth.admin.inviteUserByEmail`), que requiere la
  service-role key — eso no es SQL, no lo puede hacer una función de
  Postgres por sí sola. Es exactamente el caso de "necesito código que no
  es SQL" que ya identificamos como el criterio para usar Edge Functions
  en este template.
- **Alternatives considered**: hacer el alta en dos pasos manuales
  (crear la organización por RPC, invitar por separado desde algún otro
  lado) — descartado, rompe FR-009 (que exige que la invitación sea parte
  del mismo alta) y le devuelve al superadmin un paso manual que la spec
  quiere evitar (SC-004: menos de 2 minutos de punta a punta).

## Separación de la policy de lectura vs. escritura en `clientes`

- **Decision**: dos funciones helper, no una — `private.organizacion_id()`
  para aislamiento (SELECT, usada en cualquier tabla futura) y
  `private.puede_escribir()` para permiso de escritura (administrador, o
  superadmin con esa organización activa) — usada solo en tablas que
  distingan admin/miembro como `clientes`.
- **Rationale**: mantiene el molde de aislamiento (SC-003) genuinamente
  reutilizable sin condicionarlo — no toda tabla futura del template va a
  necesitar distinguir roles de escritura, así que ese chequeo queda
  aparte, no mezclado en la función de aislamiento.
- **Alternatives considered**: una sola función que devuelva un permiso
  compuesto — descartada, mezclaría dos preocupaciones distintas
  (aislamiento vs. permiso de escritura) en una sola función, dificultando
  reutilizar solo el aislamiento en una tabla sin roles.

## Por qué las funciones helper de RLS viven en el schema `private`, no `auth`

- **Decision**: `private.is_superadmin()`, `private.organizacion_id()` y
  `private.puede_escribir()` viven en un schema propio (`private`), creado
  por la misma migración, y no dentro del schema `auth` de Supabase.
- **Rationale**: se intentó primero en el schema `auth` (siguiendo un
  patrón común en otros proyectos Supabase, junto a `auth.uid()`), pero
  falló al aplicar la migración incluso en local: `permission denied for
  schema auth` — el rol `postgres` no es dueño de ese schema (lo es
  `supabase_auth_admin`), ni local ni en la nube. `private` es un schema
  común y sí administrable por `postgres`, y al no estar en la lista de
  schemas expuestos por la Data API (`supabase/config.toml`, `[api]
  schemas = ["public", "graphql_public"]`), estas funciones quedan
  disponibles para las policies de RLS sin aparecer como RPC público — el
  mismo resultado buscado al pensar en `auth`, sin el problema de permisos.
- **Alternatives considered**: schema `public` — descartada, expondría las
  3 funciones como RPC callable por cualquier cliente (ruido innecesario
  en la API, aunque no sería un problema de seguridad real dado que son
  `stable` y dependen solo de `auth.uid()`).
