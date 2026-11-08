---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - supabase/tests/database
  - apps/web/src
---

# Tienda pública: contenido, analítica y compartir (MSF-164)

Épica **MSF-164** — Tiendas online · Tienda contenido y analítica. Spec:
`specs/20270210-100000-tienda-contenido-y-analitica/` (`spec.md`, `plan.md`, `tasks.md` y contrato en
`contracts/tienda-contenido-analitica.md`). Historias: **F-TDA-23** páginas de contenido (`MSF-306`, commits
`0c3e2ed9` y `86e52a22`), **F-TDA-24** analítica de visitas (`MSF-315`, commit `d878f86f`, que cierra la épica) y
**F-TDA-25** compartir producto (`MSF-325`, commit `87f9eb03`).
Resumen para quien administra la tienda: [Páginas propias, medición de visitas y botón Compartir](../producto/tienda-contenido-y-analitica.md).

> **Estado del código:** la implementación vive en la rama `epic/MSF-164-tiendas-online-tienda-contenido-y-analit`
> (tip `232d1cab`) y no está en `main` al escribir esta página. Las rutas y migraciones se verificaron contra esa
> rama. Depende de **MSF-149** (contrato de consentimiento de cookies, `lib/consentimientoCookies.ts`) y de
> **MSF-212** (puntos de enganche de WhatsApp y contacto: [WhatsApp y contacto](tienda-whatsapp-y-contacto.md),
> que dejó los eventos para esta épica).

## Alcance de entrega

`refine` (front público y pestañas de la gestión de la tienda) y `supabase` (migraciones aditivas, funciones de
`publico` y pgTAP). Sin `kestra`, `superset`, `workers`, Edge Function ni `openapi/`. F-TDA-25 no toca la base.

## Datos (esquema `dominio`, Principio VII)

| Historia | Migración | Contenido | Reversión (migración posterior) |
|---|---|---|---|
| F-TDA-23 | `supabase/migrations/20270212200001_tienda_paginas.sql` | tabla `dominio.tienda_paginas` + RLS (solo `select` a `authenticated`, sin privilegios a `anon`); `private.slug_pagina_tienda`, `private.normalizar_tienda_pagina`; `public.guardar_pagina_tienda`, `public.eliminar_pagina_tienda`; `publico.paginas_por_dominio`, `publico.pagina_por_dominio` | `drop function` de las funciones y `drop table dominio.tienda_paginas` (cabecera del archivo) |
| F-TDA-24 | `supabase/migrations/20270212200002_tienda_analitica.sql` | tabla `dominio.tienda_analitica` (una fila por empresa) + RLS; `public.guardar_analitica_tienda`; `publico.analitica_por_dominio` | `drop function` de las funciones y `drop table dominio.tienda_analitica` (cabecera del archivo) |

Reglas comunes: la escritura es **solo por RPC** `SECURITY DEFINER` que exige `private.nivel_seccion('empresas') = 'edicion'`
y empresa de la organización; `revoke … from public, anon` + `grant execute … to authenticated`. Las funciones de
`publico` devuelven lista blanca (nunca `organizacion_id`) y `null` idéntico para host desconocido y empresa
desactivada. Detalle de firmas: `specs/20270210-100000-tienda-contenido-y-analitica/contracts/tienda-contenido-analitica.md`.

Restricciones relevantes (migraciones citadas):

- `tienda_paginas`: `unique (empresa_id, slug)`; título 1–80, contenido ≤ 10 000, `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`; `visible` por defecto `false`. El `slug` se genera al crear (con sufijo `-n` si choca) y no cambia al editar. El `hint` del error nombra el campo (`titulo`, `contenido`, `pagina`).
- `tienda_analitica`: `ga4_id ~ '^G-[A-Z0-9]{4,20}$'`, `meta_pixel_id ~ '^[0-9]{8,20}$'`. Se guardan en mayúsculas/recortados y el vacío significa «quitar» (`null`). Son identificadores públicos, no secretos.
- Texto plano: se guarda literal; el front lo escapa siempre.

