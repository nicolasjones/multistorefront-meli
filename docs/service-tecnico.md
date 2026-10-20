# Service técnico

Épica MSF-182 · spec en `specs/20261020-100000-service-alta-estados-y-permisos/`. Este documento crece con cada
historia; hoy cubre **F-SVC-01 · Modelos de equipo y estados de reparación configurables** (MSF-254) y
**F-SVC-02 · Alta y edición de reparación** (MSF-283).

## Modelo de datos (F-SVC-02)

Esquema (Constitución, Principio VII): `dominio.reparaciones` es la entidad central del negocio del taller y
`dominio.reparacion_historial` su bitácora; las dos van a **`dominio`**, no a `public`. Las RPC viven en `public`
(contrato de la app) y las ayudas internas en `private`.

| Tabla | Columnas | Reglas |
|-------|----------|--------|
| `dominio.reparaciones` | `id`, `organizacion_id` (de la sesión), `empresa_id` (Tienda), `numero`, `cliente_id`, `contacto`, `modelo_id`, `estado_id`, `numero_serie` (opcional), `accesorios`, `falla`, `costo_mano_obra`, `costo_repuestos` (ARS sin IVA, ≥ 0), `tecnico_id`, `ingreso_en`, `entrega_prevista`, `entrega_real`, `entregado_por`, `anulada_en`, `anulada_motivo`, `creado_en`, `updated_at` | `unique (empresa_id, numero)`: la serie es **por empresa**. FK compuestas `(cliente_id, organizacion_id)`, `(modelo_id, organizacion_id)` y `(estado_id, organizacion_id)` contra Clientes, Modelos y Estados: no se puede cruzar organización. `unique (id, organizacion_id)` habilita la FK del historial. `entrega_prevista >= ingreso_en`; la anulación se guarda completa (fecha y motivo juntos). Sin `delete`: se anula (F-SVC-03). |
| `dominio.reparacion_historial` | `id`, `organizacion_id`, `reparacion_id`, `tipo` (`alta`/`estado`/`entrega`/`anulacion`), `estado_anterior_id`, `estado_nuevo_id`, `nota`, `usuario_id`, `creado_en` | Solo lectura para la app: no hay grants de `insert`/`update`/`delete`. Lo escriben las RPC `security definer` en la misma transacción que la operación. FK compuestas por organización. |

**RLS**: las dos tablas filtran por `organizacion_id = private.organizacion_id()` y por nivel de `service_tecnico`
(`private.nivel_seccion` en `lectura`/`edicion`) para `select`. `anon` no tiene privilegios. `reparaciones` **no**
tiene políticas ni grants de escritura: todas las escrituras pasan por RPC. Los **costos internos no tienen `select`
directo** (grant por columna sin `costo_mano_obra` ni `costo_repuestos`): solo los devuelve `obtener_reparacion`,
enmascarados en `null` sin la acción `ver_costos` (FR-021).

Disparadores `before insert or update`: validan que la tienda y el técnico sean de la organización, normalizan
textos, redondean importes a dos decimales, mantienen `updated_at` solo ante un cambio real (bloqueo optimista) y
rechazan cargar costos sin `ver_costos` (`42501`). Sin sesión (migraciones, sembrados) el control de costos no
aplica.

## Modelo de datos (F-SVC-01)
Esquema (Constitución, Principio VII): las dos tablas son entidades de negocio del producto → **`dominio`**.
Ambas son **por organización** (no por empresa), con RLS, sin `delete` y sin acceso de `anon`.

| Tabla | Columnas | Reglas |
|-------|----------|--------|
| `dominio.modelos_equipo` | `id`, `organizacion_id` (de la sesión), `equipo`, `modelo`, `mano_obra_base` (ARS, sin IVA, `numeric(12,2)` ≥ 0), `activo`, `creado_en`, `updated_at` | Equipo + modelo únicos por organización sin distinguir mayúsculas ni tildes (incluye inactivos): índice `modelos_equipo_org_equipo_modelo_key`. `unique (id, organizacion_id)` para la FK compuesta de F-SVC-02. |
| `dominio.estados_reparacion` | `id`, `organizacion_id`, `nombre`, `descripcion` («Qué significa»), `orden`, `avisa_cliente`, `cierra`, `tono`, `activo`, `creado_en`, `updated_at` | Nombre único por organización sin distinguir mayúsculas ni tildes: índice `estados_reparacion_org_nombre_key`. `orden` no es único a propósito (permite el intercambio atómico). `orden` es **orientativo**: el `grant insert` lo incluye porque `crear_estado_reparacion` es `security invoker`, así que un insert directo por la API puede duplicarlo sin pasar por el bloqueo de la RPC; `mover` desempata por `id` y el orden mostrado sigue siendo estable. `cierra` y `tono` los fija el sembrado: la API no los escribe. Por la misma razón (`security invoker`) el `grant update` por columna incluye `orden` —`mover_estado_reparacion` lo necesita—: una persona con `edicion` puede escribir `orden`, `nombre` o `activo` directo por la API, saltándose el bloqueo por organización y el `updated_at` de las RPC; queda acotado a su organización por RLS y es un límite conocido (la UI siempre pasa por las RPC). |

