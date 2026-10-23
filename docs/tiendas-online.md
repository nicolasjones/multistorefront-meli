# Tiendas online: dominio e identidad

Spec: `specs/20261022-084830-tienda-dominio-e-identidad/` (épica MSF-147).
Historias: F-TDA-01 (`MSF-241`), F-TDA-03 (`MSF-294`, contenido y textos comerciales), F-TDA-02/04 (identidad y catálogo visible).
Migraciones: `supabase/migrations/20261023100000_tiendas_dominio.sql` (F-TDA-01), `20261023100200_tienda_contenido.sql` (F-TDA-03) y las que agregue cada historia.
Pruebas: `supabase/tests/database/tienda_dominio.test.sql`, `tienda_contenido.test.sql`, `apps/web/src/pages/tienda-publica/` y
`apps/web/src/pages/empresas/tienda/`.

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
