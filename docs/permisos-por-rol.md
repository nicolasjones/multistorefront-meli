---
owner: producto
sources:
  - specs/20261013-120000-usuarios-y-roles
  - specs/20261016-140000-permisos-por-empresa
  - supabase/migrations/20261013130002_roles_basicos_permisos.sql
  - supabase/migrations/20261013140000_editar_matriz_permisos.sql
  - supabase/migrations/20261014120000_usuarios_suspension_y_roles.sql
  - supabase/migrations/20261016140100_roles_por_empresa.sql
  - supabase/migrations/20261020130100_rol_tecnico.sql
  - supabase/migrations/20270202202000_tecnico_invitable_y_por_empresa.sql
  - supabase/migrations/20270507180000_anular_comprobante_rechaza_entregada_y_con_cobros.sql
  - supabase/migrations/20270507180100_revertir_cobro.sql
  - supabase/migrations/20270507180400_documentos_escritura_excluye_consulta.sql
  - supabase/migrations/20270512000000_proveedores_condiciones_compra.sql
  - supabase/migrations/20270512000100_productos_proveedores.sql
  - supabase/migrations/20270512000200_listas_precios_asignacion_masiva.sql
  - supabase/migrations/20270512000300_listas_precios_por_tipo_cliente.sql
  - supabase/migrations/20270512000400_listas_de_clientes_para_exportar.sql
  - supabase/migrations/20270512000500_ventas_por_lista_precios.sql
  - supabase/migrations/20270507180600_categorias_lectura_para_stock.sql
  - supabase/migrations/20270507200100_borrar_fragmentos_si_dueno.sql
  - supabase/migrations/20270507240200_rls_ventas_nivel_por_empresa.sql
  - supabase/migrations/20270507270000_ventas_lectura_por_empresa_una_vez.sql
  - supabase/tests/database/permisos_por_rol.test.sql
  - supabase/tests/database/editar_matriz_permisos.test.sql
  - supabase/tests/database/rol_tecnico.test.sql
  - supabase/tests/database/rol_tecnico_por_empresa.test.sql
  - supabase/tests/database/roles_por_empresa.test.sql
  - supabase/tests/database/lote32_documentos_escritura_consulta.test.sql
  - supabase/tests/database/lote42_rls_ventas_nivel_por_empresa.test.sql
  - apps/web/src/hooks/usePuedeEditarEmpresas.ts
  - apps/web/src/lib/permisos.ts
  - apps/web/src/lib/rolActual.ts
---

# Permisos por rol: contrato `nivel_seccion` / `puede_accion`

Spec: `specs/20261013-120000-usuarios-y-roles/` (F-ROL-01, MSF-258, épica MSF-125).
Migración: `supabase/migrations/20261013130002_roles_basicos_permisos.sql`.
Pruebas: `supabase/tests/database/permisos_por_rol.test.sql`.

Toda tabla de dominio de las demás épicas (Catálogo, Stock, Ventas, …) DEBE usar este
contrato en sus políticas RLS en vez de `private.puede_escribir()`.

## Modelo

| Elemento | Esquema | Naturaleza |
|---|---|---|
| `roles_organizacion` | `public` | Catálogo de roles: `administrador`, `operador`, `consulta`, `mostrador`, `deposito`, `administracion`, `tecnico` (MSF-182) y `miembro` (template). |
| `permisos_rol` | `public` | Organización × rol × sección → `edicion` / `lectura` / `ninguno`. |
| `permisos_rol_accion` | `public` | Organización × rol × sección × acción (`eliminar`, `exportar`, `ver_costos`, `editar_precio`, `anular`, `emitir_nota_credito`, `registrar_cobro`, `conciliar_pago`, `cobrar_contrarreembolso`, `despachar`, `ver_comisiones`) → permitido. |

Son mecanismos de acceso transversales (Principio VII), por eso viven en `public`. Cada
organización tiene su propia matriz, sembrada al crearla (trigger sobre `organizaciones`) con los
valores de `Roles.dc.html`; las organizaciones existentes se rellenaron en la migración.
El Administrador no se puede restringir: lo garantizan `check` de base de datos, no solo la UI.

Secciones (clave → nombre): `inicio`, `productos`, `categorias`, `stock`, `cotizacion_dolar`,
`empresas`, `mercado_libre`, `rentabilidad`, `usuarios_permisos`, `actividad`, `consultas`,
`ventas`, `clientes`, `proveedores`, `reportes`, `service_tecnico`.

## Funciones (esquema `private`, `GRANT EXECUTE` a `authenticated`)

- `private.nivel_seccion(seccion text) returns text` → `'edicion' | 'lectura' | 'ninguno'` para el
  usuario actual en la organización de `private.organizacion_id()`. Sin fila en `permisos_rol` usa
  la matriz inicial; sin membresía o sección desconocida devuelve `'ninguno'` (nunca acceso total).
  Un superadmin con organización activa equivale a administrador.
- `private.puede_accion(seccion text, accion text) returns boolean`. `eliminar` exige `edicion`;
  `exportar`, `ver_costos` y `ver_comisiones` exigen al menos `lectura`; una acción desconocida es `false`.
  `ver_comisiones` (MSF-957) existe solo en `service_tecnico`, se siembra en `true` para Administrador y Administración y es
  **independiente** de `ver_costos` (ninguna implica la otra); ver `docs/tecnico/service-comisiones.md`.
- Exportar la actividad (F-AUD-03) exige la acción `exportar` **y** el nivel `edicion` en `actividad` (por defecto solo el
  Administrador); ver `docs/actividad.md`. Operador y Administración tienen la acción `exportar` por defecto pero solo
  lectura en Actividad, así que no exportan (el spec de MSF-170 se alineó con el código).
- **Actividad por empresa accesible (MSF-968):** además de la organización y el nivel en `actividad`, la lectura del historial
  (política `registro_actividad_select`, `listar_actividad`, `obtener_detalle_actividad`, `opciones_actividad` y
  `exportar_actividad`) solo muestra los eventos sin empresa (de toda la organización) y los de las empresas a las que la persona
  accede (`private.empresas_de_actividad()`: el Administrador, todas las de su organización; el Superadmin, todas las de su organización activa; el resto, las asignadas; las pausadas
  cuentan para no perder su historial). Cambio visible: Operador y Administración con una sola tienda asignada ya no ven los eventos
  de las demás; el Administrador sigue viendo todo. Ver `docs/actividad.md`.
- Importar y exportar productos (F-CAT-10 / F-CAT-11) **no** usan `puede_accion`: exigen Administrador de la organización
  (`private.es_administrador_de`); ni el permiso `exportar` ni el nivel de la sección `productos` los habilitan.

