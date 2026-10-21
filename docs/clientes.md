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
- **MSF-142 Backlog (migración)**: importación masiva F-MIG-01. NO se implementa acá.
- **Sin dueño**: entidad tienda + filtro por tienda; tipo Distribuidor (el check admite
  minorista/mayorista); datos del ranking (sin ventas). La columna Cuenta web y Tiendas no se
  muestran hasta tenerlos.
- **Pruebas**: pgTAP (expreso: round-trip, tope, grants) + Vitest (columnas Contacto/Expreso en
  `pages/clientes/list.test.tsx`; fixtures con `expreso_preferido`).
