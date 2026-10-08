# Plan de implementación: Conexiones OAuth de plataforma vía Nango

**Rama**: `nicolasjones/conexiones-oauth-nango` | **Fecha**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: especificación de funcionalidad de `specs/20260930-153545-conexiones-oauth-nango/spec.md`

## Resumen

Nango self-hosted (`nango-db`, `nango-redis`, `nango-server`) es el motor de
autenticación OAuth y la única entidad que guarda tokens de proveedor. Supabase
no duplica esa custodia: solo lleva el catálogo de integraciones habilitadas y,
por organización, una fila de bookkeeping (`conexiones_oauth`) cuyo `id` se
reutiliza tal cual como `connection_id` de Nango. Un backend o worker de un
producto derivado resuelve esa fila por RLS y después llama directo a la API
de Nango (`GET /connection/:id`) con el secreto de plataforma
(`NANGO_SECRET_KEY_*`) para obtener un access token vigente — Nango refresca
solo. Ningún token ni secreto de proveedor pasa nunca por el navegador ni se
guarda en Postgres.

## Contexto técnico

**Lenguaje**: SQL/PL-pgSQL (Supabase), TypeScript/React existente (Refine, `apps/web`), YAML (Docker Compose).
**Dependencias nuevas**: Nango self-hosted (`nangohq/nango-server`, imagen pineada por tag/commit), `@nangohq/frontend` en `apps/web` para el popup de consentimiento.
**Persistencia**: `public.integraciones_oauth`, `public.conexiones_oauth`, `public.eventos_conexion_oauth` (Supabase); Nango guarda credenciales de proveedor en su propia base `nango-db`, fuera del alcance de Supabase.
**Pruebas**: pgTAP de RLS/aislamiento por organización y de las funciones `SECURITY DEFINER`; `pnpm infra:config` valida `infra/nango/compose.yaml`; verificación manual del flujo de consentimiento contra un proyecto Google en modo Testing.
**Plataforma**: nuevo Compose independiente `infra/nango/compose.yaml` (desarrollo local) más el mismo servicio operado en el entorno propio de cada producto derivado (staging/producción), detrás de su propio reverse proxy/dominio.
**Límites**: sin `pg_net` ni HTTP desde funciones SQL — la llamada a la API de Nango la hace siempre el backend/worker del producto derivado, nunca Postgres. Sin sync/functions/webhooks de Nango Cloud. Sin conector de Google Sheets ni tablas de dominio (eso es del producto derivado).

## Decisiones

1. **Nango es la única custodia de tokens.** Supabase nunca guarda un access/refresh token de proveedor, ni en texto plano ni en Vault — a diferencia de `conexiones` (spec 013), que sí guarda una credencial en Vault porque la aporta la propia organización. Acá el secreto lo genera el flujo OAuth y vive únicamente en `nango-db`.
2. ~~El `id` de `conexiones_oauth` es el `connection_id` de Nango.~~ **Revisado por decisión 8**: con Connect Session Token, Nango asigna su propio `connection_id` — no se puede pre-fijar igual al `id` de esta fila (confirmado en vivo, research.md R8). `conexiones_oauth.id` queda como clave de bookkeeping de Supabase únicamente; el `connection_id` real vive en la columna nueva `nango_connection_id`, completada recién por `confirmar_conexion_oauth` con el valor que devuelve `nango.auth()`/`.reconnect()`. "Reautorizar" sigue siendo un solo mecanismo (ahora `nango.reconnect(...)` apuntando al mismo `nango_connection_id` existente vía `POST /connect/sessions/reconnect`), no crea una fila ni un `connection_id` nuevos.
3. **`unique (organizacion_id, integracion_id)`** en `conexiones_oauth`, a propósito distinto de `conexiones` (que permite varias por sistema externo, R10/FR-021 de la spec 013): una conexión OAuth representa un login de una persona en nombre de la organización, no una credencial arbitraria — no tiene sentido dejar más de una activa a la vez para el mismo proveedor.
4. **Obtener un token vigente NO es una función de Postgres.** Sería una llamada HTTP saliente desde SQL, algo que este template ya evita (ver spec 019, "sin pg_net"). En su lugar, el contrato es de dos pasos documentados en `contracts/obtener-token-oauth.md`: 1) resolver `conexion_id` con un `select` normal sobre Supabase (RLS), 2) llamar directo a la API HTTP del propio Nango self-hosted con el secreto de plataforma. Esto mantiene a Postgres fuera del camino de red y dispensa a este template de reimplementar lo que Nango ya resuelve (refresh, expiración, proxy).
5. **El frontend nunca ve un secreto.** El flujo de conexión usa `@nangohq/frontend` (`nango.auth(clave)`/`nango.reconnect(clave)` — sin `connectionId` posicional, ver decisión 8), que abre el popup de consentimiento del proveedor y devuelve éxito con el `connection_id` real asignado por Nango, o error. Ni tokens ni claves de Nango llegan al navegador. La confirmación de éxito la reporta el propio navegador (mismo nivel de confianza que `crear_conexion` en spec 013, que también acepta el resultado reportado por quien ya completó la acción sensible del lado correcto) — `confirmar_conexion_oauth` no revalida ese resultado contra la API de Nango (riesgo aceptado, ver `data-model.md`).
6. **`integraciones_oauth` es un catálogo de plataforma, no de producto.** Alta/baja vía función `SECURITY DEFINER` restringida a superadmin — agregar un proveedor nuevo no requiere migración de esquema (FR-006), solo una fila nueva y su alta correspondiente como "Integration" en el dashboard de Nango (client id/secret del proveedor, fuera de Git).
7. **Nango self-hosted vive en `infra/nango/compose.yaml`**, con los 3 servicios confirmados contra el `docker-compose.yaml` oficial de NangoHQ/nango (`nango-db`, `nango-redis`, `nango-server`; sin Temporal ni Elasticsearch), variables en `.env.example`, puertos configurables (mismo patrón que la spec 015) y comando `dev:nango`/`dev:down:nango`.
8. **El popup de consentimiento necesita un Connect Session Token, no solo `host`.** Descubierto verificando el flujo real: `@nangohq/frontend` 0.71.x exige `publicKey` o `connectSessionToken` — `host` a secas ya no alcanza para self-host. Ese token se genera server-to-server con `NANGO_SECRET_KEY_*` (nunca en el navegador), vía una Edge Function nueva (`iniciar-sesion-oauth`, mismo patrón que `emitir-acceso-reporte` de spec 007: RLS de `conexiones_oauth` decide la autorización, la función solo agrega el secreto de Nango). El contrato de `contracts/conectar-oauth.md` documenta el paso adicional.

