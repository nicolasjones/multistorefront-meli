---
owner: producto
sources:
  - specs
  - apps/web/src
---

# Clientes (MSF-180)

**Épica:** MSF-180 — Clientes y proveedores · Clientes alta y búsqueda.
**Historias:** F-CLI-01 (MSF-262), F-CLI-02 (MSF-282), F-CLI-03 (MSF-301), F-CLI-04 (MSF-318).
**Spec:** `specs/20261016-130000-clientes-alta-y-busqueda/`.
**Construcción interna:** [Clientes: modelo, RPC y pantallas](tecnico/clientes.md).

El equipo puede dar de alta, editar, buscar y exportar los clientes de la organización, cada uno con
su tipo minorista o mayorista, y existe el **Consumidor final** para el mostrador, listos para que
Ventas los use.

## Qué resuelve

- Antes el panel solo traía el esqueleto de clientes del panel anterior: sin datos de contacto, sin
  búsqueda, sin tipos y sin forma de darlos de baja.
- Ahora hay una **ficha de cliente** de la organización con nombre o razón social, DNI/CUIT, correo,
  teléfono, celular, dirección, código postal, localidad y provincia, y un **número correlativo** por
  organización que se lo asigna el sistema (nadie lo escribe a mano).
- El listado **busca y pagina en el servidor**: con miles de clientes no hay que traerlos todos para
  filtrar en el navegador.
- Cada cliente tiene **tipo** (minorista o mayorista), que es lo que después define la escala de precio
  en Ventas.
- Cada organización tiene un **Consumidor final**: el cliente de mostrador, para vender en el local sin
  cargar un cliente cada vez.
- El cliente **se archiva, no se borra**: deja de verse en el listado pero conserva sus datos y sus
  comprobantes, y se puede restaurar.
- Los clientes que coincidan con la búsqueda se **exportan a una planilla de Excel**.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a, Administración, Operador y Mostrador** (`edicion` en Clientes) | Ver el listado, dar de alta, editar, archivar y restaurar clientes |
| **Consulta** (`lectura` en Clientes) | Ver el listado y la ficha; no cambia nada, ni desde la pantalla ni llamando directo a la base |
| **Miembro** (`lectura` en Clientes) | Igual que Consulta |
| **Depósito** (`ninguno` en la matriz vigente) | No ve la sección ni recibe filas de clientes por la API |
| **Con la acción `exportar`** (Administrador, Administración y Operador por defecto) | Además, descargar los clientes a Excel |

La matriz de roles y el detalle de permisos están en [Permisos por rol](permisos-por-rol.md).

!!! note "La base manda, no la pantalla"
    Ocultar un botón es comodidad, no autorización: las políticas de `public.clientes` vuelven a
    comprobar organización y nivel de sección en cada lectura y escritura.

## La ficha del cliente

| Campo | Qué es |
|---|---|
| **Número** | Correlativo de la organización. Lo asigna el sistema; no se edita. |
| **Nombre o razón social** | Obligatorio. Se guarda recortado. **No** es único: dos clientes con el mismo nombre pueden coexistir. |
| **DNI/CUIT** | Opcional. **Único por organización** (se comparan solo letras y dígitos: sin puntos, guiones ni espacios) e incluye los archivados, para que restaurar nunca choque. Repetirlo se rechaza en el campo. |
| **Correo, teléfono, celular** | Contacto. |
| **Dirección, código postal, localidad, provincia** | Domicilio. |
| **Tipo** | Minorista o Mayorista. Obligatorio; Minorista por defecto. |
| **Estado** | Activo o Archivado. |

## Alta y edición

- «Nuevo cliente» abre el formulario con nombre o razón social, DNI/CUIT, correo, teléfono, celular,
  dirección, código postal, localidad, provincia y tipo. Al guardar se confirma **«Cliente creado»**;
  al editar, **«Cliente guardado»**.
- Si el nombre queda vacío, el error aparece en el campo y no se guarda.
- Si el DNI/CUIT ya lo usa otro cliente de la organización, el error aparece en el campo
  («Ya existe un cliente con ese DNI/CUIT») y no se guarda.
- Si el guardado falla, el formulario muestra el error («No se guardó el cliente»), deja el botón listo
  para volver a guardar y **conserva lo escrito**.
