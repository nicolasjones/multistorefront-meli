# Clientes

Guía de `public.clientes` (épica MSF-180, spec `specs/20261016-130000-clientes-alta-y-busqueda/`).
La tabla vive en `public` por excepción documentada en la spec (Principio VII). Esta guía
la completa T018; acá queda lo de F-CLI-03.

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

## Pruebas

pgTAP `supabase/tests/database/clientes_tipo_y_consumidor_final.test.sql`; Vitest
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
