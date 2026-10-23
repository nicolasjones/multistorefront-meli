# Tiendas online: dominio e identidad

Spec: `specs/20261022-084830-tienda-dominio-e-identidad/` (épica MSF-147).
Historias: F-TDA-01 (`MSF-241`), F-TDA-02 (identidad visual, `MSF-266`), F-TDA-03 (`MSF-294`, contenido y textos comerciales), F-TDA-04 (`MSF-312`, catálogo visible).
Migraciones: `supabase/migrations/20261023100000_tiendas_dominio.sql` (F-TDA-01), `20261023100100_tienda_identidad.sql` (F-TDA-02),
`20261023100200_tienda_contenido.sql` (F-TDA-03), `20261023100300_tienda_catalogo_visible.sql` (F-TDA-04) y las que agregue cada historia.
Pruebas: `supabase/tests/database/tienda_dominio.test.sql`, `tienda_identidad.test.sql`, `tienda_contenido.test.sql`, `tienda_catalogo.test.sql`,
`apps/web/src/pages/tienda-publica/` y `apps/web/src/pages/empresas/tienda/`.

Una **tienda** es la vidriera online de una **empresa** (una por empresa, FR-001). El visitante entra
por el **dominio** de la tienda y, sin sesión, ve lo que esa tienda publica; si el dominio no está
configurado o la empresa está desactivada, ve siempre la misma página «Volvemos pronto» (FR-003). El
administrador con **edición en Empresas** configura la tienda desde Empresas (Principio VIII: opera
sobre la **empresa activa** de la barra superior).

## Esquema y RLS (Constitución, Principio VII)

| Objeto | Esquema | Justificación | RLS |
|---|---|---|---|
| `dominio.tiendas` | **`dominio`** | Entidad de negocio: la tienda de una empresa y su dominio. | Sí, por organización. |
| `publico.tienda_por_dominio(host)` | **`publico`** | Contrato de lectura anónima mínima. Esquema **solo de funciones**, sin tablas. | No aplica (función `security definer` con lista blanca). |
| `dominio.tienda_identidad` | **`dominio`** | Dato de negocio: colores, tipografías, logo y banners de la tienda de una empresa (F-TDA-02). | Sí, por organización; escritura solo por RPC. |
| `publico.identidad_por_dominio(host)` | **`publico`** | Lectura anónima de la identidad de la tienda de ese dominio (F-TDA-02). | No aplica (función con lista blanca de columnas). |
| Bucket `tienda-identidad` | `storage` | Infraestructura de plataforma: logo y banners (lectura pública). | Políticas sobre `storage.objects`. |

Columnas de `dominio.tiendas`: `id`, `organizacion_id` (FK a `public.organizaciones`), `empresa_id`
(**único**: una tienda por empresa), `dominio` (**único** a nivel plataforma, normalizado),
`created_at`, `updated_at`. FK compuesta `(empresa_id, organizacion_id)` a `dominio.empresas` para
que una tienda no cruce organizaciones.

- `anon` no tiene privilegios sobre `dominio` ni `public`; solo ejecuta las funciones de `publico`
  (y las RPC de acceso ya vigentes de `public`).
- RLS de `dominio.tiendas`: `select` para `authenticated` de la propia organización con nivel
  `lectura`/`edicion` en la sección `empresas`. **Sin política de escritura**: el dominio lo
  configura el equipo técnico (FR-004), no la app.
- El pgTAP `rls_en_toda_tabla` recorre `public` + `dominio`; `tienda_dominio.test.sql` comprueba
  además que `publico` no tiene tablas.

## Configurar el dominio de una tienda (sin pantalla, FR-004)

En el lanzamiento **no hay pantalla de dominio** ni verificación DNS (eso es F-TDA-05/MSF-133). El
equipo técnico lo hace por SQL sobre la base self-hosted. El dominio se guarda normalizado
(minúsculas, sin puerto ni punto final) y debe ser único a nivel plataforma.

