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
| `dominio` | Negocio: empresas, clientes, productos, categorías, stock, comprobantes, reparaciones, historial |

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
- Detalle de RPC, permisos, aviso y operación: [Consultas](consultas.md).

## Tienda pública (MSF-147 / MSF-167)

**Sin cambios de esquema:** las épicas de tienda crean y alteran tablas solo en MSF-147 (modelo de
tienda, identidad, contenido y catálogo visible). MSF-167 (catálogo y ficha) **no crea ni altera tablas**:
agrega funciones de lectura en `publico` y lógica interna en `private`. `publico` sigue sin tablas.

| Función | Qué expone |
|---|---|
| `publico.categorias_por_dominio(host)` | Categorías visibles de la tienda del dominio, con conteo de productos efectivos |
| `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)` | Página de 24 productos con lista blanca (precio final, disponible, imagen, categoría y destacado) |
| `publico.producto_por_dominio(host, producto)` | Ficha con nombre, descripción, SKU, categoría, precio, disponibilidad, compatibilidad e imágenes |
| `publico.imagen_publica(ruta)` | Booleano que respalda la política de lectura anónima de imágenes de productos visibles |

- La visibilidad efectiva sale de `private.catalogo_tienda_efectivo` (producto activo, visible y con
  categoría visible); el precio, de `private.precio_final_publico`, y la disponibilidad, de
  `private.disponible_publico` (solo booleano).
- `anon` ejecuta solo funciones de `publico`; las tablas conservan su RLS por organización.
- Detalle de contratos, seguridad y operación: [Tienda pública: catálogo y ficha](tienda-catalogo-y-ficha.md).
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
