---
owner: producto
sources:
  - specs
---

# Clientes

Guía de `public.clientes` (épica MSF-180, spec `specs/20261016-130000-clientes-alta-y-busqueda/`).
La tabla vive en `public` por excepción documentada en la spec (Principio VII): es preexistente, está
expuesta y `clientes_identificadores_externos` y los tests de aislamiento dependen de ella; moverla a
`dominio` no es aditivo. El traslado queda trazado como seguimiento (ver «Deuda trazada»).

## Modelo

- Ficha: `numero` (correlativo por organización, asignado bajo advisory lock; nadie lo fija), `nombre`
  (obligatorio, recortado, **no** único), `documento` (DNI/CUIT, único por organización tras normalizar:
  `clientes_org_documento_uq`; el error `23505` se muestra en el campo), `correo`, `telefono`, `celular`,
  `direccion`, `codigo_postal`, `localidad`, `provincia`, `tipo`, `es_consumidor_final`, `archivado_en`
  (archivar/restaurar; **no existe «Eliminar»**) y `updated_at`.
- Migraciones aditivas, en orden: `20261016130000_clientes_ficha_y_numeracion`,
  `20261016130200_clientes_rls_por_seccion_y_actividad`, `20261016130300_clientes_tipo_y_consumidor_final`,
  `20261016140000_clientes_buscar`, `20261016150000_clientes_exportar`.
- Actividad: archivar, restaurar, crear y editar registran `cliente.*` en `registro_actividad` (solo con
  sesión) y **sin datos de contacto** en el detalle.

## Permisos (FR-004, FR-013)

| Quién | Qué puede |
| --- | --- |
| Administrador, Administración, Operador, Mostrador (`edicion`) | Listar, ver, crear, editar, archivar y restaurar |
| Consulta (`lectura`) | Listar y ver |
| Depósito (`ninguno` en la matriz vigente) | Nada: ni siquiera lee filas por la API |
| Acción `exportar` (Administrador, Operador y Administración por defecto) | Además, exportar a Excel |

El RLS se evalúa por organización **y** por sección (`private.nivel_seccion('clientes')`); la UI oculta
botones pero la base es la que manda. `anon` no ejecuta ninguna RPC de clientes ni tiene privilegios sobre
la tabla (`docs/acceso-ingreso.md`). Detalle por rol: `docs/permisos-por-rol.md`.

## Búsqueda y listado (FR-006, FR-007)