### Cómo usarlas en una tabla de dominio

```sql
create policy productos_select on dominio.productos for select to authenticated
  using (organizacion_id = (select private.organizacion_id())
         and (select private.nivel_seccion('productos')) in ('lectura', 'edicion'));

create policy productos_insert on dominio.productos for insert to authenticated
  with check (organizacion_id = (select private.organizacion_id())
              and (select private.nivel_seccion('productos')) = 'edicion');

create policy productos_delete on dominio.productos for delete to authenticated
  using (organizacion_id = (select private.organizacion_id())
         and (select private.puede_accion('productos', 'eliminar')));
```

Envolver la llamada en `(select …)` para que Postgres la evalúe una sola vez por consulta.

## Panel

- RPC `public.permisos_actuales()` devuelve nivel y acciones por sección del usuario actual
  (solo para presentar; la autorización real es RLS).
- `PermisosPanelProvider` (dentro de `ContextoPanelProvider`) la carga; `useNivelSeccion(seccion)`
  y `usePuedeAccion(seccion, accion)` la exponen.
- Menú: un destino con `seccionPermiso` en `destinosPanel.ts` no aparece si la sección es `ninguno`.
- `accessControlProvider`: los recursos listados en `SECCION_POR_RECURSO` (`lib/permisos.ts`)
  niegan todo con `ninguno`, permiten `list`/`show` con `lectura` y el resto con `edicion`.
  **Cada épica agrega su recurso a `SECCION_POR_RECURSO` y su destino con `seccionPermiso`.**

## Ventas: catálogos de cobro y envío (MSF-139)

Las seis tablas de la épica (formas de pago, formas de envío, cuentas de cobro y transportes, con sus
relaciones por empresa) usan este contrato:

- **Lectura:** `private.nivel_seccion('ventas')` en `lectura` o `edicion`. Las formas de pago y de
  envío, además, exigen que `empresa_id` esté en `private.empresas_accesibles()`; cuentas y
  transportes son de la organización y se leen completos (con sus empresas habilitadas).
- **Escritura:** solo `private.es_administrador_de(organizacion_id)`, en la política RLS y con rechazo
  `42501` en cada RPC. Un rol con `edicion` en Ventas que no es Administrador lee pero no escribe.
- **Sin DELETE:** los catálogos se desactivan (`activo`/`activa`). `transportes_empresas` admite DELETE
  del Administrador porque su RPC reemplaza el conjunto de empresas.
- Las cuentas de cobro registran `cuenta_cobro.*` en `registro_actividad` sin CBU ni CUIT. Detalle:
  [Ventas · catálogos (técnico)](tecnico/ventas-catalogos.md) y
  [Permisos por empresa](tecnico/permisos-por-empresa.md).

## Compatibilidad y límites

- `private.puede_escribir()` no cambia: las tablas que todavía no migraron a este contrato conservan su
  comportamiento (pgTAP de regresión incluido). `clientes` ya migró (ver abajo).
- **`clientes` migró a este contrato (F-CLI-01, MSF-262):** sus políticas usan
  `nivel_seccion('clientes')` (`select` con `lectura`/`edicion`; `insert`/`update` con `edicion`; sin
  DELETE) y `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR` (`lib/permisos.ts`) quedó vacío. Operador, Mostrador y
  Administración editan; Consulta lee; Depósito (`ninguno` en la matriz vigente) ni lee filas por la API.
  Queda cerrado el riesgo aceptado de lectura REST con `ninguno`. Migraciones
  `20261016130000_clientes_ficha_y_numeracion` y `20261016130200_clientes_rls_por_seccion_y_actividad`;
  `numero`, `es_consumidor_final` y `organizacion_id` fuera de lo que el llamador fija (grants por
  columna); `archivado_en` sí se puede escribir (es el archivar/restaurar).
  Búsqueda, exportación (acción `exportar`) y `escala_de_cliente` (F-CLI-02/03/04): ver
  [Clientes (producto)](clientes.md) y [Clientes: modelo, RPC y pantallas](tecnico/clientes.md).
  Matriz de Depósito (SC-006): `ninguno` en Clientes, sin cambios; la base y la UI le niegan listado, ficha y exportación.
  Ranking de clientes y compras en la ficha (F-CLI-08/09/10): lo ve quien tiene Clientes en `lectura` o `edicion`
  (`ranking_clientes` y `compras_de_cliente` lo exigen en la base, `42501` si no); exportarlo a Excel exige además la
  acción `exportar` de Clientes. Depósito (`ninguno`) no lo ve ni lo exporta. Detalle en `docs/clientes.md`.
  Correo masivo (MSF-155, F-CLI-11/12/13): sin sección ni acción nuevas; se rigen por la sección Clientes: destinatarios, crear
  campaña y envío de prueba exigen `edicion`; el historial y su detalle, `lectura` o `edicion` (chequeo dentro de cada función). Depósito (`ninguno`) no los ve. Detalle en
  `docs/correo-masivo.md`.
- **`dominio.proveedores` (F-PRV-01/02/03, MSF-205):** `dominio.proveedores` usa `nivel_seccion('proveedores')` (Administrador y
  Administración `edicion`; el resto `ninguno`, la base no entrega filas de la tabla); sin `DELETE` (se desactiva). El selector del
  producto lee `public.proveedores_basico` (solo id, razón social y estado), que filtra por organización **y nivel**:
  `productos` en `edicion`, `stock` en `lectura`/`edicion` o `proveedores` en `lectura`/`edicion`; así el Operador
  ve los proveedores por la vista aunque no lea la tabla. La ficha
  llama `productos_de_proveedor`, que exige `proveedores` y `productos`. Detalle en `docs/proveedores.md`.
- **Exportar proveedores (MSF-526):** `exportar_proveedores` exige la acción `exportar` en `proveedores`, que a su vez pide al menos `lectura` en la sección: con la matriz inicial, quien además tiene la acción (Administrador, Administración) la ejerce; un rol sin acceso a Proveedores no exporta aunque tenga la acción.
- **Condiciones de compra y varios proveedores por producto (lote 93, MSF-523 y MSF-530):** las condiciones del proveedor siguen la sección
  `proveedores` (lectura o edición leen; solo edición guarda). Los proveedores de un producto siguen la sección `productos` (lectura o
  edición leen; solo edición agrega, quita y marca principal) y el **costo** del vínculo se ve con `rentabilidad` en lectura/edición y se
  carga solo con edición en `rentabilidad`. Detalle en `docs/proveedores.md`.
  El **costo efectivo** del producto (`producto_costos`) también cambia al promover un proveedor con otro costo: exige edición en
  `rentabilidad` (`PT409` con `details = 'rentabilidad'` si no); sin ella, el camino viejo conserva al principal anterior como secundario.
  Los procesos sin sesión de persona (la importación de productos que corre en el worker con `auth.uid()` nulo, `service_role`,
  mantenimiento) **no se restringen** por este permiso: hoy la importación solo la solicita el Administrador, que tiene Rentabilidad.
