---
owner: tecnico
sources:
  - specs/20261020-100000-ventas-catalogos-de-cobro-y-envio
  - supabase/migrations
  - supabase/tests/database
  - apps/web/src
---

# Ventas · catálogos de cobro y envío (técnico, MSF-139)

Implementación de la épica **MSF-139 · Ventas y despacho · Ventas catálogos de cobro y envío**
(spec `20261020-100000-ventas-catalogos-de-cobro-y-envio`). Historias: F-VTA-01 (MSF-210, formas de
pago), F-VTA-02 (MSF-225, formas de envío), F-VTA-03 (MSF-240, cuentas de cobro) y F-VTA-04 (MSF-251,
transportes y terminales de retiro). La vista de producto está en
[Ventas · catálogos de cobro y envío](../producto/ventas-catalogos.md).

!!! note "Estado"
    Implementado en la rama `epic/MSF-139-ventas-y-despacho-ventas-catalogos-de-co`, **pendiente de
    merge a `main`**. Las tareas de las cuatro historias y del cierre quedaron `[x]`; no hay E2E
    automatizado de estas pantallas (se cubren con pgTAP y Vitest).

## Alcance de entrega

`refine` (`apps/web`) y `supabase` (migraciones, RLS, RPC y pgTAP). Sin `kestra`, `superset` ni
`workers`. No altera tablas existentes: crea seis tablas en `dominio` y usa los helpers de permisos de
MSF-121.

## Modelo de datos

