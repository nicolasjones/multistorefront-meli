---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src/main.tsx
  - apps/web/src/lib/tienda.ts
  - apps/web/src/lib/tiendaIdentidad.ts
  - apps/web/src/lib/tiendaContenido.ts
  - apps/web/src/lib/tiendaCatalogo.ts
  - apps/web/src/hooks/useCatalogoTienda.ts
  - apps/web/src/pages/empresas/tienda
  - apps/web/src/pages/tienda-publica
---

# Tienda online: dominio, identidad y catálogo visible (MSF-147)

Spec: `specs/20261022-084830-tienda-dominio-e-identidad/spec.md` · plan y tareas en la misma carpeta.
Épica **MSF-147** (F-TDA-01 a F-TDA-04), merge `f52758d` (PR #260), rama de la épica pendiente de merge a
`main`. Depende de MSF-160 (`dominio.categorias` y `producto_empresa`) y de MSF-435 (temas del sistema de
diseño). Resumen de producto y límites: [Tienda online: dominio, identidad y vidriera](../producto/tienda-dominio-e-identidad.md).

## Alcance de entrega

- **`supabase`:** cuatro migraciones **aditivas** con sus tablas, RLS, RPC de escritura, funciones de
  lectura anónima, bucket y pgTAP. `publico` es un esquema **solo de funciones** (sin tablas).
- **`refine`:** gestión de la tienda dentro de Empresas y front público mínimo en `apps/web`.
- **Sin** `kestra`, `superset`, `workers` ni Compose nuevo.

| Historia | Issue | Migración | Contenido | Reversión |
|---|---|---|---|---|
| F-TDA-01 | MSF-241 | `20261023100000_tiendas_dominio.sql` | Esquema `publico`, `dominio.tiendas`, `private.normalizar_host`, `publico.tienda_por_dominio`, auditoría y seed | `drop function publico.tienda_por_dominio(text)`, `drop table dominio.tiendas`, `drop function private.normalizar_host(text)`, `drop schema publico` |
| F-TDA-02 | MSF-266 | `20261023100100_tienda_identidad.sql` | `dominio.tienda_identidad`, bucket `tienda-identidad` y políticas, `public.guardar_tienda_identidad`, `publico.identidad_por_dominio` | `drop` de las dos funciones, las tres políticas, la fila del bucket (vaciarlo antes), la tabla y el esquema |
| F-TDA-03 | MSF-294 | `20261023100200_tienda_contenido.sql` | `dominio.tienda_contenido`, `public.guardar_tienda_contenido`, `publico.contenido_por_dominio` | `drop` de las dos funciones, el trigger, la función de normalización y la tabla |
| F-TDA-04 | MSF-312 | `20261023100300_tienda_catalogo_visible.sql` | `dominio.categorias_tienda`, `dominio.productos_tienda`, `private.catalogo_tienda_efectivo`, `public.listar_catalogo_tienda`, `public.guardar_catalogo_tienda`, `publico.catalogo_visible_por_dominio` | `drop` de las funciones y las dos tablas |

Cada migración trae su reversión en el encabezado. Los dominios de prueba del seed son
`mundojc.localhost` y `sanjavucho.localhost` (`supabase/seed.sql`, solo local).

## Modelo de datos

Cinco tablas nuevas en `dominio`, más el bucket y las funciones de `publico`. El DER completo (con leyenda
y Mermaid) está en [Datos y DER](datos.md#modelo-de-la-tienda-msf-147).

| Tabla | Clave / reglas principales |
|---|---|
| `dominio.tiendas` | `id` PK; `empresa_id` **único**; `dominio` **único**, normalizado por trigger y validado con un check DNS; FK compuesta `(empresa_id, organizacion_id)` a `dominio.empresas`. |
| `dominio.tienda_identidad` | `empresa_id` PK; cuatro colores con check `#RRGGBB`, dos tipografías de la lista cerrada de DS-04, rutas de logo/banner/banner móvil dentro de `<organizacion_id>/<empresa_id>/…`; FK compuesta a Empresas. |
| `dominio.tienda_contenido` | `empresa_id` PK; ocho textos recortados por trigger, con límites (120/300) y `boton_destino` en lista cerrada (`catalogo`); FK compuesta a Empresas. |
| `dominio.categorias_tienda` | PK `(empresa_id, categoria_id)`; `visible` default `true`; FK compuesta a Empresas y a `dominio.categorias` (MSF-160). Sin fila = visible. |
| `dominio.productos_tienda` | PK `(empresa_id, producto_id)`; `visible` default `true`, `destacado` default `false`; FK compuesta a Empresas y a `dominio.productos`. Sin fila = visible y no destacado. |
| Bucket `tienda-identidad` | Lectura pública; escritura solo `authenticated` con edición en Empresas y bajo la carpeta de su organización; 3 MB y tipos PNG/SVG/JPEG/WebP. |

- Un producto pertenece a la tienda por `dominio.producto_empresa` (F-CAT-07), no por una tabla nueva.
- Las rutas de los archivos nunca salen de la carpeta de la empresa (checks de la tabla y de la RPC).
- La tabla de identidad y la de contenido son opcionales: sin fila, la tienda usa el tema base y no
  muestra textos opcionales.

## Permisos y RLS

- Las cinco tablas tienen **RLS** por organización. La lectura exige
  `organizacion_id = private.organizacion_id()` y `private.nivel_seccion('empresas')` en `lectura` o
  `edicion`. No hay políticas de escritura ni grants de `insert`/`update`/`delete`: **solo escriben las
  RPC** `security definer`.
- Las RPC de escritura verifican sesión, pertenencia de la empresa a la organización y
  `private.nivel_seccion('empresas') = 'edicion'`; hacen `revoke … from public, anon` y
  `grant execute … to authenticated`.
- `anon` ejecuta **solo** funciones de `publico`; no tiene privilegios sobre `public`, `dominio` ni
  `private`. `publico` no contiene tablas: lo verifica el pgTAP.
- Las funciones de `publico` son `security definer`, `stable`, `search_path = ''`, normalizan el `host` con
  `private.normalizar_host`, filtran por `dominio.empresas.activa` y devuelven una lista blanca de campos.
  Dominio desconocido, host inválido y empresa desactivada devuelven la **misma** respuesta vacía o
  `null` (anti-enumeración).

## Contratos públicos (esquema `publico`)

| Función | Devuelve | Notas |
|---|---|---|
| `publico.tienda_por_dominio(host text)` | Tabla `(tienda_id uuid, empresa_nombre text, estado text)` | `estado` es `publicada` cuando hay fila; dominio desconocido o empresa inactiva devuelven **cero filas**. Nunca devuelve `organizacion_id`. |
| `publico.identidad_por_dominio(host text)` | Tabla con los cuatro colores, las dos tipografías y las rutas de logo/banner/banner móvil | Sin fila de identidad devuelve los valores del tema base (`coalesce`). Cero filas para dominio desconocido o empresa inactiva. |
| `publico.contenido_por_dominio(host text)` | Tabla con los ocho textos y `boton_destino` | Sin fila de contenido devuelve todo vacío (y `catalogo` como destino). Cero filas para dominio desconocido o empresa inactiva. |
| `publico.catalogo_visible_por_dominio(host text)` | `jsonb` `{ categorias: [{ id, nombre, padre_id }], productos: [{ id, nombre, moneda, precio, tiene_imagen, categoria_id, destacado }] }` o `null` | Productos **efectivamente visibles** y destacados primero. No devuelve costos, stock, proveedor ni `organizacion_id`; la imagen se informa como booleano porque la ruta contiene el id de la organización. |

Todas hacen `revoke execute … from public` y `grant execute … to anon, authenticated`.

## Contratos de escritura (esquema `public`, solo `authenticated`)

| RPC | Devuelve | Errores / reglas |
|---|---|---|
| `public.guardar_tienda_identidad(p_empresa_id, p_color_primario, p_color_primario_oscuro, p_color_acento, p_color_fondo, p_tipografia_titulos, p_tipografia_texto, p_logo_ruta, p_banner_ruta, p_banner_movil_ruta)` | La fila de `dominio.tienda_identidad` | `42501` sin edición en Empresas; `P0002` empresa inexistente; `22023` color/tipografía/rutas inválidas. Idempotente; bloquea la empresa para serializar guardados; emite `tienda.identidad_actualizada` solo si algo cambió. |
| `public.guardar_tienda_contenido(p_empresa_id, p_titulo, p_subtitulo, p_texto_boton, p_boton_destino, p_bienvenida, p_pie, p_aviso_ficha, p_texto_boton_contacto)` | La fila de `dominio.tienda_contenido` | `42501` sin edición o empresa ajena; `22023` con `hint` del campo si supera el límite o el destino no está en la lista. Recorta espacios; idempotente; emite `tienda.contenido_actualizado` solo ante cambios reales. |
| `public.listar_catalogo_tienda(p_empresa uuid)` | `jsonb` `{ categorias, productos, resumen: { visibles, destacados } }` | `42501` sin lectura/edición en Empresas; `P0002` empresa inexistente. La visibilidad efectiva, el motivo y el resumen salen del servidor. |
| `public.guardar_catalogo_tienda(p_empresa uuid, p_categorias jsonb, p_productos jsonb)` | `jsonb` `{ visibles, destacados }` | `42501` sin edición; `P0002` empresa inexistente; `22023` formato, valores vacíos, ids repetidos o elementos ajenos. Aplica solo la diferencia en una transacción, con lock asesor por empresa; emite `tienda.catalogo_actualizado` solo si hubo cambios. |

`private.catalogo_tienda_efectivo(empresa)` es la única definición de la visibilidad efectiva y la usan la
gestión, el resumen y la función pública. No tiene `execute` para roles de API.

## Reglas de implementación

- **Visibilidad efectiva:** producto activo, `productos_tienda.visible` verdadero y su categoría (y la
  padre, si es subcategoría) visibles en `categorias_tienda`. Sin categoría, depende solo de su estado y
  de `visible`. El motivo de «no se muestra» también se calcula en el servidor.
- **Fragmento de escritura:** `guardar_catalogo_tienda` borra la fila cuando el valor vuelve al
  predeterminado (visible y no destacado) e inserta/actualiza el resto; repetir la llamada no cambia nada
  ni duplica la auditoría.
- **Identidad:** la RPC valida formato y lista cerrada; el front valida antes de subir para avisar sin ir
  a la red. «Guardar» sube primero los archivos nuevos, llama a la RPC y, si todo va bien, borra los
  archivos que quedaron sin uso. Si la subida o la RPC fallan, se conserva la imagen anterior y se limpia
  lo recién subido (mejor esfuerzo).
- **Contenido:** todos los textos se recortan y se guardan como texto plano; React los escapa. Un campo
  vacío oculta su elemento. La longitud se cuenta en puntos de código (un emoji vale 1), igual que
  `char_length` en la base.
- **Auditoría:** `tienda.dominio_configurado` (trigger al crear o cambiar el dominio),
  `tienda.identidad_actualizada`, `tienda.contenido_actualizado` y `tienda.catalogo_actualizado` en
  `public.registro_actividad`, con empresa, actor y una descripción; nunca ids ni valores.

## Frontend

| Ruta / pieza | Archivos |
|---|---|
| Gestión `/empresas/:id/tienda/:pestaña` (`identidad`, `contenido`, `catalogo`) | `apps/web/src/pages/empresas/tienda/GestionTienda.tsx`, `EncabezadoTienda.tsx`, `pestanas.ts` |
| Pestañas (carga diferida por `import.meta.glob`) | `pestanas/identidad.tsx`, `pestanas/contenido.tsx`, `pestanas/catalogo.tsx` |
| Identidad: logo/banners, colores y contraste | `componentes/imagen-tienda/ImagenTienda.tsx`, `componentes/identidad/CamposDeIdentidad.tsx`, `apps/web/src/lib/tiendaIdentidad.ts` |
| Contenido: límites y cliente de la RPC | `apps/web/src/lib/tiendaContenido.ts` |
| Catálogo: borrador, resumen y RPC | `apps/web/src/lib/tiendaCatalogo.ts`, `apps/web/src/hooks/useCatalogoTienda.ts` |
| Entrada pública por `Host` | `apps/web/src/main.tsx`, `apps/web/src/lib/tienda.ts`, `pages/tienda-publica/index.tsx` |
| Home pública y secciones | `pages/tienda-publica/PaginaTienda.tsx`; `secciones/TemaTienda.tsx` (orden 10), `BannerHome.tsx` (20), `BarraBienvenida.tsx` (10), `PieTienda.tsx` (900) |
| «Volvemos pronto» y error con reintento | `pages/tienda-publica/VolvemosPronto.tsx`, `ErrorConReintento.tsx` |

- **Empresa activa:** `GestionTienda` opera sobre la empresa activa de la barra superior. Si se entra por
  URL a la tienda de otra empresa accesible, la primera resolución la vuelve activa; después, una activa
  nula es la elección explícita «Todas mis empresas» y la pantalla pide elegir una. Al cambiar se
  recargan las consultas, se avisa si hay cambios sin guardar y no se muestran datos de la anterior. La
  pestaña de catálogo cierra el diálogo de destacado y limpia la búsqueda al cambiar de empresa.
- **Acceso:** sin `edicion` en Empresas se muestra el patrón de acceso restringido y no se accede por URL.
- **Front público:** `main.tsx` decide por `Host` si sirve la tienda o el panel (`VITE_PANEL_HOSTS`); la
  entrada resuelve la tienda con `publico.tienda_por_dominio` sin sesión. Un error de red **no** se
  disfraza de «Volvemos pronto»: muestra reintento.
- **Catálogo y ficha:** las rutas de MSF-167 se suman a `PaginaTienda`/`EnrutadorTienda` por archivo; no
  son de esta épica y consumen otras funciones de `publico`.

## Operación

- **PostgREST:** `publico` debe estar expuesto. En local lo fija `supabase/config.toml`
  (`schemas = ["public", "graphql_public", "dominio", "publico"]`); en self-hosted, `PGRST_DB_SCHEMAS` /
  `SUPABASE_API_SCHEMAS` (`SUPABASE_API_SCHEMAS=public,graphql_public,dominio,publico` en `.env.example`).
  Sin eso, las rutas públicas no resuelven la tienda.
- **Hosts:** `VITE_PANEL_HOSTS` debe listar todos los hosts del panel de cada entorno; cualquier otro host
  se sirve como tienda. Sin la variable en producción, ningún host se enruta como tienda (falla segura).
- **Dominios:** se configuran por SQL/operación en `dominio.tiendas`; no hay RPC de alta ni pantalla. Los
  cambios de dominio quedan auditados por trigger.
- **Bucket:** `tienda-identidad` es de **lectura pública** (las imágenes se muestran sin sesión) y de
  escritura acotada a la carpeta de la organización/empresa. Si se revierte la épica, exportar los
  archivos antes de borrar el bucket.
- **Migraciones:** aplicar en orden (`100000`, `100100`, `100200`, `100300`). Son aditivas; la reversión
  está en el encabezado de cada archivo.

## Verificación

| Qué | Archivos |
|---|---|
| pgTAP de dominio, aislamiento, `anon` y auditoría | `supabase/tests/database/tienda_dominio.test.sql` |
| pgTAP de identidad, bucket, validaciones e idempotencia | `supabase/tests/database/tienda_identidad.test.sql` |
| pgTAP de contenido, límites, destino y auditoría | `supabase/tests/database/tienda_contenido.test.sql` |
| pgTAP de catálogo visible, visibilidad efectiva y resumen | `supabase/tests/database/tienda_catalogo.test.sql` |
| Vitest + axe de gestión, empresa activa y acceso | `apps/web/src/pages/empresas/tienda/GestionTienda.test.tsx` |
| Vitest de identidad y contrato de dominio | `apps/web/src/pages/empresas/tienda/IdentidadTienda.test.tsx`, `apps/web/src/lib/tienda.test.ts`, `apps/web/src/lib/tiendaIdentidad.test.ts` |
| Vitest de contenido | `apps/web/src/pages/empresas/tienda/contenido.test.tsx`, `apps/web/src/lib/tiendaContenido.test.ts` |
| Vitest de catálogo visible | `apps/web/src/pages/empresas/tienda/catalogo.test.tsx` |
| Vitest del front público (tema y textos) | `apps/web/src/pages/tienda-publica/index.test.tsx`, `TemaTienda.test.tsx`, `PaginaTienda.test.tsx`, `seccionesContenido.test.tsx` |
| E2E con los dos dominios del seed | `apps/web/e2e/tienda-dos-dominios.e2e.ts` |

```bash
pnpm dev:supabase
pnpm --filter @platform/web test
pnpm --filter @platform/web test:e2e tienda-dos-dominios
```

## Decisiones y supuestos

| Decisión | Supuesto adoptado | Si cambia |
|---|---|---|
| **D1** dominios/DNS | Dominios de prueba en el seed; los reales los carga el equipo técnico | SQL/operación sobre `dominio.tiendas`; no hay código de dominio |
| **D2** precio y destacados por tienda | Destacados por tienda; precio por producto/empresa, sin edición por tienda | Agregar columna y RPC; hoy no existe |
| **D3** quién gestiona | Administrador con edición en Empresas; el Operador no ve Empresas | Dar edición acotada al Operador |
| **D4** destinos del botón | Lista cerrada con `catalogo` («Catálogo completo») | Una fila de `DESTINOS_BOTON` y el check de la base |
| **D5** límites | Logo 1 MB; banners 3 MB; títulos/botones 120; textos largos 300 | `REGLAS_IMAGEN`/`CAMPOS_CONTENIDO` y los checks de la migración |
| **D6** categorías | `categorias_tienda` manda en la tienda; no se unifica con `categorias_empresa` (MSF-160) | Cambiar la consulta y la migración |
| **D7** horas | No cambia el alcance funcional | Planificación |

## Límites y deuda

- **Filtro de SVG solo en el navegador.** La app rechaza etiquetas activas, `on*`, URLs peligrosas,
  entidades y referencias externas antes de subir (`apps/web/src/lib/tiendaIdentidad.ts`), pero el bucket
  y la base no vuelven a inspeccionar el contenido. Un usuario con edición que suba un SVG por fuera de la
  app podría dejarlo en el bucket; el `<img>` de la tienda no ejecuta scripts, pero el archivo sigue
  siendo accesible por su URL pública. Si se requiere cierre total, validar el SVG en el servidor.
- **Archivos huérfanos:** la limpieza es mejor esfuerzo después de guardar; un fallo de borrado no rompe
  la tienda, solo deja un archivo sin uso.
- **Sin borrador, versiones ni «Publicar cambios»:** son de MSF-133 (F-TDA-05/06/07, Etapa 2).
- **`publico.catalogo_visible_por_dominio` no la consume el front actual:** el catálogo de MSF-167 usa
  `catalogo_pagina_por_dominio` y la home de MSF-191 usa `destacados_por_dominio` (ver
  [Tienda pública: inicio, búsqueda y móvil](tienda-inicio-busqueda-movil.md)). La función de esta épica
  queda como contrato de lectura verificado por pgTAP.
- **Sin caché** de las respuestas públicas.

## Diferencias con el prototipo

- Se adapta «Guardar y publicar» a **«Guardar»** (aplica de inmediato) y «Descartar» restaura el último
  valor guardado; no hay diálogos de publicación ni de descarte.
- La vista previa es en vivo y local; no publica una versión aparte.
- `StorePublicacion` (dominio, DNS, versiones) y `StoreGeneral` (datos de la empresa) quedan fuera.
- Las pestañas General, Precios y moneda y Mercado Libre no se dibujan.
- El bloque «Información de contacto visible» no se implementa.