```sql
-- Alta de la tienda de una empresa (una sola por empresa).
insert into dominio.tiendas (organizacion_id, empresa_id, dominio)
values ('<organizacion_id>', '<empresa_id>', 'tienda.ejemplo.com');

-- Cambiar el dominio (normaliza igual y registra tienda.dominio_configurado).
update dominio.tiendas set dominio = 'Nuevo-Dominio.Ejemplo.com:443.'
where empresa_id = '<empresa_id>';
```

Cada alta o cambio de dominio deja un evento `tienda.dominio_configurado` en
`public.registro_actividad` (empresa, actor si lo hubo y fecha; nunca el valor del dominio).

## Exposición de `publico` en la API

`publico` es un esquema nuevo con **solo funciones** de lectura anónima. Para que PostgREST lo
exponga:

- **Local**: `supabase/config.toml` → `[api] schemas` ya incluye `publico`.
- **Self-hosted (staging/producción)**: la variable del servicio PostgREST `PGRST_DB_SCHEMAS` debe
  incluir `publico` (`public,graphql_public,dominio,publico`, ver `SUPABASE_API_SCHEMAS` en
  `.env.example`). Es un cambio de configuración del VPS, sin secretos. **Reiniciar PostgREST** para
  que tome el cambio; si falta `publico`, la tienda pública responde 404 al resolver el dominio.

## Resolución por dominio (`publico.tienda_por_dominio(host)`)

Ejecutable por `anon` y `authenticated`. Normaliza el `host` (minúsculas, sin puerto ni punto final)
y devuelve **solo** `tienda_id`, `empresa_nombre` y `estado`. Un dominio desconocido, un `host`
inválido y una empresa con `activa = false` devuelven lo mismo (cero filas): no se revela si el
dominio existe (anti-enumeración). Nunca devuelve `organizacion_id` ni datos de otra tienda.

## Gestión dentro de Empresas

- Ruta canónica `/empresas/:id/tienda/:pestana`, con `:pestana` ∈ `identidad`, `contenido`,
  `catalogo`. Solo con **edición en Empresas**; sin acceso se ve el patrón de acceso restringido.
- Encabezado «Empresas › <empresa>» con el dominio y el estado («Publicada» si la empresa está
  activa), «Cambiar a <otra empresa> ↔» y «Ver tienda».
- La **empresa activa** de la barra superior (F-ROL-06) es la única fuente de verdad: «Cambiar a …»
  cambia esa misma empresa activa. Al cambiar se recargan todas las consultas, se descartan los
  cambios sin guardar con aviso y nunca se muestran datos de la empresa anterior (Principio VIII).
- Las pestañas se registran por archivo en `apps/web/src/pages/empresas/tienda/pestanas/` (cada
  historia de la épica aporta la suya) y el front público por sección en
  `apps/web/src/pages/tienda-publica/secciones/`.

## Front público

`apps/web` decide por el `Host` de la petición: si no es un host del panel (`VITE_PANEL_HOSTS`)
renderiza la tienda pública sin sesión. Un error de red no se disfraza de «Volvemos pronto»: se
ofrece reintentar.

- **Desarrollo**: sin la variable, el panel vive en `localhost,127.0.0.1`; un subdominio de
  `localhost` (p. ej. `mundojc.localhost:4300`) es una tienda de prueba.
- **Producción**: `VITE_PANEL_HOSTS` se pasa como build arg (`apps/web/Dockerfile`) con el dominio
  del panel del entorno. **Si no se configura, no se enruta ninguna tienda y todo host sirve el
  panel** (falla seguro): la tienda pública exige configurarla explícitamente. Los dominios de
  tienda son los que **no** figuran en esa lista.
