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