- El botón se deshabilita mientras envía: un doble clic no crea dos clientes.
- La ficha del cliente muestra los datos, el tipo y el estado, con «Editar» para quien puede editar.

## Relación con empresas / tiendas (F-CLI-05)

Un cliente es **único en la organización**, pero se **habilita en una o más tiendas** (empresas).
Esta relación explica la columna «Tiendas» del listado y el bloque «Habilitado en» del formulario
y de la ficha. **Leer esto antes de tocar clientes: el cliente no es «de una tienda», es de la
organización y se habilita en N tiendas.**

- **Tabla:** `public.clientes_empresas` (`cliente_id`, `empresa_id`, `organizacion_id`, `created_at`;
  PK `(cliente_id, empresa_id)`). Claves foráneas a `public.clientes` y `dominio.empresas` con
  `on delete cascade`; `empresa_id` y `organizacion_id` indexados. El `organizacion_id` de la fila
  debe coincidir con el del cliente y el de la empresa: lo garantiza el disparador
  `clientes_empresas_validar` (`private.validar_cliente_empresa`), también frente a `postgres`.
- **Lectura:** `select` para `authenticated` con RLS por organización y sección
  (`private.organizacion_id()` y `private.nivel_seccion('clientes') in ('lectura','edicion')`).
  En la web, `useEmpresasDeCliente(clienteId)` (ids) + `useEmpresas()` (catálogo de
  `dominio.empresas`) dan los nombres; `buscar_clientes` ya devuelve `empresas` (`jsonb` de
  `{id, nombre}`, `[]` si no hay, ordenado por nombre) para la columna del listado.
- **Escritura:** **solo** por la RPC `public.guardar_empresas_de_cliente(p_cliente_id uuid,
  p_empresa_ids uuid[])` (security definer, `search_path` vacío). Exige
  `private.nivel_seccion('clientes') = 'edicion'` (error `42501`), valida que el cliente sea de la
  organización (`P0002`) y que todas las empresas sean de la organización (`42501`), normaliza
  (sin nulos ni repetidos) y **reemplaza** el conjunto completo (borra e inserta en la misma
  transacción); devuelve cuántas tiendas quedaron. La tabla no concede `insert`/`delete` a
  `authenticated`: hay un solo camino de escritura, auditable. `anon` no ejecuta la RPC ni lee la
  tabla. En la web: `useGuardarEmpresasDeCliente().guardar(clienteId, empresaIds)` (el alta crea el
  cliente y después guarda las tiendas; la edición actualiza y después reemplaza la selección).
- **Valores por defecto:** un cliente nuevo arranca habilitado en **todas** las tiendas de la
  organización (el formulario las preselecciona); se puede dejar en ninguna. Los clientes que
  existían antes de esta migración se habilitaron en todas las tiendas de su organización para
  conservar el comportamiento previo (no había noción de tienda).
- **El «Consumidor final» no está exento:** es un cliente más de la relación (la migración lo
  alcanza en el backfill). No tiene trato especial acá.
- **Reversión:** migración aditiva `20261018090000_clientes_empresas.sql`; su reversión (drop de la
  RPC, del disparador y de la tabla, y restauración de `buscar_clientes` sin `empresas`) va en una
  migración posterior.
- **Pruebas:** pgTAP `supabase/tests/database/clientes_empresas.test.sql` y
  `supabase/tests/database/clientes_filtro_tienda.test.sql` (filtro por tienda, F-CLI-11); Vitest
  `apps/web/src/hooks/useEmpresasDeCliente.test.tsx`, `components/clientes/FormularioCliente.test.tsx`,
  `components/clientes/FiltroTienda.test.tsx` y `pages/clientes/{list,edit,show}.test.tsx`.
- **Filtro por tienda (F-CLI-11):** la pantalla filtra por la tienda elegida (`{{tFilt}}` del
  prototipo) y es un filtro **de pantalla**: el listado, el ranking y la exportación comparten la
  selección. `buscar_clientes`, `exportar_clientes` y `ranking_clientes` aceptan
  `p_empresa_id uuid default null` (`null` u omitido = todas, comportamiento previo). Un cliente sin
  tiendas no aparece al filtrar. Migración aditiva `20261018150000_clientes_filtro_por_tienda.sql`
  (ver la sección «Reversión»).