- **Listas de precios (lote 93, MSF-973, MSF-974, MSF-975 y MSF-976):** asignar una lista en masa o a un tipo de cliente es solo del
  Administrador (como asignarla a un cliente). La lista de cada cliente en la exportación de clientes exige la acción `exportar` de
  `clientes`; las ventas por lista de precios, `ventas` en lectura o edición (y por tienda, el nivel de ventas de cada una). Detalle en
  `docs/listas-de-precios.md`.
- **`dominio.proveedores_contactos` (F-PRV-08, MSF-449):** lectura con `nivel_seccion('proveedores')` en `lectura`/`edicion`;
  escritura solo por `agregar_contacto_proveedor` y `marcar_contacto_principal` (exigen `edicion`, `42501` si no); sin
  `DELETE` directo; `anon` sin acceso. Detalle en `docs/proveedores.md`.
- **`dominio.productos` y `dominio.producto_costos` nacen en este contrato (F-CAT-02, MSF-458):** `productos`
  con `nivel_seccion('productos')` (Administrador y Operador editan; el resto lee; sin DELETE) y
  `producto_costos` con `nivel_seccion('rentabilidad')` (solo Administrador edita, Administración lee; el
  Operador ve 0 filas y la RPC le rechaza el costo). Ver `docs/catalogo.md`.
- **`dominio.producto_imagenes` y el bucket `productos-imagenes` (F-CAT-05, MSF-461)** usan `nivel_seccion('productos')`:
  Administrador y Operador agregan y quitan imágenes; el resto las ve (lectura) y no puede subir ni borrar.
- **`dominio.producto_empresa` (F-CAT-07, MSF-276)** usa `nivel_seccion('productos')`: edita quien edita productos; el resto lee.
  **`dominio.categorias` y `dominio.categorias_empresa` (F-CAT-08, MSF-298)** usan `nivel_seccion('categorias')`
  (`edicion` crea, edita, reordena y elimina; `lectura` solo ve el árbol). Ver `docs/catalogo.md`.
  Desde la migración `20270507180600_categorias_lectura_para_stock.sql`, una política `select` adicional
  (`categorias_select_stock`) deja leer las categorías de su organización a quien tiene `stock` en `edicion` (Depósito, que
  tiene `categorias` en `ninguno`, las ve en «Toma de inventario»); quien solo lee stock no gana lectura y nadie gana escritura.
- **`dominio.existencias`, `dominio.movimientos_stock` y `dominio.motivos_movimiento` (F-STK-02, MSF-153)** usan
  `nivel_seccion('stock')`: quien tiene `edicion` (Administrador, Operador, Depósito) registra movimientos con
  `public.registrar_movimiento_stock`; con `lectura` (Consulta, Mostrador, Administración) ve cantidades y movimientos sin
  poder escribir, ni por la interfaz ni llamando directo a la base. Los motivos los edita solo quien cumple
  `private.puede_escribir()` (Administrador). Ver `docs/stock.md`.
- **`dominio.formas_pago` (F-VTA-01, MSF-210):** catálogo **por empresa** de las formas de pago que el
  comprobante ofrece al cobrar. `select` con `nivel_seccion('ventas')` en `lectura`/`edicion` **y** `empresa_id`
  en `private.empresas_accesibles()`; `insert`/`update` solo con `private.es_administrador_de(organizacion_id)`
  (un no Administrador recibe `42501`, también por la RPC). Sin `DELETE` (se desactiva con
  `cambiar_estado_forma_pago`, idempotente); `anon` sin privilegios. Pantalla `Configuración de ventas`
  (`/ventas/configuracion`, grupo Ventas del menú, sección `ventas`). Migraciones
  `20261020100000_formas_pago` y `20261020100100_formas_pago_rpc`, con reversión propia en cada encabezado.
- **`dominio.formas_envio` (F-VTA-02, MSF-225):** catálogo **por empresa** de las formas de envío (tipo, si
  exige transporte y guía, costo por defecto en ARS —nulo permitido, nunca negativo— y estado de despacho
  inicial). Mismas reglas que `formas_pago`: `select` con `nivel_seccion('ventas')` en `lectura`/`edicion` y
  empresa accesible; `insert`/`update` solo del Administrador (`42501` también por RPC
  `crear_forma_envio`/`actualizar_forma_envio`/`cambiar_estado_forma_envio`); sin `DELETE`; `anon` sin
  privilegios. Vive como pestaña `Formas de envío` de `Configuración de ventas`. Migraciones
  `20261020110000_formas_envio` y `20261020110100_formas_envio_rpc`, con reversión propia en cada encabezado.
- **`dominio.cuentas_cobro` y `dominio.cuentas_cobro_empresas` (F-VTA-03, MSF-240):** cuentas bancarias de la **organización**,
  habilitadas por empresa. `select` con `nivel_seccion('ventas')` en `lectura`/`edicion`; escritura solo Administrador (RLS y
  `42501` en cada RPC); sin `DELETE` («No usar» = `activa = false`); `anon` sin privilegios. CBU/CUIT validados en la base y nunca
  en la actividad. Ruta `/ventas/cuentas-cobro`. Ver `docs/cuentas-cobro.md`.
- **`dominio.transportes` y `dominio.transportes_empresas` (F-VTA-04, MSF-251):** transportes y terminales de retiro de la
  organización. Mismas reglas: lectura con `ventas`, escritura solo Administrador, sin `DELETE` en `transportes`, `anon` sin
  privilegios. Ruta `/ventas/transportes`. Ver `docs/ventas-transportes.md`. Guía de la épica: `docs/ventas-catalogos.md`.
- **`dominio.cobros_comprobante` (F-VTA-12, MSF-389):** libro de cobros de la **organización**, por empresa (la del
  comprobante). `select` con `nivel_seccion('ventas')` en `lectura`/`edicion` y `empresa_id` en
  `private.empresas_accesibles()`; **sin escritura directa** (no hay política ni permiso de `insert`, `update` o `delete`:
  escribe la RPC `public.registrar_cobro`); `anon` sin privilegios. Un cobro nunca se borra ni se edita: solo lo mueve la
  conciliación (columnas `aprobado_*`). Ruta `/ventas/comprobantes/:id` (tarjeta «Cobros»). Ver `docs/cobros-por-comprobante.md`.