El modelo se resume en [Datos](datos.md#paginas-de-contenido-y-analitica-de-la-tienda-msf-164).

## Front

| Pieza | Archivo |
|---|---|
| Pestañas de la gestión (`/empresas/:id/tienda/paginas` y `/analitica`) | `apps/web/src/pages/empresas/tienda/pestanas.ts`, `pestanas/paginas.tsx`, `pestanas/analitica.tsx` |
| Acceso a datos del panel | `apps/web/src/lib/tiendaPaginas.ts`, `lib/tiendaAnalitica.ts` |
| Ruta pública `/pagina/:slug` | `apps/web/src/pages/tienda-publica/rutas/pagina.tsx`, `hooks/usePaginaTienda.ts` |
| Columna «Información» del pie | `tienda-publica/layout/PieInformacion.tsx` (montada desde `PieCategorias`), `hooks/useEnlacesPaginas.ts` |
| Medición | `apps/web/src/lib/analiticaTienda.ts`, `tienda-publica/layout/MedicionTienda.tsx` (montada en `LayoutTienda`) |
| Eventos | `whatsapp/DialogoWhatsApp.tsx` (`clic_whatsapp`), `contacto/FormularioContacto.tsx` (`envio_contacto`) |
| Compartir | `tienda-publica/ficha/BotonCompartir.tsx` (montado en `DatosProducto.tsx`), `lib/enlaceProducto.ts` |

**Medición.** `MedicionTienda` consulta `publico.analitica_por_dominio` una vez por visita y llama a `cargarMedicion`
solo si `debeMedir`: hay al menos un ID **y** `useConsentimientoCookies()` vale `aceptadas`. Se monta solo en el
front público, por lo que la vista previa del panel y una tienda desactivada nunca cargan scripts. Los scripts son
`https://www.googletagmanager.com/gtag/js?id=<ID codificado>` y `https://connect.facebook.net/en_US/fbevents.js`; los
IDs se pasan siempre como datos. GA4 se configura con `send_page_view: false` y cada cambio de ruta emite
`page_view` a mano (`registrarVisita`) para no duplicar. Una falla de carga se traga. Los eventos
(`registrarEventoTienda`) llevan solo el nombre y son no-op sin medición cargada. Un cambio de consentimiento con la
página abierta carga los scripts en ese momento.

**Compartir.** `enlaceProducto(id)` = `${window.location.origin}/producto/${id}`, sin parámetros. `BotonCompartir`
usa `navigator.share({ title, url })`; `AbortError` no avisa; cualquier otro fallo o la ausencia de la API cae a
`navigator.clipboard.writeText` con el aviso «Enlace copiado» (región `aria-live`); si eso falla muestra el campo
«Copiá este enlace» con el texto seleccionado.

## Empresa activa y permisos

Las pestañas **Páginas** y **Analítica** pertenecen a la gestión de la tienda de una empresa (`/empresas/:id/tienda/:pestana`):
al cambiar de empresa se reencuadra la lista y se descartan diálogos; **Analítica** avisa de cambios sin guardar
(`useWarnAboutChange`). Permiso: edición en Empresas. No se creó una pantalla nueva (decisión D1 de la spec).

## Fuera de alcance / pendiente

- HTML o texto con formato en las páginas; otras herramientas de medición; integrar páginas y analítica al borrador/versiones (decisiones D2, D3, D5 de la spec).
- La cláusula «con un enlace o por WhatsApp» de F-TDA-25 se implementó solo como copiar enlace o selector del sistema (ver «A revisar» de la épica).
- **TODO (dueño: documentación de producto):** capturas de las pantallas nuevas; el código no está en `main`, por lo que `pnpm docs:capturas` no puede generarlas desde esta rama.
- **TODO (dueño: producto/diseño):** la épica no tiene pantallas en el prototipo; el aspecto es el del sistema de diseño y quedó anotado en el PR.
- Al mergear la épica, actualizar a mano la fila de MSF-164 en `docs/roadmap-template.md`.

## Guía de prueba (rótulos `[MSF-xxx:T0yy]`)

### Base de datos (pgTAP)

`pnpm dev:supabase` corriendo y `pnpm test`:

- `supabase/tests/database/tienda_paginas.test.sql`: RLS, checks, permisos, empresa ajena, slug único y estable, HTML literal, solo visibles, `null` idéntico, lista blanca y sin `grant` a `anon` (T004).
- `supabase/tests/database/tienda_analitica.test.sql`: RLS, formatos, permisos, vaciar, `null` idéntico (pausada/desconocida/inválida), lista blanca, aislamiento (T023).
- Prueba manual SQL: con una sesión `anon`, `select publico.pagina_por_dominio('<host>', '<slug-oculto>')` devuelve `null`; `select * from dominio.tienda_paginas` falla por falta de privilegios.

### A mano (entorno DEV o local con el seed de dos tiendas)

Prerrequisitos: usuario con edición en Empresas; las dos tiendas del seed con dominio.

1. **Páginas.** En `/empresas/<id>/tienda/paginas` crear «Cómo comprar» con el interruptor apagado → figura **Oculta**; en la tienda, `/pagina/como-comprar` muestra 404 y el pie no tiene «Información».
2. Prender **Visible en la tienda** y guardar → el pie muestra «Información» con el enlace y la página muestra el texto en párrafos; la otra tienda no la ve.
3. Eliminar la página (diálogo de confirmación) → `/pagina/como-comprar` vuelve a dar 404.
4. **Analítica.** En `/empresas/<id>/tienda/analitica` guardar `G-TEST12345` y un píxel de 10 dígitos; un ID inválido muestra el error bajo el campo.
5. En la tienda publicada, sin aceptar cookies: la pestaña de red no muestra pedidos a `googletagmanager.com` ni `facebook.net`. Aceptar → se cargan con los IDs de **esa** tienda; navegar emite una visita.
6. Abrir WhatsApp desde una ficha y enviar el formulario de contacto → un evento cada uno (`clic_whatsapp`, `envio_contacto`); un envío fallido no emite.
7. Pausar la tienda o abrir la vista previa del panel → no se cargan scripts.
8. **Compartir.** En una ficha, **Compartir**: con selector se abre con nombre y enlace; sin él, aparece «Enlace copiado»; con el portapapeles bloqueado, el campo «Copiá este enlace».

Resultado esperado: las páginas se ven solo cuando están visibles y solo en su tienda; la medición solo se carga con la tienda publicada, IDs cargados y cookies aceptadas; compartir siempre deja el enlace de la ficha al alcance del visitante.

### Cómo automatizarlo

| Rótulo | Archivo |
|---|---|
| `[MSF-306:T009]` | `apps/web/e2e/tienda-paginas.e2e.ts` |
| `[MSF-315:T028]` | `apps/web/e2e/tienda-analitica.e2e.ts` |
| `[MSF-325:T045]` | `apps/web/e2e/tienda-compartir.e2e.ts` |

Vitest + axe: `pages/empresas/tienda/paginas.test.tsx`, `analitica.test.tsx`, `rutas/pagina.test.tsx`, `layout/PieInformacion.test.tsx`, `layout/MedicionTienda.test.tsx`, `lib/analiticaTienda.test.ts`, `ficha/BotonCompartir.test.tsx`, `lib/enlaceProducto.test.ts`.
