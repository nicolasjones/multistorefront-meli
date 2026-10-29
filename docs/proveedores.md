---
owner: producto
sources:
  - specs
---

# Proveedores

Épica MSF-205 (spec `specs/20261018-190000-proveedores-y-productos/`). Cubre el alta y edición con CUIT
(F-PRV-01, MSF-336), el listado y la búsqueda (F-PRV-02, MSF-351) y la relación con los productos (F-PRV-03,
MSF-367). Permisos: `docs/permisos-por-rol.md`; eventos: `docs/actividad.md`; catálogo: `docs/catalogo.md`.

## Fuera de alcance (seguimientos)

El prototipo muestra y esta épica **no** entrega: condiciones de compra, «Compra para», «Enviar correo a proveedor»,
importar/exportar proveedores, N.º correlativo, Último ingreso y Costo en la ficha (MSF-219/MSF-179), código de
barras y varios proveedores por producto. «Desactivar» reemplaza a «Eliminar» del prototipo. Cada punto tiene su
seguimiento en Jira (T029): condiciones de compra MSF-523, «Compra para» MSF-524, «Enviar correo» MSF-525,
importar/exportar MSF-526, N.º correlativo MSF-527, Último ingreso y Costo MSF-528, código de barras MSF-529 y
varios proveedores por producto MSF-530.

## Revisión de seguridad de cierre (T028)

Revisión de `20261021161500`–`190700`: esquemas verificados (`proveedores` y `productos` en `dominio`; `proveedores_basico`
y las RPC en `public`); RLS por organización y `nivel_seccion('proveedores')` en select/insert/update, sin `DELETE`;
grants por columna sin `organizacion_id`; RPC `security invoker` con `revoke … from public, anon` y `grant … to
authenticated`; disparadores `security definer` con `search_path = ''` y sin `execute` para clientes; la vista
`proveedores_basico` (única no-invoker) filtra por organización y nivel y no expone CUIT ni contacto.
Diferencias con el prototipo: Desactivar en vez de Eliminar y lo listado arriba. Cambio de contrato de las RPC de
producto (SC-007): ver «Relación con los productos».
Validación final: las pruebas pgTAP (RLS, grants, `search_path` de los disparadores) y `pnpm test` corren en el CI de
las historias F-PRV-01/02/03; en esta historia (solo documentación) se corrieron `pnpm lint`, `pnpm docs:check` y
`pnpm matriz:check`, verdes.

## Modelo

- Tabla `dominio.proveedores` (Principio VII: entidad de negocio del producto → esquema `dominio`).
  Columnas: `razon_social`, `cuit`, `persona_contacto`, `correo`, `telefono`, `direccion`, `observaciones`,
  `activo`, `creado_en`, `updated_at`. El proveedor pertenece a la **organización** (la sección es compartida
  entre empresas).
- Migraciones: `20261021161600_proveedores_tabla.sql` (tabla, CUIT, RLS, grants),
  `20261021161700_proveedores_rpc.sql` (RPC) y `20261021161800_proveedores_actividad.sql` (actividad).

## CUIT

La base lo normaliza y valida con el disparador `private.normalizar_proveedor` (no solo el formulario):
acepta guiones, puntos y espacios, se guarda **solo con dígitos**, exige 11 dígitos con dígito verificador
módulo 11 (resto 1 = inválido) y es **único por organización, también entre desactivados**
(`unique (organizacion_id, cuit)`). En pantalla se muestra `XX-XXXXXXXX-X`. El espejo del frontend es
`apps/web/src/lib/cuit.ts`; ambos comparten vectores (`cuit.test.ts` y `supabase/tests/database/proveedores.test.sql`).

## Permisos

Sección `proveedores` de la matriz de roles: **Administrador** y **Administración** editan; con `lectura` se ve
la ficha sin acciones; el resto (Depósito, Operador, Mostrador, Consulta) tiene `ninguno` y la base no les
entrega filas (CUIT ni contacto). Sin política ni grant `DELETE`: **se desactiva, no se borra**. `anon` no
tiene privilegios. El llamador no fija `organizacion_id` (sale de la sesión), `creado_en` ni `updated_at`.

## RPC (`security invoker`, rige RLS)