- **Listá todos los hosts del panel de cada entorno** (dominio del panel, previews, IP o nombre
  interno del VPS, `localhost`): cualquier host que no figure en `VITE_PANEL_HOSTS` se sirve como
  tienda (o «Volvemos pronto» si no hay tienda) y el panel queda inaccesible desde ahí.

## Identidad visual (F-TDA-02, `MSF-266`)

Pestaña **Identidad visual** de `/empresas/:id/tienda/identidad` (solo con edición en Empresas).

- **Tabla** `dominio.tienda_identidad` (`empresa_id` PK): cuatro colores `#RRGGBB` (Primario, Primario
  oscuro, Acento, Fondo, con `check` de formato), tipografías de Títulos y Texto contra una **lista
  cerrada** (`system-ui`, Barlow, Barlow Condensed, Playfair Display, Lato, Sora, Instrument Sans) y
  las rutas de logo, banner principal y banner móvil. Sin fila → tema base (`#222222` / blanco /
  tipografía del sistema). Las rutas deben estar en `<organización>/<empresa>/` (check en la base).
- **Supuesto sobre DS-04**: la épica remite la lista de tipografías a DS-04, pero el repo no la trae
  versionada; se usó el tema base más las fuentes de los dos temas de ejemplo
  (`apps/web/src/tema/temaTienda.ts`) y del prototipo. Se ajusta en una sola constante
  (`TIPOGRAFIAS` en `apps/web/src/lib/tiendaIdentidad.ts` y los `check`/RPC de la migración).
- **Escritura**: solo `public.guardar_tienda_identidad(...)` (`security definer`, exige edición en
  Empresas, estado completo, **idempotente**: si no cambia nada no escribe ni registra evento; emite
  `tienda.identidad_actualizada`). `revoke … from public, anon`, `grant execute … to authenticated`.
  La tabla no concede `INSERT`/`UPDATE`/`DELETE`, así el evento no se puede omitir.
- **Archivos**: bucket `tienda-identidad` (lectura pública; escritura `authenticated` con edición en
  Empresas bajo `<organización>/<empresa>/<archivo>`; PNG/SVG/JPG/WebP, tope 3 MB). Límites (D5): logo
  ≤ 1 MB (PNG/SVG), banners ≤ 3 MB (PNG/JPG/WebP); el tope de 1 MB del logo lo valida la app antes de
  subir. Un **SVG con etiquetas activas (`<script>`, `<foreignObject>`…), manejadores `on*` (separados por espacio o `/`), `javascript:`/`data:` (aunque lleven tab o salto de línea en el esquema), entidades, referencias externas o CSS que carga recursos externos (`@import`, `url(http…)`) se rechaza** en el navegador.
  **Límites conocidos (aceptados):** ese filtro es solo del cliente; quien suba directo por la API de Storage lo esquiva (Storage no inspecciona contenido), y el tope de 1 MB del logo tampoco se aplica en servidor (el bucket admite 3 MB). Si se exige defensa en servidor, el siguiente paso es sacar `image/svg+xml` del bucket (PNG solo). Google Fonts se carga de un tercero (se filtra la IP del visitante; sin SRI/CSP) — decisión aceptada, alternativa: autoalojar. Si el guardado falla tras subir, la app relee la identidad y borra solo las subidas que la base no referencia (si no puede releer, las conserva: la respuesta de la RPC pudo perderse tras guardar); pueden quedar huérfanos (tolerado; `borrarImagenes` limpia en el mejor esfuerzo). El
  archivo elegido queda pendiente y **se sube recién al «Guardar»**; si la subida o la RPC fallan, no
  se guarda nada, se borra lo recién subido y la imagen anterior se conserva. Al guardar se borran los
  archivos reemplazados (best-effort).
- **Contraste**: se muestra «Contraste de texto blanco sobre el primario: N,N:1 (AA)»; por debajo de
  4,5:1 es una **advertencia que no bloquea** guardar.