`public.buscar_clientes(p_texto, p_tipo, p_archivados, p_pagina, p_tamano)` es `security invoker` (hereda RLS).
Busca de forma parcial e insensible a mayúsculas (`lower`; **no** ignora tildes) en nombre, documento, correo, teléfono, localidad
y número (índice GIN trigram `clientes_busqueda_trgm_idx`, con la misma expresión; la migración `20261016160000_clientes_habilitar_pg_trgm.sql` habilita `pg_trgm` en `extensions` y crea el índice si faltaba y **aborta con error si el índice no queda creado**, para que no haya un salto silencioso); escapa `\`, `%` y `_` del texto; filtra por tipo y por activos/archivados; pagina en el servidor
(tope de 100 por página) y devuelve el total. La pantalla espera ≈300 ms antes de buscar.

## Tipo de cliente (FR-008)

`clientes.tipo` es `minorista` (por defecto) o `mayorista`, con restricción en base y sin
valores nulos. Los tipos no se crean ni se borran. Quien edita Clientes puede elegirlo en
el alta y cambiarlo después, desde el selector «Tipo de cliente» del formulario compartido
(`FormularioCliente`, alta y edición): muestra qué significa cada tipo y, al cambiarlo en la
edición, avisa que las próximas ventas usarán la escala del nuevo tipo (lo ya vendido no cambia).

## Consumidor final (FR-009)

Cada organización tiene exactamente **un** cliente «Consumidor final» (`es_consumidor_final`),
minorista, para vender en el mostrador sin cargar un cliente cada vez.

- Las organizaciones existentes lo reciben por backfill de la migración
  `20261016130300_clientes_tipo_y_consumidor_final.sql`; las nuevas, por el disparador
  `organizaciones_crear_consumidor_final`.
- Unicidad por organización: índice único parcial `clientes_consumidor_final_uq`.
- **Inmutable en la base**: el disparador `clientes_proteger_consumidor_final` rechaza editarlo,
  archivarlo, cambiarle el tipo o borrarlo, también para `postgres`/`service_role`. El borrado
  solo se permite en cascada al borrar la organización. Nadie puede marcar a otro cliente
  como Consumidor final (la columna no se concede a `authenticated`).
- En la interfaz (ficha y edición) no se ofrece «Editar» ni «Archivar», y no existe «Eliminar».
- Es un cliente más para las consultas: **aparece en el listado y en las exportaciones**. Búsqueda
  (F-CLI-02) y exportación (F-CLI-04) deben tratarlo explícitamente (mostrarlo marcado como cliente
  de mostrador o excluirlo según corresponda), no ignorarlo.
- Numeración: recibe el siguiente número de su organización. Es el **1** solo en organizaciones
  nuevas; en las existentes el backfill le asigna el siguiente libre.

## `public.escala_de_cliente(p_cliente_id uuid)` (FR-010)

Contrato de lectura para Ventas y Service técnico: `x1` para minorista y `por_cantidad`
para mayorista; nulo si el cliente no existe o no es visible (security invoker, hereda RLS).
Regla provisoria hasta que Precios decida: si cambia, solo cambia el cuerpo de la función.
Ejecutable por `authenticated`; `anon` y `public` sin acceso (FR-013).

## Reversión

Ver el encabezado de la migración: es aditiva y su reversión (funciones, disparadores, índice,
restricciones y grants) va en una migración posterior; las columnas no se borran en el mismo PR.

## Deuda trazada

- Traslado de `public.clientes` a `dominio`: [MSF-505] «Trasladar public.clientes al esquema dominio (Principio VII)».
- Registro en la actividad de la exportación: MSF-508.
- E2E «alta, búsqueda y exportación»: MSF-499 (ver `docs/e2e-app.md`).
- T019 (SC-002), seed de ~5.000 clientes y `EXPLAIN`: lo verifica el CI. El pgTAP `supabase/tests/database/clientes_plan_indices.test.sql` (job `database`) siembra 5.000 clientes con tilde, corre `EXPLAIN` con `enable_seqscan = off` (prueba que el índice es utilizable, no la elección con costos normales) y **falla** si la búsqueda no usa `clientes_busqueda_trgm_idx` o la paginación no usa `clientes_org_nombre_idx`. Corre como owner, sin RLS. `supabase/verificacion/clientes_explain.sql` es el script manual (`EXPLAIN ANALYZE`, solo base local).
  Desvío: sin Docker acá no se pegó el plan; lo corre el CI (ver commit 0d18b43).

## Pruebas

pgTAP `supabase/tests/database/clientes_tipo_y_consumidor_final.test.sql` y `clientes_plan_indices.test.sql` (planes de índice, T019); Vitest
`apps/web/src/pages/clientes/show.test.tsx`, `edit.test.tsx` y
`apps/web/src/components/clientes/FormularioCliente.test.tsx` (selector de tipo). El aislamiento
(`aislamiento_organizaciones.test.sql`) cuenta todas las filas, Consumidor final incluido, para que
una fuga de RLS sobre él sea detectable.

## Exportación a Excel (F-CLI-04, MSF-318)
- **Quién:** solo quien tiene la acción `exportar` en Clientes (`private.puede_accion('clientes','exportar')`;
  por defecto Administrador, Operador y Administración). La UI oculta «Exportar» sin el permiso y la RPC
  `public.exportar_clientes` (security definer, `search_path` vacío) lo vuelve a exigir: error `42501` si no.
  La organización sale de `private.organizacion_id()`, nunca de un parámetro. `anon` sin acceso.
- **Cómo:** mismos filtros que `buscar_clientes`, por lotes con keyset `(lower(nombre), id)` (sin repetidos ni
  omisiones). Tope de lote 1000; tope total 50.000 filas (superado: error `54000`, «Afiná la búsqueda»). El total se cuenta solo en el primer lote (los siguientes devuelven 0) y un cursor inexistente falla con `40001` («reintentá»), nunca un archivo truncado.
- **Archivo:** `.xlsx` real (hoja «Clientes»), generado en el navegador con `write-excel-file` (MIT, una sola
  dependencia, `fflate` MIT), cargado con `import()` diferido al exportar. Toda celda es texto y los valores que
  empiezan con `=`, `+`, `-`, `@`, tab o retorno llevan un apóstrofo delante (formula injection); ese apóstrofo es visible (p. ej. `'+54…`) y es una limitación aceptada.
  Licencia verificada con `supply-chain-security`: `write-excel-file` y `fflate` son MIT (lockfile con integridad fijada; subpath `write-excel-file/browser` declarado en su `exports`).