- **Qué tiendas ofrece el filtro (F-CLI-11, spec `20261018-170000-empresas-accesibles-y-filtro`):** la
  fila «Tienda» lista las empresas **accesibles** (`empresas_para_selector()` →
  `private.empresas_accesibles()`, `hooks/useEmpresasAccesibles.ts`): el Administrador ve todas las
  activas de su organización, un miembro las asignadas y el superadmin las de su organización activa.
  Al entrar, el filtro **arranca en la empresa activa** de la barra superior (como el prototipo:
  `gc_co` inicializa `tFilt`) y la sigue mientras no se elija una píldora; elegir una píldora manda sobre la
  activa y cambia solo el filtro de la pantalla, no la empresa activa persistida. Migración aditiva
  `20261018160000_selector_empresas_superadmin.sql` (rama del superadmin en `empresas_accesibles`).

## `public.escala_de_cliente(p_cliente_id uuid)` (FR-010)
## Listado, búsqueda, filtros y paginación

- Columnas: Cliente (nombre, N.º y DNI/CUIT), Tipo, Contacto (correo y teléfono), Localidad, más
  Expreso preferido y las columnas «Tiendas» y «Cuenta web», que hoy se muestran como «—» porque esas
  capacidades son de la cuenta web del cliente (MSF-237).
- El buscador espera ≈300 ms antes de consultar (no busca en cada tecla) y filtra por coincidencia
  parcial, sin distinguir mayúsculas, sobre **nombre, DNI/CUIT, correo, teléfono, localidad y número**.
- Filtros combinables: **Todos / Minorista / Mayorista** y **Activos / Archivados** (Activos por
  defecto).
- La paginación es del servidor (25 por página) y muestra el total; cambiar de página conserva la
  búsqueda y los filtros.
- Estados vacíos con salida: si hay filtros y no hay coincidencias, «No encontramos clientes con esos
  criterios» con la sugerencia de probar otro texto o quitar un filtro; si no hay ningún cliente
  cargado, «Todavía no hay clientes cargados.» y el botón «Nuevo cliente» queda a mano (si hay
  permiso). Un error de carga muestra el estado compartido con «Reintentar».
- En pantallas angostas (320 px) el listado pasa a tarjetas; funciona con teclado y lector de pantalla
  y no muestra identificadores técnicos.

## Archivar y restaurar

- Archivar pide confirmación y el cliente **deja de verse en el listado por defecto**. No se pierde
  ningún dato y sigue siendo legible por sus comprobantes históricos.
- Con el filtro «Archivados» se ven los archivados; «Restaurar» los devuelve al listado activo con
  sus datos y su número.
- **No existe «Eliminar»** en ninguna pantalla. Archivar un cliente ya archivado no duplica nada.

Para el filtro por tienda (F-CLI-11, `20261018150000_clientes_filtro_por_tienda.sql`): en una
migración posterior, `drop function public.buscar_clientes(text, text, boolean, integer, integer, uuid)`,
`drop function public.exportar_clientes(text, text, boolean, uuid, integer, uuid)` y
`drop function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid)`, y
recrear las tres con su firma previa (sin `p_empresa_id`): `buscar_clientes` como en
`20261018090000_clientes_empresas.sql`, `exportar_clientes` como en
`20261017120001_clientes_expreso_preferido.sql` y `ranking_clientes` como en
`20261018100100_clientes_ranking.sql`.

## Deuda trazada

- Traslado de `public.clientes` a `dominio`: [MSF-505] «Trasladar public.clientes al esquema dominio (Principio VII)».
- Registro en la actividad de la exportación: MSF-508.
- E2E «alta, búsqueda y exportación»: MSF-499 (ver `docs/e2e-app.md`).
- T019 (SC-002), seed de ~5.000 clientes y `EXPLAIN`: lo verifica el CI. El pgTAP `supabase/tests/database/clientes_plan_indices.test.sql` (job `database`) siembra 5.000 clientes con tilde, corre `EXPLAIN` con `enable_seqscan = off` y sin el btree `clientes_organizacion_id_idx` dentro de la transacción de prueba, para que el resultado no dependa del empate de costos (prueba que el índice es utilizable, no la elección con costos normales) y **falla** si la búsqueda no usa `clientes_busqueda_trgm_idx` o la paginación no usa `clientes_org_nombre_idx`. Corre como owner, sin RLS. `supabase/verificacion/clientes_explain.sql` es el script manual (`EXPLAIN ANALYZE`, solo base local).
  Desvío: sin Docker acá no se pegó el plan; lo corre el CI (ver commit 0d18b43).
