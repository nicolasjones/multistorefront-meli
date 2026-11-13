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

> **Estado del código:** implementado y mergeado en `dokploy` (PR #772 de la épica, #779 con la revocación del
> consentimiento y el tope de eventos, y #800 con los hallazgos de la revisión independiente). Depende de **MSF-149** (contrato de consentimiento de cookies, `lib/consentimientoCookies.ts`) y de
> **MSF-212** (puntos de enganche de WhatsApp y contacto: [WhatsApp y contacto](tienda-whatsapp-y-contacto.md),
> que dejó los eventos para esta épica).

El modelo se resume en [Datos](datos.md#paginas-de-contenido-y-analitica-de-la-tienda-msf-164).

## Front

| Pieza | Archivo |
|---|---|
| Pestañas de la gestión (`/empresas/:id/tienda/paginas` y `/analitica`) | `apps/web/src/pages/empresas/tienda/pestanas.ts`, `pestanas/paginas.tsx`, `pestanas/analitica.tsx` |
| Acceso a datos del panel | `apps/web/src/lib/tiendaPaginas.ts`, `lib/tiendaAnalitica.ts` |
| Ruta pública `/pagina/:slug` | `apps/web/src/pages/tienda-publica/rutas/pagina.tsx`, `hooks/usePaginaTienda.ts` |
| Columna «Información» del pie | `tienda-publica/layout/PieInformacion.tsx` (montada desde `PieCategorias`), `hooks/useEnlacesPaginas.ts` |
| Medición | `apps/web/src/lib/analiticaTienda.ts`, `tienda-publica/layout/MedicionTienda.tsx` (montada en `LayoutTienda`) |
| Eventos | `rutas/producto.tsx` (`vista_producto`), `layout/BuscadorTienda.tsx` (`busqueda`), `whatsapp/DialogoWhatsApp.tsx` (`clic_whatsapp`), `contacto/FormularioContacto.tsx` (`envio_contacto`) |
| Compartir | `tienda-publica/ficha/BotonCompartir.tsx` (montado en `DatosProducto.tsx`), `lib/enlaceProducto.ts` |

**Medición.** `MedicionTienda` consulta `publico.analitica_por_dominio` una vez por visita y llama a `cargarMedicion`
solo si `debeMedir`: hay al menos un ID **y** `useConsentimientoCookies()` vale `aceptadas`. Se monta solo en el
front público (`LayoutTienda`), por lo que la vista previa del panel y una tienda pausada (`empresa.activa = false`,
que muestra «Volvemos pronto» sin pasar por el layout) nunca cargan scripts. Los scripts son
`https://www.googletagmanager.com/gtag/js?id=<ID codificado>` y `https://connect.facebook.net/en_US/fbevents.js`; los
IDs se pasan siempre como datos.

- *GA4:* `gtag('config', id, { send_page_view: false })` y cada cambio de ruta emite `page_view` a mano
  (`registrarVisita`). Con la «Medición mejorada» activa en la propiedad Google suma `page_view` e interacciones de
  formularios por su cuenta: solo se desactiva en la propiedad (Administrar → Flujos de datos → flujo web).
- *Meta Pixel:* antes de `init` se ejecuta `fbq('set','autoConfig',false,<ID>)` y `init` va con objeto vacío: sin
  coincidencia avanzada automática, sin lectura de formularios ni de clics. Los eventos usan
  `trackSingle` / `trackSingleCustom` con el ID vigente.
- *Eventos* (`registrarEventoTienda`): `vista_producto`, `busqueda`, `clic_whatsapp` y `envio_contacto`; llevan solo el
  nombre (nunca el texto buscado ni datos del visitante) y son no-op sin medición cargada. Uno que llega antes de
  que cargue la medición espera (máx. 5). `busqueda` se emite al ir a resultados (Enter o «Ver todos»), no al elegir
  una sugerencia ni al entrar directo a la URL.
- *Consentimiento vigente:* cada emisión y cada visita consultan el consentimiento actual. **Revocar apaga la
  medición** (`retirarMedicion`): `ga-disable-<ID>` y `consent update denied` en GA4, `consent revoke` en Meta; borra las
  cookies `_ga`, `_ga_<ID>`, `_gid`, `_gat*`, `_gcl_*`, `_fbp`, `_fbc` (path `/`, dominio actual y dominios padre, sin
  sufijos públicos como `com.ar` o `co.uk`); borra las claves de `localStorage` / `sessionStorage` **por proveedor** con
  regex ancladas (Google: `_ga`, `_ga_*`, `_gid`, `_gat*`, `_gcl_*`, `__gads`, `__gpi`, `__eoi`, `google_experiment_mod`;
  Meta: `_fbp`, `_fbc`, `_fbq`, `fbevents`, `fbq`; nunca la decisión de cookies ni claves de la app); quita los `<script>` y
  las globales (`dataLayer`, `gtag`, `fbq`, `_fbq`, `google_tag_manager`, `google_tag_data`). Un cambio de consentimiento
  a «aceptadas» con la página abierta carga los scripts en ese momento.
- *Recarga diferida:* los scripts ya evaluados solo se sueltan recargando. Se recarga **únicamente si es seguro**: no con
  la pestaña en segundo plano, un campo con texto, un `select` cambiado, un checkbox o radio cambiado, un
  `contenteditable`, el foco en un campo o un diálogo abierto. Si no es seguro se difiere y se reintenta al soltar el
  foco hacia algo que no es otro campo, al volver a la pestaña, al cambiar de ruta de la SPA y cada 5 s con la pestaña
  visible (se cancela al recargar). El contador `enVuelo` cuenta los scripts pedidos que no cargaron ni fallaron: al
  revocar cuentan como «en memoria». Un script que llega tarde tras revocar se deja **inerte** y se limpian sus huellas;
  uno de un ID de GA4 anterior queda con `ga-disable` y sin sus cookies sin tocar el vigente. `pixelEnMemoria` evita
  inyectar otro `fbevents.js` si se quita y se vuelve a agregar el ID de Meta. Re-aceptar con scripts viejos que no se
  pudieron recargar **no carga nada encima** (evita doble envío): la medición queda apagada hasta poder recargar.
- *Cambio de ID de GA4 en la misma visita:* se descarga el script y el `dataLayer` del ID anterior y se carga el nuevo.
- *Scripts bloqueados:* `onerror` apaga esa herramienta (borra su `dataLayer` o pila), no se reintenta en esa visita y
  no se acumulan eventos. Una falla de carga nunca se muestra.

**Compartir.** `enlaceProducto(id)` = `${window.location.origin}/producto/${id}`, sin parámetros. `BotonCompartir`
usa `navigator.share({ title, url })`; `AbortError` no avisa; cualquier otro fallo o la ausencia de la API cae a
`navigator.clipboard.writeText` con el aviso «Enlace copiado» (región `aria-live`); si eso falla muestra el campo
«Copiá este enlace» con el texto seleccionado.

## Empresa activa y permisos

Las pestañas **Páginas** y **Analítica** pertenecen a la gestión de la tienda de una empresa (`/empresas/:id/tienda/:pestana`):
al cambiar de empresa se reencuadra la lista y se descartan diálogos; **Analítica** avisa de cambios sin guardar
(`useWarnAboutChange`). Permiso: edición en Empresas. No se creó una pantalla nueva (decisión D1 de la spec). Con un nivel
que no es edición, las dos pestañas deshabilitan sus controles y avisan que es solo lectura; un rechazo `42501` de la base
muestra «Tu rol no puede editar…».

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
6. Abrir una ficha, buscar con Enter y abrir WhatsApp desde una ficha, y enviar el formulario de contacto → un evento cada uno (`vista_producto`, `busqueda`, `clic_whatsapp`, `envio_contacto`); un envío fallido no emite; elegir una sugerencia no emite `busqueda`. Luego **revocar** el consentimiento (`localStorage.setItem('tienda:consentimiento-cookies', 'rechazadas')` y el evento `tienda:consentimiento-cookies`) y repetir una acción: no sale ningún pedido nuevo, las cookies `_ga*`/`_fbp` desaparecen y la medición queda apagada.
7. Pausar la tienda (empresa desactivada) o abrir la vista previa del panel → no se cargan scripts.
8. **Compartir.** En una ficha, **Compartir**: con selector se abre con nombre y enlace; sin él, aparece «Enlace copiado»; con el portapapeles bloqueado, el campo «Copiá este enlace».

Resultado esperado: las páginas se ven solo cuando están visibles y solo en su tienda; la medición solo se carga con la tienda publicada, IDs cargados y cookies aceptadas; compartir siempre deja el enlace de la ficha al alcance del visitante.

### Cómo automatizarlo

| Rótulo | Archivo |
|---|---|
| `[MSF-306:T009]` | `apps/web/e2e/tienda-paginas.e2e.ts` |
| `[MSF-315:T028]` | `apps/web/e2e/tienda-analitica.e2e.ts` |
| `[MSF-325:T045]` | `apps/web/e2e/tienda-compartir.e2e.ts` |

Vitest + axe: `pages/empresas/tienda/paginas.test.tsx`, `analitica.test.tsx`, `rutas/pagina.test.tsx`, `layout/PieInformacion.test.tsx`, `layout/MedicionTienda.test.tsx`, `lib/analiticaTienda.test.ts`, `ficha/BotonCompartir.test.tsx`, `lib/enlaceProducto.test.ts`.

## Seguridad y límites

- **Lecturas públicas.** `publico.paginas_por_dominio`, `publico.pagina_por_dominio` y `publico.analitica_por_dominio` las
  llama el navegador directo a Supabase (PostgREST): **no pasan por el nginx de la tienda**, así que su límite de
  frecuencia y su caché dependen de PostgREST y del proxy delante de Supabase, no de este repositorio. Lo que acota el
  daño es la lista blanca de campos y el tope de páginas.
- **Tope de páginas.** `public.guardar_pagina_tienda` rechaza la página 51 de una empresa con `22023` («La empresa ya tiene
  el máximo de 50 páginas…», migración `20270218400000`); editar no se bloquea. El pie también acota a 50 enlaces.
- **CSP.** `apps/web/nginx.conf` envía `Content-Security-Policy-Report-Only` en `location /` (mismo `index.html` que el
  panel) con `self`, `googletagmanager.com`, `google-analytics.com`, `connect.facebook.net`, `facebook.com`, el origen de
  Supabase e imágenes `https:`. Está en **modo solo reporte** porque sin un navegador real no se puede garantizar que el
  panel (embebidos de Superset, fuentes) no se rompa. **Sin `report-uri`**: el endpoint de seguridad de GlitchTip lleva una
  clave por proyecto y entorno y habría que inyectarla al construir la imagen (`ARG` en `apps/web/Dockerfile` y marcador en
  `nginx.conf`); queda como seguimiento pendiente para conectar GlitchTip. `index.html` no tiene scripts inline. Plan de
  endurecimiento: revisar a mano la consola de un navegador real en tienda y panel durante un ciclo de uso, sumar al
  allowlist lo legítimo y pasar el mismo valor a `Content-Security-Policy`.
- **Meta Pixel.** `fbq('set','autoConfig',false,<ID>)` antes de `init` y `init(<ID>, {})`: sin coincidencia avanzada ni
  lectura de formularios o clics.
- **GA4.** La «Medición mejorada» de la propiedad suma `page_view` e interacciones de formularios por su cuenta y duplica
  visitas: se desactiva en la propiedad de GA4, no desde la tienda (lo avisa la pestaña «Analítica»).