- **Límites conocidos:** (1) la exportación no se registra aún en la actividad (la RPC es `stable`; registrarla pide
  pasarla a `volatile` o un registro desde el cliente): queda como deuda trazada: [MSF-508] «Registrar en la actividad la exportación de clientes» (requisito de auditoría, Principio III); no se resuelve en esta historia.
  (2) Cada lote reaplica filtro y orden sobre `clientes` (mismo patrón y mismo índice que `buscar_clientes`); el total
  y el tope solo se cuentan en el primer lote, y el máximo son 50 lotes por exportación. (3) El cursor se relee en vivo:
  si renombran al cliente cursor durante la descarga, el orden puede correrse (filas repetidas u omitidas); si lo
  borran, falla con `40001` y se reintenta.
- **UX:** confirmación con el total, progreso, cancelación y error con «Reintentar».
- **Reversión:** migración `20261016150000_clientes_exportar.sql` aditiva; se deshace en una migración posterior
  con `drop function public.exportar_clientes(text, text, boolean, uuid, integer)`.
- **Pruebas:** pgTAP `clientes_busqueda_exportacion.test.sql` (permiso, keyset, tope de lote, aislamiento);
  Vitest `lib/exportarClientes.test.ts`, `components/clientes/ExportarClientes.test.tsx` y `pages/clientes/list.test.tsx`.

## Fidelidad al prototipo (Clientes · Listado, `design/pantallas/Clientes.dc.html`)

Mapeo del inventario (51 ítems) contra épicas — la pantalla se construye por partes, cada épica
dueña de la suya (la pantalla evoluciona; ninguna épica reescribe lo ajeno):

- **MSF-180 (hecho)**: tabla base (Nº, nombre, DNI/CUIT, tipo, localidad), búsqueda/filtros/paginación
  en servidor, ficha con archivo/eliminar lógico, alta/edición, exportar a Excel.
- **Este cambio (MS-180 fidelidad, sin épica)**: expreso preferido + **tabla fiel** (Cliente combinado N.º·nombre·doc, Contacto mail+tel, Tiendas/Cuenta web como placeholder `—` sin backend) y **formulario en diálogo grid** (N.º readonly, Tipo en 3 cards, grid 2 cols) — acerca lo entregado en MS-180 al prototipo sin pisar MS-155/445/171.
- **MSF-155 Backlog (correo masivo)**: diálogo de correo, destinatarios, historial (F-CLI-11/12/13).
  NO se implementa acá.
- **MSF-445 Backlog (mejoras)**: etiqueta impresa F-CLI-17. NO se implementa acá.
- **MSF-171 Backlog (ranking)**: pestaña de ranking F-CLI-14/15/16. NO se implementa acá.
- **MSF-450 Backlog (cuentas)**: cuenta web e invitación. NO se implementa acá.
- **MSF-142 (migración, hecho en la rama de la épica)**: importación masiva F-MIG-01 desde el botón
  «Importar», solo Administrador; ver [Migración inicial de datos](producto/migracion-inicial-de-datos.md).
- **Sin dueño**: entidad tienda + filtro por tienda; tipo Distribuidor (el check admite
  minorista/mayorista); datos del ranking (sin ventas). La columna Cuenta web y Tiendas no se
  muestran hasta tenerlos.
- **MSF-450 Backlog (cuentas)**: historial de compras y favoritos de la cuenta. La cuenta web, la
  invitación y los precios por tipo se entregan en **MSF-237** (ver «Cuenta web del cliente»).
- **MSF-142 Backlog (migración)**: importación masiva F-MIG-01. NO se implementa acá.
- **Sin dueño**: tipo Distribuidor (el check admite minorista/mayorista); datos del ranking (sin
  ventas). Las columnas Tiendas y Cuenta web ya son reales (MSF-237).