- **Vista previa** en vivo con los valores sin guardar («Se actualiza con tus cambios sin guardar.»):
  no escribe nada hasta «Guardar». «Descartar» vuelve al último valor guardado. La pestaña se
  recarga al cambiar la empresa activa (Principio VIII) y avisa si hay cambios sin guardar.
- **Tienda pública**: `publico.identidad_por_dominio(host)` devuelve la identidad (o el tema base si no
  hay fila; vacío si el dominio no existe o la empresa está desactivada). La sección
  `secciones/TemaTienda.tsx` aplica colores y tipografías como variables CSS `--tienda-*` y muestra
  logo y banners; devuelve **rutas** del bucket y el front arma la URL pública.
- **Reversión**: ver el encabezado de la migración (función, políticas, bucket vacío, tabla).
- **Prototipo**: `design/pantallas/StoreIdentidad.dc.html`; se omiten las miniaturas «Productos que
  aparecen en el banner de la home» (sin requisito en la spec) y el diálogo «Publicar cambios» (la
  épica adapta «Guardar y publicar» a «Guardar», que aplica de inmediato).

## Límites y valores por defecto

- Dominio: hasta 253 caracteres, con al menos un punto y TLD de 2+ letras.
- Sin fila en las tablas de identidad/contenido/catálogo, la tienda usa el tema base y no muestra
  textos opcionales (ver F-TDA-02/03/04).

## Contenido y textos comerciales (F-TDA-03, MSF-294)

Pestaña **Contenido** de la gestión (`/empresas/:id/tienda/contenido`) y textos que muestra la tienda
pública. Solo con edición en Empresas; opera sobre la empresa activa (al cambiarla se vuelve a leer y
no queda nada de la anterior).

### Esquema y RLS (Principio VII, re-verificado)

| Objeto | Esquema | Justificación | Acceso |
|---|---|---|---|
| `dominio.tienda_contenido` | **`dominio`** | Textos comerciales de quien vende (entidad de negocio). | RLS por organización; `select` con acceso a Empresas; **sin política de escritura**. |
| `public.guardar_tienda_contenido(...)` | `public` (RPC de la app) | `security definer`: exige edición en Empresas y que la empresa sea de la organización de la sesión. | `revoke … from public, anon`; `grant … to authenticated`. |
| `publico.contenido_por_dominio(host)` | `publico` | Lectura anónima con lista blanca de columnas. | `grant … to anon, authenticated`. |

Campos (`empresa_id` es la clave): `titulo`, `subtitulo`, `texto_boton`, `boton_destino`,
`bienvenida` (barra superior), `pie`, `aviso_ficha` y `texto_boton_contacto`. Migración aditiva;
la reversión está en el encabezado de `20261023100200_tienda_contenido.sql`.

### Reglas

- **Texto plano**: se recorta (espacios de los extremos) y nunca se interpreta como HTML; el front lo
  renderiza siempre escapado.
- **Límites (D5, constantes en la migración y espejadas en `lib/tiendaContenido.ts`)**: título, texto
  del botón y texto del botón de contacto ≤ 120 caracteres; subtítulo, bienvenida, pie y aviso de
  ficha ≤ 300. La base los valida (check y RPC); la pestaña avisa por campo y no guarda nada si falla.
- **«El botón lleva a»**: lista cerrada validada en la base. Hoy solo `catalogo` («Catálogo completo», D4);
  como el catálogo navegable es de MSF-167, el botón apunta al ancla `#catalogo`.
- **Vacío oculta**: un texto vacío no se muestra (barra, subtítulo, botón, pie). Sin fila, la tienda
  no muestra ningún texto opcional.
- **Guardar** aplica de inmediato; **Descartar** vuelve al último guardado. La vista previa del banner
  usa el mismo componente que la tienda pública (`BannerContenido`) con los valores sin guardar y no
  escribe. Los productos de ejemplo de la vista previa del prototipo quedan para F-TDA-04.
