# Tienda online · Contacto con formulario (F-TDA-16, MSF-437)

Épica MSF-212, spec [`specs/20261202-100000-tienda-whatsapp-y-contacto`](../specs/20261202-100000-tienda-whatsapp-y-contacto/spec.md).
El visitante abre `/contacto`, ve el WhatsApp (con horarios) y el correo de **su** tienda y envía una consulta que llega a la
bandeja de Consultas y ventas (MSF-122) de esa empresa con origen `formulario`.

## Qué hay

| Capa | Pieza |
|---|---|
| Base (`supabase/migrations/20261206100000_tienda_contacto.sql`) | columna `dominio.empresas.horarios` (≤ 200); tabla `dominio.tienda_envios`; `publico.contacto_por_dominio(host)`; `publico.enviar_consulta_contacto(host, nombre, contacto, mensaje, clave_envio)`; internas `private.visitante_hash`, `limite_envios_tienda`, `registrar_envio_tienda`, `validar_contacto_tienda`, `entregar_a_bandeja` |
| Front público | `apps/web/src/pages/tienda-publica/rutas/contacto.tsx`, `contacto/` (`DatosContacto`, `FormularioContacto`, `validacion.ts`), `lib/tiendaContacto.ts`, `hooks/useContactoTienda.ts`; «Contacto» en el menú (escritorio y celular) y «Escribinos» en el pie |
| Panel | campo «Horarios de atención» en Empresas → General (`pages/empresas/edit.tsx`) |
| Pruebas | pgTAP `supabase/tests/database/tienda_contacto.test.sql`; Vitest en `contacto/*.test.tsx`, `lib/tiendaContacto.test.ts`, `pages/empresas/edit.test.tsx`; E2E `apps/web/e2e/tienda-contacto.e2e.ts` |

## Decisiones y contratos

- **Esquemas (Principio VII)**: `dominio.tienda_envios` y `dominio.empresas.horarios` en **`dominio`**; las funciones públicas en `publico`
  (sin tablas); la lógica interna en `private`. La tabla tiene RLS por organización (solo `select` para `authenticated`) y **ningún**
  privilegio para `anon`; escribe solo `private.registrar_envio_tienda` (`security definer`).
- **Interfaz de entrada de Consultas (F-CON-01, firma real)**: `publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje,
  producto_id) → uuid` (migración `20261205100100`). `private.entregar_a_bandeja(empresa, origen, nombre, contacto, mensaje, producto)` es el
  único punto que la conoce: resuelve el dominio de la empresa en `dominio.tiendas` (orden determinista por dominio) y la invoca. Desde la migración `20261206100100` la RPC ya no es ejecutable por `anon` ni `authenticated` (solo `service_role` y el propietario), para que el único camino público sea `enviar_consulta_contacto` con su límite. Si la entrega falla, `enviar_consulta_contacto` deja un `raise warning` (sqlstate + sqlerrm) en el log del servidor y devuelve `error` genérico al cliente. Si esa firma cambia, solo cambia el adaptador.
- **Límite**: 5 envíos por hora por visitante y empresa (`private.limite_envios_tienda()`, una sola constante). Atómico con
  `pg_advisory_xact_lock` por (empresa, visitante); las filas de más de 24 h se podan en la misma función. Formulario y WhatsApp (F-TDA-14)
  comparten el cupo.
- **Idempotencia**: `unique (empresa_id, clave_envio)`; una clave repetida responde `ok` sin entregar de nuevo ni gastar cupo. El cliente genera
  una clave por intento: «Reintentar» la reutiliza, «Enviar otra» (o editar el texto tras un error) pide una nueva.
- **Visitante**: hash `sha256` de la IP del cliente (según `private.saltos_proxy_confiables()` de F-TDA-15) y la empresa; la IP nunca se
  guarda. Sin cabecera `x-forwarded-for` todos caen en un único cupo «sin-ip» (falla cerrada).
- **Falla de entrega**: `enviar_consulta_contacto` ejecuta registro + entrega en una subtransacción; si la bandeja falla se revierte el registro
  (no se gasta cupo) y el visitante ve el error genérico con «Reintentar».
- **Validación (D7)**: nombre ≤ 100; «Correo o WhatsApp» ≤ 120 con formato de correo o teléfono; mensaje ≤ 2000; todos obligatorios y recortados.
  El teléfono admite **8 a 15 dígitos** (el tope de 15 es el de la bandeja, que admite 7 a 15: así nunca rechaza lo que la tienda aceptó). Servidor
  (`private.validar_contacto_tienda`) y cliente (`contacto/validacion.ts`) son espejo; cambian juntos.
- **Respuestas**: `ok | invalido (campos) | limite (espera_segundos) | error`. `error` es idéntico para host desconocido, empresa desactivada y
  falla de entrega. Las respuestas no incluyen ids de organización, IP ni hash.
- **Texto**: todo se guarda y se muestra literal (nodos de React); un `<script>` escrito en el formulario no se interpreta.

## Reversión

Migración aditiva. Se deshace con una migración posterior que elimina, en este orden, las funciones `publico.enviar_consulta_contacto` y
`publico.contacto_por_dominio`, las `private` (`entregar_a_bandeja`, `registrar_envio_tienda`, `validar_contacto_tienda`, `visitante_hash`,
`limite_envios_tienda`), la tabla `dominio.tienda_envios` y la columna `dominio.empresas.horarios` (el detalle exacto está en el encabezado de
la migración). El código del front se revierte con `git revert -m 1` del merge de la historia.

## Contradicciones prototipo ↔ requisitos (para el PR)

1. El prototipo de **Empresas** no dibuja «Horarios de atención»; el campo se agrega por FR-014 (D2).
2. La **bajada** de «Contacto» sale del «Texto del pie de página» que la tienda ya configura (F-TDA-03); sin texto, no se muestra.
3. «Respondemos dentro de las 24 h» y el bloque «Retiro y envíos» del prototipo quedan fuera de alcance (ver matriz de la spec).
4. El menú de escritorio suma «Contacto» al final de la lista de categorías (el prototipo lo muestra en otra barra); el menú móvil lo pone después de «Inicio».

## Verificación

- `pnpm --filter @platform/web test` (Vitest + axe a 320/768/1440 px) y `pnpm test:db` (pgTAP; requiere `pnpm dev:supabase`).
- E2E: `pnpm --filter @platform/web test:e2e tienda-contacto` con el stack local (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).
- Pendiente de confirmar en DEV: que `x-forwarded-for` llega a PostgREST (si no llega, todos comparten el cupo «sin-ip»; ver
  `private.saltos_proxy_confiables()`).