- **`dominio.contrarreembolsos` (F-VTA-14, MSF-410):** lo que cobra el transporte al entregar. Mismas reglas que el libro de
  cobros: `select` con `ventas` y empresa accesible, sin escritura directa (escribe `private.abrir_contrarreembolso` y la RPC
  `public.marcar_contrarreembolso_cobrado`), sin `DELETE`, `anon` sin privilegios. Ruta `/ventas/transportes` (sub-pestaña
  «Contrarreembolsos»). Ver `docs/contrarreembolsos-transporte.md`. Guía de la épica:
  `docs/ventas-cobros-y-conciliacion.md`.

### Las tres acciones de Ventas (F-VTA-12, F-VTA-13, F-VTA-14)

`registrar_cobro`, `conciliar_pago` y `cobrar_contrarreembolso` son **acciones** de la matriz
(`public.permisos_rol_accion`, plataforma): viven **solo en la sección `ventas`** y sus valores
iniciales son los de la spec (*Decisiones abiertas* 1: roles a confirmar con el cliente).

| Acción | Mostrador | Administración | Administrador | Operador | Depósito / Consulta / Miembro / Técnico |
|---|---|---|---|---|---|
| `registrar_cobro` | Sí | Sí | Sí | No | No |
| `conciliar_pago` | No | Sí | Sí | No | No |
| `cobrar_contrarreembolso` | No | Sí | Sí | No | No |

- **Escribir exige `ventas` en edición** en la **empresa del dato** (no la empresa activa): quien
  solo tiene lectura nunca cobra, concilia ni rinde. El permiso se resuelve con el rol del usuario
  **en esa empresa** (`private.puede_registrar_cobro_en_empresa`,
  `private.puede_conciliar_pago_en_empresa`, `private.puede_cobrar_contrarreembolso_en_empresa`):
  quien no puede cobrar en la tienda A no lo hereda por ser Administración en la B.
- La **base** valida el permiso dentro de cada RPC (`public.registrar_cobro`,
  `public.conciliar_pago`, `public.revertir_conciliacion_pago`,
  `public.marcar_contrarreembolso_cobrado`), no solo la pantalla: sin la acción, la RPC responde
  `42501`.
- La pantalla lee el permiso con `public.puede_registrar_cobro`, `public.puede_conciliar_pago` y
  `public.puede_cobrar_contrarreembolso`: una lectura por empresa, que queda cacheada (en el
  detalle, la de la empresa de la factura; en Pagos y Transportes, la de cada empresa de la página).
  Esas lecturas **no autorizan nada**: solo evitan ofrecer una acción que la base va a rechazar, y
  si fallan la pantalla queda **sin permiso** (deny-by-default).
- Las funciones internas que aplican el permiso (`private.*_en_empresa`) viven en `private`, sin
  `grant`: solo las llaman las RPC públicas.
- Los datos de DEV de la épica y su guía: `docs/ventas-cobros-y-conciliacion.md`.
- **`dominio.ingresos_mercaderia` y sus líneas (F-PRV-04, MSF-383)** usan `nivel_seccion('stock')`: con `edicion`
  (Administrador, Operador, Depósito) se registran ingresos con `public.registrar_ingreso_mercaderia`; con `lectura`
  (Consulta, Mostrador, Administración) solo se ve el historial. Actualizar el costo de un producto desde el ingreso
  exige además `rentabilidad` en `edicion` (hoy solo Administrador). Ver `docs/ingreso-de-mercaderia.md`.
- **Acciones de ventas de la épica MSF-177**: `exportar` (Administrador, Operador, Administración) habilita la exportación
  del listado de comprobantes; `anular` y `emitir_nota_credito` (solo sección `ventas`: Administrador y Administración)
  se verifican en `anular_comprobante` y `emitir_nota_credito` (`42501` si no), no solo en la UI.
  `anular_comprobante` además rechaza (error de negocio, ver [errores de negocio](./errores-negocio-postgrest.md)) anular una factura ya entregada o con cobros registrados
  (`20270507180000_anular_comprobante_rechaza_entregada_y_con_cobros.sql`); el permiso `anular` no cambió.
  `public.revertir_cobro` (reversión con contra-asiento, `20270507180100_revertir_cobro.sql`) no usa una acción de la matriz: exige
  Administrador de la organización (`42501` a los demás roles). Ver [Cobros por comprobante](cobros-por-comprobante.md).
  Las transiciones de estado por rol viven en `dominio.transiciones_estado_comprobante`. Valores propuestos, pendientes de confirmar con el cliente.
  Ver `docs/ventas-listado-estados.md`.
- `accessControlProvider` comparte una sola consulta de permisos por usuario (promesa en vuelo + TTL de 5 s,
  `obtenerPermisosActualesCacheado`); F-ROL-02 debe llamar `invalidarCachePermisos()` al editar la matriz.
  El usuario de Auth y el resultado de superadmin (`lib/superadmin.ts`) se cachean igual, hasta 5 s y hasta el próximo cambio de sesión: una revocación se ve en la UI con ese retraso, y RLS decide en el servidor.
- El rol `miembro` del template queda en solo lectura donde el prototipo da lectura, y sin acceso
  a las secciones reservadas a Administrador/Administración (nunca gana acceso que no tenía).
- Los valores iniciales de las acciones (`eliminar`, `exportar`, `ver_costos`, `editar_precio`, `anular`,
  `emitir_nota_credito`, `registrar_cobro`, `conciliar_pago`, `cobrar_contrarreembolso`, `despachar`, `ver_comisiones`) son una
  **extensión propuesta**, pendiente de confirmar con el cliente. Se editan con F-ROL-02. Excepción confirmada: `ver_costos`
  en **Stock** también es del Operador (reportes de inventario, migración `20270438000000`); los demás roles sin ella ven solo cantidades.
- **Suspendidos (resuelto):** `usuarios_organizacion.estado` existe (`20261012140100`) y la resolución de
  permisos excluye a quien no está `activo`: `private.roles_de_referencia` (`20261016140100_roles_por_empresa.sql:241`) y
  `private.empresas_accesibles` / `private.rol_en_empresa` exigen `estado = 'activo'`, así que `nivel_seccion` y
  `puede_accion` no dan nivel a un suspendido. Ver [Acceso: ingreso, recuperación y sesión](acceso-ingreso.md).
- Sin policies de escritura sobre las tablas de permisos: la edición (F-ROL-02, MSF-239) pasa solo por las
  RPC de abajo, que verifican en servidor que quien llama es Administrador de esa organización.