## Chequeo constitucional

| Principio | Resultado | Evidencia |
|---|---|---|
| I. Aislamiento multi-tenant | Pasa | `conexiones_oauth` con `organizacion_id` obligatorio, RLS y pgTAP de aislamiento; ninguna clave de proveedor ni token pasa por el navegador. |
| II. Especificar antes de implementar | Pasa | spec, plan, research, data-model y contratos preceden al código. |
| III. Automatizaciones idempotentes y auditables | Pasa | Reautorizar reutiliza la misma fila/`connection_id` (sin duplicar); `eventos_conexion_oauth` registra actor, resultado y fecha. |
| IV. Un monorepo, despliegues independientes | Pasa | `infra/nango/compose.yaml` propio, sin Compose raíz; Supabase/Refine ya tienen su propio ciclo. |
| V. Simplicidad operativa | Pasa | Solo 3 servicios (footprint mínimo confirmado); no se agregan syncs/functions/webhooks pagos ni infraestructura sin caso de uso. |
| VI. Panel operable y extensible | Aplica en implementación | La pantalla de conexiones en Refine deberá declarar ubicación/icono, estados de carga/vacío/error y accesibilidad al construirse (spec 018). |
| VII. Documentación como parte del cambio | Pasa | Esta spec documenta el contrato de consumo en `contracts/` y actualizará `README.md`/`docs/` en la implementación. |

## Estructura

### Documentación (esta funcionalidad)

```text
specs/20260930-153545-conexiones-oauth-nango/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md         # Fase 1
├── quickstart.md         # Fase 1
├── contracts/
│   ├── conectar-oauth.md
│   └── obtener-token-oauth.md
└── tasks.md              # Fase 2 (/speckit-tasks, no este comando)
```

### Código (raíz del repositorio)

```text
infra/nango/
├── compose.yaml
└── README.md

.env.example                            # sección Nango agregada (convención ya existente, no un .env.example por producto)

supabase/migrations/<timestamp>_conexiones_oauth.sql
supabase/tests/database/conexiones_oauth.test.sql
supabase/functions/iniciar-sesion-oauth/   # Connect Session Token server-to-server (decisión 8)

apps/web/src/
├── pages/conexiones-oauth/list.tsx        # pantalla por organización (Historia 1 y 3)
├── pages/integraciones-oauth/administrar.tsx  # catálogo de plataforma (Historia 4, superadmin)
└── providers/nango/                        # wrapper mínimo de @nangohq/frontend

docs/adoptar-conexiones-oauth.md        # guía de adopción para un producto derivado
README.md                               # comando dev:nango y tabla de servicios
```

**Decisión de estructura**: no se agrega un `worker` nuevo al template — el
consumo del token es un contrato HTTP+SQL documentado que cada producto
derivado implementa en su propio backend/worker. `apps/web` gana una feature
genérica reutilizable, sin lógica de negocio de ningún conector concreto.

## Complexity Tracking

Sin violaciones constitucionales que justificar.