Las seis tablas son entidades de negocio de Ventas (qué se cobra y cómo se envía), no mecanismos de
plataforma: viven en **`dominio`**, nunca en `public` (Principio VII). El modelo completo, con el DER
y las relaciones, está en [Datos y DER § Ventas catálogos de cobro y envío](datos.md#ventas-catalogos-de-cobro-y-envio-msf-139).

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.formas_pago` | nueva | Catálogo de formas de pago por empresa. |
| `dominio.formas_envio` | nueva | Catálogo de formas de envío por empresa. |
| `dominio.cuentas_cobro` | nueva | Cuentas bancarias/billeteras de la organización. |
| `dominio.cuentas_cobro_empresas` | nueva | Habilitación «Disponible en» (N:M con empresas). |
| `dominio.transportes` | nueva | Empresas de transporte y terminal de retiro de la organización. |
| `dominio.transportes_empresas` | nueva | «Empresas donde se usa» (N:M con empresas). |
| `dominio.empresas` | existente | Solo se referencia (`empresa_id`, FK y validación de organización). |
| `public.organizaciones` | existente | FK de `organizacion_id`; sin cambios. |
| `public.registro_actividad` | existente | Recibe los eventos `cuenta_cobro.*`; sin cambios de esquema (MSF-455). |

Migraciones (aditivas; la reversión está en el encabezado de cada una):

| Migración | Qué agrega |
|---|---|
| `20261020100000_formas_pago.sql` | Tabla, índices, normalización, RLS y grants de `formas_pago`. |
| `20261022120000_formas_pago_rpc.sql` | `crear_forma_pago`, `actualizar_forma_pago`, `cambiar_estado_forma_pago`. |
| `20261022120100_formas_envio.sql` | Tabla, índices, normalización, RLS y grants de `formas_envio`. |
| `20261022120200_formas_envio_rpc.sql` | `crear_forma_envio`, `actualizar_forma_envio`, `cambiar_estado_forma_envio`. |
| `20261022120300_cuentas_cobro.sql` | Tablas, índices, validación de empresa, RLS y grants. |
| `20261022120400_cuentas_cobro_validacion.sql` | `private.cbu_valido`, normalización y validación de CBU/CVU y CUIT. |
| `20261022120500_cuentas_cobro_rpc.sql` | RPC de alta, edición, estado y listado; habilitación por empresa. |
| `20261022120600_cuentas_cobro_actividad.sql` | Disparadores `cuenta_cobro.creada/editada/desactivada/reactivada`. |
| `20261022120700_transportes.sql` | Tablas, índices, normalización de CUIT/correo, RLS y grants. |
| `20261022120800_transportes_rpc.sql` | RPC de alta, edición, estado y listado; reemplazo atómico de empresas. |

Los timestamps del primer y del último bloque no son consecutivos porque las migraciones se
renumeraron al reconstruir la épica sobre `main`; los nombres de archivo son la fuente de verdad.

### Reglas comunes

- La **organización sale de la sesión** (`private.organizacion_id()`); el llamador no la fija.
- **Nombre único**: `(empresa_id, lower(nombre))` en pago y envío; `(organizacion_id,
  lower(btrim(nombre)))` en transportes (incluye inactivos).
- **`updated_at`** avanza solo ante un cambio real y sostiene el bloqueo optimista (`40001`). Un cambio
  solo de empresas habilitadas también lo avanza.
- **No hay DELETE** de catálogos: se desactivan. La única tabla con política y grant DELETE es
  `transportes_empresas` (su RPC reemplaza el conjunto); `cuentas_cobro_empresas` también se reemplaza,
  pero solo desde un ayudante `security definer`, sin grants de escritura directa.
- `anon` no tiene privilegios sobre tablas ni RPC; toda RPC de `public` lleva `revoke … from public,
  anon` y `grant execute … to authenticated`.

## Permisos y RLS

| Operación | Regla |
|---|---|
| Lectura de formas de pago/envío | `organizacion_id = private.organizacion_id()`, `empresa_id` en `private.empresas_accesibles()` y `private.nivel_seccion('ventas')` en `lectura` o `edicion`. |
| Lectura de cuentas y transportes | `organizacion_id = private.organizacion_id()` y `private.nivel_seccion('ventas')` en `lectura` o `edicion`. |
| Escritura | Solo `private.es_administrador_de(organizacion_id)`, en la política RLS **y** con rechazo explícito `42501` en cada RPC. |
| `transportes_empresas` | `select` con la misma regla de Ventas; `insert`/`delete` solo Administrador, usados por la RPC. |
| `cuentas_cobro_empresas` | Solo `select`; la escritura pasa por `private.guardar_empresas_cuenta_cobro` (`security definer`, revalida Administrador y organización). |

Un rol con `ventas` en `edicion` que no es Administrador **lee pero no escribe**. La UI oculta
acciones; la autoridad es la base. La sección `ventas` se resuelve por la empresa activa
(`private.nivel_seccion`), según MSF-121.

## RPC

Todas en `public`, `security invoker` salvo los ayudantes indicados, `search_path = ''` y grants
explícitos. Errores: `42501` permiso · `22023`/`23514` validación (`hint` no usado en estas RPC) ·
`P0002` no existe · `40001` conflicto · `23505` nombre repetido.

| RPC | Contrato |
|---|---|
| `crear_forma_pago(p_empresa_ids, p_nombre, p_tipo, p_exige_cuenta_cobro, p_genera_deuda, p_estado_inicial, p_orden, p_activo)` | Alta multiempresa: un ítem independiente por empresa, todo o nada. Solo Administrador. |
| `actualizar_forma_pago(p_id, p_actualizado_en, …)` | Edición por fila con bloqueo optimista; la empresa no se cambia. |
| `cambiar_estado_forma_pago(p_id, p_activo)` | Activa/desactiva sin tocar datos; idempotente. |
| `crear_forma_envio(p_empresa_ids, p_nombre, p_tipo, p_exige_transporte_guia, p_costo_defecto, p_estado_despacho_inicial, p_orden, p_activo)` | Ídem para envío; costo nulo o `0 ≤ costo < 10.000.000.000`. |
| `actualizar_forma_envio(p_id, p_actualizado_en, …)` / `cambiar_estado_forma_envio(p_id, p_activo)` | Edición con conflicto `40001` y estado idempotente. |
| `crear_cuenta_cobro(p_nombre, p_titular, p_cuit, p_banco, p_alias, p_cbu, p_tipo, p_moneda, p_orden, p_activa, p_notas, p_empresa_ids)` | Alta con CBU/CUIT obligatorios y validados; habilitación por empresa en la misma transacción. |
| `actualizar_cuenta_cobro(p_id, p_actualizado_en, …)` | Edición con bloqueo optimista; la habilitación por empresa se reemplaza en la misma transacción. |
| `cambiar_estado_cuenta_cobro(p_id, p_activa)` | «No usar»/reactivar idempotente; conserva datos e historial. |
| `listar_cuentas_cobro(p_empresa_id, p_estado, p_pagina, p_tamano)` | Listado paginado en servidor; `p_estado` ∈ `todas \| activas \| no_usar`; devuelve `empresas`, `total_filas`. |
| `crear_transporte(p_nombre, p_tipo, p_cuit, … , p_empresa_ids)` | Alta con CUIT opcional validado y empresas donde se usa. |
| `actualizar_transporte(p_id, p_actualizado_en, …)` | Edición con bloqueo optimista; si solo cambian las empresas, igual avanza `updated_at`. |
| `cambiar_estado_transporte(p_id, p_activa)` | Activa/desactiva idempotente; no borra. |
| `listar_transportes(p_empresa_id, p_pagina, p_tamano)` | Listado paginado con `empresas`, `total_filas` (N filtrado) y `total_organizacion` (M). Una página fuera de rango devuelve 0 filas sin totales; el cliente vuelve a la página 1. |
| `private.guardar_empresas_cuenta_cobro(cuenta_id, empresa_ids)` | `security definer`; reemplaza el conjunto y revalida Administrador, organización y empresa. |
| `private.asegurar_empresas_de_transporte(transporte_id, organizacion_id, empresa_ids)` | `security invoker`; reemplaza el conjunto y valida que todas las empresas sean de la organización. |
| `private.cbu_valido(text)` | CBU/CVU de 22 dígitos con los dos dígitos verificadores (bloques de 8 y 14). No se expone a `authenticated`. |
| `private.cuit_valido(text)` | Reutiliza el validador de CUIT ya existente (módulo 11). |
| `private.normalizar_forma_pago`, `private.normalizar_forma_envio`, `private.normalizar_cuenta_cobro`, `private.normalizar_transporte` | Disparadores `security definer` con `search_path = ''`: recortan, normalizan y validan; sin grant a `authenticated`. |

## Validaciones

- **Nombre**: no vacío; máximo 100 caracteres en pago/envío, 120 en cuentas, 200 en transportes.
- **CBU/CVU**: siempre 22 dígitos con verificadores válidos; se acepta con espacios, puntos o guiones
  y se guarda solo con dígitos. Mismos vectores en SQL y en `apps/web/src/lib/ventas/cbu.ts`.
- **CUIT**: con o sin guiones, 11 dígitos y dígito verificador. En cuentas es obligatorio; en
  transportes es opcional (una moto propia puede no tenerlo).
- **Correo del transporte**: formato `usuario@dominio.tld`; la regla está alineada entre el disparador
  y `apps/web/src/lib/ventas/transportes.ts`.
- **Comisión** 0–100 con hasta dos decimales; **plazo de rendición** entero 0–3650; **orden** dentro
  del rango de cada tabla.
- **Costo por defecto** opcional, `0 ≤ costo < 10.000.000.000` (`numeric(12,2)`); vacío se muestra
  «—».
- **CBU/CUIT nunca van a la actividad ni a la consola** de errores: `mensajeDeError` de
  `apps/web/src/lib/ventas/cuentasCobro.ts` loguea solo el código, porque el `details` de un check
  fallido incluye la fila completa.

## Frontend

Rutas dentro del grupo **Ventas** del menú, todas con `RequiereOrganizacionActiva` y
`RequiereAccesoSeccion seccion="ventas"`:

| Ruta | Pantalla / archivo | Fuente visual |
|---|---|---|
| `/ventas/configuracion` | `pages/ventas/configuracion/index.tsx` con pestañas `Formas de pago` y `Formas de envío` | `design/pantallas/VentasConfiguracion.dc.html` |
| `/ventas/cuentas-cobro` | `pages/ventas/cuentas-cobro/list.tsx` | `design/pantallas/CuentasCobro.dc.html` |
| `/ventas/transportes` | `pages/ventas/transportes/list.tsx` | `design/pantallas/VentasTransportes.dc.html` |

- Menú: **Ventas › Transportes** (`DeliveryDiningIcon`), **Ventas › Configuración de ventas**
  (`PointOfSaleIcon`) y **Ventas › Cuentas de cobro** (`AccountBalanceIcon`), en
  `apps/web/src/components/navegacion/destinosPanel.ts`.
- Cliente: `apps/web/src/lib/ventas/formasPago.ts`, `formasEnvio.ts`, `cuentasCobro.ts`,
  `transportes.ts` y `cbu.ts`; diálogos en `apps/web/src/components/ventas/`.
- **Configuración de ventas:** el selector `Empresa` arranca en la empresa activa de la barra
  superior; si la elegida deja de ser accesible vuelve a la activa. El alta ofrece «Empresas donde
  aplica» y crea un ítem por empresa. Al cambiar de empresa, la pestaña recarga con «última petición
  gana».
- **Cuentas de cobro:** el filtro `Tienda` sigue a la empresa activa (`useFiltroPorEmpresaActiva`) y
  permite «Todas las tiendas»; estado y paginación se resuelven en el servidor con
  `listar_cuentas_cobro` (10 por página). Al cambiar de empresa se invalida y recarga la consulta.
- **Transportes:** filtro `Tienda` que arranca en «Todas las tiendas»; el recuento muestra «N de M»
  con los totales que devuelve `listar_transportes`; 25 por página.
- Acciones ocultas sin edición: `Nueva`, `Editar` e interruptores solo se muestran al Administrador.

## Actividad

`20261022120600_cuentas_cobro_actividad.sql` registra, en la misma transacción y solo con sesión:

- `cuenta_cobro.creada` al insertar;
- `cuenta_cobro.editada` al cambiar datos o solo las empresas habilitadas;
- `cuenta_cobro.desactivada` / `cuenta_cobro.reactivada` al cambiar `activa`.

El detalle lleva el nombre de la cuenta; **nunca** el CBU ni el CUIT. Si no hubo cambio real no hay
evento. El contrato general está en [Actividad](../actividad.md).

## Pruebas

- pgTAP: `supabase/tests/database/formas_pago.test.sql`, `formas_envio.test.sql`,
  `cuentas_cobro.test.sql` y `transportes.test.sql` (aislamiento por organización y empresa, lectura
  con `ventas`, escritura solo Administrador, duplicados, valores fuera de lista, CBU/CUIT, rangos,
  conflicto, estado idempotente, sin DELETE, `anon` y eventos sin CBU). `rls_en_toda_tabla` recorre
  las seis tablas.
- Vitest: `pages/ventas/configuracion/*.test.tsx`, `pages/ventas/cuentas-cobro/list.test.tsx`,
  `pages/ventas/transportes/list.test.tsx`, los diálogos de `components/ventas/*.test.tsx` y
  `lib/ventas/{cbu,cuentasCobro,consolaSinDetalle}.test.ts`.
- No hay E2E Playwright de estas pantallas en la épica.

## Revisión de seguridad de cierre (T034 · SC-009)

Revisión `authz-security` de las diez migraciones y de los cuatro pgTAP:

- **Esquema:** las seis tablas nuevas están en `dominio`.
- **RLS:** todas con `enable row level security`; lectura por organización y sección `ventas`;
  escritura solo Administrador; sin DELETE salvo `transportes_empresas` (relación N:M reemplazada por
  la RPC, solo Administrador).
- **`anon`:** `revoke` explícito en tablas y RPC; las funciones privadas de validación no se exponen a
  `authenticated`.
- **Funciones `security definer`:** `search_path = ''`; `private.guardar_empresas_cuenta_cobro`
  revalida Administrador, organización y empresa en el cuerpo.
- **Datos bancarios:** sin CBU/CUIT en `registro_actividad`, en mensajes al usuario ni en
  `console.error` (solo el código de error). Sin service-role en el navegador.
- **Hallazgo corregido en el cierre:** `mensajeDeError` de cuentas de cobro enviaba el error crudo a
  `console.error` y el `details` de un `23514` podía incluir el CBU. Ahora loguea solo el código; test
  en `apps/web/src/lib/ventas/cuentasCobro.test.ts`.

## Reversión

Cada migración es aditiva y documenta su `drop` en el encabezado. Orden inverso:

1. `20261022120800_transportes_rpc.sql`: `drop function` de `listar_transportes`,
   `cambiar_estado_transporte`, `actualizar_transporte`, `crear_transporte` y
   `private.asegurar_empresas_de_transporte`.
2. `20261022120700_transportes.sql`: disparadores y funciones de normalización/validación, y
   `drop table dominio.transportes_empresas; drop table dominio.transportes;` — **exportar antes**:
   el drop se lleva los transportes cargados.
3. `20261022120600_cuentas_cobro_actividad.sql`: disparadores y funciones de actividad; restaurar
   `private.normalizar_cuenta_cobro()` a la definición de `20261022120400`.
4. `20261022120500_cuentas_cobro_rpc.sql`: RPC y `private.guardar_empresas_cuenta_cobro`.
5. `20261022120400_cuentas_cobro_validacion.sql`: disparador, `private.normalizar_cuenta_cobro()` y
   `private.cbu_valido(text)`.
6. `20261022120300_cuentas_cobro.sql`: `drop table dominio.cuentas_cobro_empresas; drop table
   dominio.cuentas_cobro;` — exportar antes.
7. `20261022120200_formas_envio_rpc.sql` y `20261022120100_formas_envio.sql`: RPC, disparador y
   `drop table dominio.formas_envio` — exportar antes.
8. `20261022120000_formas_pago_rpc.sql` y `20261020100000_formas_pago.sql`: RPC, disparador y
   `drop table dominio.formas_pago` — exportar antes.

Para deshacer el PR completo: `git revert -m 1 <merge>`. Los datos cargados no se recuperan con el
revert.

## Fuera de alcance

La elección de estos catálogos al cargar un comprobante (MSF-159), la carga de los datos reales
(MSF-142), las pestañas RMA/Contrarreembolsos/Estados, los tableros de despacho y motos, «Envíos del
mes», Exportar y el transporte preferido del cliente (MSF-180). La matriz pantalla↔criterios de la
spec declara cada ítem del prototipo que queda afuera.