## Edición de la matriz (F-ROL-02)

Migración: `supabase/migrations/20261013140000_editar_matriz_permisos.sql` (solo funciones, aditiva).
Pruebas: `supabase/tests/database/editar_matriz_permisos.test.sql` y `apps/web/src/pages/roles/list.test.tsx`.

- `public.guardar_matriz_permisos(p_niveles jsonb, p_acciones jsonb)`: aplica cambios
  `{rol_id, seccion, nivel}` y `{rol_id, seccion, accion, permitido}` sobre la organización de
  `private.organizacion_id()` (el cliente no elige organización). Exige `private.puede_escribir()`
  (Administrador, o superadmin con organización activa; si no, `42501`). Todo o nada; rechaza
  (`22023`) al rol `administrador`, niveles inválidos y roles/secciones/acciones desconocidos.
- `public.restablecer_matriz_permisos()`: borra la matriz de la organización y la vuelve a sembrar con
  `private.sembrar_permisos` (misma fuente que la siembra inicial).
- Pantalla `/roles` («Roles y permisos», Configuración, audiencia administrador, sección
  `usuarios_permisos`): 6 roles con descripción y cantidad de usuarios, grilla 16×6 con rotación
  Edición → Solo lectura → Sin acceso, columna Administrador bloqueada, selector de acción
  (eliminar / exportar / ver costos) y «Guardar cambios» según cambios pendientes. Tras guardar o
  restablecer se llama `invalidarCachePermisos()`.
- **No dibujado en `Roles.dc.html`** (marcado en el PR): la edición de acciones (FR-006) y el diálogo
  de «Restablecer valores iniciales» (FR-015) son propuestas de diseño, a confirmar con el cliente.
- Tope: un guardado acepta hasta 200 niveles y 400 acciones (la matriz tiene 6×16 y 6×16×3); más se rechaza con `22023`.
- Auditoría (F-AUD-01 y F-AUD-02, entregadas): `guardar_matriz_permisos` y `restablecer_matriz_permisos` registran `permisos.matriz_guardada` / `permisos.matriz_restablecida` en `public.registro_actividad` (quién y cuándo; visible en `/actividad` para Administración y Operador). Ahora guardan también el valor previo y el nuevo de cada celda modificada (hasta 8 KB; si hay más cambios, el resto se resume en «… otros cambios»), consultables en el detalle del evento. Ver [Auditoría avanzada y soporte](tecnico/auditoria-y-soporte.md).
- Edición concurrente: si dos Administradores guardan a la vez gana el último en guardar (la RPC serializa pero no detecta conflictos); la auditoría deja quién y cuándo guardó y, para los cambios de matriz, el valor previo y nuevo. La pantalla avisa al cerrar la pestaña con cambios sin guardar.
- El contador de usuarios por rol filtra por la organización activa (la policy también deja ver las propias membresías en otras organizaciones).
- Reversión: `drop function public.restablecer_matriz_permisos(); drop function public.guardar_matriz_permisos(jsonb, jsonb);`.

## Guard de rutas (F-ROL-03)

Toda ruta de sección con `seccionPermiso` DEBE envolverse en `RequiereAccesoSeccion`
(`apps/web/src/components/RequiereAccesoSeccion.tsx`); hoy cubre `/clientes*`, `/usuarios*` y `/ventas/configuracion` (`/miembros*` redirige a `/usuarios*`); `inicio` (`/`) queda fuera a propósito (es el destino de
redirección, envolverla causaría un bucle). `apps/web/src/App.guard.test.ts` cruza `DESTINOS_PANEL` con
`App.tsx` (importado con `?raw`, sin `node:fs`) y falla si una ruta con `seccionPermiso` queda sin guard.
El guard exige acceso a la sección (`lectura` o `edicion`), no distingue `create`/`edit`: en esas
rutas un usuario con `lectura` ve el formulario pero RLS rechaza la escritura (UX, no fuga). Las etiquetas de rol viven en
`ETIQUETA_ROL` (`apps/web/src/lib/permisos.ts`); un rol nuevo se agrega ahí. El guard
es defensa de UX (RLS es la autoridad) y falla cerrada: solo `lectura`/`edicion` abren la sección; un
nivel nulo tras cargar se trata como denegado. El rol mostrado sale de `usuarios_organizacion`
filtrado por `user_id` y por la organización activa (`useOrganizacionDeTrabajo`, por si la persona
pertenece a varias); si falla, se muestra «actual» y nunca una pantalla en blanco.
Si falla la carga de permisos (`permisos_actuales`: red, 5xx, schema cache) el proveedor expone
`error` (con `permisos: null`, nunca `[]`): el guard y el menú muestran «No pudimos verificar tus
permisos» con **Reintentar** (`recargar()`) en vez de «Acceso restringido» / «Solicitar acceso». La
sección sigue sin montarse (falla cerrada); «sin acceso» solo aparece con un nivel `ninguno` real (MSF-697).

## Reversión

Documentada en la cabecera de la migración (solo válida mientras ninguna tabla de dominio use las
funciones). La migración es aditiva: no modifica ni elimina objetos existentes.

## Usuarios: estado, suspensión y roles (MSF-228 · F-USR-02)

- Esquema: `usuarios_organizacion` y `eventos_membresia` siguen en `public` (plataforma); no hay tablas nuevas.
- `usuarios_organizacion.estado` (`activo` | `suspendido`) llega con las migraciones `20261012140100` y `20261012140300`, copiadas tal cual de `epic/MSF-138` (idénticas, sin conflicto al fusionar esa épica). Un suspendido no resuelve organización (`private.organizacion_id()`), ni nivel de sección ni acciones (`private.nivel_seccion`, `private.puede_accion`), ni gestiona membresías.
- RPC (migración `20261014120000`, todas `security definer` con `search_path` fijo y verificación de Administrador activo de la misma organización dentro del cuerpo): `listar_usuarios_organizacion()`, `cambiar_rol_miembro(uuid, text)` (ahora admite los siete roles de `roles_organizacion`), `suspender_miembro(uuid)`, `reactivar_miembro(uuid)` y `remover_miembro(uuid)` (reemplazada: ya no cuenta suspendidos). `listar_usuarios_organizacion()` devuelve además `email` y `es_propio`. Un objetivo inexistente responde 42501, igual que uno ajeno. La regla «al menos un Administrador activo» se evalúa con la fila de la organización bloqueada (`for update`) y el objetivo se relee tras el bloqueo; cubre cambio de rol, suspensión y remoción. La pantalla Usuarios no ofrece acciones sobre la fila propia y el control de acceso del front exige membresía activa.
- Eventos (FR-012): `rol_cambiado`, `suspendido` y `reactivado` en `eventos_membresia` hasta que exista F-AUD-01.
- Pantalla única: Usuarios (`/usuarios`) absorbe Miembros; `/miembros` y `/miembros/create` redirigen. `listar_miembros_organizacion` queda sin uso en la web y se retira en un PR posterior (las migraciones son aditivas).
- Reversión: ver el encabezado de `20261014120000_usuarios_suspension_y_roles.sql`.

