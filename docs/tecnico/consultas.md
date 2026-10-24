---
owner: tecnico
sources:
  - supabase/migrations
  - infra/kestra/flows
---

# Consultas: modelo, RPC y aviso

**Épica:** MSF-122 · **Spec:** `20261023-120000-consultas-bandeja-y-aviso` (rama
`epic/MSF-122-consultas-y-ventas-consultas-bandeja-y-a`, pendiente de merge a `main` en este repositorio).

La bandeja es un registro: el panel no responde al visitante. El alta entra solo por una RPC pública que
resuelve la empresa por el dominio de la tienda; la edición va por RPC con permisos y bloqueo optimista; el
aviso por correo se encola en la misma transacción y lo envía una Edge Function con reintentos.

## Modelo

Todo es entidad de negocio y vive en `dominio` (Principio VII). `public` solo expone la vista y las RPC del
panel; `publico` expone la RPC que llama la tienda.

| Objeto | Esquema | Para qué | Migración |
|---|---|---|---|
| `dominio.consultas` | `dominio` | Lo que preguntó un visitante a una empresa. | `20261205100000_consultas.sql` |
| `dominio.consultas_configuracion` | `dominio` | Dirección de avisos de la empresa (una fila por empresa). | `20261205200000_consultas_configuracion.sql` |
| `dominio.consultas_avisos` | `dominio` | Cola y registro del aviso por correo (estado, intentos, error útil). | `20261205200100_consultas_avisos.sql` |
| `publico.crear_consulta_publica` | `publico` | Único punto de alta; la llama la tienda como `anon`. | `20261205100100_crear_consulta_publica.sql` |
| `public.consultas_bandeja` + RPC del panel | `public` | Lectura y edición desde el panel; no guardan datos. | `20261205100200`, `20261205100300`, `20261205100500` |

