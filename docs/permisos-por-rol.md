---
owner: producto
sources:
  - specs
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
| `permisos_rol_accion` | `public` | Organización × rol × sección × acción (`eliminar`, `exportar`, `ver_costos`) → permitido. |

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
  `exportar` y `ver_costos` exigen al menos `lectura`; una acción desconocida es `false`.

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

## Compatibilidad y límites

- `private.puede_escribir()` no cambia: las tablas existentes (`clientes`, …) conservan su
  comportamiento hasta que cada una migre a este contrato (pgTAP de regresión incluido).
- **`clientes` migró a este contrato (F-CLI-01, MSF-262):** sus políticas usan
  `nivel_seccion('clientes')` (`select` con `lectura`/`edicion`; `insert`/`update` con `edicion`; sin
  DELETE) y `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR` (`lib/permisos.ts`) quedó vacío. Operador, Mostrador y
  Administración editan; Consulta lee; Depósito (`ninguno` en la matriz vigente) ni lee filas por la API.
  Queda cerrado el riesgo aceptado de lectura REST con `ninguno`. Migraciones
  `20261016130000_clientes_ficha_y_numeracion` y `20261016130200_clientes_rls_por_seccion_y_actividad`;
  `numero`, `organizacion_id` y `archivado_en` fuera de lo que el llamador fija (grants por columna).
  Búsqueda, exportación (acción `exportar`) y `escala_de_cliente` (F-CLI-02/03/04): ver `docs/clientes.md`.
  Matriz de Depósito (SC-006): `ninguno` en Clientes, sin cambios; la base y la UI le niegan listado, ficha y exportación.

  Ranking de clientes y compras en la ficha (F-CLI-08/09/10): lo ve quien tiene Clientes en `lectura` o `edicion`
  (`ranking_clientes` y `compras_de_cliente` lo exigen en la base, `42501` si no); exportarlo a Excel exige además la
  acción `exportar` de Clientes. Depósito (`ninguno`) no lo ve ni lo exporta. Detalle en `docs/clientes.md`.
- **`dominio.proveedores` (F-PRV-01/02/03, MSF-205):** `dominio.proveedores` usa `nivel_seccion('proveedores')` (Administrador y
  Administración `edicion`; el resto `ninguno`, la base no entrega filas de la tabla); sin `DELETE` (se desactiva). El selector del
  producto lee `public.proveedores_basico` (solo id, razón social y estado), que filtra por organización **y nivel**:
  `productos` en `edicion`, `stock` en `lectura`/`edicion` o `proveedores` en `lectura`/`edicion`; así el Operador
  ve los proveedores por la vista aunque no lea la tabla. La ficha
  llama `productos_de_proveedor`, que exige `proveedores` y `productos`. Detalle en `docs/proveedores.md`.
- **`dominio.productos` y `dominio.producto_costos` nacen en este contrato (F-CAT-02, MSF-458):** `productos`
  con `nivel_seccion('productos')` (Administrador y Operador editan; el resto lee; sin DELETE) y
  `producto_costos` con `nivel_seccion('rentabilidad')` (solo Administrador edita, Administración lee; el
  Operador ve 0 filas y la RPC le rechaza el costo). Ver `docs/catalogo.md`.
- **`dominio.producto_imagenes` y el bucket `productos-imagenes` (F-CAT-05, MSF-461)** usan `nivel_seccion('productos')`:
  Administrador y Operador agregan y quitan imágenes; el resto las ve (lectura) y no puede subir ni borrar.
- **`dominio.producto_empresa` (F-CAT-07, MSF-276)** usa `nivel_seccion('productos')`: edita quien edita productos; el resto lee.
  **`dominio.categorias` y `dominio.categorias_empresa` (F-CAT-08, MSF-298)** usan `nivel_seccion('categorias')`
  (`edicion` crea, edita, reordena y elimina; `lectura` solo ve el árbol). Ver `docs/catalogo.md`.
- **`dominio.existencias`, `dominio.movimientos_stock` y `dominio.motivos_movimiento` (F-STK-02, MSF-153)** usan
  `nivel_seccion('stock')`: quien tiene `edicion` (Administrador, Operador, Depósito) registra movimientos con
  `public.registrar_movimiento_stock`; con `lectura` (Consulta, Mostrador, Administración) ve cantidades y movimientos sin
  poder escribir, ni por la interfaz ni llamando directo a la base. Los motivos los edita solo quien cumple
  `private.puede_escribir()` (Administrador). Ver `docs/stock.md`.