## Rol por empresa (MSF-185 · F-ROL-04, épica MSF-121)

Spec: `specs/20261016-140000-permisos-por-empresa/`. Migración: `20261016140100_roles_por_empresa.sql` (renombrada desde `20261016140000` al integrar la épica de clientes, que ocupa esa versión). Construcción interna: [Permisos por empresa](tecnico/permisos-por-empresa.md).
Pruebas: `supabase/tests/database/roles_por_empresa.test.sql`.

- Esquemas (Principio VII): `usuarios_empresas(user_id, empresa_id, organizacion_id, rol_id)` y `usuario_empresa_activa(user_id, empresa_id)` viven en `public` (acceso transversal); `dominio.empresas` solo se referencia. Ambas con RLS, sin privilegios para `anon` y sin escritura directa: la escritura llega por las RPC de F-ROL-06 (empresa activa) y F-ROL-07 (asignaciones).
- `rol_id` solo admite `operador`, `consulta`, `mostrador`, `deposito`, `administracion` (`check` en la base) y la empresa debe ser de la organización del usuario (trigger). El Administrador de la organización no tiene filas y accede a todas las empresas activas.
- Resolución de `private.nivel_seccion` / `private.puede_accion` (vía `private.roles_de_referencia`):
  - **Compartidas** (`productos`, `categorias`, `stock`, `clientes`, `proveedores`, `cotizacion_dolar`): el mejor nivel (`edicion` > `lectura` > `ninguno`) entre los roles del usuario en sus empresas activas, sin importar la activa.
  - **Por empresa** (`ventas`, `consultas`, `reportes`): el nivel del rol en la empresa activa válida; sin activa válida → `ninguno`.
  - **El resto** (Inicio, Empresas, Mercado Libre, Rentabilidad, Usuarios y permisos, Actividad, Servicio técnico), el Administrador y quien **no tiene empresas asignadas**: el rol de organización, como antes.
  - Una empresa activa deja de ser válida si se pausa, se quita la asignación o el usuario se suspende.
- Las listas de secciones viven en `private.secciones_compartidas()` / `private.secciones_por_empresa()` (fuente única). `permisos_actuales()` no cambia de firma: ya devuelve el nivel resuelto, así que el panel refleja la empresa activa al recargar permisos (`invalidarCachePermisos()`, que invoca el selector de F-ROL-06).
- Reversión: ver el encabezado de la migración. Mientras no haya filas en `usuarios_empresas` el comportamiento es idéntico al anterior.

Las asignaciones por empresa se cargan desde Usuarios: ver `docs/usuarios-y-empresas.md` (F-ROL-07).

### Revisión de seguridad de cierre (MSF-121, T023)

Revisión `authz-security` del diff de F-ROL-04/06/07 (migraciones `20261016140100`, `20261016150100`, `20261016160100`), sin hallazgos abiertos. Evidencia: lectura de esas tres migraciones y de las pruebas
`supabase/tests/database/rls_en_toda_tabla.test.sql` (RLS en `public` + `dominio`) y
`supabase/tests/database/roles_por_empresa.test.sql` (resolución por empresa, aislamiento y
privilegios de `anon`), que corren con `pnpm test` contra `pnpm dev:supabase`:

- **Esquemas (Principio VII):** `usuarios_empresas` y `usuario_empresa_activa` en `public` (plataforma, acceso transversal); `dominio.empresas` solo se referencia. Coincide con lo declarado en la spec.
- **RLS:** ambas tablas con RLS por organización/usuario, solo `select` para `authenticated`, sin privilegios para `anon` y sin escritura directa (el test pgTAP de aislamiento recorre `public` + `dominio`).
- **RPC:** `cambiar_empresa_activa`, `empresas_para_selector`, `asignar_empresas_usuario`, `guardar_asignaciones_invitacion`, `listar_empresas_usuarios` y `aceptar_invitacion` (redefinida en `20261016160100` con `create or replace`, que conserva los `grant`/`revoke` de `20261013160001`: solo `authenticated`) llevan `revoke … from public, anon` y `grant … to authenticated` explícitos; todas son `security definer` con `search_path = ''`. Cada una valida organización y rol dentro del cuerpo (gestión de membresías para las de asignación; empresa accesible para el cambio), no solo en la UI.
- **Concurrencia:** la asignación toma `pg_advisory_xact_lock` por usuario (el mismo que `cambiar_rol_miembro`) y reemplaza atómicamente; el cambio de empresa activa bloquea la fila con `for update`.
- **Escalada:** el Administrador no lleva asignaciones (se rechazan) y los roles por empresa admiten solo los cinco roles básicos; una empresa ajena se rechaza por trigger y por RPC.

## Rol Técnico (MSF-324 · F-SVC-05, épica MSF-182)

Rol `tecnico` para quienes operan Servicio técnico sin acceder al resto. Es **solo datos** (Principio VII):
una fila en `public.roles_organizacion` y sus filas en `permisos_rol` / `permisos_rol_accion`; no se crea ni
altera ninguna tabla. Migración `20261020130100_rol_tecnico.sql`, aditiva.

| Sección | Nivel del Técnico |
|---|---|
| `service_tecnico` | `edicion` |
| `inicio`, `clientes` (ve al cliente de la reparación), `productos`, `stock` | `lectura` |
| Las demás (11 secciones) | `ninguno` |

Acciones: sin `eliminar`, `exportar` ni `ver_costos` en ninguna sección (los costos internos de una
reparación quedan ocultos, ver `docs/service-tecnico.md`). Los valores de los demás roles **no cambian**:
`service_tecnico` sigue en Administrador y Operador `edicion`; Consulta, Mostrador y Administración
`lectura`; Depósito `ninguno` (lo verifica `supabase/tests/database/rol_tecnico.test.sql`).

