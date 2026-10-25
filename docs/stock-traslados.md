---
owner: producto
sources: [specs]
---
# Stock · Traslado entre depósitos (F-STK-15, MSF-353)

Spec: `specs/20261022-180000-stock-depositos-y-reservas/` (épica MSF-292). Esta guía cubre F-STK-15: trasladar
unidades de un depósito a otro **sin cambiar el stock total** y sin pasar el disponible del origen. Se apoya en
las tablas y en la rutina de movimiento de F-STK-14 (`docs/stock-depositos.md`); las reservas (F-STK-16) tienen
su propia guía.

## Esquema (Principio VII)

No hay tablas nuevas. `dominio.movimientos_stock` (negocio de Stock, `dominio`) gana la columna
`traslado_id uuid` (nula en los demás movimientos) con un índice único parcial `(traslado_id, tipo)`: un traslado
tiene a lo sumo una salida y una entrada. La RPC `trasladar_stock` y la lectura ampliada viven en `public`
(contrato de la app). La RLS no cambia: sigue rigiendo la de F-STK-14.

## Contrato: `public.trasladar_stock`

```
trasladar_stock(p_producto uuid, p_origen uuid, p_destino uuid, p_cantidad integer,
                p_nota text default null, p_fecha date default current_date)
returns table (traslado_id, movimiento_salida_id, movimiento_entrada_id,
               origen_cantidad, origen_disponible, destino_cantidad, destino_disponible)
```

*security definer*, `search_path = ''`, `revoke … from public, anon` y `grant execute … to authenticated`. Exige
`private.nivel_seccion('stock') = 'edicion'` (consulta recibe `42501`). Organización y responsable salen de la
sesión.

Validaciones (mensajes en castellano; el rechazo no deja movimiento, motivo ni actividad):

| Caso | Código | Mensaje |
|------|--------|---------|
| Rol sin edición | 42501 | Tu rol no puede trasladar stock |
| Origen o destino vacío | 22023 | Elegí el depósito de origen y el de destino |
| Origen = destino | 22023 | El depósito de origen y el de destino deben ser distintos |
| Cantidad nula, 0 o negativa | 22023 | La cantidad debe ser un entero mayor a cero |
| Fecha futura | 22023 | La fecha no puede ser futura |
| Nota de más de 500 caracteres | 22023 | La nota admite hasta 500 caracteres |
| Producto de otra organización | 22023 | No encontramos ese producto |
| Depósito de otra organización | 22023 | No encontramos el depósito de origen / de destino |
| Depósito inactivo | 22023 | El depósito de origen / de destino está inactivo: elegí otro |
| Cantidad mayor que el disponible del origen | 23514 | No hay stock suficiente |

## Cómo se aplica (FR-022, FR-023, FR-024)

1. Serializa por producto (`select … for update` sobre `dominio.existencias`, el mismo mecanismo de MSF-136) y
   toma ambos depósitos `for share` en orden de id (no se pueden desactivar mientras se traslada, sin cruces).
2. Asegura el motivo de sistema **«Traslado entre depósitos»** (`entrada`/`salida`) de la organización: se crea
   la primera vez que se traslada (es un dato; no cambia el sembrado de motivos).
3. Con `private.aplicar_movimiento_deposito` aplica la **salida** en el origen (la barrera es su disponible =
   cantidad − reservado) y la **entrada** en el destino, y deja dos movimientos con el mismo `traslado_id` y el
   mismo motivo, todo en **una transacción**: si algo falla, no queda nada.
4. `existencias.cantidad` y `existencias.reservado` no cambian. `movimientos_stock.saldo` es el total único: la
   salida deja `total − n` y la entrada vuelve a `total`.
5. Registra la actividad `stock.traslado`.

Traslados simultáneos sobre un producto se serializan: con disponible 5, diez traslados de 1 aceptan exactamente
cinco (`apps/web/e2e/stock-traslado-concurrencia.e2e.ts`).

## Decisión D-5 · el traslado no emite `stock.actualizado`

Un traslado no cambia el total y los canales externos ven solo totales, así que
`private.emitir_stock_actualizado` **omite** el evento cuando el movimiento tiene `traslado_id`. Los demás
movimientos no cambian. *Para Nicolás*: confirmar D-5 (spec).

## Lectura y pantalla

- `public.listar_movimientos_stock` gana `traslado_id` (última columna); la pantalla Movimientos rotula los dos
  movimientos como «Traslado · Salida» y «Traslado · Entrada», cada uno con su depósito (FR-026).
- Stock actual agrega la acción **«Trasladar»** por fila, solo con `edicion`: abre `TrasladarDialog` (carga
  diferida) con Producto, Depósito de origen, Depósito de destino, Cantidad, Nota y Fecha; muestra el disponible
  del origen y, al terminar, «Traslado registrado» con las cifras de ambos depósitos (FR-025). **El prototipo no
  dibuja esta acción**: se construyó con los componentes del sistema de diseño (diferencia anotada en el PR).
- Empresa activa (Principio VIII): el stock es único por organización y compartido entre empresas, así que el
  traslado no depende de la empresa activa de la barra superior.

## Contratos que cambian (alto riesgo, gate humano)

RPC nueva `trasladar_stock`; `listar_movimientos_stock` gana una columna (se recrea: cambia el tipo de retorno);
`stock.actualizado` deja de emitirse para movimientos de traslado.

## Pruebas

- pgTAP `supabase/tests/database/stock_traslado.test.sql`: permisos y `anon`, rechazos sin rastro, 4 de 10, total
  y reservado sin cambios, sin evento, disponible con reservado.
- E2E `apps/web/e2e/stock-traslado-concurrencia.e2e.ts` (requiere `pnpm dev:supabase`).
- Vitest `TrasladarDialog.test.tsx`, `list.test.tsx` y `movimientos.test.tsx`.

## Motivo de sistema reservado

El motivo «Traslado entre depósitos» solo lo usa `trasladar_stock`. «Nuevo movimiento» no lo ofrece
(`motivosDelTipo`) y el trigger `movimientos_stock_motivo_traslado` (migración
`20261023130400_stock_motivo_traslado_reservado.sql`) rechaza con `22023` cualquier movimiento con ese
motivo y sin `traslado_id`. El aviso de stock insuficiente del diálogo usa `role="alert"`.

## Reversión

Migración aditiva `20261023130000_stock_traslado.sql`. Para volver atrás, en una migración posterior y
exportando antes los movimientos con `traslado_id` (el libro es de solo agregado):

1. Restaurar `private.emitir_stock_actualizado` de `20261023120300_stock_evento_deposito.sql`.
2. Restaurar `public.listar_movimientos_stock` de `20261023120400_stock_lecturas_deposito.sql`.
3. `drop function public.trasladar_stock(uuid, uuid, uuid, integer, text, date);`
4. `alter table dominio.movimientos_stock drop column traslado_id;` (borra también el índice único).

5. `drop trigger movimientos_stock_motivo_traslado on dominio.movimientos_stock; drop function private.validar_motivo_traslado();` (migración `20261023130100`).

El motivo «Traslado entre depósitos» queda como dato (se desactiva desde Motivos). Los saldos por depósito no
se tocan: el traslado ya dejó cada depósito con sus unidades.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.