- **`dominio.ingresos_mercaderia` y `dominio.ingresos_mercaderia_lineas` (MSF-219)** siguen la sección
  `stock`: `lectura`/`edicion` ven el historial; registrar y anular exigen `edicion`. Actualizar el costo del
  producto con el ingreso exige además `rentabilidad` en `edicion`; sin ese permiso la casilla no se muestra
  y la base rechaza (`42501`). Las tablas son de solo lectura: escriben las RPC `security definer`. Ver
  `docs/tecnico/ingreso-de-mercaderia.md`.
- **`dominio.ingresos_mercaderia` y sus líneas (F-PRV-04, MSF-383)** usan `nivel_seccion('stock')`: con `edicion`
  (Administrador, Operador, Depósito) se registran ingresos con `public.registrar_ingreso_mercaderia`; con `lectura`
  (Consulta, Mostrador, Administración) solo se ve el historial. Actualizar el costo de un producto desde el ingreso
  exige además `rentabilidad` en `edicion` (hoy solo Administrador). Ver `docs/ingreso-de-mercaderia.md`.
- `accessControlProvider` comparte una sola consulta de permisos por usuario (promesa en vuelo + TTL de 5 s,
  `obtenerPermisosActualesCacheado`); F-ROL-02 debe llamar `invalidarCachePermisos()` al editar la matriz.
- El rol `miembro` del template queda en solo lectura donde el prototipo da lectura, y sin acceso
  a las secciones reservadas a Administrador/Administración (nunca gana acceso que no tenía).
- Los valores iniciales de las acciones (`eliminar`, `exportar`, `ver_costos`) son una
  **extensión propuesta**, pendiente de confirmar con el cliente. Se editan con F-ROL-02.
- **Pendiente MSF-119**: cuando exista `usuarios_organizacion.estado`, `private.nivel_seccion`
  DEBE excluir `suspendido` (`and u.estado <> 'suspendido'`). La columna no existe todavía en esta
  rama, así que hoy la función no puede filtrarlo; US4 (F-USR-02) queda bloqueada hasta entonces.
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
- Auditoría (F-AUD-01, entregada): `guardar_matriz_permisos` y `restablecer_matriz_permisos` registran `permisos.matriz_guardada` / `permisos.matriz_restablecida` en `public.registro_actividad` (quién y cuándo; visible en `/actividad` para Administración y Operador). El valor previo y nuevo de cada celda no se guarda. Ver `docs/actividad.md`.
- Edición concurrente: si dos Administradores guardan a la vez gana el último en guardar (la RPC serializa pero no detecta conflictos); la auditoría de F-AUD-01 deja quién y cuándo guardó, no el valor previo. La pantalla avisa al cerrar la pestaña con cambios sin guardar.
- El contador de usuarios por rol filtra por la organización activa (la policy también deja ver las propias membresías en otras organizaciones).
- Reversión: `drop function public.restablecer_matriz_permisos(); drop function public.guardar_matriz_permisos(jsonb, jsonb);`.

## Guard de rutas (F-ROL-03)

Toda ruta de sección con `seccionPermiso` DEBE envolverse en `RequiereAccesoSeccion`
(`apps/web/src/components/RequiereAccesoSeccion.tsx`); hoy cubre `/clientes*` y `/usuarios*` (`/miembros*` redirige a `/usuarios*`); `inicio` (`/`) queda fuera a propósito (es el destino de
redirección, envolverla causaría un bucle). `apps/web/src/App.guard.test.ts` cruza `DESTINOS_PANEL` con
`App.tsx` (importado con `?raw`, sin `node:fs`) y falla si una ruta con `seccionPermiso` queda sin guard.
El guard exige acceso a la sección (`lectura` o `edicion`), no distingue `create`/`edit`: en esas
rutas un usuario con `lectura` ve el formulario pero RLS rechaza la escritura (UX, no fuga). Las etiquetas de rol viven en
`ETIQUETA_ROL` (`apps/web/src/lib/permisos.ts`); un rol nuevo se agrega ahí. El guard
es defensa de UX (RLS es la autoridad) y falla cerrada: solo `lectura`/`edicion` abren la sección; un
nivel nulo tras cargar se trata como denegado. El rol mostrado sale de `usuarios_organizacion`
filtrado por `user_id` y por la organización activa (`useOrganizacionDeTrabajo`, por si la persona
pertenece a varias); si falla, se muestra «actual» y nunca una pantalla en blanco.

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

Spec: `specs/20261016-140000-permisos-por-empresa/`. Migración: `20261016140100_roles_por_empresa.sql` (renombrada desde `20261016140000` al integrar la épica de clientes, que ocupa esa versión).
Pruebas: `supabase/tests/database/roles_por_empresa.test.sql`.