- **Pruebas**: pgTAP (expreso: round-trip, tope, grants) + Vitest (columnas Contacto/Expreso en
  `pages/clientes/list.test.tsx`; fixtures con `expreso_preferido`).

## Cuenta web del cliente (MSF-237)

La ficha, el listado y el formulario de Clientes gestionan la **cuenta web por tienda** (épica
**MSF-237**, spec `specs/20261024-051500-cuenta-web-del-cliente/`). Guía de producto:
[Cuenta web del cliente](producto/cuenta-web-cliente.md); contratos, datos y operación:
[Cuenta web del cliente (técnico)](tecnico/cuenta-web-cliente.md).

- **Estados por tienda:** **Activa**, **Suspendida**, **Sin cuenta** (sin fila) y **No habilitado**
  (el cliente no está en «Habilitado en» esa tienda; prevalece sobre el estado guardado y conserva la
  cuenta). La lógica de derivación vive en `apps/web/src/lib/cuentasCliente.ts`.
- **Acciones:** crear cuenta web (requiere correo), restablecer clave, suspender, reactivar y
  habilitar/deshabilitar la tienda. La creación y el restablecimiento pasan por la Edge Function
  `invitar-cliente`; suspender/reactivar, por `public.cambiar_estado_cuenta_cliente`. Cada acción
  registra un evento de Actividad con actor, cliente y tienda.
- **Invitación y acceso:** un solo usuario de Auth por cliente (D1); la cuenta **no** se agrega a
  `usuarios_organizacion` y no puede leer nada del panel. El correo de acceso es `clientes.correo`; si
  ya pertenece a un usuario del panel, la invitación se rechaza con un mensaje genérico (D5). No hay
  auto-registro.
- **Listado:** la columna «Cuenta web» muestra el estado (en «Todas mis empresas», Activa > Suspendida >
  Sin cuenta, D4) y el filtro «Con cuenta web» deja las cuentas activas y habilitadas. El filtro también
  se aplica a la exportación.
- **Formulario:** campo «Cuenta web» (Sin cuenta / Activa / Suspendida) con su nota y casilla «Enviar
  invitación por correo al crear la cuenta». Al guardar con «Activa» se crea la cuenta en cada tienda
  tildada; una cuenta existente no recibe otra invitación y solo transiciona si el operador cambia el
  campo.
- **Empresa activa:** listado, ficha y formulario se reencuadran a la tienda de la barra superior y
  descartan la selección de la anterior (Principio VIII, `empresa-activa.test.tsx`).
- **Datos:** tabla `public.cuentas_cliente` (una fila por `(cliente, tienda)`, única, RLS por organización
  + sección Clientes + tiendas accesibles, FK en cascada). Migraciones `20261206100000`–`20261206110100`.
- **Estado:** implementado en la rama de la épica, pendiente de merge a `main`; pgTAP, Vitest/axe y E2E
  escrito (requiere Supabase local).

Quedan **fuera de esta épica**: historial de compras y favoritos (F-CLI-20 / MSF-450), auto-registro y
aprobación del mayorista, tipo «Distribuidor», compra/carrito (MSF-176) y selección automática de escala
en ventas (F-VTA-06).
## Exportar el ranking a Excel (F-CLI-09, MSF-255)
- **Quién:** solo quien tiene la acción `exportar` en Clientes (`usePuedeAccion('clientes','exportar')`); la solapa
  «Ranking por facturación» oculta «Exportar a Excel» sin el permiso. Los datos son los mismos que ya ve quien tiene
  `lectura` (la función `ranking_clientes` exige la sección `clientes`); la acción no se vuelve a imponer en el servidor.
- **Qué exporta:** **todas** las filas del ranking vigente (período aplicado, tipo, Consumidor final, base con/sin IVA),
  no solo la página. Llama por lotes de 1.000 a la **misma** `public.ranking_clientes` que la pantalla
  (`lib/exportarRanking.ts`), así filas y totales coinciden. Tope: 100.000 clientes (si lo supera pide acotar el período).
