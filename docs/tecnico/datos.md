---
owner: tecnico
sources:
  - supabase/migrations
---

# Datos y DER

## Esquemas

| Esquema | Qué guarda |
|---|---|
| `public` | Plataforma: organizaciones, usuarios, roles, permisos, actividad, ejecuciones, imports |
| `dominio` | Negocio: empresas, clientes, productos, categorías, stock, comprobantes, reparaciones, ítems de reparación, historial |
| `publico` | **Solo funciones** `security definer` de lectura anónima de la tienda online; **sin tablas** |

Toda tabla expuesta tiene **RLS** por organización. Las secciones por empresa resuelven el nivel con `private.nivel_seccion()` y la empresa activa.

## Modelo del catálogo (MSF-160)

```mermaid
erDiagram
  EMPRESAS ||--o{ PRODUCTO_EMPRESA : "vende"
  PRODUCTOS ||--o{ PRODUCTO_EMPRESA : "se vende en"
  CATEGORIAS ||--o{ PRODUCTOS : "clasifica"
  CATEGORIAS ||--o{ CATEGORIAS : "padre de"
  EMPRESAS ||--o{ CATEGORIAS_EMPRESA : "ve"
  CATEGORIAS ||--o{ CATEGORIAS_EMPRESA : "visible en"

  EMPRESAS { uuid id PK
             uuid organizacion_id FK
             text nombre }
  PRODUCTOS { uuid id PK
              uuid organizacion_id FK
              uuid categoria_id FK "alterada: nueva FK a CATEGORIAS"
              text nombre
              text sku }
  PRODUCTO_EMPRESA { uuid producto_id PK
                     uuid empresa_id PK
                     uuid organizacion_id FK
                     timestamptz creado_en }
  CATEGORIAS { uuid id PK
               uuid organizacion_id FK
               uuid padre_id FK
               text nombre
               int posicion }
  CATEGORIAS_EMPRESA { uuid categoria_id PK
                       uuid empresa_id PK
                       uuid organizacion_id FK }
```

- **[ERD interactivo (Archify)](../diagrams/msf-160-erd.html)** — todas las columnas, PK/FK y cardinalidad.
- **[Arquitectura del catálogo](../diagrams/msf-160-architecture.html)** — cómo se lee y quién consume.

## Modelo de la tienda (MSF-147)