## Tipo minorista y mayorista
- El tipo se elige entre **Minorista** y **Mayorista**, con una explicación breve de cada uno.
- Hoy el tipo define la **escala de precios** que Ventas y Service técnico van a leer: minorista
  `x1` (siempre precio de lista), mayorista `por_cantidad` (escala según la cantidad).
- Al cambiar el tipo de un cliente existente, el panel avisa que «Al cambiar el tipo, las próximas
  ventas usarán la escala de precios del nuevo tipo. Lo ya vendido no cambia», y el cambio queda
  registrado en Actividad.
- La regla de la escala es **provisoria**: la define Precios más adelante. Si cambia, no cambia la
  forma de usarla.

!!! warning "No se crean tipos"
    Los tipos son fijos (minorista y mayorista) y no se pueden crear ni borrar. La pantalla «Tipos de
    cliente» del prototipo, con descuento adicional y condición de pago, **no** se construyó.

## Consumidor final

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
  con `drop function public.exportar_clientes(text, text, boolean, uuid, integer, uuid)` (firma vigente; el
  filtro por tienda de F-CLI-11 agregó `p_empresa_id`).
- **Pruebas:** pgTAP `clientes_busqueda_exportacion.test.sql` (permiso, keyset, tope de lote, aislamiento);
  Vitest `lib/exportarClientes.test.ts`, `components/clientes/ExportarClientes.test.tsx` y `pages/clientes/list.test.tsx`.
- Cada organización tiene **exactamente un** cliente «Consumidor final», de tipo minorista, creado
  automáticamente. Sirve para vender en el mostrador sin cargar un cliente cada vez.
- No se puede editar, archivar ni cambiarle el tipo: la base lo rechaza aunque alguien la llame
  directo.
- Aparece en el listado y en las exportaciones como un cliente más; la ficha lo marca como **«Cliente
  de mostrador»**.
- En organizaciones nuevas es el cliente N.º 1; en las que ya tenían clientes, toma el siguiente
  número libre.

## Exportar clientes

- El botón «Exportar» aparece solo para quien tiene la acción `exportar`; sin ese permiso, la
  descarga se rechaza en el servidor aunque se la pida a la base directamente.
- Descarga **todas** las filas que coinciden con la búsqueda y los filtros (no solo la página visible),
  en una planilla **Excel `.xlsx`** con una columna por campo: N.º, nombre o razón social, DNI/CUIT,
  tipo, correo, teléfono, celular, dirección, código postal, localidad, provincia y estado.