- **Archivo:** `ranking-clientes-<desde>_<hasta>.xlsx`, hoja «Ranking de clientes», encabezados en la primera fila
  (#, Cliente, Tipo, Comprobantes, Facturado (sin/con IVA), Participación); al pie, el período, la base y el total
  facturado. Importes y participación son números con formato; el texto se neutraliza con `neutralizarFormula`.
  `write-excel-file` (MIT, ya dependencia) se carga con `import()` diferido al exportar.
- **Estados:** botón deshabilitado con el ranking vacío o en curso; progreso, «Cancelar exportación», «Exportación lista»
  y error con «Reintentar».
- **Límite conocido:** la paginación es por posición; si Ventas emite comprobantes mientras se exporta, el archivo puede
  diferir de la pantalla en esas filas (se documenta, no se bloquea).
- **Sin cambios de base de datos:** no hay migración ni tablas nuevas (esquemas sin alterar). **Reversión:** revertir el
  PR (solo frontend).
- **Pruebas:** Vitest `lib/exportarRanking.test.ts` y `components/clientes/RankingClientes.test.tsx`.

## Historial de compras en la ficha (F-CLI-10, MSF-269 · épica MSF-126)

- **Pantalla:** la ficha `/clientes/show/:id` muestra la sección **Compras** (para quien tiene la sección Clientes en
  lectura/edición): «Resumen comercial» con el **total facturado del año en curso** (1/ene → hoy en la zona de la
  organización, base sin IVA, mismo predicado `private.comprobante_cuenta_como_facturado` que el ranking) y «Últimos
  comprobantes» (número, fecha, estado y total; del más reciente al más antiguo; 10 por página, paginado en el servidor).
  Anuladas y presupuestos se listan con su estado pero no suman. Los números de comprobante son texto: el enlace es de Ventas.
  Un error o la carga de Compras no afectan al resto de la ficha. El Consumidor final se muestra igual.
- **Función:** `public.compras_de_cliente(p_cliente_id, p_pagina default 1, p_tamano default 10)` (migración
  `20261018100200_clientes_compras.sql`, sin tablas nuevas): `security definer`, `search_path = ''`, organización de
  `private.organizacion_id()`, exige Clientes en `lectura`/`edicion` (si no, `42501`); cliente de otra organización o
  inexistente → cero filas; sin comprobantes → una fila centinela (`numero` nulo, `facturado_anio = 0`) para mostrar `$ 0`.
  `revoke … from public, anon` y `grant execute … to authenticated`.
- **Reversión (migración posterior, aditiva):** `drop function public.compras_de_cliente(uuid, integer, integer);`
- **Pruebas:** pgTAP `clientes_compras.test.sql`; Vitest `ComprasCliente.test.tsx`, `useComprasCliente.test.tsx` y `show.test.tsx`.

## Cierre de la épica MSF-126 (MSF-518)

- **Reversión de la épica:** funciones `public.ranking_clientes` y `public.compras_de_cliente`, predicado
  `private.comprobante_cuenta_como_facturado` y (exportando antes los datos si Ventas ya escribe)
  `dominio.comprobantes_venta` + `public.clientes_id_organizacion_uq`, siempre en migraciones posteriores aditivas.
  La exportación es solo frontend. La spec completa se deshace con un `git revert -m 1` del merge.
- **Verificación de esquema (Principio VII):** `dominio.comprobantes_venta` en `dominio` (documento de venta del
  producto), con RLS por organización y sección `ventas`; `public.clientes` no cambia de esquema (solo un índice
  único aditivo); las dos funciones viven en `public` por ser RPC de la app y leen ambos esquemas.
- **Seguridad:** ambas RPC son `security definer` con `search_path = ''`, organización de `private.organizacion_id()`
  y sección `clientes` verificada adentro; `revoke … from public, anon` y `grant execute … to authenticated`.
- **Diferencias con el prototipo (declaradas):** atajos de período y filtros no dibujados en el prototipo; «total del
  año» (1/ene → hoy) en la ficha frente a 12 meses; el ranking también se pide en Ventas · Reportes (duplicado).
- **Seguimiento trazado:** ranking en Ventas · Reportes (mismo componente/función, filtro y desglose por tienda) y aviso
  a MSF-159/177 del contrato `dominio.comprobantes_venta` y del predicado único de estados. Dueño del ranking en
  Ventas · Reportes: **MSF-159/177** (historias de Ventas); no se creó una Tarea `seguimiento` aparte, por lo que la
  clave de esas historias es el responsable verificable.

## Importación desde el panel actual (F-MIG-01, MSF-299 · épica MSF-142)

- **Quién:** solo el **Administrador de la organización** (`private.puede_escribir()`); `anon` sin acceso y sin
  service-role en el navegador. En el listado, «Importar» aparece únicamente con ese permiso y lleva a
  `/migracion/importar/clientes`. La entrada «Migración de datos» vive en Administración (Principio VI).
- **Archivo:** CSV UTF-8 (si viene de Excel, guardarlo como «CSV UTF-8»). Se acepta coma o punto y coma, BOM,
  CRLF y comillas escapadas; un archivo ilegible, vacío o sin filas no avanza. «Descargar plantilla CSV»
  entrega `clientes.csv` con las mismas columnas que el mapeo.
- **Mapeo (FR-003):** cada columna del archivo se asocia a un campo del cliente; el **identificador del panel
  actual** y el **nombre o razón social** son obligatorios y no se puede asignar un campo a dos columnas. El
  «Número» del cliente no se mapea: lo asigna el sistema (D4).
- **Vista previa (FR-004):** la clasificación la hace la base con las mismas reglas del alta
  (`previsualizar_lote_clientes`, solo lee): nuevos, a actualizar y filas con error con su número de fila y
  motivo. Las filas con error no se importan; las válidas sí.
- **Aplicar (FR-005/006/007/008):** `iniciar_carga_migracion` abre la carga; `aplicar_lote_clientes` procesa
  lotes de hasta 500 filas y concilia por `clientes_identificadores_externos` con `sistema = 'panel_actual'`
  (existe → actualiza; no existe → crea, vincula y habilita en las tiendas de la organización);
  `cerrar_carga_migracion` recalcula los contadores y devuelve el informe. Reaplicar la misma carga no duplica.
  Cada ejecución deja `public.migracion_cargas` y el resultado por fila en `public.migracion_filas`.
- **Esquema y RLS (Principio VII):** las dos tablas nuevas están en `public` (herramienta transversal de
  plataforma), con RLS por organización, lectura solo Administrador, sin escritura directa para
  `authenticated` y sin privilegios para `anon`; las RPC son `security definer` con `search_path = ''`.
- **Empresa activa (Principio VIII):** **no aplica filtrado por empresa**. Los clientes son de la
  organización y se habilitan en las tiendas; la pantalla lo declara y cambiar la empresa de la barra
  superior no cambia el destino ni mezcla el lote en curso (FR-011).
- **Reversión:** migración aditiva `20261201100000_migracion_cargas.sql`; el `drop` de funciones y tablas va
  en una migración posterior (los clientes ya importados no se borran con la reversión). El frontend se
  revierte con el PR. Detalle en `specs/20261023-120000-migracion-inicial-de-datos/`.
- **Pruebas:** pgTAP `supabase/tests/database/migracion_clientes.test.sql` (RLS, `anon`, rol, idempotencia,
  lote atómico, errores por fila); Vitest `lib/migracionCsv.test.ts`, `pages/migracion/entidades/clientes.test.ts`,
  `pages/migracion/AsistenteImportacion.test.tsx`, `pages/clientes/list.test.tsx` y la guarda de fixtures
  sintéticas `test/fixtures/fixturesSinteticas.test.ts`. Las fixtures usan dominios reservados y documentos
  inventados (FR-012).

## Importador de clientes desde el panel actual (MSF-299)

- La RPC `aplicar_lote_clientes` concilia por `clientes_identificadores_externos` (`sistema = 'panel_actual'`).
  Al **actualizar**, solo se pisan las columnas que el archivo trae **con valor**: una celda vacía (o de solo
  espacios) deja el dato existente como está; reimportar nunca borra documento, correo, teléfono ni dirección.
- El mismo identificador en dos filas del mismo archivo es error de fila (la primera gana); para actualizar un
  cliente hay que reimportarlo en otra carga.
- El mensaje «El identificador ya está en uso» no revela si el identificador pertenece a otra organización.
- El navegador rechaza archivos de más de 25 MB (`TAMANO_MAXIMO_BYTES`) antes de leerlos.