Cinco tablas nuevas en `dominio` (Principio VII), el bucket `tienda-identidad` y funciones de lectura en
`publico`. Migraciones aditivas `20261023100000`–`20261023100300` (rama de la épica, pendiente de merge a
`main`; reversión en el encabezado de cada una y consolidada en
[Tienda online: dominio, identidad y catálogo visible](tienda-dominio-e-identidad.md#alcance-de-entrega)).
No hay borrador ni versiones: cada cambio se aplica al guardar.

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.tiendas` | **nueva** | Una tienda por empresa (`empresa_id` único) con `dominio` único y normalizado; FK compuesta a `dominio.empresas`. |
| `dominio.tienda_identidad` | **nueva** | Identidad visual por `empresa_id` (PK): cuatro colores `#RRGGBB`, dos tipografías de la lista cerrada de DS-04 y rutas de logo/banner/banner móvil. |
| `dominio.tienda_contenido` | **nueva** | Textos comerciales por `empresa_id` (PK), recortados, con límites y destino del botón en lista cerrada. |
| `dominio.categorias_tienda` | **nueva** | Visibilidad de categorías por `(empresa_id, categoria_id)`; sin fila = visible. |
| `dominio.productos_tienda` | **nueva** | Visibilidad y destacado por `(empresa_id, producto_id)`; sin fila = visible y no destacado. |
| `dominio.empresas` | existente | Solo se referencia con FK compuesta; no cambia. |
| `dominio.categorias` | existente | Solo se referencia con FK compuesta (MSF-160); no cambia. |
| `dominio.productos` | existente | Solo se referencia con FK compuesta; no cambia. |
| `storage.buckets` / `storage.objects` | existente | Se agrega el bucket `tienda-identidad` y sus políticas; no es una tabla de negocio. |

```mermaid
erDiagram
  ORGANIZACIONES ||--o{ TIENDAS : "es dueña"
  EMPRESAS ||--o| TIENDAS : "publica"
  EMPRESAS ||--o| TIENDA_IDENTIDAD : "define"
  EMPRESAS ||--o| TIENDA_CONTENIDO : "escribe"
  EMPRESAS ||--o{ CATEGORIAS_TIENDA : "muestra"
  CATEGORIAS ||--o{ CATEGORIAS_TIENDA : "visible en"
  EMPRESAS ||--o{ PRODUCTOS_TIENDA : "muestra"
  PRODUCTOS ||--o{ PRODUCTOS_TIENDA : "visible en"

  TIENDAS { uuid id PK
    uuid organizacion_id FK
    uuid empresa_id FK "único"
    text dominio "único, normalizado"
    timestamptz created_at
    timestamptz updated_at }
  TIENDA_IDENTIDAD { uuid empresa_id PK
    uuid organizacion_id FK
    text color_primario "#RRGGBB"
    text color_primario_oscuro "#RRGGBB"
    text color_acento "#RRGGBB"
    text color_fondo "#RRGGBB"
    text tipografia_titulos "lista cerrada"
    text tipografia_texto "lista cerrada"
    text logo_ruta
    text banner_ruta
    text banner_movil_ruta
    timestamptz updated_at }
  TIENDA_CONTENIDO { uuid empresa_id PK
    uuid organizacion_id FK
    text titulo "máx. 120"
    text subtitulo "máx. 300"
    text texto_boton "máx. 120"
    text boton_destino "catalogo"
    text bienvenida "máx. 300"
    text pie "máx. 300"
    text aviso_ficha "máx. 300"
    text texto_boton_contacto "máx. 120"
    timestamptz updated_at }
  CATEGORIAS_TIENDA { uuid empresa_id PK
    uuid categoria_id PK
    uuid organizacion_id FK
    boolean visible "default true" }
  PRODUCTOS_TIENDA { uuid empresa_id PK
    uuid producto_id PK
    uuid organizacion_id FK
    boolean visible "default true"
    boolean destacado "default false" }
  EMPRESAS { uuid id PK
    uuid organizacion_id FK
    text nombre
    boolean activa }
  CATEGORIAS { uuid id PK
    uuid organizacion_id FK
    uuid padre_id FK
    text nombre }
  PRODUCTOS { uuid id PK
    uuid organizacion_id FK
    uuid categoria_id FK
    text nombre }
  ORGANIZACIONES { uuid id PK
    text nombre }
```

- **Ausencia de fila = valor predeterminado:** identidad y contenido usan el tema base y textos vacíos;
  categorías y productos se toman visibles (y no destacados).
- Los dominios los configura el equipo técnico; no hay pantalla ni RPC de alta de dominio. El cambio de
  dominio queda auditado (`tienda.dominio_configurado`).
- La visibilidad efectiva de un producto se calcula en `private.catalogo_tienda_efectivo` (producto activo,
  visible y con categoría y categoría padre visibles). El detalle de contratos y operación está en
  [Tienda online: dominio, identidad y catálogo visible](tienda-dominio-e-identidad.md).

## Acceso y membresía (MSF-119)

- `public.usuarios_organizacion.estado` (`activo` | `suspendido`, default `activo`): migración aditiva `20261012140100`. Las funciones `private.organizacion_id()` y `private.puede_escribir()` excluyen a los suspendidos (más `20261012140300` para las de administración). El trigger `cortar_sesiones_suspendido` (`20261012150000`) borra `auth.sessions` al suspender.
- `public.intentos_acceso` (`correo_hash` PK, `fallos`, `ultimo_fallo`, `bloqueado_hasta`; `20261012140200`): contador de fallos por correo en hash HMAC (clave `acceso_hmac` en Vault). RLS activado y sin privilegios para `anon`/`authenticated`; solo se accede por RPC y por el hook `verificar_intento_acceso` (`20261014100000`). Es plataforma/auth, por eso vive en `public`. Cada migración lleva su reversión en el encabezado.
- Una persona pertenece a una sola organización (`user_id` PK de `usuarios_organizacion`, spec 003).

```mermaid
erDiagram
  organizaciones ||--o{ usuarios_organizacion : "tiene"
  auth_users ||--o| usuarios_organizacion : "pertenece a (user_id PK)"
  usuarios_organizacion { uuid user_id PK
    uuid organizacion_id FK
    text estado "activo|suspendido" }
  intentos_acceso { text correo_hash PK
    int fallos
    timestamptz bloqueado_hasta }
```

Detalle y operación: [Acceso](../acceso-ingreso.md) · regla para tablas nuevas: [Aislamiento](../aislamiento-por-organizacion.md).

## Service técnico (MSF-182)

Todas las tablas van en `dominio` (Principio VII), con RLS por `organizacion_id` y nivel de `service_tecnico` (`private.nivel_seccion`); lectura además restringida a tiendas accesibles (`20261020140000`). Sin `delete`. Migraciones: `supabase/migrations/20261020100100`–`20261020150000` (aditivas; reversión en el encabezado de cada una).

```mermaid
erDiagram
  modelos_equipo ||--o{ reparaciones : "modelo_id"
  estados_reparacion ||--o{ reparaciones : "estado_id"
  clientes ||--o{ reparaciones : "cliente_id"
  empresas ||--o{ reparaciones : "empresa_id (numeración)"
  reparaciones ||--o{ reparacion_historial : "reparacion_id"
  modelos_equipo { uuid id PK
    text equipo
    text modelo
    numeric mano_obra_base
    bool activo }
  estados_reparacion { uuid id PK
    text nombre
    int orden
    bool avisa_cliente
    bool cierra
    bool activo }
  reparaciones { uuid id PK
    uuid empresa_id FK
    int numero "unique (empresa_id, numero)"
    text numero_serie
    numeric costo_mano_obra "sin select directo"
    numeric costo_repuestos "sin select directo"
    timestamptz entrega_real
    timestamptz anulada_en }
  reparacion_historial { uuid id PK
    text tipo "alta|estado|entrega|anulacion"
    uuid estado_anterior_id
    uuid estado_nuevo_id
    uuid usuario_id }
```

- **Modelos y estados son por organización; la numeración es por empresa** (`private.siguiente_numero_reparacion`, bloqueo asesor por transacción). Sembrado idempotente: `private.sembrar_service` (`20261020100300`, siete modelos y siete estados).
- FK compuestas `(…_id, organizacion_id)` impiden cruzar organizaciones.
- Costos: grant por columna sin `costo_*`; solo los entrega `obtener_reparacion`, enmascarados sin `ver_costos`.
- `reparacion_historial` es solo lectura para la app; lo escriben las RPC en la misma transacción.
- Rol `tecnico`: solo datos en `roles_organizacion`/`permisos_rol` (matriz fija); detalle en la rama de la épica (`docs/permisos-por-rol.md`).

## Service técnico: ítems e impresión (MSF-199)

Se agrega `dominio.reparacion_items` (entidad de negocio del taller) y dos columnas derivadas en
`dominio.reparaciones`: `total_mano_obra` y `total_repuestos` (ARS sin IVA, de cara al cliente). Las RPC de
ítems y listado viven en `public` y las ayudas internas en `private`. Migraciones:
`supabase/migrations/20261022100100`–`20261022110200` (aditivas; reversión en el encabezado de cada una).
Detalle: [Service técnico: listado, ítems e impresión](service-listado-items-impresion.md).

```mermaid
erDiagram
  reparaciones ||--o{ reparacion_items : "reparacion_id"
  productos ||--o{ reparacion_items : "producto_id (opcional)"
  reparaciones { uuid id PK
    numeric total_mano_obra "nueva: derivada, sin IVA"
    numeric total_repuestos "nueva: derivada, sin IVA" }
  reparacion_items { uuid id PK
    uuid organizacion_id FK
    uuid reparacion_id FK "FK compuesta"
    text tipo "mano_obra|repuesto"
    text descripcion "<= 200"
    uuid producto_id FK "opcional, solo repuesto"
    int cantidad "1..9999"
    numeric precio_unitario "ARS sin IVA"
    numeric subtotal "generada" }
  productos { uuid id PK
    text nombre
    text sku
    bool activo }
```

- **RLS**: `reparacion_items` filtra por organización, nivel `service_tecnico` (`lectura`/`edicion`) y tienda
  accesible; sin grants de escritura directa (`insert`/`update`/`delete`), solo escriben las RPC
  `security definer`. `anon` sin acceso.
- **FK compuestas** `(reparacion_id, organizacion_id)` y `(producto_id, organizacion_id)` impiden cruzar
  organizaciones.
- **Totales**: los mantiene solo `private.recalcular_totales_reparacion` dentro de la misma transacción que
  agrega o quita un ítem; `reparaciones` no tiene grants de escritura para esas columnas.
- **Stock**: los ítems no mueven existencias; el descuento de repuestos es de MSF-217.

## Consultas (MSF-122)

Tres tablas nuevas en `dominio` (Principio VII), con RLS por organización, empresa accesible y sección
`consultas`; sin escritura directa desde la app. El alta entra solo por `publico.crear_consulta_publica`
(la empresa sale del dominio de la tienda) y la edición por `public.actualizar_consulta`. Migraciones:
`20261205100000_consultas.sql`, `20261205200000_consultas_configuracion.sql` y
`20261205200100_consultas_avisos.sql` (aditivas; reversión en el encabezado de cada una y consolidada en
[Consultas: modelo, RPC y aviso](consultas.md#reversion)).

```mermaid
erDiagram
  EMPRESAS ||--o{ CONSULTAS : "recibe"
  PRODUCTOS ||--o{ CONSULTAS : "interés (opcional)"
  CONSULTAS ||--|| CONSULTAS_AVISOS : "encola"
  EMPRESAS ||--o| CONSULTAS_CONFIGURACION : "avisos"

  CONSULTAS { uuid id PK
    uuid organizacion_id FK
    uuid empresa_id FK
    text origen "formulario|whatsapp"
    text nombre
    text contacto
    text mensaje "nullable"
    uuid producto_id FK "nullable"
    text estado "nueva|en_curso|resuelta"
    uuid responsable_id FK "nullable"
    text nota_interna "nullable"
    timestamptz created_at
    timestamptz updated_at }
  CONSULTAS_CONFIGURACION { uuid empresa_id PK
    uuid organizacion_id FK
    text correo_avisos "nullable: usa empresas.correo"
    timestamptz updated_at }
  CONSULTAS_AVISOS { uuid consulta_id PK
    uuid organizacion_id FK
    uuid empresa_id FK
    text estado "pendiente|enviado|fallido|sin_destinatario"
    int intentos
    text ultimo_error
    timestamptz enviado_en
    timestamptz updated_at }
```

- `consultas` guarda estado, responsable y nota interna; `consultas_configuracion` la dirección de avisos
  (una fila por empresa); `consultas_avisos` la cola del correo, con `consulta_id` como clave (un aviso por
  consulta).
- FK compuestas `(empresa_id, organizacion_id)` y `(producto_id, organizacion_id)` impiden cruzar
  organizaciones.
- La vista `public.consultas_bandeja` y las RPC del panel viven en `public` y no almacenan datos.
- Desde MSF-189 (MSF-562) el alta **ya no encola en `dominio.consultas_avisos`**: el disparador emite por
  `private.emitir_aviso` y el flow `enviar-avisos` envía. `consultas_avisos` y la Edge Function quedan solo
  para drenar lo que ya estaba encolado. Detalle: [Avisos y listas](avisos-y-listas.md).
- Detalle de RPC, permisos, aviso y operación: [Consultas](consultas.md).

## Avisos y listas configurables (MSF-189)

Tres tablas nuevas en `public` (plataforma/transversal), una en `dominio` (estado de consulta) y ninguna
alteración de `dominio.motivos_movimiento`. Migraciones aditivas `20261210120000`–`20261210120600` (avisos) y
`20261210130000`–`20261210130300` (listas y emisión desde Consultas), en la rama de la épica, pendiente de
merge a `main`; reversión en el encabezado de cada una y consolidada en
[Avisos y listas](avisos-y-listas.md#reversión). Los detalles de RPC, flow y operación están en
[Avisos y listas: modelo, RPC y flujos](avisos-y-listas.md).

| Tabla | Estado | Cambio |
|---|---|---|
| `public.tipos_aviso` | **nueva** | Catálogo de tipos (clave, nombre, sección de permisos); siembra `consulta_nueva`. RLS con `select` para `authenticated`, sin escritura desde la app. |
| `public.preferencias_aviso` | **nueva** | Preferencia por `(user_id, tipo_aviso)`; sin fila = encendido. Cada usuario lee y escribe solo las suyas; sin delete. |
| `public.avisos_pendientes` | **nueva** | Cola durable de correos con `grupo_id`, `datos`, estado, ventana, intentos, reclamo, `enviado_en` y `error`. RLS activa sin políticas para `authenticated`; solo `security definer` y el rol de Kestra. |
| `dominio.estados_consulta` | **nueva** | Lista de estados por organización (`nombre` ≤ 80, `activo`, `orden`), nombre único sin distinguir mayúsculas. RLS: lectura con `consultas`, escritura solo Administrador; sin delete. **Todavía no alimenta la bandeja de Consultas.** |
| `dominio.motivos_movimiento` | existente | **Sin cambio de tabla ni de RLS**; se edita también desde `/configuracion/listas` con el mismo editor de `/stock/motivos`. |
| `dominio.consultas` | existente | **Sin cambio de tabla**; el disparador de aviso ahora emite por `private.emitir_aviso` en lugar de encolar en `dominio.consultas_avisos`. |
| `public.organizaciones`, `public.usuarios_organizacion`, `auth.users` | existente | Solo se referencian con FK; no cambian. |

```mermaid
erDiagram
  ORGANIZACIONES ||--o{ AVISOS_PENDIENTES : "encola"
  ORGANIZACIONES ||--o{ ESTADOS_CONSULTA : "define"
  AUTH_USERS ||--o{ PREFERENCIAS_AVISO : "guarda"
  AUTH_USERS ||--o{ AVISOS_PENDIENTES : "recibe"
  TIPOS_AVISO ||--o{ PREFERENCIAS_AVISO : "por tipo"
  TIPOS_AVISO ||--o{ AVISOS_PENDIENTES : "clasifica"

  TIPOS_AVISO { text clave PK
    text nombre
    text seccion
    timestamptz created_at }
  PREFERENCIAS_AVISO { uuid user_id PK
    text tipo_aviso PK
    boolean activo
    timestamptz updated_at }
  AVISOS_PENDIENTES { uuid id PK
    uuid organizacion_id FK
    uuid user_id FK
    text tipo_aviso FK
    uuid grupo_id
    jsonb datos
    text estado "pendiente|enviando|enviado|descartado|fallido"
    integer intentos
    timestamptz creado_en
    timestamptz ventana_vence_en
    timestamptz proximo_intento
    timestamptz reclamado_hasta
    timestamptz enviado_en
    text error }
  ESTADOS_CONSULTA { uuid id PK
    uuid organizacion_id FK
    text nombre "≤ 80, único por organización"
    boolean activo
    integer orden
    timestamptz creado_en }
```

- `tipos_aviso` es un catálogo global (sin `organizacion_id`); cada componente registra sus claves por
  migración.
- `avisos_pendientes` agrupa por `grupo_id`: varias filas con el mismo grupo salen en un solo correo.
- `estados_consulta` no tiene FK desde `dominio.consultas.estado` en esta entrega; los estados de la bandeja
  siguen siendo los tres fijos de MSF-122. Conectarlos y migrar los valores es una historia de seguimiento.
- `motivos_movimiento` mantiene la forma de F-STK-02 (tipos a los que aplica y activo); la pantalla de listas
  no agrega columnas.

## Tienda pública (MSF-147 / MSF-167)

Las tablas del modelo de tienda son las cinco nuevas de **MSF-147** (ver arriba). **MSF-167** (catálogo y
ficha) **no crea ni altera tablas**: agrega funciones de lectura en `publico` y lógica interna en
`private`. `publico` sigue sin tablas.

| Función | Qué expone |
|---|---|
| `publico.tienda_por_dominio(host)` | Tienda pública (`tienda_id`, `empresa_nombre`, `estado`) o cero filas si el dominio no existe o la empresa está inactiva (MSF-147) |
| `publico.identidad_por_dominio(host)` | Colores, tipografías y rutas de logo/banners de la tienda; sin fila, valores del tema base (MSF-147) |
| `publico.contenido_por_dominio(host)` | Textos comerciales de la tienda; sin fila, todo vacío (MSF-147) |
| `publico.catalogo_visible_por_dominio(host)` | Categorías visibles y productos efectivamente visibles (destacados primero) con nombre, precio, indicador de imagen y categoría (MSF-147) |
| `publico.categorias_por_dominio(host)` | Categorías visibles de la tienda del dominio, con conteo de productos efectivos (MSF-167) |
| `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)` | Página de 24 productos con lista blanca (precio final, disponible, imagen, categoría y destacado) (MSF-167) |
| `publico.producto_por_dominio(host, producto)` | Ficha con nombre, descripción, SKU, categoría, precio, disponibilidad, compatibilidad e imágenes (MSF-167) |
| `publico.imagen_publica(ruta)` | Booleano que respalda la política de lectura anónima de imágenes de productos visibles (MSF-167) |

- La visibilidad efectiva sale de `private.catalogo_tienda_efectivo` (producto activo, visible y con
  categoría visible); el precio, de `private.precio_final_publico`, y la disponibilidad, de
  `private.disponible_publico` (solo booleano).
- `anon` ejecuta solo funciones de `publico`; las tablas conservan su RLS por organización.
- Detalle de contratos, seguridad y operación: [Tienda online: dominio, identidad y catálogo
  visible](tienda-dominio-e-identidad.md) y [Tienda pública: catálogo y ficha](tienda-catalogo-y-ficha.md).
  Modelo del catálogo y ERD vigente: [MSF-160](#modelo-del-catálogo-msf-160).

## Cuenta web del cliente (MSF-237)

Una tabla nueva en `public` (plataforma/autenticación, atada a `public.clientes` por la excepción
documentada) y funciones de lectura en `publico`/`private`; `publico` sigue **sin tablas**. Migraciones
aditivas `20261206100000`–`20261206110100` (rama de la épica, pendiente de merge a `main`; reversión en
el encabezado de cada una y consolidada en [Cuenta web del cliente](cuenta-web-cliente.md#alcance-de-entrega)).
Detalle de RLS, RPC y operación: [Cuenta web del cliente](cuenta-web-cliente.md).

| Tabla | Estado | Cambio |
|---|---|---|
| `public.cuentas_cliente` | **nueva** | Cuenta web por `(cliente, tienda)`: `id`, `organizacion_id`, `cliente_id`, `empresa_id`, `auth_user_id`, `estado` (`activa` \| `suspendida`), `created_at`; única `(cliente_id, empresa_id)`; FK en cascada a organización, cliente, empresa y `auth.users`. |
| `public.clientes` | existente | Solo se referencia; el correo de acceso sale de `clientes.correo` y el tipo define la escala. |
| `public.clientes_empresas` | existente | Determina «Habilitado en»; su ausencia deriva «No habilitado». |
| `public.organizaciones` | existente | Dueña y límite de aislamiento. |
| `dominio.empresas` / `dominio.tiendas` | existentes | Empresa de la cuenta y dominio para el enlace de Auth. |
| `auth.users` | existente | Un usuario por cliente (D1); `last_sign_in_at` alimenta «Último ingreso». |
| `public.usuarios_organizacion` | existente | **No** recibe la cuenta web: por eso no accede al panel. |

- RLS activada; lectura `authenticated` por organización, sección Clientes y `private.empresas_accesibles()`;
  sin políticas de escritura (solo RPC `security definer`). `anon` no tiene grants.
- «Sin cuenta» (sin fila) y «No habilitado» (cliente fuera de `clientes_empresas`) se **derivan**, no se
  guardan; «No habilitado» prevalece sobre el estado guardado.

```mermaid
erDiagram
  ORGANIZACIONES ||--o{ CUENTAS_CLIENTE : "es dueña"
  CLIENTES ||--o{ CUENTAS_CLIENTE : "tiene cuenta"
  EMPRESAS ||--o{ CUENTAS_CLIENTE : "tienda"
  AUTH_USERS ||--o{ CUENTAS_CLIENTE : "autentica"
  CLIENTES ||--o{ CLIENTES_EMPRESAS : "habilitado en"
  EMPRESAS ||--o{ CLIENTES_EMPRESAS : "recibe"
  EMPRESAS ||--|| TIENDAS : "publica"

  CUENTAS_CLIENTE { uuid id PK
    uuid organizacion_id FK
    uuid cliente_id FK
    uuid empresa_id FK
    uuid auth_user_id FK "auth.users"
    text estado "activa|suspendida"
    timestamptz created_at }
  CLIENTES { uuid id PK
    uuid organizacion_id FK
    text correo "correo de acceso"
    text tipo "minorista|mayorista"
    timestamptz archivado_en }
  CLIENTES_EMPRESAS { uuid cliente_id PK
    uuid empresa_id PK
    uuid organizacion_id FK }
  EMPRESAS { uuid id PK
    uuid organizacion_id FK
    text nombre
    boolean activa }
  TIENDAS { uuid id PK
    uuid empresa_id FK
    text dominio }
  AUTH_USERS { uuid id PK
    text email
    timestamptz last_sign_in_at }
  ORGANIZACIONES { uuid id PK
    text nombre }
```

## Precios y dólar (MSF-116)

Tres tablas nuevas en `dominio` (Principio VII), una por organización y con RLS; la cotización es **de la
organización**, no de una empresa. La cuarta, `cotizacion_inicial`, ya existe (MSF-114) y queda como
respaldo. Migraciones aditivas `20261023140000`–`20261023140500` (rama de la épica, pendiente de merge a
`main`; reversión en el encabezado de cada una y consolidada en
[Dólar y recálculo](dolar-y-recalculo.md#reversión)).

```mermaid
erDiagram
  ORGANIZACIONES ||--o| COTIZACION_PENDIENTE : "espera confirmación"
  ORGANIZACIONES ||--o{ COTIZACIONES : "historial"
  ORGANIZACIONES ||--o| COTIZACION_APLICADA : "rige los precios"
  ORGANIZACIONES ||--o| COTIZACION_INICIAL : "respaldo (MSF-114)"
  COTIZACIONES ||--o| COTIZACION_APLICADA : "cotizacion_id"

  COTIZACION_PENDIENTE { uuid organizacion_id PK
    numeric valor "numeric(14,4) > 0"
    uuid cargada_por FK
    timestamptz cargada_en
    timestamptz expira_en "cargada_en + 24 h" }
  COTIZACIONES { uuid id PK
    uuid organizacion_id FK
    numeric valor
    numeric valor_anterior
    numeric variacion_pct
    uuid cargada_por FK
    text cargada_por_nombre
    timestamptz cargada_en
    boolean recalculo_aplicado
    integer precios_recalculados }
  COTIZACION_APLICADA { uuid organizacion_id PK
    numeric valor
    uuid cotizacion_id FK
    timestamptz aplicada_en }
  COTIZACION_INICIAL { uuid organizacion_id PK
    numeric valor
    timestamptz updated_at }
```

- `cotizacion_pendiente`: valor cargado que espera confirmación; vence a las 24 h y se resuelve al
  consultar; los tiempos los fija un trigger.
- `cotizaciones`: historial append-only de cargas confirmadas; sin grants de escritura y con triggers
  `ENABLE ALWAYS` que rechazan `UPDATE`, `DELETE` y `TRUNCATE`. Único escritor:
  `public.confirmar_cotizacion`.
- `cotizacion_aplicada`: una fila por organización; la lee `private.a_pesos` con
  `coalesce(aplicada, inicial)`. Sin fila, rige la inicial.
- `anon` sin privilegios en las tres. RPC, umbral, eventos y operación: [Dólar y recálculo](dolar-y-recalculo.md).

## Datos vivos vs. archivo

- **Vivos:** comprobantes, cobros, stock, reparaciones. Afectan estados, saldos y reportes.
- **Archivo (`historial_*`):** datos del panel anterior, importados una sola vez, **solo lectura**. No tocan stock, saldos ni estados.
  - **[Flujo de importación](../diagrams/msf-275-dataflow.html)**
  - **[Estados de la ejecución](../diagrams/msf-275-lifecycle.html)**

## Migraciones y RLS

- Cada historia trae **su propia migración aditiva** con reversión en el encabezado.
- Las RPC nuevas son `security invoker` (o `definer` justificado), con `revoke`/`grant` explícitos.
- `rls_en_toda_tabla` y `aislamiento_organizaciones` recorren `public` + `dominio` en pgTAP.

## Inventario

El listado de tablas/rutas/variables generado desde el código está en **[Inventario](../_generated/inventory.md)**.

> **service_role (server-only):** tiene grants explícitos en `public`, `dominio` y `private`; `BYPASSRLS` no alcanza para usar un esquema/tabla. Lo usa el sandbox y las herramientas server-side, nunca el navegador.