| RPC | Qué hace |
|-----|----------|
| `public.crear_proveedor(...)` | Alta; exige `edicion`; devuelve el proveedor. |
| `public.actualizar_proveedor(p_id, p_actualizado_en, ...)` | Edición con **bloqueo optimista** por `updated_at`: si cambió, error `40001` y no se pisa nada. |
| `public.cambiar_estado_proveedor(p_id, p_activo)` | Desactiva/reactiva; idempotente. |
| `public.guardar_empresas_de_proveedor(p_proveedor_id, p_empresa_ids)` | «Compra para» (MSF-524): reemplaza atómicamente las tiendas del proveedor; `security definer`, exige `edicion` en Proveedores, valida proveedor y tiendas de la organización, normaliza repetidos y devuelve cuántas quedaron. `anon` sin ejecución. |
| `public.listar_proveedores(p_busqueda, p_estado, p_pagina, p_tamano, p_empresa_id)` | Listado paginado (F-PRV-02): razón social parcial sin mayúsculas ni tildes, o CUIT con/sin guiones (solo si el texto es numérico); `p_estado` = `activos` (por defecto) / `inactivos` / `todos`; orden por razón social e `id`; 25 por página, tope 200; devuelve `empresas` (jsonb `[{id, nombre}]`, «Compra para») y `total_filas`; `p_empresa_id` (opcional) deja los proveedores que compran para esa tienda **y los que no tienen ninguna tienda asignada** (transversales; se muestran en el filtro de cualquier tienda de la organización). Sin `lectura`/`edicion` la RLS no entrega filas. Índices GIN `pg_trgm` en `dominio`. |

Errores que reconoce la app: `23505` (CUIT repetido), `40001` (conflicto de edición), `42501` (sin permiso),
`P0002` (no existe o es de otra organización), `22023` (dato inválido).

## Pantallas

- Listado `/proveedores` (`apps/web/src/pages/proveedores/list.tsx`, hook `useListarProveedores`): tabla
  Razón social, CUIT (con guiones), Correo y Teléfono; buscador «Buscar por razón social o CUIT» (con espera
  de 300 ms, búsqueda en el servidor); filtro Estado (Activos / Inactivos / Todos; los inactivos llevan la
  etiqueta «Inactivo»); filtro Tienda que **sigue la empresa activa** de la barra superior
  (`useFiltroPorEmpresaActiva`, US5 de `specs/20261018-170000-empresas-accesibles-y-filtro/`): arranca en ella,
  la acompaña al cambiarla y permite fijar otra tienda o «Todas» sin tocar la activa persistida; al filtrar
  por una tienda también se muestran los proveedores **sin «Compra para»** (transversales, con «—» en la
  columna), para que un alta sin tiendas no desaparezca del listado; paginación de
  25 conservando búsqueda y estado; **Nuevo proveedor** (solo con
  `edicion`) y **Ver ficha**; estados «Sin resultados», vacío inicial, carga y error con «Reintentar»;
  tarjetas en pantallas angostas. Entrada de menú **Proveedores** (icono camión) junto a Clientes, visible con
  `lectura` o `edicion`; la ruta directa sin permiso lleva a «Acceso restringido».
- Ficha `/proveedores/show/:id` (`apps/web/src/pages/proveedores/show.tsx`): datos, estado,
  **Editar** y **Desactivar/Reactivar** con confirmación; acciones ocultas sin `edicion`. El botón «Proveedores» vuelve al listado.
- Diálogo Nuevo/Editar (`apps/web/src/components/proveedores/ProveedorFormDialog.tsx`), reutilizado por el
  listado de F-PRV-02 para «Nuevo proveedor».
- El prototipo muestra «Eliminar proveedor»: el documento manda y se implementa **Desactivar/Reactivar**.
  Condiciones de compra quedan fuera de alcance (ver la matriz de la spec).

## «Compra para» (MSF-524, seguimiento de MSF-205)

Dato **informativo**: las tiendas (empresas) para las que se le compra a un proveedor. No restringe el ingreso de
mercadería (si algún día debe hacerlo, es otra historia en MSF-219).

