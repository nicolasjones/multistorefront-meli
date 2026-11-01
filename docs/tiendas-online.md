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

- **Sin vencimiento por inactividad (MSF-673)**: el cierre de sesión a las 12 h sin actividad
  (`lib/vencimientoSesion.ts`) es solo del panel. En un host de tienda `main.tsx` no registra la
  marca `sesion:ultima-actividad` ni redirige a `/login` (que la tienda no tiene; su ingreso es
  `/ingresar`).
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
y la pestaña `apps/web/src/pages/empresas/tienda/pestanas/catalogo.tsx`. La sección pública mínima
`ProductosTienda` (que leía `precio_lista`) la reemplazó `DestacadosInicio` (F-TDA-10, ver «Página de inicio»).

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
Migración: `supabase/migrations/20261023150100_tienda_disponibilidad_publica.sql` (aditiva; reversión: `drop function private.disponible_publico(uuid)`).
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

- **Base**: `publico.categorias_por_dominio(host)` (migración `20261023150000_tienda_categorias_publicas.sql`,
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

## Catálogo con filtros y orden (F-TDA-12, MSF-355, épica MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (FR-030…FR-041, SC-004, SC-005, SC-006).
Migración: `supabase/migrations/20261023150200_tienda_catalogo_publico.sql` (aditiva, **sin tablas**).
Reversión (migración posterior): `drop function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer); drop policy productos_imagenes_select_anon on storage.objects; drop function publico.imagen_publica(text); drop function private.imagen_publica(text); drop function private.precio_final_publico(uuid, uuid);`.
Pruebas: pgTAP `tienda_catalogo_publico`, Vitest + axe (`ListadoProductos.test.tsx`, `RutaCatalogo.test.tsx`, `lib/tiendaListado.test.ts`) y E2E `e2e/tienda-catalogo.e2e.ts` con las dos tiendas del seed.

| Objeto | Esquema | Justificación |
|---|---|---|
| `private.precio_final_publico(producto, empresa) → numeric` | **`private`** | Lógica interna de Precios; sin `execute` para `anon`/`authenticated`. |
| `private.imagen_publica(ruta) → boolean` | **`private`** | Respalda la lectura anónima de imágenes; sin `execute` para ningún rol de API. |
| `publico.imagen_publica(ruta) → boolean` | **`publico`** | Envoltorio `SECURITY DEFINER` para la política de `anon`: así `anon` no necesita `USAGE` sobre `private`. |
| `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina) → jsonb` | **`publico`** | Lectura anónima con lista blanca de campos; `publico` sigue sin tablas. |
| política `productos_imagenes_select_anon` sobre `storage.objects` | plataforma (storage) | Lectura de `anon` acotada a imágenes de productos visibles de tiendas activas. |

- **Página del catálogo**: `{ total, pagina, tamano: 24, categorias[], productos[] }`; cada producto trae solo `id`, `nombre`, `precio`, `disponible`, `imagen`, `categoria_id` y `destacado`. El tamaño 24 es una constante de la función (D3). Host desconocido y empresa desactivada devuelven el mismo `null`.
- **Filtros**: categoría (los productos de una categoría oculta o ajena no son «efectivos»: lista vacía, sin error), «Solo con stock» (por `private.disponible_publico`) y precio máximo sobre el precio final. **Orden**: relevancia (destacados, nombre, id), menor y mayor precio (desempate por nombre e id; los sin precio van al final).
- **Normalización** (sin error): orden desconocido → relevancia; página < 1 o nula → 1; `precio_max` ≤ 0 o nulo → sin límite; página fuera de rango → lista vacía con el `total` real.
- **Precio público**: regla de la empresa (`a_pesos` → `aplicar_regla_precio`) y, **según el interruptor «Precios que ve el cliente»** de la empresa, `aplicar_iva` (con IVA = `precio_para(...).final`; sin IVA = `precio_para(...).neto`). Resuelve la alícuota inline (la propia del producto o la de su categoría) porque `private.alicuota_producto` se acota a la sesión y bajo `anon` no devolvería nada; el pgTAP de paridad con `private.precio_para` evita la deriva. Sin precio calculable (USD sin cotización) el precio es `null`: la tarjeta no muestra precio, queda al final de los órdenes por precio y no pasa el filtro de precio máximo (D9).
- **Costo y techo esperado**: la RPC es pública y calcula `precio_final_publico` y `disponible_publico` para todo el catálogo efectivo de la tienda antes de filtrar y paginar, y lee las categorías en cada página. El diseño asume **hasta unos pocos cientos de productos visibles por tienda** (cifra de diseño, no medida); por encima conviene calcular el precio solo al filtrar u ordenar por precio y medir con un benchmark. Seguimiento de rendimiento fuera de esta historia: no hay catálogo real que lo justifique todavía.
- **`publico.imagen_publica` es invocable directo** por `anon` y `authenticated`: permite confirmar si una ruta de storage es imagen pública, algo que esas rutas ya permiten leer; riesgo bajo aceptado (anotado en el comentario de la función).
- **Página fuera de rango en la UI**: con `?pagina=` mayor a la última, el listado redirige (reemplazando el historial) a la última página; la RPC sigue devolviendo lista vacía con el `total` real.
- **Imágenes (D1, supuesto)**: el bucket `productos-imagenes` sigue privado. `anon` lee solo las imágenes que `private.imagen_publica` acepta (producto activo, no oculto, categoría visible, en una tienda activa). Como un `<img>` no manda cabeceras, `lib/imagenProducto.ts` pide **URLs firmadas** de una hora con la clave pública, en una sola llamada por página; se piden al cargar, así que en una pestaña abierta más de una hora vencen y la tarjeta cae a «Sin imagen» (`onError`) hasta recargar. Si D1 se resuelve distinto (URL pública o firmada por el servidor), cambia solo ese archivo y la política. La ruta (`<organización>/<producto>/<archivo>`) viaja en `imagen`: el id de organización no es un secreto (es un UUID sin valor de acceso) y el contrato de la épica la define así.
- **Front** (`apps/web/src/pages/tienda-publica/`): `rutas/catalogo.tsx` (`/catalogo`: título «Todos los productos», migas y el listado), `secciones-catalogo/ListadoProductos.tsx` (también montado por `/categoria/:categoriaId` con la categoría fija del path), componentes en `catalogo/` (panel de filtros, «Ordenar por», tarjeta, paginación con enlaces reales, estado vacío), `lib/tiendaListado.ts` (cliente de la RPC y parser/serializador de la URL) y el hook `hooks/useCatalogoPublico.ts`.
- **URL compartible**: `categoria`, `stock=1`, `max=<pesos>`, `orden=<relevancia|precio_asc|precio_desc>` y `pagina=<n>`; abrir la URL restaura el estado; cambiar un filtro u orden vuelve a la página 1; los valores inválidos se ignoran. Filtrar no recarga la página (navegación del lado del cliente).
- **Diferencias con el prototipo** (anotadas para el PR): la paginación no está dibujada en el prototipo (se usa el control del kit); «Últimas unidades · quedan N» queda fuera (expone stock exacto); el buscador del encabezado es de MSF-191.

## Ficha de producto (F-TDA-13, MSF-372, épica MSF-167)

Migración **aditiva** `20261023150300_tienda_ficha_publica.sql`. Reversión (migración posterior): `drop function publico.producto_por_dominio(text, uuid);`.

### Esquema (Principio VII, re-verificado)

| Objeto | Esquema | Justificación |
|---|---|---|
| `publico.producto_por_dominio(host, producto) → jsonb` | **`publico`** | Lectura anónima con lista blanca de campos; `publico` sigue sin tablas. `execute` para `anon` y `authenticated`. |

No se crean ni alteran tablas. Reutiliza `private.catalogo_tienda_efectivo` (visibilidad efectiva), `private.precio_final_publico` (F-TDA-12) y `private.disponible_publico` (F-TDA-18).

### Reglas

- **Qué devuelve**: `id`, `nombre`, `descripcion`, `sku`, `categoria {id, nombre}`, `precio` (final de la empresa, con el mismo interruptor de IVA que el catálogo), `disponible` (solo el booleano), `compatibilidad` (texto con los valores de `compatible_con` unidos por coma, `null` si no hay) e `imagenes [{posicion, ruta}]` ordenadas por posición. Nunca costos, existencias, proveedor, códigos internos ni `organizacion_id`.
- **El mismo `null`** para producto inexistente, inactivo, oculto, con categoría oculta, de otra empresa u organización, host desconocido o empresa desactivada: el front no puede distinguir los casos y no revela si el producto existe. El front también corta los ids que no son UUID antes de consultar.
- **SKU público (D7)**: se muestra el SKU del producto en el bloque de datos; un SKU en blanco no aparece.
- **Front** (`apps/web/src/pages/tienda-publica/`): `rutas/producto.tsx` (`/producto/:productoId`) arma la ficha con `ficha/Galeria.tsx` (principal = menor posición, hasta 4 miniaturas con la elegida marcada con `aria-pressed`, «Sin imagen» si no hay o si ninguna URL firmada carga), `ficha/Ampliacion.tsx` (diálogo de MUI: foco atrapado, cierre por botón y Esc, texto alternativo), `ficha/DatosProducto.tsx` (migas, nombre, categoría, precio, `EtiquetaDisponibilidad`, descripción, bloque «SKU» / «Categoría» / «Disponibilidad», la fila de acciones —«Consultar por WhatsApp» (F-TDA-14) y «Ver más productos» → `/catalogo`— y nota) y `ficha/Compatibilidad.tsx` (no se renderiza sin datos). Lectura: `lib/tiendaFicha.ts` y `hooks/useFichaProducto.ts` (una llamada a la base más un firmado en lote de las imágenes con `lib/imagenProducto.ts`).
- **Texto escapado**: nombre, descripción y compatibilidad van como nodos de React; HTML o `<script>` se ve literal. Las miniaturas cargan con `loading="lazy"`.
- **Fuera de alcance** (el prototipo los muestra, la spec de esta épica no los pide): «Productos relacionados». El botón «Consultar por WhatsApp» lo agrega MSF-212 (F-TDA-14, MSF-433): ver [`tienda-contacto.md`](./tienda-contacto.md).

### Verificación

pgTAP `supabase/tests/database/tienda_ficha_publica.test.sql` (SC-007), Vitest + axe `pages/tienda-publica/FichaProducto.test.tsx` y E2E `apps/web/e2e/tienda-ficha.e2e.ts` (SC-008, requiere el stack local).

## Cierre de la épica MSF-167: tienda · catálogo y ficha (MSF-549)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/` (T070–T073; SC-010…SC-013). Resumen de lo que entregan las cuatro historias (F-TDA-11, F-TDA-12, F-TDA-13 y F-TDA-18); el detalle de cada una está en sus secciones de arriba.

### Rutas públicas

| Ruta | Qué muestra | Historia |
|---|---|---|
| `/` | Inicio de la tienda | épica anterior |
| `/catalogo` | «Todos los productos» con filtros, orden y paginación | F-TDA-12 |
| `/categoria/:categoriaId` | Listado de una categoría visible (migas «Inicio / Categoría») | F-TDA-11 + F-TDA-12 |
| `/producto/:productoId` | Ficha con galería, precio, disponibilidad y compatibilidad | F-TDA-13 |
| cualquier otra | La misma 404 (inexistente, oculta, ajena o id inválido) | F-TDA-11 |

### Funciones públicas (`publico.*`, ejecutables por `anon`)

| Función | Devuelve | Historia |
|---|---|---|
| `categorias_por_dominio(host)` | categorías visibles con conteo de productos visibles | F-TDA-11 |
| `catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)` | página de 24 productos con lista blanca de campos | F-TDA-12 |
| `producto_por_dominio(host, producto)` | ficha con lista blanca de campos | F-TDA-13 |
| `imagen_publica(ruta)` | booleano; respalda la política de lectura de `anon` sobre imágenes | F-TDA-12 |

Helpers `private.*` sin `execute` para la API: `disponible_publico` (F-TDA-18) y `precio_final_publico`, `imagen_publica` (F-TDA-12). Host desconocido, producto no visible y empresa desactivada devuelven el mismo `null`. Las migraciones de la épica son aditivas (`20261023120000` … `20261023120300`) y ninguna crea tablas.

### Filtros y URL

`categoria`, `stock=1`, `max=<pesos>`, `orden=<relevancia|precio_asc|precio_desc>` y `pagina=<n>`; la URL es compartible, los valores inválidos se ignoran y cambiar un filtro vuelve a la página 1.

### Disponibilidad

Solo el booleano «Disponible» / «Sin stock» (`cantidad > 0`), nunca cantidades. Contrato de cambio futuro (depósitos y reservas) en [`stock.md`](./stock.md).

### Decisiones y su supuesto

| Decisión | Supuesto adoptado | Si cambia |
|---|---|---|
| **D1** imágenes | Bucket privado + política de `anon` acotada + URLs firmadas de una hora | Cambia `lib/imagenProducto.ts` y una migración |
| **D3** tamaño de página | 24, constante de la función | Un solo valor; ver rendimiento abajo |
| **D7** SKU público | Se muestra el SKU del producto | Quitar una fila de `DatosProducto.tsx` |
| **D9** sin precio calculable | Precio `null`: sin precio en la tarjeta, al final de los órdenes por precio, fuera del filtro de máximo | Ajustar la función |

### Contradicciones con el prototipo (para el PR)

Paginación no dibujada en el prototipo (se usa el control del kit); «Últimas unidades · quedan N» queda fuera (expondría stock exacto); «Productos relacionados» de la ficha queda fuera de alcance (el botón «Consultar por WhatsApp» llega con MSF-212, F-TDA-14); el buscador del encabezado es de MSF-191. Precios que ven los clientes: [`precios.md`](./precios.md).

### Rendimiento en celular (T071, SC-010)

**No medido todavía.** El entorno donde se cerró la épica no tenía acceso a Docker, así que no hubo stack local con el seed y no hay cifras que registrar (no se inventan). La medición queda trazada en **MSF-552** (seguimiento). Protocolo a seguir:

1. `pnpm dev:supabase`, build del front y preview con las dos tiendas del seed.
2. Lighthouse en perfil móvil (`.lighthouserc.json`) sobre `/catalogo` y `/producto/:id` de ambas tiendas.
3. Medir `publico.catalogo_pagina_por_dominio` con un catálogo de cientos de productos (techo de diseño, ver «Costo y techo esperado» arriba).
4. Si el tamaño 24 (D3) o la consulta por precio no cumplen, anotar acá el ajuste.

Lo que ya mitiga: rutas con carga diferida, imágenes con `loading="lazy"`, una llamada RPC por página y un firmado en lote de imágenes.

## Cuenta del cliente en la tienda (épica MSF-237)

Spec: `specs/20261024-051500-cuenta-web-del-cliente/`. La tienda suma el acceso de clientes con cuenta web (alta en [`clientes.md`](./clientes.md), contraseña y redirecciones en [`acceso-ingreso.md`](./acceso-ingreso.md)).

| Ruta | Qué hace | Historia |
|---|---|---|
| `/ingresar` | Ingreso con correo y contraseña; solo entra una cuenta `activa` | F-CLI-06 |
| `/definir-contrasena` | Primera contraseña o recuperación; solo con un enlace de Auth vigente | F-CLI-06 |
| `/recuperar-contrasena` | Pide el correo; respuesta idéntica exista o no la cuenta | F-CLI-06 |

| Función `publico.*` | Quién la ejecuta | Devuelve | Historia |
|---|---|---|---|
| `acceso_cliente_por_dominio(host)` | `authenticated` | estado (`activa` · `suspendida` · `sin_cuenta` · `no_habilitado`) y tipo si es activa; `null` si el host no resuelve o la empresa está desactivada | F-CLI-05 |
| `precios_cliente_por_dominio(host, productos[])` | `authenticated` | escalas del tipo de cliente (x1; o x1–x50 con rango) por producto; `null` sin cuenta activa habilitada | F-CLI-07 |

`anon` no ejecuta ninguna de las dos: el visitante ve exactamente el precio público de siempre. Ninguna devuelve `organizacion_id`, costos, margen ni existencias. Detalle del precio: [`precios-escalas.md`](./precios-escalas.md).

## Página de inicio (F-TDA-10, MSF-399, épica MSF-191)

Spec: `specs/20261024-120000-tienda-inicio-busqueda-movil/` (FR-001…FR-008, FR-060, SC-001…SC-003).
Migración aditiva `supabase/migrations/20261203100000_tienda_destacados_publicos.sql`
(reversión: `drop function publico.destacados_por_dominio(text)`). No crea ni altera tablas
(`publico` sigue sin tablas). Pruebas: `supabase/tests/database/tienda_destacados_publicos.test.sql`,
`apps/web/src/pages/tienda-publica/rutas/inicio/*.test.tsx` y `apps/web/e2e/tienda-inicio.e2e.ts`.

- `publico.destacados_por_dominio(host)` (ejecutable por `anon`): hasta 8 destacados efectivamente
  visibles (por nombre), con `id`, `nombre`, `precio` final de la empresa
  (`private.precio_final_publico`, `null` si no es calculable), `disponible` (solo booleano), `imagen` y
  `categoria_id`, más `hay_productos`. Host desconocido y empresa desactivada devuelven el mismo `null`.
- La home compone, por `orden`: banner (20, `BannerHome` de MSF-147) → `EstadoPreparacion` (30) →
  `CategoriasInicio` (40) → `DestacadosInicio` (50). Los tres bloques nuevos comparten una sola
  llamada por host (`lib/tiendaInicio.ts`).
- «Catálogo en preparación» aparece solo si la tienda activa no tiene ningún producto visible y reemplaza
  a «Categorías» y «Destacados»; con productos pero sin destacados solo se oculta «Destacados». Un bloque
  que falla muestra su error con «Reintentar» sin romper el resto.

## Búsqueda y versión móvil (F-TDA-15 y F-TDA-17, épica MSF-191)

Guías de detalle: [`docs/tienda-busqueda.md`](./tienda-busqueda.md) (F-TDA-15, MSF-413: sugerencias, `/catalogo?q=…`,
tolerancia a tildes y tipeo, límite por visitante) y [`docs/tienda-movil.md`](./tienda-movil.md) (F-TDA-17: menú y panel de
filtros móviles, error con «Reintentar», 360/390/412/430 px y tableta 768/1024 px). Esta página solo consolida el cierre.

### Cierre de la épica MSF-191 (MSF-558)

- **Migraciones** (todas aditivas): `20261203100000` (destacados de la home), `20261203110000` a `20261203110300`
  (búsqueda: base, sugerencias, resultados y saltos de proxy). Reversión: la de cada guía; la tabla nueva
  `public.limite_pedidos_publicos` se revierte con `drop table`, sin otras dependencias.
- **Esquema (Principio VII, re-verificado)**: `public.limite_pedidos_publicos` va en **`public`** (control de abuso
  transversal, no es dominio del producto); `publico` sigue sin tablas.
- **Seguridad revisada**: la tabla tiene RLS activada, sin políticas y con `revoke all` a `public`, `anon` y
  `authenticated`; solo la toca `private.registrar_pedido_publico` (`security definer`, sin ejecución para `anon`).
  `anon` ejecuta únicamente `publico.destacados_por_dominio`, `publico.sugerencias_busqueda_por_dominio` y
  `publico.busqueda_pagina_por_dominio` (con `revoke … from public, anon` previo y `grant` explícito). El visitante es el
  hash `sha256` de la IP + host; la IP nunca se guarda y las ventanas se purgan a los 10 minutos.
- **Pendiente real**: confirmar en DEV la cadena de `x-forwarded-for` (`private.saltos_proxy_confiables()`, hoy 0) y medir
  Lighthouse en celular (trazado en MSF-552); no hay cifras inventadas.

### Contradicciones prototipo ↔ épica (para el PR)

1. **Resultados de búsqueda sin artboard**: la página de resultados es el catálogo con el término (`/catalogo?q=…`).
2. **Panel de filtros móvil sin «Precio máximo»**: manda el comportamiento; el panel móvil lo incluye (D5).
3. **Sin artboards de tableta**: se reutiliza el layout responsivo de escritorio/celular.
4. **Estados no dibujados** (sugerencias, aviso de espera, «Catálogo en preparación», error con reintento): kit de componentes y textos de los requisitos (D8).
5. **«Últimas unidades · quedan N»**: fuera de alcance, solo «Disponible» y «Sin stock».

### Verificación pendiente

«Contacto» en el menú móvil (FR-046, D10): agregado por MSF-437 (F-TDA-16); falta verificarlo a 360 px en un navegador real.

## Contacto y WhatsApp (F-TDA-16 y F-TDA-14, épica MSF-212)

Spec: `specs/20261202-100000-tienda-whatsapp-y-contacto/` (FR-001…FR-015, FR-020…FR-026, FR-060, FR-061).
Historias: F-TDA-16 (`MSF-437`, contacto con formulario) y F-TDA-14 (`MSF-433`, consulta por WhatsApp desde la ficha).
Guía de detalle: [`docs/tienda-contacto.md`](./tienda-contacto.md) (contratos, firmas, seguridad y pruebas de cada historia).
Migraciones: `20261212120700_tienda_contacto.sql` y `20261212120800_crear_consulta_publica_solo_interna.sql` (F-TDA-16),
`20261212121000_tienda_whatsapp.sql` (F-TDA-14).
Pruebas: pgTAP `supabase/tests/database/tienda_contacto.test.sql` y `tienda_whatsapp.test.sql`; Vitest + axe en
`apps/web/src/pages/tienda-publica/contacto/` y `.../whatsapp/`, en `apps/web/src/lib/` (`tiendaContacto`, `whatsapp`,
`registroWhatsapp`) y en `apps/web/src/pages/empresas/edit.test.tsx`; E2E `apps/web/e2e/tienda-contacto.e2e.ts` y
`apps/web/e2e/tienda-whatsapp.e2e.ts`.

El visitante anónimo de la tienda de una empresa (resuelta por dominio desde MSF-147) puede **enviar una consulta** desde
`/contacto` o **abrir WhatsApp** desde la ficha de un producto. Las dos consultas llegan a la bandeja de Consultas y ventas
(MSF-122) de esa misma empresa, con origen `formulario` o `whatsapp`.

### Rutas públicas

| Ruta | Historia | Qué muestra |
|---|---|---|
| `/contacto` | F-TDA-16 | Migas «Inicio / Contacto», título «Contacto» con la bajada de la tienda, bloques «WhatsApp» (número y horarios) y «Correo» —el bloque o la línea sin dato no se muestra— y el formulario «Escribinos». `/contacto/<algo>` devuelve la 404 amable. |
| `/producto/:productoId` | F-TDA-14 | La ficha de MSF-167 suma el botón «Consultar por WhatsApp» (solo si la empresa tiene un número válido) que abre el diálogo con el mensaje armado. |

Además: «Contacto» en el menú (escritorio y celular) y «Escribinos» en el pie (F-TDA-16), y el campo «Horarios de atención»
en la edición de Empresas (FR-014, D2), que opera sobre la empresa activa.

### Funciones públicas (`publico`, ejecutables por `anon`)

| Función | Devuelve |
|---|---|
| `publico.contacto_por_dominio(host text)` | `{ nombre, whatsapp, correo, horarios }` de la empresa del host, o `null` (idéntico para host desconocido y empresa desactivada). |
| `publico.enviar_consulta_contacto(host text, nombre text, contacto text, mensaje text, clave_envio uuid)` | `{ estado: 'ok' \| 'invalido' \| 'limite' \| 'error', campos?, espera_segundos? }`. |
| `publico.registrar_consulta_whatsapp(host text, producto uuid, clave_envio uuid)` | `{ estado: 'ok' \| 'limite' \| 'error' }`. |

Las tres son `SECURITY DEFINER` con `set search_path = ''`, filtran por `dominio.empresas.activa` y devuelven una lista
blanca: nunca `organizacion_id`, IP, hash del visitante ni columnas internas. Host desconocido, empresa desactivada y
producto ajeno u oculto responden **lo mismo**.

Las funciones internas (`private.visitante_hash`, `private.limite_envios_tienda`, `private.registrar_envio_tienda`,
`private.validar_contacto_tienda`, `private.entregar_a_bandeja`) no tienen `grant` para `anon` ni `authenticated`.
`private.entregar_a_bandeja` es el **único** punto que conoce la interfaz de entrada de MSF-122
(`publico.crear_consulta_publica`): si esa firma cambia, solo cambia el adaptador.

### Tabla `dominio.tienda_envios` (esquema `dominio`)

| Objeto | Esquema | Justificación | RLS |
|---|---|---|---|
| `dominio.tienda_envios` (tabla nueva) | **`dominio`** | Dato del producto Tiendas online atado a una empresa: registro mínimo de envíos de visitantes (límite e idempotencia). No es plataforma genérica. | Sí, por organización: `select` para `authenticated` con `organizacion_id = private.organizacion_id()`. `revoke all … from public, anon, authenticated` + `grant select … to authenticated`: **`anon` no tiene ningún privilegio** y escribe solo `private.registrar_envio_tienda` (`security definer`). |
| `dominio.empresas.horarios` (columna nullable, ≤ 200) | **`dominio`** | La tabla ya es de dominio y tiene RLS; se suma la columna con `grant update (horarios)` a `authenticated`. Aditiva. | Hereda la de `dominio.empresas`. |

Columnas: `id`, `organizacion_id`, `empresa_id`, `visitante` (hash, nunca la IP), `clave_envio`, `origen`
(`formulario|whatsapp`), `creado_en`; `unique (empresa_id, clave_envio)` e índice `(empresa_id, visitante, creado_en)`.
Nada nuevo en `public`: `publico` sigue siendo un esquema de **solo funciones**.

### Límite e idempotencia

- **Límite**: `private.limite_envios_tienda()` → **5 envíos por hora por visitante y empresa** (constante única). Es atómico:
  `private.registrar_envio_tienda` toma `pg_advisory_xact_lock` por (empresa, visitante), así que dos envíos simultáneos no
  superan el cupo. Las filas de más de 24 h se podan en la misma función (sin worker ni cron). Formulario y WhatsApp
  **comparten** el mismo cupo (D3).
- **Idempotencia**: `unique (empresa_id, clave_envio)`; una clave repetida responde `ok` sin entregar de nuevo ni gastar
  cupo. El cliente genera una clave por intento: «Reintentar» la reutiliza y «Enviar otra» pide una nueva.
- **Falla de entrega**: el registro y la entrega van en una sub-transacción; si la bandeja falla se revierte el registro (no se
  gasta cupo) y el visitante ve el error genérico con «Reintentar».

### Identidad del visitante (D6)

El visitante es anónimo: se identifica por el hash `sha256` de la **IP** del cliente (tomada según
`private.saltos_proxy_confiables()`, de F-TDA-15) **más la empresa**. **La IP nunca se guarda**: en la tabla queda solo el
hash. Si la cadena `x-forwarded-for` no llega a PostgREST, todos los visitantes caen en un único cupo «sin-ip»: falla
cerrada, no abierta. **Pendiente de confirmar en DEV**: que la cabecera llega (si no, el límite es global).

### Decisiones de la épica y el supuesto con el que se implementaron

| Decisión | Supuesto |
|---|---|
| D1 · Registro de la consulta por WhatsApp | Al abrir WhatsApp se registra la consulta con `origen = whatsapp` por la misma interfaz de entrada del formulario (F-CON-01), sin esperar al seguimiento de MSF-130. |
| D2 · Fuente de los horarios | `dominio.empresas` no tenía la columna: F-TDA-16 agrega `horarios text` (aditiva, nullable, ≤ 200) y el campo «Horarios de atención» en Empresas. |
| D3 · Alcance del límite | Formulario y WhatsApp cuentan juntos (5 por hora por visitante y empresa). Superado el cupo, el formulario muestra la espera y el botón de WhatsApp **igual abre WhatsApp**: solo se omite el registro. |
| D4 · Interfaz de entrada de MSF-122 | `private.entregar_a_bandeja` es el único adaptador; su firma real se confirmó en T003 (`publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje, producto_id)`). |
| D5 · Antispam adicional | Sin captcha: la defensa es el límite por visitante y empresa, la validación por campo con topes de longitud y el texto siempre literal. |
| D6 · Identidad del visitante | Hash de la IP + empresa (ver arriba); sin IP disponible, un único cupo «sin-ip». |
| D7 · Reglas de validación | Nombre obligatorio (≤ 100), «Correo o WhatsApp» obligatorio (≤ 120) con formato de correo o teléfono, mensaje obligatorio (≤ 2000); todo recortado, con los mismos topes en cliente y servidor. |
| D8 · Horas | No cambia el alcance: el recorte de horas del roadmap queda pendiente de decisión. |

### Seguridad (revisión del diff de la épica)

- **RLS de `dominio.tienda_envios`**: habilitada, con la única política de `select` para `authenticated` por organización
  (`private.organizacion_id()`). `anon` no llega a la tabla: escribe solo `private.registrar_envio_tienda`
  (`security definer`, sin `grant` para roles de API).
- **`grant`s de `anon`**: las tres funciones de `publico` hacen `revoke execute … from public, anon` y después
  `grant execute … to anon, authenticated`. El `revoke` a `PUBLIC` importa: por defecto Postgres da `EXECUTE` a `PUBLIC` en
  toda función. Además, desde `20261212100100` la RPC de la bandeja `publico.crear_consulta_publica` **no** es ejecutable por
  `anon` ni `authenticated` (solo `service_role` y el propietario): el único camino público es
  `publico.enviar_consulta_contacto`, con su límite.
- **Texto literal**: lo que escribe el visitante se guarda y se muestra literal (nodos de React; en
  `apps/web/src/pages/tienda-publica/` no hay `dangerouslySetInnerHTML`). Un `<script>` escrito en el formulario no se
  interpreta.
- **IP no persistida**: la tabla guarda el hash (`visitante`), nunca la IP.
- **Sin datos internos en las respuestas**: `ok | invalido | limite | error` en el formulario y `ok | limite | error` en
  WhatsApp, sin ids de organización, costos, existencias, IP ni hash. Las fallas internas se registran en el log del
  servidor solo con `sqlstate`; al anónimo le llega el error genérico.
- **Aislamiento**: la empresa sale siempre del `Host`; el producto de WhatsApp tiene que ser **efectivamente visible** en la
  tienda del host (misma visibilidad que la ficha).

### Contradicciones prototipo ↔ épica (para el PR)

1. «Se abrió WhatsApp con el mensaje listo (simulado en el prototipo)»: el «simulado» es un artefacto del prototipo; en
   producción abre WhatsApp de verdad y el aviso dice «Se abrió WhatsApp con el mensaje listo.» (FR-023).
2. «Respondemos dentro de las 24 h» y el bloque «Retiro y envíos / No hay compra online en esta versión»: la épica no los pide
   (prometen un plazo y un estado de la compra que cambia con MSF-176) y quedan fuera de alcance.
3. El prototipo de **Empresas** no dibuja «Horarios de atención»: el campo se agrega por FR-014 (D2).
4. La bajada de «Contacto» sale del texto del pie que la tienda ya configura (F-TDA-03); sin texto, no se muestra.
5. El menú de escritorio suma «Contacto» al final de la lista de categorías (el prototipo lo muestra en otra barra).

### Migraciones y reversión

| Migración | Contenido | Reversión (en una migración posterior) |
|---|---|---|
| `20261212120700_tienda_contacto.sql` (F-TDA-16) | columna `dominio.empresas.horarios` (+ check ≤ 200 y `grant update`); tabla `dominio.tienda_envios` + RLS + índices + `unique`; `private.visitante_hash`, `private.limite_envios_tienda`, `private.registrar_envio_tienda`, `private.validar_contacto_tienda`, `private.entregar_a_bandeja`; `publico.contacto_por_dominio` y `publico.enviar_consulta_contacto` con sus `grant`s | `drop function` de las funciones públicas y privadas, `drop table dominio.tienda_envios` y `alter table dominio.empresas drop column horarios` — nada se destruye en el mismo PR que lo crea. |
| `20261212120800_crear_consulta_publica_solo_interna.sql` (F-TDA-16) | solo privilegios: `publico.crear_consulta_publica` deja de ser ejecutable por `anon` y `authenticated` | `grant execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) to anon, authenticated` |
| `20261212121000_tienda_whatsapp.sql` (F-TDA-14) | `publico.registrar_consulta_whatsapp` + `grant`s; no crea ni altera tablas | `drop function publico.registrar_consulta_whatsapp(text, uuid, uuid)` |

**Orden de despliegue**: F-TDA-16 antes que F-TDA-14 (la segunda reusa `private.registrar_envio_tienda`,
`private.entregar_a_bandeja` y `publico.contacto_por_dominio`).

**Pendiente para el despliegue de la épica (no de este cierre)**: las versiones de las dos migraciones de F-TDA-16
(`20261212100000` y `20261212100100`) están por debajo de la máxima de `dokploy` (`20261212120600`) y la segunda pisa la de
`solicitar_documento_presupuesto`: hay que devolverlas a números libres y mayores **antes** de aplicar la épica. Está
detallado en [`docs/tienda-contacto.md`](./tienda-contacto.md) y lo resuelve el PR de release de la épica, no este cierre.

### Verificación

- **pgTAP**: `supabase/tests/database/tienda_contacto.test.sql` (FR-001…FR-006, FR-014, FR-060, FR-061) y
  `supabase/tests/database/tienda_whatsapp.test.sql` (FR-025, FR-060, FR-061): lista blanca, `null` idéntico, aislamiento entre
  dos tiendas, RLS y privilegios de la tabla, límite y ventana de una hora, idempotencia, simultaneidad, reversión ante una
  falla de entrega, HTML literal, producto visible/oculto/ajeno, origen `whatsapp` y respuestas sin datos internos. Se corren
  con `pnpm test:db` (requiere `pnpm dev:supabase`).
- **Vitest + axe**: `apps/web/src/pages/tienda-publica/contacto/` (validación por campo, confirmación, «Enviar otra», espera,
  error con «Reintentar», bloques sin dato ocultos, 404 de subruta, enlaces del menú y del pie, foco y 320 / 768 / 1440 px),
  `.../whatsapp/` (botón solo con número válido, diálogo, foco atrapado y devuelto, `noopener`, URL de `wa.me` codificada),
  `apps/web/src/lib/` (`tiendaContacto`, `whatsapp`, `registroWhatsapp`) y `apps/web/src/pages/empresas/edit.test.tsx`
  (campo «Horarios de atención» y cambio de empresa). Comando: `pnpm --filter @platform/web test`.
- **E2E**: `apps/web/e2e/tienda-contacto.e2e.ts` y `apps/web/e2e/tienda-whatsapp.e2e.ts`, con las dos tiendas del seed: la
  consulta llega a la bandeja de **su** empresa, la ráfaga de 6 envíos muestra la espera y la bandeja recibe 5, y el HTML
  se ve literal. Se omiten sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (ver `docs/e2e-app.md`).
- **Gates del cierre** (T072): `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm prototipo:check`,
  `pnpm matriz:check` y `pnpm docs:check`.