`private.clave_texto(text)` (minúsculas, sin espacios de los bordes, sin tildes) arma la clave de comparación; no hay
`unaccent` en el stack.

**RLS**: `organizacion_id = private.organizacion_id()` y nivel de la sección `service_tecnico`
(`private.nivel_seccion`): `select` con `lectura` o `edicion`; `insert`/`update` con `edicion`. Un disparador
`before insert or update` recorta los textos y hace avanzar `updated_at` solo ante un cambio real (bloqueo optimista).

## Sembrado (F-SVC-01)

`private.sembrar_service(organizacion)` (idempotente) crea los **siete modelos** y los **siete estados** del
prototipo (`design/pantallas/ServicioModelos.dc.html`, `ServicioEstados.dc.html`). Corre por disparador al crear una
organización y por relleno de las existentes. No pisa lo que la organización ya editó.

- Modelos: Nintendo Switch Estándar / Lite / OLED, Joystick Pro Controller / Joy-Con (par), PlayStation 4 Slim
  (**inactivo**, como en el prototipo) y PlayStation 5 Estándar.
- Estados (en orden): Recibido, En diagnóstico, Esperando repuesto, En reparación, Listo para entregar, Entregado,
  Sin reparación. Cierran: Entregado y Sin reparación. Avisan al cliente: Recibido, Esperando repuesto, Listo para
  entregar y Sin reparación.
- El **octavo estado** que menciona la épica se define con el cliente y se agrega desde la pantalla, sin migración.

## RPC de catálogos (F-SVC-01; todas `security invoker`; exigen `edicion`; `revoke … from public, anon`, `grant execute … to authenticated`)

| RPC | Qué hace |
|-----|----------|
| `crear_modelo_equipo(equipo, modelo, mano_obra_base)` | Alta. Duplicado → `23505`. |
| `actualizar_modelo_equipo(id, actualizado_en, equipo, modelo, mano_obra_base)` | Edición con bloqueo optimista (`40001` si cambió). |
| `cambiar_estado_modelo_equipo(id, activo)` | Activa/desactiva; idempotente. |
| `crear_estado_reparacion(nombre, descripcion, avisa_cliente)` | Alta al final del orden (serializada por organización). |
| `actualizar_estado_reparacion(id, actualizado_en, nombre, descripcion, avisa_cliente)` | Edición con bloqueo optimista. |
| `mover_estado_reparacion(id, 'subir' \| 'bajar')` | Intercambia `orden` con el vecino en una sola sentencia; en un extremo no hace nada. |
| `cambiar_estado_estado_reparacion(id, activo)` | Activa/desactiva; idempotente. |

`avisa_cliente` y `cierra` **solo se guardan y se muestran**: esta épica no envía ningún aviso al cliente (FR-006).

En ambas pantallas, con `edicion`, el botón «Editar» de cada fila abre el mismo diálogo precargado (equipo/modelo/mano de obra; nombre/«Qué significa»/aviso) y guarda con `actualizar_*` y bloqueo optimista por `updated_at`. Límite conocido: desactivar un estado que cierra (p. ej. «Entregado») no tiene guarda en esta épica; el aviso por uso es FR-019 (F-SVC-02).

## RPC de reparaciones (F-SVC-02)

Todas son `security definer` (la tabla no admite escritura directa), fijan la organización desde la sesión, exigen
`edicion` en `service_tecnico` (salvo las de lectura, que aceptan `lectura`) y llevan `revoke … from public, anon` +
`grant execute … to authenticated`. Los errores de validación usan `22023` y llevan el campo afectado en `hint`;
sin permiso `42501`; conflicto `40001`; anulada `55000`; inexistente `P0002`.