- **Idempotencia y auditoría**: guardar lo mismo dos veces no cambia nada ni duplica el evento;
  un cambio real registra `tienda.contenido_actualizado` (actor, empresa, fecha; el detalle nombra la
  empresa, nunca los textos).
- **Tienda pública**: `BarraBienvenida` (orden 10), `BannerHome` (20) y `PieTienda` (900), en
  `apps/web/src/pages/tienda-publica/secciones/`, comparten una sola petición por host
  (`publico.contenido_por_dominio`). `aviso_ficha` y `texto_boton_contacto` quedan guardados y
  expuestos para la ficha de producto de MSF-167.

## Catálogo visible y destacados (F-TDA-04, MSF-312)

Migración `supabase/migrations/20261023100300_tienda_catalogo_visible.sql`. Pruebas:
`supabase/tests/database/tienda_catalogo.test.sql`, `apps/web/src/pages/empresas/tienda/catalogo.test.tsx`
y `apps/web/src/pages/tienda-publica/ProductosTienda.test.tsx`. Pestaña
`apps/web/src/pages/empresas/tienda/pestanas/catalogo.tsx`; sección pública
`apps/web/src/pages/tienda-publica/secciones/ProductosTienda.tsx`.

| Objeto | Esquema | Justificación | RLS |
|---|---|---|---|
| `dominio.categorias_tienda` (`empresa_id`, `categoria_id`, `visible`) | **`dominio`** | Qué categorías muestra la tienda: regla de negocio del producto. | Sí, por organización (`select` con `lectura`/`edicion` en Empresas); sin política ni privilegio de escritura. |
| `dominio.productos_tienda` (`empresa_id`, `producto_id`, `visible`, `destacado`) | **`dominio`** | Qué productos muestra y destaca la tienda. | Ídem. |
| `public.listar_catalogo_tienda(empresa)` / `public.guardar_catalogo_tienda(empresa, categorias, productos)` | `public` (RPC) | Contrato de la app; `revoke … from public, anon`, `grant execute … to authenticated`. | Chequeo explícito en la función (`security definer`). |
| `publico.catalogo_visible_por_dominio(host)` | `publico` | Lectura anónima con lista blanca. | No aplica (función). |

- **Una fila no cruza organizaciones ni empresas**: FK compuestas `(…, organizacion_id)` a
  `dominio.empresas`, `dominio.categorias` y `dominio.productos`. **Ausencia de fila = visible y no
  destacado**; guardar un valor igual al predeterminado borra la fila.
- **Productos de la tienda**: los de `dominio.producto_empresa` (empresas que venden el producto,
  F-CAT-07). Dos tiendas con los mismos productos tienen visibilidad y destacados independientes.
- **Visibilidad efectiva** (una sola definición, `private.catalogo_tienda_efectivo`): producto
  activo **y** su fila `visible` **y** su categoría (y la categoría padre) visible; sin categoría
  depende solo de su estado y su `visible`. El motivo («No se muestra: producto inactivo» /
  «No se muestra: categoría oculta») y el resumen «N visibles, M destacados» se calculan en el
  servidor sobre los productos efectivamente visibles. Un producto que la gestión dejó con
  `visible = false` no lleva motivo (el interruptor ya lo dice).
- **Escritura**: `guardar_catalogo_tienda` recibe solo los cambios (`[{id, visible}]` y
  `[{id, visible, destacado}]`), valida pertenencia (22023 ante id ajeno, repetido, vacío o con
  formato inválido; 42501 sin edición en Empresas; P0002 empresa ajena), toma un candado por tienda
  y es transaccional e idempotente. Emite `tienda.catalogo_actualizado` (empresa, actor, fecha; sin
  ids) solo ante cambios reales.