- Tabla `dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id)`, PK compuesta, esquema `dominio`
  (Principio VII: es una relación del negocio). RLS de lectura por organización y sección `proveedores`; sin grants
  de escritura: solo escribe `guardar_empresas_de_proveedor`. Un disparador valida que proveedor y tienda sean de la
  misma organización. Los proveedores existentes quedan sin tiendas marcadas; un alta nueva también (hay que elegir).
- Diálogo Nuevo/Editar: casillas «Compra para» (una por tienda), con el mismo patrón de
  `SelectorEmpresas` que «Disponible en» de Cuentas de cobro. Se guardan después del proveedor; si fallan, el aviso
  dice que el proveedor sí se guardó y el reintento no lo duplica. Si no se tocan, no se llama a la RPC.
- Listado: columna «Compra para» (chips) y filtro «Tienda» (servidor, `p_empresa_id`). Ficha: dato «Compra para».
- Reversión (migración posterior): ver el encabezado de `20261021162400_proveedores_empresas.sql`.

## Enviar correo a proveedor (MSF-525)

- Botón **Enviar correo** en la ficha y en cada fila del listado (solo con `edicion` en Proveedores y si el
  proveedor tiene correo) que abre `EnviarCorreoProveedorDialog` (`Para` solo lectura, `Asunto`, `Mensaje`;
  asunto hasta 200 y mensaje hasta 5000 caracteres) y confirma con «Correo enviado al proveedor».
- Edge Function `supabase/functions/enviar-correo-proveedor`: exige sesión, nivel `edicion` en `proveedores`
  (`permisos_actuales()`) y lee el proveedor con la sesión de quien llama (RLS acota a su organización). El
  destinatario **no viaja desde el navegador**: es siempre `dominio.proveedores.correo`, así no es un relay
  abierto. Envía por el SMTP de `_shared/correo.ts` (`SMTP_*` solo en la función; sin service-role).
  Pruebas: `pnpm test:edge:enviar-correo-proveedor`.
- Sin tablas ni migraciones. Fuera de alcance (decisión provisoria, sin respuesta de negocio): historial de
  envíos, remitente por organización y límite de frecuencia — a consultar si se necesitan.

## Relación con los productos (F-PRV-03, MSF-367)

- `dominio.productos` gana `proveedor_id` (FK compuesta `(proveedor_id, organizacion_id)`, `on delete restrict`) y
  `codigo_proveedor` (hasta 80); no hay código sin proveedor, y quitar el proveedor borra el código. Un proveedor
  **nuevo** asignado debe estar activo; si se desactiva después, la asignación se conserva
  (`20261021162000_productos_proveedor.sql`).
- Vista `public.proveedores_basico` (`id`, `razon_social`, `activo`) para el selector: **no es `security_invoker`
  a propósito** (el Operador no lee la tabla) y filtra por organización y nivel; no expone CUIT ni contacto
  (`20261021162100_proveedores_basico.sql`).
- **Cambio de contrato** (`20261021162200_productos_proveedor_rpc.sql`): `crear_producto` y `actualizar_producto`
  reciben `p_proveedor_id` y `p_codigo_proveedor` opcionales al final. `actualizar_producto` suma `p_cambiar_proveedor`
  (default `false`): sin él, el proveedor y el código **no cambian** (los llamadores con la firma anterior no pierden
  datos); con `true` se reemplazan (nulo = sin proveedor) y el formulario lo envía siempre. El cambio avanza `updated_at` y
  deja `producto.editado`. Contrato para MSF-219 y reposición: `productos.proveedor_id` / `codigo_proveedor`.
- `public.productos_de_proveedor(p_proveedor_id, p_pagina, p_tamano)` (`20261021162300_…`): exige `proveedores` y
  `productos`; orden por nombre, tope 100, `total_filas`. La ficha lo muestra en la sección **Productos**
  (`ProductosDelProveedor.tsx`), con carga y error aislados; «Ver producto» abre la edición del producto.
- **Costo en la ficha** (MSF-528, `20261021162400_productos_de_proveedor_costo.sql`): la RPC suma `moneda` y `costo`
  (de `dominio.producto_costos`); `costo` es `null` sin Rentabilidad en lectura/edición o sin costo cargado. La columna
  **Costo** (moneda del producto, `—` si es null) solo se muestra con Rentabilidad. Cambia el `returns table`: drop +
  create; reversión = drop y recrear la versión de `20261021162300`. **Último ingreso** sigue fuera: depende de
  MSF-219 (no existe tabla de ingresos); se agregará a esta RPC con ese ingreso.