**Asignación a tiendas (MSF-597 · BUG-315).** El Técnico accede a Service solo en las tiendas con fila en
`usuarios_empresas` (`private.empresas_accesibles()`), así que `tecnico` es el sexto rol válido por empresa:
el CHECK `usuarios_empresas_rol_por_empresa` y `private.validar_asignaciones` (usada por
`asignar_empresas_usuario`, `guardar_asignaciones_invitacion` y `aceptar_invitacion`) lo admiten, y el selector
de Usuarios lo ofrece. Migración aditiva `20270202202000_tecnico_invitable_y_por_empresa.sql`; test
`supabase/tests/database/rol_tecnico_por_empresa.test.sql`. Los permisos de `mostrador` no cambian.

- **Siembra**: la migración redefine `private.matriz_inicial()` con la columna `tecnico`
  (`private.matriz_acciones_iniciales()` la deriva sin cambios) y vuelve a correr
  `private.sembrar_permisos()` (`on conflict do nothing`) sobre las organizaciones existentes; las
  nuevas la reciben por el trigger vigente. «Restablecer valores iniciales» también repone al Técnico.
- **Matriz fija**: en **Roles y permisos** el Técnico aparece como columna sin edición (chips y casillas
  deshabilitados, «no editable»). `public.guardar_matriz_permisos` rechaza con `22023` cualquier cambio
  sobre `tecnico`; la edición de los otros roles no cambia. La matriz editable del Técnico llega en enero.
- **Asignación**: «Técnico» se elige en **Usuarios → Editar → Rol** (`cambiar_rol_miembro`, que valida
  contra `roles_organizacion`). Desde la migración `20270202202000_tecnico_invitable_y_por_empresa.sql` la
  **invitación** (`registrar_invitacion`), `private.validar_asignaciones` y el check de `usuarios_empresas` también
  aceptan `tecnico`: un Técnico se puede invitar y asignar por empresa directamente. La matriz del Técnico sigue sin
  editarse (`guardar_matriz_permisos` no cambió).
- **Reversión** (cabecera de la migración): borrar las filas `tecnico` de `permisos_rol_accion`,
  `permisos_rol` y `roles_organizacion` (solo si ningún usuario lo usa) y reaplicar
  `private.matriz_inicial()` y `public.guardar_matriz_permisos` de `20261013130002` / `20261016120000`.

## Migración inicial de datos (F-MIG-01…04, épica MSF-142)

Spec: `specs/20261023-120000-migracion-inicial-de-datos/`. Guía: `docs/migracion-inicial-de-datos.md`.

- **Quién migra:** solo el Administrador. Toda RPC del importador (`iniciar_carga_migracion`,
  `previsualizar_lote_*`, `aplicar_lote_*`, `cerrar_carga_migracion`, `informe_conciliacion_migracion`) exige
  `private.puede_escribir()` y toma la organización de la sesión; un rol de consulta recibe `42501`. «Importar» en
  Clientes y Proveedores aparece solo con ese permiso (`docs/clientes.md`, `docs/proveedores.md`).
- **Lectura de cargas:** `public.migracion_cargas` y `public.migracion_filas` (plataforma, `public`) solo se leen como
  Administrador de la organización; no tienen grants de escritura.
- **Archivo de ingresos:** `dominio.archivo_ingresos_mercaderia` usa `nivel_seccion('stock')` para leer (`lectura` o
  `edicion`) y solo se escribe por la RPC de importación (`docs/ingreso-de-mercaderia.md`).
- **`anon`:** ninguna de estas RPC es ejecutable por `anon` (`revoke … from public, anon` + `grant … to authenticated`).
- **Reversión:** las migraciones `20261201100000`…`20261201130000` son aditivas; cada cabecera documenta cómo deshacerlas.

## Fusionar clientes (F-CLI-18, MSF-447)

`public.fusionar_clientes` y `public.vista_previa_fusion_clientes` exigen **Administrador** de la organización (`private.es_administrador_de`), independientemente del nivel de la sección `clientes`; `anon` no las ejecuta. La ficha oculta «Fusionar con otro cliente…» a los demás roles.

## Rol mostrado en «Acceso restringido» (MSF-637)

Las pantallas solo-Administrador (`/stock/motivos`, Listas configurables) muestran el nombre real del rol
(`useNombreRolActual`, misma consulta que `RequiereAccesoSeccion`, vía `lib/rolActual.ts`). Si no se puede
resolver, el texto genérico es «actual». Pendiente de decisión de negocio: la matriz otorga `edicion`/`lectura`
a otros roles en `/stock/motivos` e `/historial/importar`, pero el código las limita al Administrador.

## Permisos que se vuelven a pedir con un formulario abierto (decisión: falla cerrada)

`useNivelSeccion` devuelve `nivel: null` cuando cambia la clave `usuario:organización` del `PermisosPanelProvider`
(p. ej. un superadmin entra a otra organización) o cuando el repedido de permisos falla. Se descartó conservar el
último nivel conocido como nivel vigente: dejaba la pantalla **abierta con el nivel de la organización anterior o con un
permiso ya perdido** (fail-open de la UI). Mientras el nivel no se pueda confirmar para la clave vigente no se ofrece
editar ni guardar; el servidor (RLS / `private.nivel_seccion`) es la autoridad igualmente.

**Qué pasa ahora (MSF-855)**: `RequiereAccesoSeccion` distingue dos casos según la clave `usuario:organización`.

| Situación | Qué ve la persona | Borrador |
| --- | --- | --- |
| **Misma clave** con la que se abrió la sección y **falla el repedido** (red caída, error transitorio) | Los hijos siguen **montados pero inertes** (`fieldset disabled` + `inert`, y los eventos de edición y envío se cortan en captura, también los de diálogos que MUI saca a un portal). Arriba, un aviso **no bloqueante** en una región viva (`aria-live`) que ya existía: «No pudimos verificar tus permisos» con «Reintentar» (alcanzable con el teclado, sin robar el foco). El guardado y las teclas/Enter del formulario no tienen efecto. | Se **conserva** (se ve, solo lectura). |
| **La clave cambió** (otro usuario u otra organización, p. ej. un superadmin que entra a otra organización), o la sección nunca llegó a abrirse | Como antes: carga y, si el pedido falla, «No pudimos verificar tus permisos» sin formulario. | Se **descarta**: los hijos se desmontan (y el árbol lleva `key` por clave, así que ni sin pasar por la carga se arrastra). Nunca se ve ni se guarda el borrador de la organización anterior. |

Nota: cambiar la empresa activa vuelve a pedir los permisos y remonta la pantalla a propósito (no arrastra datos de la empresa anterior); el aviso con borrador aplica a lo que la persona escribe después, mientras el repedido está en vuelo y falla.

