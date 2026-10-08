# Contract: Edge Function `emitir-acceso-reporte`

**Quién la llama**: Refine, desde `ReporteEmbebido.tsx`, para cualquier
persona autenticada que abre un reporte de la sección Analítica.

## Request

```http
POST /functions/v1/emitir-acceso-reporte
Authorization: Bearer <JWT del usuario>
Content-Type: application/json

{ "reporte_id": "<uuid>" }
```

## Autorización (FR-010)

La función NO usa la service-role para decidir si quien llama puede ver el
reporte. En su lugar:

1. Valida el JWT del header `Authorization` (mismo patrón que
   `crear-organizacion`: `admin.auth.getUser(jwt)` con un cliente
   service-role solo para esa validación, no para leer datos de negocio).
2. Arma un segundo cliente de Supabase autenticado **como ese usuario**
   (su JWT, no la service-role) y llama a la RPC `resolver_organizacion_reporte`:
   ```ts
   const { data: organizacionId } = await asUser.rpc('resolver_organizacion_reporte', {
     p_reporte_id: reporte_id,
   })
   ```
3. Si `organizacionId` viene `null` → `403`. La RPC (`security definer`,
   ver `data-model.md`) usa `private.organizacion_id()` +
   `private.puede_ver_asignacion()` — **no** es un
   `select ... from reportes_organizaciones limit 1`: esa forma se probó
   y tenía dos bugs reales, encontrados por el usuario probando la app (no
   por el guion del quickstart):
   - Con el mismo reporte asignado a dos organizaciones, la RLS vieja de
     `reportes_organizaciones` dejaba ver la fila de la organización
     ajena (bug de aislamiento, corregido en la RLS — ver
     `data-model.md`, `private.puede_ver_asignacion`).
   - Un superadmin bypassa esa RLS por completo (`is_superadmin() or
     ...`), así que un `limit 1` ahí agarraba cualquier fila sin importar
     a qué organización había entrado — la RPC usa
     `private.organizacion_id()`, que sí resuelve bien ese caso.
4. `organizacionId` es la que se usa para la cláusula `rls` del guest
   token — nunca un valor que mande el cliente en el body.

## Comportamiento (autorizado)

1. Busca `reportes.superset_dashboard_uuid` para `reporte_id` (con el
   mismo cliente `asUser` — la policy de `reportes` ya lo permite si llegó
   hasta acá).
2. `POST {SUPERSET_URL}/api/v1/security/login` con las credenciales de la
   cuenta de servicio (`SUPERSET_GUEST_TOKEN_USERNAME/PASSWORD`,
   secretos de la función, research.md #3) → `access_token`.
3. `POST {SUPERSET_URL}/api/v1/security/guest_token/` con ese
   `access_token`, pidiendo:
   ```json
   {
     "resources": [{ "type": "dashboard", "id": "<superset_dashboard_uuid>" }],
     "rls": [{ "clause": "organizacion_id = '<organizacion_id>'" }],
     "user": { "username": "guest" }
   }
   ```
4. Devuelve el `guest_token` recibido, junto con `SUPERSET_PUBLIC_URL` (no
   `SUPERSET_URL`) y el `superset_dashboard_uuid`, para que el frontend
   monte el SDK.

**`SUPERSET_URL` vs. `SUPERSET_PUBLIC_URL`** (encontrado en quickstart.md,
sección 2, T023): esta función corre en el contenedor de Edge Functions y
le habla a Superset por su URL interna (`SUPERSET_URL` — en local, el
nombre del contenedor Docker). Esa URL no la puede resolver el navegador
de quien mira el reporte, que es quien recibe `superset_url` en la
response para que el SDK monte el iframe ahí — necesita la URL pública
(`SUPERSET_PUBLIC_URL`, en local `http://localhost:8088`). Son casi nunca
la misma.

## Response

**200** (autorizado y Superset respondió):
```json
{ "guest_token": "...", "superset_url": "<SUPERSET_PUBLIC_URL>", "dashboard_uuid": "..." }
```

**403** (no autorizado — organización/rol sin acceso a ese reporte, o
`reporte_id` inexistente): sin cuerpo con información del reporte, solo
`{ "error": "No autorizado" }` — no revela si el reporte existe (FR-007,
Acceptance Scenario 4 de la spec: "sin revelar ningún dato del reporte").

**503** (Superset no respondió a alguno de los dos `POST`, o se agotó el
timeout — FR-015): `{ "error": "analitica_no_disponible" }`. El frontend
mapea este código puntual al mensaje específico de no disponibilidad; no
se reintenta automáticamente (Clarifications).

## Permisos

Sin `grant` de PostgREST — es una Edge Function, se invoca por HTTP, no
por `supabase.rpc(...)`. El `Authorization` header con el JWT del usuario
es lo único que la autoriza; sin la service-role, esta función no puede
leer ni escribir nada que la RLS del usuario no le deje ver.