- Reversión: restaurar las RPC de `20261017120200`/`20261017120400`, luego `drop function productos_de_proveedor`,
  `drop view proveedores_basico` y quitar las dos columnas (migración posterior, exportando antes los datos).

## Importación desde el panel actual (F-MIG-02, MSF-313)

El listado suma «Importar» (solo Administrador) que abre el asistente de migración
(`/migracion/importar/proveedores`). `dominio.proveedores.id_externo` guarda el identificador del
panel actual (nullable, único por organización) y concilia la carga: reimportar actualiza, no duplica.
Los vínculos con productos se cargan con `/migracion/importar/vinculos-proveedor-producto`.
Detalle y reglas en [migracion-datos.md](migracion-datos.md).

## Actividad

`proveedor.creado|editado|desactivado|reactivado` en `public.registro_actividad` (ver `docs/actividad.md`).

## Reversión

Migraciones aditivas. Para volver atrás, en una migración **posterior** (no en el mismo PR; exportar antes los
datos): quitar los disparadores de actividad y `proveedores_normalizar`, las tres RPC, `public.listar_proveedores` y sus dos índices (`proveedores_razon_social_trgm_idx`, `proveedores_cuit_trgm_idx`), las funciones
`private.registrar_actividad_proveedor*`, `private.normalizar_proveedor` y `private.cuit_valido`, y la tabla
`dominio.proveedores`. El encabezado de cada migración lista los pasos exactos.
---
owner: producto
sources:
  - specs
  - apps/web/src
---
# Proveedores (MSF-205)
**Épica:** MSF-205 · **Historias:** F-PRV-01 (MSF-336), F-PRV-02 (MSF-351) y F-PRV-03 (MSF-367).
**Spec:** `specs/20261018-190000-proveedores-y-productos/`.
**Construcción interna:** [Proveedores: modelo, RPC y pantallas](tecnico/proveedores.md).
La organización guarda sus proveedores con CUIT y contacto, los busca desde el panel y asigna a cada
producto el proveedor que lo abastece. Es la base del ingreso de mercadería (MSF-219) y de los reportes
de reposición.
## Qué resuelve
- Antes no había una lista propia de proveedores ni forma de saber quién abastece cada producto.
- Ahora cada proveedor tiene una ficha con **razón social**, **CUIT**, persona de contacto, correo,
  teléfono, dirección y observaciones, y se puede **desactivar** sin perder sus datos.
- El listado permite encontrar un proveedor entre unos 135 por razón social o CUIT, incluso si está
  desactivado.
- Cada producto guarda **un proveedor principal** y el **código con que ese proveedor lo conoce**; la
  ficha del proveedor muestra los productos que abastece.
- Quien registra mercadería elige el proveedor por un selector mínimo (solo razón social), sin ver CUIT
  ni contacto.
## Para quién
| Persona | Qué puede hacer |
|---|---|
| **Administrador/a y Administración** (`edicion` en Proveedores) | Crear, editar, desactivar y reactivar proveedores; ver la ficha y sus productos |
| **Con `lectura` en Proveedores** | Ver el listado y la ficha, sin acciones de alta, edición ni estado |
| **Operador** (`edicion` en Productos, `ninguno` en Proveedores) | Elegir proveedor y cargar el código del proveedor en el producto; no ve CUIT ni contacto |
| **Depósito** (registra ingresos) | Elegir proveedor por la vista mínima al ingresar mercadería (MSF-219); no ve CUIT ni contacto |
| **Mostrador, Consulta y demás roles sin Proveedores** | No ven la sección ni reciben filas de la tabla por la API |
La base vuelve a validar el permiso: ocultar botones es comodidad, no la autorización.
Detalle por rol: [Permisos por rol](permisos-por-rol.md).
**Empresa activa: no aplica.** El proveedor pertenece a la **organización** y se comparte entre sus
empresas; no hay columna de empresa ni filtro por empresa activa. Cambiar de empresa no recarga el
listado ni cierra diálogos por ese motivo (los diálogos siguen el ciclo normal de guardado).
## Cómo se usa
### Listado y búsqueda
La sección **Proveedores** vive en `/proveedores`, dentro del grupo **Clientes y proveedores** del menú.
Muestra las columnas **Razón social**, **CUIT**, **Correo** y **Teléfono**, ordenadas por razón social.
- **Buscar por razón social o CUIT:** filtra en el servidor por coincidencia parcial, sin distinguir
  mayúsculas ni tildes; el CUIT se encuentra con o sin guiones.