| RPC | Qué hace |
|-----|----------|
| `crear_reparacion(empresa, cliente, modelo, contacto, serie, accesorios, falla, costo_mano_obra, costo_repuestos, tecnico, entrega_prevista)` | Valida tienda accesible, cliente no archivado, modelo activo y técnico elegible (todos de la organización). Asigna el **próximo número de la empresa** bajo `pg_advisory_xact_lock`, el **primer estado activo por `orden`** y el **ingreso de hoy** (zona Argentina). Escribe el evento `alta` del historial y la actividad `reparacion.creada`. Devuelve la reparación como JSON con `codigo` `R-0001`. |
| `actualizar_reparacion(id, updated_at, cliente, modelo, contacto, serie, accesorios, falla, costo, costo, tecnico, ingreso, entrega_prevista)` | Bloqueo optimista por `updated_at` (`40001` si cambió) y `for update` para serializar ediciones. No cambia número, tienda ni estado; rechaza anuladas (`55000`). Valida cliente y modelo obligatorios, importes ≥ 0 y entrega prevista ≥ ingreso. `null` en un costo = sin cambio; un valor exige `ver_costos`. |
| `obtener_reparacion(id)` | Devuelve la reparación con cliente, modelo, estado y tienda. Acepta `lectura`. Los costos llegan `null` sin `ver_costos`; `puede_ver_costos` le dice a la UI qué mostrar. |
| `tecnicos_de_service()` | Usuarios activos de la organización con `edicion` en Service técnico: solo `user_id` y nombre visible (sin nombre: "Técnico sin nombre", nunca el email). |
| `uso_modelo_equipo(id?)` / `uso_estado_reparacion(id?)` | Cantidad de reparaciones que usan cada modelo/estado (`security invoker`: rige la RLS). Sin id devuelven todos los que tienen uso. |

`private.siguiente_numero_reparacion(empresa)` toma un bloqueo asesor por empresa que se libera al terminar la
transacción y calcula `max(numero) + 1`: dos altas simultáneas se serializan, sin repetidos ni saltos, y el número
no se consume si la transacción falla. `private.codigo_reparacion(numero)` arma `R-0001` solo para presentar; la
base guarda el entero.

## Alta, edición y uso (F-SVC-02)

- **Cliente**: `ClienteSelector` busca con `public.buscar_clientes` (RLS de la organización, sin bajar la lista
  completa). Al elegirlo, **Contacto** se completa con celular, si no teléfono, si no correo, y queda editable
  (FR-014).
- **Alta rápida de cliente** (FR-015): si la persona puede editar Clientes, «Nuevo cliente» abre
  `AltaRapidaClienteDialog`, que reutiliza el alta de la pantalla Clientes (recurso `clientes` de Refine,
  `validarCliente`/`aValores` y `guardar_empresas_de_cliente`), **sin duplicar validaciones**. En `main` todavía no
  existe la RPC de alta mínima de MSF-180 (Decisión abierta 7): cuando llegue, solo cambia el cuerpo de ese
  diálogo. El cliente creado queda elegido en la reparación; los errores se muestran dentro del diálogo.
- **Pantalla** `/service-tecnico/reparaciones/nueva` y `/service-tecnico/reparaciones/:id`: breadcrumb
  «Reparaciones», título `Nueva reparación` o `Reparación R-000N` con cliente · equipo, tarjeta «Cliente y equipo»
  (Tienda, Cliente, Contacto, Consola o equipo, Modelo, N.º de serie, Accesorios, Falla), tarjeta «Costo interno»
  (solo con `ver_costos`) y tarjeta «Técnico y fechas» (Técnico, Ingreso, Entrega prevista, Entrega real de solo
  lectura). «Guardar» crea o edita; el alta navega al detalle recién creado.
- **Tienda**: por defecto la empresa activa; no se puede cambiar al editar (la numeración y la pertenencia quedan
  fijadas en el alta). El selector solo ofrece empresas accesibles (`useEmpresasAccesibles`).
- **Costos**: son internos (ARS, sin IVA). Sin `ver_costos` no se ven ni se editan; la base los enmascara y rechaza
  escrituras (`42501`). No es el «Total al cliente» (MSF-199).
- **Conflicto**: si otra pestaña guardó antes, la RPC devuelve `40001`; la pantalla muestra «Otra persona modificó
  esta reparación…» con «Recargar» y no pisa nada.
- **Anuladas y lectura**: una reparación anulada se muestra marcada y deshabilitada (FR-017); con `lectura` se ve
  pero no se ofrece «Guardar». Las anuladas tampoco admiten edición en la base (`55000`).
- **Pestaña Reparaciones** (FR-018): ofrece «Nueva reparación» y lleva al detalle. La tabla, los KPIs y los filtros
  son de MSF-199; esta historia no los implementa.
- **Uso y desactivación** (FR-019): Modelos y Estados muestran la columna **Reparaciones** con la cantidad de
  reparaciones que los usan. Al desactivar uno en uso se abre un aviso con la cantidad y se pide confirmación; el
  modelo/estado deja de ofrecerse en altas nuevas pero las reparaciones existentes lo conservan.
- **Actividad** (FR-020): `reparacion.creada` y `reparacion.editada` se registran en la misma transacción, con el
  código visible; sin cambio real no hay evento (ver `docs/actividad.md`).