Mientras la zona está inerte también se cortan, en captura, el ratón (`mouseup`, clic auxiliar), el puntero, el
arrastre (`dragstart/enter/over/drop`), el táctil y las teclas de impresión; no hay atajos globales de teclado en las
pantallas. **Salida para quien ya tenía un diálogo abierto**: un diálogo o menú de MUI que estaba abierto en un portal
cuando falló el repedido atrapa el foco y tapa el aviso; `Escape` dentro del portal sí pasa (cierra, no guarda), y
`Tab` nunca se cancela. Una `RequiereAccesoSeccion` anidada solo se mantiene abierta si su propio último nivel
confirmado cumple el mínimo. Al confirmar el acceso, si el foco estaba en «Reintentar» pasa a la región viva, que anuncia
«Acceso confirmado» (el foco no se pierde en `<body>`). Riesgo residual del último nivel confirmado: un `edicion` viejo
solo se entrega a los hijos de la sección, que están inertes; aun si alguien lo forzara, el servidor lo rechaza porque
la autorización real es RLS (`private.nivel_seccion`) y no depende de lo que la UI crea.

«Reintentar» vuelve a pedir `permisos_actuales` (un pedido por clic; mientras verifica el botón queda `aria-disabled`).
**No hay reintentos automáticos ni polling**: un error persistente deja la zona inerte hasta que la persona reintente.
Si el reintento confirma `edicion` se habilita el formulario con lo tipeado intacto (mismo nodo); si confirma `lectura`
o `ninguno`, el nivel real manda como siempre (el formulario ve el nivel nuevo y no envía; sin acceso a la sección se
muestra «Sección no disponible para tu rol»).

**Por qué sigue siendo falla cerrada**: el último nivel confirmado se entrega solo a los hijos de esa misma sección,
con `sinConfirmar: true`, únicamente cuando la clave coincide con la de apertura y el repedido falló
(`BorradorConservadoContext`), para que el formulario no se desmonte; cualquier consumidor fuera de esa zona (menú,
tarjetas, otras pantallas) sigue recibiendo `nivel: null`. La zona está inerte, así que ese nivel no ofrece ninguna
acción hasta que se confirme. El superadmin no cambia: opera como administrador y su pantalla no se bloquea.

Cubierto por `RequiereAccesoSeccion.borrador.test.tsx` (provider y hook reales), `RequiereAccesoSeccion.test.tsx`,
`e2e/productos-create-permisos.e2e.ts` y `e2e/permisos-borrador.e2e.ts`. El reporte original («escribir enseguida en
Nombre deja el campo vacío») no se reprodujo con un administrador normal: `RequiereAccesoSeccion` espera a la
organización y a los permisos antes de montar el formulario, que se monta una sola vez (medido con carga lenta y con
permisos y contexto demorados).

## Accesibilidad (hallazgos de la revisión E2E)

- `BotonVolver` (`components/pagina/BotonVolver.tsx`) reemplaza la flecha sin nombre que `@refinedev/mui` pone en
  `Create`/`Edit`/`Show` (se pasa como `goBack`); `EditButton hideText` lleva `aria-label`.
- Una tabla con ancho fijo que se desplaza dentro de su contenedor (los `TableContainer` y las cajas `overflowX: auto`; también la de `ContenidoAdaptable` cuando recibe `etiquetaTabla`, que en pantallas chicas pasa a tarjetas) lleva `tabIndex={0}`, `role="region"` y un nombre
  (axe `scrollable-region-focusable`): «Formato de la planilla» y «Diferencias a aplicar» en `/stock/excel`,
  «Precio y comisión por canal» en Rentabilidad.
- La ayuda de un campo deshabilitado conserva el color secundario del tema (contraste AA).

## Listas de precios (F-PRE-14 y F-CLI-21)

Las listas de precios **no tienen sección propia** en la matriz: solo las escribe el rol **Administrador** (la RPC lo comprueba con `private.es_administrador_de`, como el descuento por cliente) y las leen quienes tienen `clientes` o `ventas` en `lectura` o `edicion` (política `listas_precios_select`). Detalle en [Precios](precios.md#listas-de-precios-f-pre-14-y-f-cli-21).

Resumen del cierre: crear, editar, archivar, restaurar y asignar listas es **solo del rol Administrador**; leen las listas y la lista de cada cliente quienes tienen `clientes` o `ventas`; la tienda nunca expone el nombre ni el porcentaje de la lista. Revisión completa en [Revisión de seguridad de las listas de precios](revision-seguridad-listas-de-precios.md).

## Documentos de la búsqueda documental: Consulta no escribe

Los documentos de la búsqueda documental no tienen sección propia en la matriz: se rigen por la funcionalidad
`busqueda-documental` y por un helper de rol. `private.puede_gestionar_documentos()`
(`supabase/migrations/20270507180400_documentos_escritura_excluye_consulta.sql`) es verdadero para un miembro **activo** con
rol `administrador`, `operador`, `mostrador`, `deposito`, `administracion` o `tecnico` (lista blanca) y para el superadmin con
una organización activa; **Consulta** y el rol heredado `miembro` no escriben. Las políticas de escritura de
`fragmentos_indexados`, `documentos` y `versiones_documento` y las de insert y delete del bucket `documentos-rag` lo exigen, y
`eliminar_documento` rechaza con `42501` a quien no puede gestionar documentos; la lectura y la búsqueda no cambian. La función
Edge `indexar-documento` escribe los fragmentos con el cliente de servicio, pero solo después de autorizar con el JWT de la
persona, y los borra con `public.borrar_fragmentos_si_dueno` (`20270507200100_borrar_fragmentos_si_dueno.sql`, solo
`service_role`), que comprueba y borra en una sola transacción. Pantalla, límites y pruebas:
[Documentos IA](documentos-ia.md); prueba pgTAP `lote32_documentos_escritura_consulta.test.sql`.

## Lote 42: `empresas` (escritura) y comprobantes/RMA por empresa

- `dominio.empresas`: el `UPDATE` exige la sección `empresas` en `edicion` (`private.nivel_seccion('empresas')`), no el rol
  Administrador; por defecto solo el Administrador la tiene, pero un rol con la sección en edición también edita.
- `comprobantes_venta`, `comprobantes_venta_lineas`, `rma` y `rma_items` (lectura): Ventas en `lectura` o `edicion` **en la
  empresa del registro** (políticas con `empresa_id in (select private.empresas_con_ventas_lectura())`, que se evalúa una vez por
  consulta y no por fila; `private.puede_leer_ventas_empresa` es el envoltorio por empresa de la misma regla); una persona con Ventas en la tienda A y sin Ventas en la B no lee
  la B por la API. Los comprobantes sin empresa siguen la regla de la organización. Detalle en `docs/higiene-base-datos.md`.