- **Función pública**: devuelve categorías visibles y productos efectivamente visibles (destacados
  primero) con `id`, `nombre`, `moneda`, `precio`, `tiene_imagen` (booleano), `categoria_id` y `destacado`.
  **Nunca** costos, stock, SKU, proveedor ni ids de organización. Las categorías visibles son las de la
  organización (el árbol es compartido entre sus tiendas; es intencional). Dominio desconocido o empresa
  desactivada devuelven `null`. Precio y stock de la gestión son de lectura (D2).
- **Imágenes**: la función devuelve solo `tiene_imagen`: la ruta del bucket privado `productos-imagenes`
  lleva el id de la organización y no se expone a `anon`. Servirla al público (URL firmada o bucket público) es parte de la
  tienda navegable (MSF-167).

Reversión: ver el encabezado de la migración (tablas y funciones nuevas; `drop` en orden inverso,
solo mientras no haya datos productivos).

## Cierre de la épica (MSF-147): seguridad y verificación

**Revisión de seguridad (SC-005)** — hecha sobre las migraciones `20261023100000…100300`, el front
público y la gestión:

- `anon` ejecuta **solo** funciones del esquema `publico` (`tienda_por_dominio`, `identidad_por_dominio`,
  `contenido_por_dominio`, `catalogo_visible_por_dominio`); las tablas `dominio.tiendas`,
  `tienda_identidad`, `tienda_contenido`, `categorias_tienda` y `productos_tienda` nacen con
  `revoke all … from public, anon, authenticated` y `select` solo para `authenticated` (con RLS por
  organización). Lo confirman los pgTAP `tienda_dominio`, `tienda_identidad`, `tienda_contenido` y
  `tienda_catalogo` (T020/T027) y la prueba global de `anon` (solo RPC de acceso en `public`).
- Cada RPC de `public` (`guardar_tienda_identidad`, `guardar_tienda_contenido`, `listar_catalogo_tienda`,
  `guardar_catalogo_tienda`) lleva `revoke … from public, anon` y `grant execute … to authenticated`
  explícitos en su migración, más el chequeo de «edición en Empresas» dentro de la función.
- **Enumeración de dominios**: dominio desconocido, host inválido y tienda desactivada devuelven lo mismo
  (sin filas / `null`); nunca se devuelve `organizacion_id`.
- **SVG**: se rechaza en el navegador un SVG con `<script>`, manejadores, `javascript:`/`data:` o
  recursos externos (`apps/web/src/lib/tiendaIdentidad.ts`, con tests). Límite aceptado ya
  documentado arriba: el filtro es solo del cliente; el logo se muestra con `<img>`, donde el SVG no
  ejecuta scripts.
- **Textos escapados**: bienvenida, pie y títulos se renderizan como texto de React (sin
  `dangerouslySetInnerHTML` en `pages/tienda-publica` ni `pages/empresas/tienda`).
- **Secretos**: ninguna clave de servicio llega al navegador; el E2E siembra desde Node y aborta si
  `SUPABASE_URL` no es local.

**Verificación integrada (SC-003)**: `apps/web/e2e/tienda-dos-dominios.e2e.ts` abre
`mundojc.localhost` y `sanjavucho.localhost` (dominios del seed) y comprueba que identidad (color
primario), textos (bienvenida y pie) y catálogo visible (un producto oculto no aparece) de cada
tienda no se mezclan con los de la otra. Se corre con `pnpm dev:supabase` y
`pnpm --filter @platform/web test:e2e tienda-dos-dominios` (ver `docs/e2e-app.md`).

**Contradicciones prototipo ↔ épica (para la descripción del PR)**: (1) el prototipo dibuja
borrador/publicación («Guardar y publicar», «Publicar cambios», versiones); la épica no tiene
borrador, así que se entrega un único «Guardar» que aplica de inmediato y los diálogos de
publicación quedan fuera de alcance (F-TDA-06/07). (2) La vista previa «sin publicar» se adapta a una
muestra en vivo con los valores sin guardar.