- Esquemas (Principio VII): `usuarios_empresas(user_id, empresa_id, organizacion_id, rol_id)` y `usuario_empresa_activa(user_id, empresa_id)` viven en `public` (acceso transversal); `dominio.empresas` solo se referencia. Ambas con RLS, sin privilegios para `anon` y sin escritura directa: la escritura llega por las RPC de F-ROL-06 (empresa activa) y F-ROL-07 (asignaciones).
- `rol_id` solo admite `operador`, `consulta`, `mostrador`, `deposito`, `administracion` (`check` en la base) y la empresa debe ser de la organización del usuario (trigger). El Administrador de la organización no tiene filas y accede a todas las empresas activas.
- Resolución de `private.nivel_seccion` / `private.puede_accion` (vía `private.roles_de_referencia`):
  - **Compartidas** (`productos`, `categorias`, `stock`, `clientes`, `proveedores`, `cotizacion_dolar`): el mejor nivel (`edicion` > `lectura` > `ninguno`) entre los roles del usuario en sus empresas activas, sin importar la activa.
  - **Por empresa** (`ventas`, `consultas`, `reportes`): el nivel del rol en la empresa activa válida; sin activa válida → `ninguno`.
  - **El resto** (Inicio, Empresas, Mercado Libre, Rentabilidad, Usuarios y permisos, Actividad, Service técnico), el Administrador y quien **no tiene empresas asignadas**: el rol de organización, como antes.
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


## Migración inicial de datos (F-MIG-01…04, épica MSF-142)

Spec: `specs/20261023-120000-migracion-inicial-de-datos/`. Guías:
`docs/producto/migracion-inicial-de-datos.md` y `docs/tecnico/migracion-inicial-de-datos.md`.

- **Quién migra:** solo el Administrador. Toda RPC del importador (`iniciar_carga_migracion`,
  `previsualizar_lote_*`, `aplicar_lote_*`, `cerrar_carga_migracion`,
  `informe_conciliacion_migracion`) exige `private.puede_escribir()` y toma la organización de la
  sesión; un rol de consulta recibe `42501`. «Importar» en Clientes y Proveedores aparece solo con ese
  permiso.
- **Lectura de cargas:** `public.migracion_cargas` y `public.migracion_filas` (plataforma, `public`)
  solo se leen como Administrador de la organización; no tienen grants de escritura.
- **Archivo de ingresos:** `dominio.archivo_ingresos_mercaderia` usa `nivel_seccion('stock')` para
  leer (`lectura` o `edicion`) y solo se escribe por la RPC de importación.
- **`anon`:** ninguna de estas RPC es ejecutable por `anon` (`revoke … from public, anon` + `grant …
  to authenticated`).
- **Reversión:** las migraciones `20261201100000`…`20261201130000` son aditivas; cada cabecera
  documenta cómo deshacerlas.
## Rol Técnico (MSF-324 · F-SVC-05, épica MSF-182)

Rol `tecnico` para quienes operan Service técnico sin acceder al resto. Es **solo datos** (Principio VII):
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

- **Siembra**: la migración redefine `private.matriz_inicial()` con la columna `tecnico`
  (`private.matriz_acciones_iniciales()` la deriva sin cambios) y vuelve a correr
  `private.sembrar_permisos()` (`on conflict do nothing`) sobre las organizaciones existentes; las
  nuevas la reciben por el trigger vigente. «Restablecer valores iniciales» también repone al Técnico.
- **Matriz fija**: en **Roles y permisos** el Técnico aparece como columna sin edición (chips y casillas
  deshabilitados, «no editable»). `public.guardar_matriz_permisos` rechaza con `22023` cualquier cambio
  sobre `tecnico`; la edición de los otros roles no cambia. La matriz editable del Técnico llega en enero.
- **Asignación**: «Técnico» se elige en **Usuarios → Editar → Rol** (`cambiar_rol_miembro`, que valida
  contra `roles_organizacion`). Límites vigentes: la **invitación** (`registrar_invitacion`) y el rol por
  empresa (`usuarios_empresas`, check de cinco roles) siguen aceptando solo los roles previos; un Técnico se
  invita con otro rol y se cambia a Técnico al sumarse.
- **Reversión** (cabecera de la migración): borrar las filas `tecnico` de `permisos_rol_accion`,
  `permisos_rol` y `roles_organizacion` (solo si ningún usuario lo usa) y reaplicar
  `private.matriz_inicial()` y `public.guardar_matriz_permisos` de `20261013130002` / `20261016120000`.