## Actividad

Disparadores `security definer` en la misma transacción: `modelo.creado|editado|desactivado|reactivado`,
`estado.creado|editado|desactivado|reactivado|reordenado`, `reparacion.creada` y `reparacion.editada`, con el
nombre o código visible (nunca ids). Sin evento si no hubo cambio real; ni sin sesión (migraciones) ni durante el
sembrado de una organización nueva (`app.sembrando`, aunque la cree una persona con sesión) se registra nada. La
edición de una reparación no registra evento si solo cambian estado, entrega o anulación (eso es de F-SVC-03). Ver
`docs/actividad.md`.

## Pantallas y menú

- Menú **Service → Service técnico** (icono herramienta), visible por nivel de `service_tecnico` **y** por la
  funcionalidad `service-tecnico` de la organización (`private.tiene_feature`, vía `useFeatureHabilitada`). Entra a
  `/service-tecnico/reparaciones` (primera pestaña del prototipo); `/service-tecnico` y las rutas desconocidas
  redirigen ahí.
- La pantalla Estados incluye el switch «Activo» (RPC `cambiar_estado_estado_reparacion`); no está en el prototipo, lo pide el Independent Test de US1. Modelos y Estados ejecutan una operación a la vez (guard `ocupado`).
- Rutas `/service-tecnico/reparaciones`, `/service-tecnico/reparaciones/nueva`, `/service-tecnico/reparaciones/:id`,
  `/service-tecnico/modelos` y `/service-tecnico/estados`, protegidas por `RequiereServiceTecnico`
  («Acceso restringido» sin nivel o sin funcionalidad). Recursos `service-tecnico-reparaciones`,
  `service-tecnico-modelos` y `service-tecnico-estados` en `SECCION_POR_RECURSO` y `RECURSOS_CONDICIONADOS_A_FEATURE`.
- **Registrar la funcionalidad no la habilita**: un superadmin la activa por organización desde *Funcionalidades*.
  La migración `20261020100700_service_funcionalidad.sql` (y `supabase/seed.sql` en un reset desde cero) la registra.
  **Runbook de despliegue**: si la base no tenía ningún superadmin al migrar, la migración solo avisa (`raise notice`) y
  no registra nada; tras el primer alta de superadmin hay que registrar `service-tecnico` en *Funcionalidades*
  (o `select public.registrar_feature(...)` como superadmin) y verificar con
  `select 1 from public.features where id = 'service-tecnico'` — si no devuelve fila, el menú no aparece.
- Diferencias con el prototipo (decisiones confirmadas de la spec): sin «Disponible en» (los modelos son de la
  organización) y sin editar un modelo desde la pantalla (el prototipo solo dibuja el alta; la RPC de edición
  existe). La columna *Reparaciones* de Modelos y Estados la agrega F-SVC-02 (FR-019).
- En la reparación quedan fuera de alcance (matriz pantalla↔criterios): ítems de mano de obra y repuestos, Total al
  cliente, «Imprimir orden», «Avisar al cliente» (solo se guarda el indicador de los estados) y el listado con KPIs
  y filtros (MSF-199). El selector de Estado, el historial, la entrega y la anulación son de F-SVC-03.

## Reversión

Todas las migraciones son aditivas y llevan su reversión en el encabezado. Orden inverso de F-SVC-02: actividad
(`20261020110700`) → uso (`20261020110600`) → lectura (`20261020110500`) → edición (`20261020110400`) → historial y
alta (`20261020110300`) → numeración (`20261020110200`) → tabla `dominio.reparaciones` (`20261020110100`). Para
F-SVC-01: actividad → RPC → sembrado → tablas → función `private.clave_texto`. Exportar antes los datos; no se
destruyen columnas ni tablas en el mismo PR que las crea.

## Pruebas

- pgTAP `supabase/tests/database/service_catalogos.test.sql` (SC-001) y
  `supabase/tests/database/service_reparaciones.test.sql` (SC-003: aislamiento, numeración, conflictos, costos,
  uso); `rls_en_toda_tabla` recorre `public` + `dominio`.
- Vitest: `lib/serviceTecnico.test.ts`, `lib/reparaciones.test.ts`, `pages/service-tecnico/*.test.tsx`,
  `components/service/*.test.tsx`, `components/navegacion/SiderPanel.test.tsx` (SC-002, SC-004).

## Secretos (gitleaks)

`pnpm calidad` marca gitleaks como «saltado» en máquinas sin el binario ni Docker (el paquete npm homónimo es un
placeholder). En CI (job `quality`, gitleaks nativo v8.30.1) el escaneo de este PR dio `no leaks found`; este cambio
no agrega secretos ni claves (solo migraciones, UI y docs).