- La descarga se arma por lotes, muestra el progreso y se puede cancelar; si falla, se reintenta.
- Los valores que empiezan con `=`, `+`, `-` o `@` se guardan como texto y se neutralizan, para que
  la planilla no los ejecute como fórmula. **Costo aceptado:** el apóstrofo queda visible (un teléfono
  «+54…» se ve «'+54…»).

- **MSF-180 (hecho)**: tabla base (Nº, nombre, DNI/CUIT, tipo, localidad), búsqueda/filtros/paginación
  en servidor, ficha con archivo/eliminar lógico, alta/edición, exportar a Excel.
- **Este cambio (MS-180 fidelidad, sin épica)**: expreso preferido + **tabla fiel** (Cliente combinado N.º·nombre·doc, Contacto mail+tel, Cuenta web como placeholder `—` sin backend) y **formulario en diálogo grid** (N.º readonly, Tipo en 3 cards, grid 2 cols) — acerca lo entregado en MS-180 al prototipo sin pisar MS-155/445/171.
- **Este cambio (F-CLI-05, sin épica)**: columna **Tiendas** real y bloque **Habilitado en** en el
  formulario y la ficha, con la tabla `public.clientes_empresas` y la RPC
  `public.guardar_empresas_de_cliente` (ver «Relación con empresas / tiendas»). Sin épica asignada;
  queda como fidelidad de MSF-180.
- **MSF-155 Backlog (correo masivo)**: diálogo de correo, destinatarios, historial (F-CLI-11/12/13).
  NO se implementa acá.
- **MSF-445 Backlog (mejoras)**: etiqueta impresa F-CLI-17. NO se implementa acá.
- **MSF-171 Backlog (ranking)**: pestaña de ranking F-CLI-14/15/16. NO se implementa acá.
- **MSF-450 Backlog (cuentas)**: cuenta web e invitación. NO se implementa acá (la entrega la épica MSF-237, ver «Cuenta web del cliente» al final).
- **MSF-142 Backlog (migración)**: importación masiva F-MIG-01. NO se implementa acá.
- **Sin dueño**: tipo Distribuidor (el check admite
  minorista/mayorista). La columna Cuenta web de esta entrega era un placeholder `—`;
  hoy muestra el estado real (épica MSF-237, ver «Cuenta web del cliente»).
- **Pruebas**: pgTAP (expreso: round-trip, tope, grants) + Vitest (columnas Contacto/Expreso en
  `pages/clientes/list.test.tsx`; fixtures con `expreso_preferido`).

## Ranking de clientes por facturación (F-CLI-08, MSF-238 · épica MSF-126)

Solapa «Ranking por facturación» dentro de `/clientes` (carga diferida; visible con la sección Clientes en
`lectura` o `edicion`). Spec: `specs/20261018-100000-ranking-de-clientes/`.

- **Criterio de facturación:** suma de las facturas no anuladas del cliente en el rango (extremos inclusivos,
  fecha de emisión). Vive en **un único predicado**, `private.comprobante_cuenta_como_facturado(tipo, estado)`
  (hoy `tipo = 'factura' and estado <> 'anulada'`); cuando Ventas fije el criterio (p. ej. si «Deuda» cuenta) se
  cambia solo ese cuerpo. Los presupuestos y las anuladas no suman ni cuentan en «Comprobantes».
- **Función:** `public.ranking_clientes(p_desde, p_hasta, p_tipo, p_incluir_consumidor_final, p_con_iva, p_pagina, p_tamano, p_empresa_id default null)`,
  `security definer`, organización de `private.organizacion_id()`, exige Clientes en `lectura`/`edicion` (si no,
  `42501`). Orden: facturado desc, nombre, número. `participacion` es un porcentaje (0–100) sobre el ranking completo
  filtrado, no sobre la página. Valida rango (Desde ≤ Hasta, máx. 5 años), tipo, página y tamaño (1–1.000) con `22023`.
  `p_empresa_id` acota a los clientes habilitados en esa tienda (F-CLI-11); `null` = todos.
- **Base:** sin IVA por defecto; «Ver con IVA» usa `total_con_iva`. Consumidor final arranca excluido (decisión provisoria).
- **Contrato para Ventas (MSF-159/177):** `dominio.comprobantes_venta` (esquema `dominio`, RLS por organización y
  sección `ventas`, solo `select` para `authenticated`; sin escritura hasta que Ventas la complete con migraciones
  aditivas). Columnas: `id`, `organizacion_id`, `cliente_id` (FK compuesta con `public.clientes`), `tipo`
  (`factura`/`presupuesto`), `numero`, `fecha`, `estado`, `total_sin_iva`, `total_con_iva`. Datos de ejemplo solo
  en local: `supabase/seed.sql`.
- **Reversión (migraciones posteriores, aditivas):** quitar `public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid)`
  y `private.comprobante_cuenta_como_facturado(text, text)`; y, exportando antes los datos si Ventas ya escribe,
  la tabla `dominio.comprobantes_venta` y el índice `public.clientes_id_organizacion_uq`.
- **Pruebas:** pgTAP `ranking_clientes.test.sql` y `comprobantes_venta_contrato.test.sql`; Vitest
  `lib/periodosRanking.test.ts`, `components/clientes/RankingClientes.test.tsx` y `pages/clientes/list.ranking.test.tsx`.

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

## Cuenta web: ajustes de la revisión (MSF-422)

- «Restablecer clave» y el reenvío al reutilizar el usuario envían el enlace al correo del **usuario de Auth** (`getUserById`), no a `clientes.correo`, que pudo editarse después.
- Si el correo ya salió pero falla el registro de la actividad, `invitar-cliente` responde `ok` con un `aviso` (no error) para que el operador no reenvíe.
- La política SELECT de `public.cuentas_cliente` filtra además por `private.empresas_accesibles()` (migración `20261211100300`); reversión: recrearla sin ese filtro.
- «Habilitar/Deshabilitar en <tienda>» relee `clientes_empresas` antes de llamar a `guardar_empresas_de_cliente`, para no pisar cambios de otro operador.
- Editar un cliente con estados mixtos (una tienda activa, otra suspendida): si el operador no cambia el campo «Cuenta web», no se reactiva ni suspende ninguna cuenta existente (solo se crean las de tiendas nuevas); únicamente cambiar el campo transiciona (`aplicarCuentaWebEnTiendas(..., estadoPrevio)`).
- `exportar_clientes` con «Con cuenta web» filtra por `private.empresas_accesibles()`, como `buscar_clientes` por RLS. La columna «Cuenta web» del listado (`cuentas_web`) solo incluye tiendas donde el cliente sigue habilitado, igual que la ficha (FR-002).
- `invitar-cliente` crea el usuario de Auth con `createUser` y envía el enlace recién después de `vincular_cuenta_cliente` (ya no `inviteUserByEmail`): si vincular falla no queda un correo de invitación muerto.

## Cuenta web del cliente (épica MSF-237, spec `20261024-051500-cuenta-web-del-cliente`)

Resumen de F-CLI-05 (alta y estados), F-CLI-06 (ingreso) y F-CLI-07 (precios); el ingreso y la recuperación están en [`acceso-ingreso.md`](./acceso-ingreso.md), la tienda en [`tiendas-online.md`](./tiendas-online.md) y los precios en [`precios-escalas.md`](./precios-escalas.md).

- **Renumeración por merge con `dokploy`**: las migraciones de la épica pasaron a `20261211100000`…`20261211110100` para no chocar con las ya aplicadas en DEV ni quedar por debajo de las de MSF-189 (`20261210130300`); el contenido no cambió.
- **Modelo**: `public.cuentas_cliente` (una fila por `(cliente, tienda)`, estado `activa|suspendida`, RLS por organización + sección Clientes + `private.empresas_accesibles()`); esquema `public` por ser identidad/acceso de plataforma. Hay **un solo usuario de Auth por cliente** (D1) y la cuenta web **no tiene fila en `usuarios_organizacion`**: no ve nada del panel (FR-006, pgTAP `cuentas_cliente.test.sql`). Reversión: `drop table public.cuentas_cliente cascade` y las funciones de las migraciones `20261211100000`…`20261211100250` en un PR posterior (no se destruye en el mismo PR que las crea).
- **Estados que ve el operador** (`lib/cuentasCliente.ts`): **Activa**, **Suspendida**, **Sin cuenta** y **No habilitado** (la tienda no está tildada en «Habilitado en»; prevalece sobre los otros y conserva la cuenta, que vuelve a su estado al rehabilitar).
- **Acciones** (ficha, `BloqueTiendas` y `BloqueCuentaWeb`): crear cuenta web (requiere correo), restablecer clave, suspender, reactivar y habilitar/deshabilitar la tienda. Todas por RPC de `public` con `grant … to authenticated` y `revoke … from public, anon`; cada cambio registra un evento de Actividad con actor y tienda (FR-016).
- **Invitación**: Edge Function `invitar-cliente` (`crear` | `restablecer`, JWT del operador). Crea o reutiliza el usuario de Auth, no escribe membresía, es idempotente y responde con mensajes controlados idénticos para correo de usuario del panel (D5), cliente de otra organización o tienda no habilitada (FR-018). El enlace vuelve al dominio de la tienda. `enable_signup = false` se conserva: no hay auto-registro (D2).
- **Listado y formulario**: columna «Cuenta web» (chip; en «Todas mis empresas» se agrega según D4) y filtro «Con cuenta web»; el formulario crea la cuenta en cada tienda tildada al guardar. Las tres superficies respetan la empresa activa (Principio VIII, `empresa-activa.test.tsx`).

### Decisiones D1–D6 y contradicciones (para el PR)

| | Decisión adoptada | Dónde |
|---|---|---|
| D1 | Una cuenta de Auth por cliente, una fila `cuentas_cliente` por tienda | modelo arriba |
| D2 | Solo invitación; sin auto-registro ni aprobación del mayorista | fuera de alcance |
| D3 | Ficha: mayorista ve x1/x5/x10/x50 con rango; tarjetas siguen en x1 | `precios-escalas.md` |
| D4 | Estado agregado en «Todas mis empresas»: Activa > Suspendida > Sin cuenta | listado |
| D5 | Correo de usuario del panel ⇒ mensaje genérico, nunca se mezclan identidades | `invitar-cliente` |
| D6 | Pantallas públicas de ingreso sin dibujar: sistema de diseño; falta que Nicolás las dibuje | seguimiento |

Contradicciones con el prototipo: las pantallas públicas de ingreso/recuperación no existen en `design/pantallas` (D6); la ficha de cliente del prototipo es la fuente del bloque Tiendas/Cuenta web.
## Límites y fuera de alcance
Lo que **no** hace esta épica (pertenece a otras historias o épicas):
- **Cuenta web del cliente**, invitación, «Tiendas / Habilitado en» y el filtro «Con cuenta web»
  (MSF-237). Lo entregado está en [Cuenta web del cliente](producto/cuenta-web-cliente.md).
- **Ranking por facturación** (MSF-126), **correo masivo a seleccionados** (MSF-155), **Importar
  clientes** (MSF-142) y **etiquetas**.
- La pantalla «Tipos de cliente» (crear tipos, descuento adicional, condición de pago).
- «Expreso preferido» y los datos de comprobantes (Facturado, Participación) son de Ventas y despacho
  (MSF-159). La columna «Expreso preferido» ya se ve en el listado, pero la agregó después un cambio
  de fidelidad al prototipo (`20261017120001_clientes_expreso_preferido.sql`), fuera de MSF-180.
- El filtro por empresa o tienda del cliente: **los clientes son de la organización**, compartidos
  entre sus empresas.
- **Eliminar** cliente (se archiva).
- Las mejoras de clientes y proveedores (MSF-445) y los **Proveedores** (MSF-205).
## Fidelidad al prototipo
La pantalla de referencia es `design/pantallas/Clientes.dc.html` (con `ClienteFicha.dc.html` y
`TiposCliente.dc.html`). El prototipo muestra más que esta historia: se implementó solo lo que pedían
los requisitos.
| Qué muestra el prototipo | Qué se entregó |
|---|---|
| Tabla de clientes, buscador, filtros de tipo, paginación | Igual, con la búsqueda y la paginación en el servidor |
| Diálogo «Nuevo/Editar cliente» | Formulario de alta y edición, con los campos del prototipo |
| Diálogo «Eliminar cliente» | **No**: se archiva y se restaura, con su confirmación |
| Pestaña «Ranking por facturación» | No (MSF-126) |
| Diálogo «Importar clientes» | No en esta épica (MSF-142) |
| Diálogo «Enviar correo a seleccionados» | No (MSF-155) |
| Columnas «Tiendas» y «Cuenta web» | Se muestran como «—»; las entrega MSF-237 |
| Pantalla «Tipos de cliente» (crear tipos, descuento, condición de pago) | No: los tipos son fijos |
| «Expreso preferido» | No en esta épica: la columna se ve, pero la agregó después un cambio de fidelidad al prototipo (fuera de MSF-180); el dato es de Ventas (MSF-159) |
## Ver también
- [Clientes: modelo, RPC y pantallas](tecnico/clientes.md) — cómo está construido.
- [Cuenta web del cliente](producto/cuenta-web-cliente.md) — la cuenta del cliente en la tienda (MSF-237).
- [Permisos por rol](permisos-por-rol.md) — qué puede hacer cada rol.
- [Actividad e historial](actividad.md) — los eventos `cliente.*`.
- [Migración inicial de datos](producto/migracion-inicial-de-datos.md) — carga masiva de clientes del
  panel anterior (MSF-142).
