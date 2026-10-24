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

## Ventas comprobantes (MSF-159)

Documento de venta interno (factura o presupuesto) con líneas y numeración por empresa y tipo. Todo vive
en `dominio`; la única tabla de plataforma que se toca es `public.permisos_rol_accion` (dato nuevo, sin
cambio de esquema). Migraciones: `20261203100100` … `20261204150200` (aditivas; reversión en el encabezado
de cada una y consolidada en [Ventas · comprobantes (técnico)](ventas-comprobantes.md#reversion)).

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.comprobantes_venta` | alterada | Empresa/tienda, canal, operador, vencimiento, forma de pago y envío elegidos, confirmación, `updated_at` y `numero_entero`; el resto del contrato de F-CLI-08 sigue igual. |
| `dominio.comprobantes_venta_lineas` | nueva | Producto, cantidad, precio sin IVA, escala, IVA, depósito de salida, «A pedido» y totales de la línea. |
| `dominio.comprobantes_venta_numeracion` | nueva | Contador `(organización, empresa, tipo) → último`; sin acceso directo. |
| `dominio.empresas`, `dominio.productos`, `dominio.depositos`, `dominio.existencias_deposito`, `dominio.reservas_stock` | existentes | Solo se leen al armar líneas y confirmar; la confirmación escribe movimientos y reservas con el motor de stock. |
| `public.clientes`, `public.permisos_rol_accion` | existentes | Sin cambio de esquema; `editar_precio` es un dato nuevo en la matriz de acciones de Ventas. |

```mermaid
erDiagram
  EMPRESAS ||--o{ COMPROBANTES_VENTA : "emite"
  CLIENTES ||--o{ COMPROBANTES_VENTA : "compra"
  COMPROBANTES_VENTA ||--o{ COMPROBANTES_VENTA_LINEAS : "detalla"
  COMPROBANTES_VENTA ||--|| COMPROBANTES_VENTA_NUMERACION : "numera"
  PRODUCTOS ||--o{ COMPROBANTES_VENTA_LINEAS : "se vende"
  DEPOSITOS ||--o{ COMPROBANTES_VENTA_LINEAS : "sale de"
  PRODUCTOS ||--o{ EXISTENCIAS_DEPOSITO : "tiene"
  DEPOSITOS ||--o{ EXISTENCIAS_DEPOSITO : "guarda"
  PRODUCTOS ||--o{ RESERVAS_STOCK : "reserva"
  DEPOSITOS ||--o{ RESERVAS_STOCK : "en"

  EMPRESAS { uuid id PK
             uuid organizacion_id FK
             text nombre }
  CLIENTES { uuid id PK
             uuid organizacion_id FK
             text nombre
             text tipo "minorista|mayorista" }
  COMPROBANTES_VENTA { uuid id PK
                       uuid organizacion_id FK
                       uuid cliente_id FK
                       uuid empresa_id FK "alterada: nueva tienda del comprobante"
                       text tipo "factura|presupuesto"
                       text numero
                       integer numero_entero "alterada: correlativo por empresa y tipo"
                       date fecha
                       text estado "borrador|confirmada|pendiente|aceptado"
                       text canal "alterada: mostrador|tienda_online|telefono_whatsapp"
                       uuid operador_id FK "alterada: usuario que carga"
                       date valido_hasta "alterada: solo presupuesto"
                       uuid forma_pago_id "alterada: solo la elección (MSF-139)"
                       uuid envio_id "alterada: solo la elección (MSF-139)"
                       timestamptz confirmado_en "alterada: la fija confirmar_comprobante"
                       uuid confirmado_por FK "alterada: usuario que confirma"
                       timestamptz updated_at "alterada: bloqueo optimista"
                       numeric total_sin_iva
                       numeric total_con_iva }
  COMPROBANTES_VENTA_LINEAS { uuid id PK
                               uuid organizacion_id FK
                               uuid comprobante_id FK
                               integer orden "unique con comprobante"
                               uuid producto_id FK
                               text descripcion
                               text codigo
                               integer cantidad "> 0"
                               numeric precio_unitario "sin IVA"
                               text escala "x1|x5|x10|x50"
                               boolean precio_manual
                               uuid alicuota_id
                               numeric alicuota_porcentaje
                               uuid deposito_id FK
                               boolean a_pedido
                               numeric subtotal_sin_iva
                               numeric iva }
  COMPROBANTES_VENTA_NUMERACION { uuid organizacion_id PK
                                  uuid empresa_id PK
                                  text tipo PK
                                  integer ultimo }
  PRODUCTOS { uuid id PK
              uuid organizacion_id FK
              text nombre }
  DEPOSITOS { uuid id PK
              uuid organizacion_id FK
              text nombre }
  EXISTENCIAS_DEPOSITO { uuid producto_id PK
                         uuid deposito_id PK
                         integer cantidad
                         integer reservado }
  RESERVAS_STOCK { uuid id PK
                   uuid producto_id FK
                   uuid deposito_id FK
                   integer cantidad
                   text referencia }
```

- **[ERD interactivo (Archify)](../diagrams/msf-159-erd.html)** — todas las tablas del grafo, columnas,
  PK/FK y cardinalidad.
- La numeración se toma con `private.siguiente_numero_comprobante` bajo bloqueo transaccional; el formato
  visible es provisorio (`lpad(..., 8, '0')`).
- La confirmación usa `private.aplicar_movimiento_deposito`; no llama a las RPC públicas de Stock porque
  exigen `stock` en edición y quien vende confirma con `ventas` en edición.
- Detalle de RPC, permisos, confirmación y reversión: [Ventas · comprobantes (técnico)](ventas-comprobantes.md).

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