Migraciones aditivas; la reversión va en una migración posterior (ver [Reversión](#reversion)). Las
migraciones `20261205200200_consultas_avisos_reintentos.sql` redefinen dos funciones del aviso, sin tablas
nuevas.

```mermaid
erDiagram
  EMPRESAS ||--o{ CONSULTAS : "recibe"
  PRODUCTOS ||--o{ CONSULTAS : "interés (opcional)"
  CONSULTAS ||--|| CONSULTAS_AVISOS : "encola"
  EMPRESAS ||--o| CONSULTAS_CONFIGURACION : "dirección de avisos"

  CONSULTAS {
    uuid id PK
    uuid organizacion_id FK
    uuid empresa_id FK "FK compuesta (empresa_id, organizacion_id)"
    text origen "formulario|whatsapp"
    text nombre
    text contacto "correo o teléfono (dato personal)"
    text mensaje "nullable; obligatorio salvo whatsapp"
    uuid producto_id FK "nullable"
    text estado "nueva|en_curso|resuelta"
    uuid responsable_id FK "nullable"
    text nota_interna "nullable"
    timestamptz created_at
    timestamptz updated_at "bloqueo optimista"
  }
  CONSULTAS_CONFIGURACION {
    uuid empresa_id PK
    uuid organizacion_id FK
    text correo_avisos "nullable: usa empresas.correo"
    timestamptz updated_at
  }
  CONSULTAS_AVISOS {
    uuid consulta_id PK
    uuid organizacion_id FK
    uuid empresa_id FK
    text estado "pendiente|enviado|fallido|sin_destinatario"
    int intentos
    text ultimo_error
    timestamptz enviado_en
    timestamptz updated_at "reserva de 2 min"
  }
```

Detalle del grafo y de las tablas existentes: [Datos y DER](datos.md).

## Permisos y RLS

- `dominio.consultas`: lectura con `organizacion_id = private.organizacion_id()`,
  `empresa_id in private.empresas_accesibles()` y `private.nivel_seccion('consultas')` en `lectura` o
  `edicion`. **Sin políticas de escritura**: el alta es solo la RPC pública y la edición solo
  `public.actualizar_consulta`.
- `dominio.consultas_configuracion`: lectura con `consultas` o `empresas` en `lectura`/`edicion`; escritura
  solo por `public.guardar_correo_avisos_consultas` con `empresas = edicion`.
- `dominio.consultas_avisos`: lectura solo con `empresas = edicion`; escritura solo desde funciones
  `security definer` y las RPC de `service_role` que usa la función de aviso.
- `anon` no tiene privilegios sobre las tablas. Ejecuta únicamente `publico.crear_consulta_publica`.

Fuente: `supabase/migrations/20261205100000_consultas.sql`, `20261205200000_consultas_configuracion.sql` y
`20261205200100_consultas_avisos.sql`. Las políticas se prueban en `supabase/tests/database/consultas.test.sql`,
`consultas_aviso.test.sql` y `rls_en_toda_tabla`.

## RPC pública

```ts
publico.crear_consulta_publica(
  host: text,
  origen: text,
  nombre: text,
  contacto: text,
  mensaje: text default null,
  producto_id: uuid default null
): uuid
```

- La empresa sale **solo del host** (`dominio.tiendas`, normalizado). No recibe `empresa_id`.
- Host desconocido, inválido o de empresa desactivada → mismo error `P0002` genérico, resuelto **antes** de
  validar los datos para no permitir sondear dominios.
- Datos inválidos → `22023` con el campo en `DETAIL`: `origen` ∈ {`formulario`, `whatsapp`}; nombre de 1 a
  120; contacto correo o teléfono (7 a 15 dígitos), hasta 200; mensaje obligatorio salvo `whatsapp`, hasta
  2000; `producto_id` de la misma organización.
- Crea la consulta en estado `nueva`, devuelve su id y encola el aviso. Ejecutable por `anon` y
  `authenticated`.
- La protección anti-spam (campo trampa, límite por IP) es de la tienda (MSF-212), no de esta RPC.

Contrato completo: `specs/20261023-120000-consultas-bandeja-y-aviso/contracts/consultas.md` (rama de la
épica).

## RPC del panel

| RPC | Contrato |
|---|---|
| `public.actualizar_consulta(p_id, p_estado, p_responsable_id, p_nota_interna, p_updated_at)` | Exige `consultas = edicion` y empresa accesible. Valida el responsable (usuario activo con acceso a la empresa y a la sección), aplica bloqueo optimista por `updated_at` (`40001`), es idempotente y registra `consulta.estado_cambiado`, `consulta.asignada` y `consulta.nota_actualizada` en `registro_actividad` solo si el valor cambió. Cambia solo estado, responsable y nota. |
| `public.contar_consultas_nuevas(p_empresa_id uuid default null)` | Contador de nuevas para el menú; respeta RLS. |
| `public.responsables_consultas(p_empresa_id uuid)` | Personas asignables a consultas de una empresa. |
| `public.consultas_bandeja` (vista `security_invoker`) | Filas de la bandeja con empresa, producto, responsable y nota; la paginación, la búsqueda y los filtros los arma el cliente sobre PostgREST. |
| `public.guardar_correo_avisos_consultas(p_empresa_id, p_correo, p_updated_at default null)` | Exige `empresas = edicion`; valida formato; `null` vuelve a usar `dominio.empresas.correo`; bloqueo optimista (`40001`); evento de actividad. |

Errores que traduce la UI: `40001` conflicto de edición, `42501` sin permiso, `22023` dato inválido. Fuente:
`apps/web/src/lib/consultas.ts` y las migraciones `20261205100200`, `20261205100300` y
`20261205100500`.

## Pantalla y empresa activa

- Menú: **Canales → Consultas** (`/consultas`, sección `consultas`), primero del grupo, con contador de
  nuevas (`apps/web/src/components/navegacion/destinosPanel.ts`, `InsigniaConsultasNuevas.tsx`).
- Lista: búsqueda, chips de estado, filtro de fecha y chips de tienda; tabla con `Estado`, `Cuándo`,
  `Empresa`, `Contacto`, `Producto` y `Origen`; pie «N consultas»; paginación de 25
  (`apps/web/src/pages/consultas/list.tsx`, `apps/web/src/lib/consultas.ts`).
- Detalle: `apps/web/src/components/consultas/DetalleConsulta.tsx`; abre por fila o por
  `/consultas?consulta=<id>`.
- **Empresa activa:** la barra superior manda. Con una empresa concreta, los chips de tienda quedan
  seleccionados y bloqueados; con «Todas mis empresas» filtran entre las accesibles. Al cambiarla se
  invalidan y recargan lista, contador y responsables, se reencuadra la paginación, se descarta la selección
  y se cierra el detalle abierto. Test: `apps/web/src/pages/consultas/list.test.tsx` y
  `apps/web/src/hooks/useConsultas.test.tsx`.

## Aviso por correo

1. Un disparador `AFTER INSERT` en `dominio.consultas` encola **un** aviso en `dominio.consultas_avisos`
   (`consulta_id` es la clave) en la misma transacción del alta
   (`20261205200100_consultas_avisos.sql`).
2. El repo prohíbe disparar HTTP desde triggers SQL (`docs/adoptar-ciclo-ejecuciones.md` §3.1): el
   disparador solo encola. El flow de Kestra `infra/kestra/flows/avisos-consultas.yml` corre cada minuto y
   llama a la Edge Function con `{"barrer": true}` y el secreto en `x-aviso-token`.
3. `supabase/functions/enviar-aviso-consulta/` toma cada aviso pendiente, resuelve el destinatario **en la
   base** (`private.correo_avisos_consulta`), arma el correo de texto plano
   (`contenido.ts`) y lo cierra con `cerrar_aviso_consulta`. La función no es un relay abierto: el
   destinatario nunca viene del pedido.
4. Destinatario efectivo: `consultas_configuracion.correo_avisos`; si es `null`, `dominio.empresas.correo`.
   Sin ninguno, el aviso queda `sin_destinatario`; si la empresa carga el correo después, el barrido lo
   retoma.
5. Estados del aviso: `pendiente` → `enviado` | `fallido` (tope de 5 intentos, reserva de 2 minutos entre
   reintentos) | `sin_destinatario`. Un fallo guarda `ultimo_error` y **nunca** afecta a la consulta. Un
   `pendiente` con el tope cumplido cuyo proceso murió se cierra como `fallido`. Un aviso `enviado` no se
   reenvía.
6. Garantía: **al menos una vez**. Si el correo salió pero la base no pudo cerrar el aviso, el reintento
   puede duplicar el correo; se prefiere eso a perderlo.

```mermaid
sequenceDiagram
  actor V as Visitante
  participant T as Tienda (MSF-212)
  participant DB as Supabase (publico.crear_consulta_publica)
  participant Q as dominio.consultas_avisos
  participant K as Kestra (avisos-consultas)
  participant F as Edge Function
  participant M as SMTP
  V->>T: envía formulario / abre WhatsApp
  T->>DB: crear_consulta_publica(host, …)
  DB->>DB: resuelve empresa por dominio y valida
  DB->>Q: encola el aviso (misma transacción)
  DB-->>T: id de la consulta
  K->>F: POST {barrer:true} cada minuto
  F->>Q: toma pendientes (reserva 2 min)
  F->>M: correo texto plano con enlace
  F->>Q: cierra enviado / fallido
```

## Operación

| Variable | Dónde | Para qué |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `supabase/functions/.env.example` | Proveedor de correo transaccional; el mismo de `solicitar-acceso`. En local, Mailpit. |
| `PANEL_URL` | `supabase/functions/.env.example` y `.env.example` | Base pública del panel para el enlace del correo. |
| `AVISOS_CONSULTAS_TOKEN` | `supabase/functions/.env.example` | Secreto compartido con Kestra; sin él la función responde 503. |
| `SECRET_AVISOS_CONSULTAS_TOKEN` (base64) y URL/clave del barrido | `infra/kestra/.env.example` | El flow los usa para llamar a la función. Solo en el `.env` de Kestra. |

Para reprocesar a mano, invocá la función con `{"barrer": true}` y el header `x-aviso-token`, o dejá que el
flow corra en el minuto siguiente. La cola y los intentos se pueden inspeccionar en
`dominio.consultas_avisos` (solo lectura con `empresas = edicion`). Qué proveedor y dominio (SPF/DKIM) es
una decisión operativa todavía abierta.

## Retención

No hay política definida para las consultas ni para los datos personales que traen (decisión abierta de la
spec). Esta entrega **no borra ni expira nada**. Cuando se defina, será una spec aparte.

## Reversión

Las migraciones son aditivas; la reversión va en una migración posterior, de la más nueva a la más vieja:

1. Aviso: `drop trigger consultas_encolar_aviso on dominio.consultas`, `drop function` de
   `public.avisos_consulta_pendientes`, `tomar_aviso_consulta`, `cerrar_aviso_consulta` y
   `private.encolar_aviso_consulta`, y `drop table dominio.consultas_avisos`. Apagar el flow de Kestra
   `avisos-consultas` y retirar la función `enviar-aviso-consulta`.
2. Dirección de avisos: `drop function public.guardar_correo_avisos_consultas` y
   `private.correo_avisos_consulta`, y `drop table dominio.consultas_configuracion`.
3. Bandeja: `drop view public.consultas_bandeja`, `drop function` de `contar_consultas_nuevas`,
   `responsables_consultas`, `actualizar_consulta`, `private.responsables_posibles` y los auxiliares de
   nombres, `drop function publico.crear_consulta_publica(text, text, text, text, text, uuid)` y, al final,
   `drop table dominio.consultas` (borra las consultas registradas: exportar antes si importan).

Para deshacer el cierre completo en Git: `git revert -m 1 <merge del PR>`.

## Verificación

- pgTAP: `supabase/tests/database/consultas.test.sql`, `consultas_aviso.test.sql` y `rls_en_toda_tabla`
  (aislamiento entre dos organizaciones, tres niveles de permiso, alta solo por RPC, validaciones, conflicto
  de edición, actividad y `anon`).
- Vitest: `apps/web/src/pages/consultas/list.test.tsx`, `components/consultas/DetalleConsulta.test.tsx`,
  `hooks/useConsultas.test.tsx`, `pages/empresas/CorreoAvisosConsultas.test.tsx`,
  `supabase/functions/enviar-aviso-consulta/handler.test.ts` e
  `infra/kestra/validar-avisos-consultas.test.mjs`.
- E2E de cierre: `apps/web/e2e/consultas-recorrido.e2e.ts` — envía una consulta como `anon`, comprueba que
  aparece en la bandeja en menos de 5 s, dispara el barrido, lee el correo en Mailpit, abre el enlace,
  asigna, anota y resuelve con los tres roles, y verifica que otra organización no la ve. Se omite sin
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y aborta si `SUPABASE_URL` no es un host local.