## Disponibilidad visible (F-TDA-18, MSF-332, épica MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (FR-020…FR-023, SC-009).
Migración: `supabase/migrations/20261023120100_tienda_disponibilidad_publica.sql` (aditiva; reversión: `drop function private.disponible_publico(uuid)`).
Pruebas: `supabase/tests/database/tienda_disponibilidad_publica.test.sql`, `apps/web/src/pages/tienda-publica/disponibilidad/EtiquetaDisponibilidad.test.tsx` y `apps/web/e2e/tienda-disponibilidad.e2e.ts`.

| Objeto | Esquema | Justificación |
|---|---|---|
| `private.disponible_publico(p_producto uuid) → boolean` | **`private`** | Lógica interna de la tienda; sin tablas nuevas y sin `execute` para `anon`/`authenticated` (la usan las funciones `publico.*` de F-TDA-12/13). |

- **Criterio único**: `true` si `dominio.existencias.cantidad > 0`, igual que `private.productos_con_stock()`. El reservado queda fuera de la cuenta; cuando Stock lo cierre se cambia solo esta función (FR-021).
- **Solo el booleano**: la función, la etiqueta y las respuestas públicas nunca exponen cantidades, mínimos ni «Últimas unidades» (FR-023). La elección manual `a_pedido` / `stock_entrante` se ignora.
- **`EtiquetaDisponibilidad`** (`pages/tienda-publica/disponibilidad/`): texto «Disponible» / «Sin stock», comunicado con texto y no solo color; la reutilizan la tarjeta (F-TDA-12) y la ficha (F-TDA-13).
- El E2E verifica «Disponible»/«Sin stock» en tarjeta y ficha apenas esas rutas existan en la épica; hasta entonces solo comprueba que la página de inicio no publica cantidades.

## Navegación por categorías (F-TDA-11, MSF-386, épica MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (FR-001…FR-008, FR-060).

- **Base**: `publico.categorias_por_dominio(host)` (migración `20261023120000_tienda_categorias_publicas.sql`,
  esquema `publico`, **sin tablas nuevas**). `SECURITY DEFINER`, `stable`, ejecutable por `anon`. Devuelve
  `{ categorias: [{ id, nombre, padre_id, productos }] }` con las categorías visibles de la tienda del host
  (la categoría y su padre, misma regla que `catalogo_visible_por_dominio`), en el orden de Catálogo, y
  `productos` = solo los efectivamente visibles de esa categoría. Host desconocido, inválido y empresa
  desactivada devuelven el mismo `null`. Nunca `organizacion_id` ni columnas internas.
  Reversión: `drop function publico.categorias_por_dominio(text);`.
- **Front** (`apps/web/src/pages/tienda-publica/`): `EnrutadorTienda` registra por archivo las rutas de
  `rutas/*.tsx` (excluye `*.test.tsx`; carga diferida; contrato en `rutas/LEEME.md`: `inicio.tsx` → `/`, `<nombre>.tsx` →
  `/<nombre>` y `/<nombre>/:<nombre>Id`) más `*` → `PaginaNoEncontrada`. `layout/LayoutTienda` pone la marca
  (h1 solo en la home), el menú de categorías y la columna «Categorías» del pie; comparte tienda, host y
  categorías por el outlet (`useContextoTienda`). `rutas/categoria.tsx` resuelve `/categoria/:categoriaId`
  contra las categorías visibles (migas «Inicio / <Categoría>», título y el listado de
  `secciones-catalogo/*.tsx`, que aporta F-TDA-12); inexistente, oculta, ajena o id inválido → la misma 404.
- **Cargas**: una sola llamada de categorías por tienda (hook `useCategoriasTienda`); si falla, el menú queda
  en «Inicio» con «Reintentar».
- **Pruebas**: pgTAP `tienda_categorias_publicas`, Vitest + axe (`EnrutadorTienda.test.tsx`, 320/768/1440 px) y
  E2E `e2e/tienda-categorias.e2e.ts` con las dos tiendas del seed.