- **Estado:** por defecto solo se ven los **activos**; el filtro permite ver **Inactivos** o **Todos**
  para reactivar uno.
- **Paginación** de 25 por página, conservando búsqueda y filtro.
- **Nuevo proveedor** (solo con `edicion`) abre el diálogo de alta; **Ver ficha** abre la ficha.
- Estados: «Sin resultados», vacío inicial con la invitación a crear el primero, carga y error con
  **Reintentar**.
### Alta y edición
El diálogo pide **Razón social** y **CUIT** (obligatorios), más persona de contacto, correo, teléfono,
dirección y observaciones. El CUIT:
- se acepta con guiones, puntos o espacios y se guarda solo con dígitos;
- debe tener 11 dígitos y dígito verificador válido;
- se muestra como `XX-XXXXXXXX-X`;
- es **único por organización**, también entre proveedores desactivados.
Un CUIT repetido, un correo con formato inválido o una edición simultánea muestran un mensaje claro
junto al campo o sobre el diálogo, sin identificadores técnicos. Si otra persona modificó el proveedor
mientras lo editabas, se avisa del conflicto y no se pisa su cambio.
### Ficha, desactivar y reactivar
La ficha (`/proveedores/show/:id`) muestra todos los datos, el estado y la sección **Productos** con
**Producto**, **Código del proveedor** y **Ver producto**, paginada de 10 en 10.
- **Editar** abre el mismo diálogo con los datos cargados.
- **Desactivar** pide confirmación: el proveedor queda archivado, **no se elige en nuevos ingresos ni
  productos**, conserva sus datos y sus productos asignados, y se puede **Reactivar**.
- **No existe «Eliminar»**. El prototipo lo dibuja, pero manda el requisito: se desactiva, no se borra.
- Cada alta, edición, desactivación y reactivación queda en **Actividad** con quién, cuándo y qué
  proveedor (por razón social), sin CUIT ni identificadores internos.
### Proveedor en el producto
En el alta y la edición de producto hay dos campos opcionales:
- **Proveedor:** selector con búsqueda por razón social; solo ofrece proveedores activos para nuevas
  asignaciones.
- **Código del proveedor:** texto libre de hasta 80 caracteres; no se puede cargar sin proveedor.
Si se quita el proveedor, también se borra el código. Un producto ya asignado a un proveedor que luego
se desactiva **conserva la asignación** y se sigue mostrando; el proveedor desactivado no se ofrece para
nuevas asignaciones.
## Fuera de alcance
El prototipo muestra más de lo que esta épica entrega. Queda **fuera de alcance** y trazado como
seguimiento en Jira: condiciones de compra (condición de pago, moneda, plazo de entrega, compra mínima;
MSF-523), «Compra para» por tienda (MSF-524), «Enviar correo a proveedor» (MSF-525), importar y exportar
proveedores (MSF-526), N.º correlativo (MSF-527), Último ingreso y Costo en la ficha (MSF-528, dependen
de MSF-219/MSF-179), código de barras (MSF-529) y varios proveedores por producto (MSF-530).
El **costo del producto** vive en Catálogo y Precios (MSF-179), no en esta épica. El **ingreso de
mercadería** y los **reportes de reposición** son MSF-219 y siguientes: esta épica solo deja el contrato
de datos (`productos.proveedor_id` y `productos.codigo_proveedor`) y la vista mínima para elegir.
## Para seguir
- **[Catálogo de productos](catalogo.md)** — alta y edición del producto, donde se elige el proveedor.
- **[Ingreso de mercadería por proveedor](producto/ingreso-de-mercaderia.md)** — consumo del proveedor.
- **[Actividad e historial](actividad.md)** — eventos `proveedor.*`.
- **[Permisos por rol](permisos-por-rol.md)** — sección `proveedores` de la matriz.
