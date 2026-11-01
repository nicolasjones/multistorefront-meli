# Bug Fix: Pérdida silenciosa de ediciones al reintentar «Compra para» (Proveedores) y «Responder por…» (Consultas)

- **Slug**: msf-698
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Los dos reintentos repetían la **foto congelada** del registro (la fila leída al abrir el diálogo) en vez de
**reaplicar el estado actual del formulario**, así que lo que la persona acababa de editar se perdía sin aviso y la
pantalla terminaba mostrando un éxito. Ahora el reintento de «Compra para» vuelve a guardar el formulario completo
sobre el mismo proveedor (sin duplicarlo) con el `updated_at` que devolvió el guardado anterior, y «Responder por…»
registra el estado, el responsable y la nota **que están en el formulario** en ese momento.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/components/proveedores/ProveedorFormDialog.tsx` | modified | El guardado sale a una función `guardar()` reutilizada por el formulario y por el botón «Reintentar». Si el proveedor ya se guardó, el reintento lo **actualiza** (no crea otro) con el `updated_at` devuelto. El aviso de «Compra para» fallida tiene título coherente («No se guardó «Compra para».») y su propio «Reintentar». |
| `apps/web/src/lib/responderConsulta.ts` | modified | `registrarRespuesta` recibe el estado actual del formulario (estado, responsable, nota) y aplica encima los cambios de FR-010 (`nueva → en_curso`, responsable solo si no había). `cambiosAlResponder` y `avisoRespuestaRegistrada` trabajan sobre esos cambios, no sobre la foto. |
| `apps/web/src/components/consultas/DetalleConsulta.tsx` | modified | `registrar()` (y su «Reintentar») mandan lo que la persona tiene en el formulario; el aviso de éxito dice cómo quedó con lo que se registró. |
| `apps/web/src/hooks/useConsultas.ts` | modified | `useConsulta` se suscribe a la revisión de consultas: tras guardar o registrar una respuesta, el detalle se relee y su `updated_at` (sello del bloqueo optimista) no queda viejo. |
| `apps/web/src/components/proveedores/ProveedorFormDialog.test.tsx` | modified | Regresión del reintento: reaplica los campos editados, usa el sello devuelto, no duplica el proveedor, aviso coherente con su «Reintentar». |
| `apps/web/src/pages/consultas/responder.test.tsx` | modified | Regresión de «Responder por…»: manda la nota, el estado y el responsable del formulario; el reintento manda lo mismo. |
| `apps/web/src/hooks/useConsultas.test.tsx` | modified | El detalle se relee cuando cambia una consulta. |
| `docs/proveedores.md` | modified | Documenta el reintento de «Compra para» (reaplica el formulario, no duplica, sello vigente). |
| `docs/consultas.md` | modified | Documenta que el registro manda lo que está en el formulario y que el sello del detalle se relee. |

## Diff Highlights

`ProveedorFormDialog.tsx` (antes: el reintento se saltaba la escritura del proveedor):

```tsx
// antes: si ya se guardó, no se volvía a guardar → lo editado se perdía
if (!persistido.current) {
  persistido.current = proveedor ? await actualizarProveedor(...) : await crearProveedor(formulario)
}
const guardado = persistido.current

// ahora: el reintento actualiza el mismo proveedor con lo que el formulario tiene en ese momento
const anterior = persistido.current
const guardado = anterior
  ? await actualizarProveedor(formulario, { id: anterior.id, actualizadoEn: anterior.updated_at })
  : proveedor
    ? await actualizarProveedor(formulario, { id: proveedor.id, actualizadoEn: proveedor.updated_at })
    : await crearProveedor(formulario)
persistido.current = guardado
```

`responderConsulta.ts` (antes: la nota, el estado y el responsable salían de la prop persistida):

```ts
// antes
nota: consulta.nota_interna ?? '',
estado: cambiosAlResponder(consulta, usuarioId).estado

// ahora: lo que la persona tiene en el formulario
const cambios = cambiosAlResponder(actual, usuarioId)
await actualizarConsulta({ id: consulta.id, estado: cambios.estado, responsableId: cambios.responsableId, nota: actual.nota, actualizadoEn: consulta.updated_at })
```

## Tests Added or Updated

- `apps/web/src/components/proveedores/ProveedorFormDialog.test.tsx::el aviso de «Compra para» fallida tiene su propio «Reintentar» y un título coherente` — el aviso ya no dice «No se guardó el proveedor.» cuando el proveedor sí se guardó, y ofrece reintentar.
- `apps/web/src/components/proveedores/ProveedorFormDialog.test.tsx::el reintento vuelve a guardar los campos editados después del fallo` — la razón social corregida después del fallo llega a `actualizar_proveedor`.
- `apps/web/src/components/proveedores/ProveedorFormDialog.test.tsx::el reintento manda el updated_at que devolvió el guardado anterior` — el reintento no choca con el bloqueo optimista (40001).
- `apps/web/src/components/proveedores/ProveedorFormDialog.test.tsx::si fallan las tiendas avisa que el proveedor sí se guardó y el reintento no lo duplica` — actualizado: el reintento crea **un solo** proveedor (actualiza el ya creado) y reintenta las tiendas.
- `apps/web/src/pages/consultas/responder.test.tsx::«Responder por…» registra la nota del formulario, no la de la foto` — la nota nueva se manda; la vieja no.
- `apps/web/src/pages/consultas/responder.test.tsx::«Responder por…» registra el estado y el responsable elegidos en el formulario` — estado «Resuelta» y responsable «Beto» se mandan, y el aviso lo refleja.
- `apps/web/src/pages/consultas/responder.test.tsx::el reintento tras un fallo vuelve a mandar lo que está en el formulario` — el «Reintentar» del aviso manda la nota vigente.
- `apps/web/src/pages/consultas/responder.test.tsx::cambios al responder (FR-010)` — `cambiosAlResponder` ahora opera sobre el estado del formulario.
- `apps/web/src/hooks/useConsultas.test.tsx::se relee cuando cambia una consulta` — el sello del detalle no queda viejo.

## Local Verification

- Comandos run: `pnpm --filter @platform/web test` (archivos de consultas y proveedores) → pass (134 tests).
- Comandos run: `pnpm lint` → pass (0 errores; los avisos de `react-hooks(exhaustive-deps)` por `revision` son el patrón ya usado en el mismo archivo por `useBandejaConsultas`).
- Comandos run: `pnpm build` → pass.
- Comandos run: `pnpm docs:check` → pass.
- Manual checks: con el código anterior (sin el arreglo) los 8 tests nuevos fallan (ver `test.md`).

## Deviations from Assessment

- **Proveedores — el reintento actualiza en vez de crear**: el assessment proponía «distinguir alta de edición». Se
  resolvió con una regla única: si el proveedor **ya se guardó**, el reintento lo actualiza con el `updated_at`
  devuelto (misma fila, sin duplicar) y vuelve a mandar los campos del formulario. Así el alta también reaplica lo
  editado sin crear un segundo proveedor, y el «no lo duplica» documentado se mantiene.
- **Proveedores — sin botón «Reintentar» nuevo en el prototipo**: el aviso de «Compra para» fallida ya usa el patrón
  compartido de error (`EstadoError`), que es el que la app usa en todas las pantallas; el botón «Reintentar» no
  agrega un control nuevo al prototipo (el prototipo no muestra estados de error) y evita el reintento implícito.
- **Consultas — el registro manda lo que está en el formulario** (opción del assessment) en vez de «no reescribir la
  nota»: la alternativa de dejar la nota solo para «Guardar» dejaba la nota pendiente sin guardar al cerrarse el
  diálogo, que es justo lo que se pierde en silencio.
- **Consultas — «Recargar» por conflicto**: se deja el comportamiento actual (el diálogo vuelve con los datos del
  servidor). Es una acción explícita de la persona, avisada con «La consulta cambió.», no un reintento automático; se
  evita inventar un aviso o un borrador en línea (assessment, pregunta abierta).

## Follow-ups

- E2E: el bug no define criterios de aceptación de pantalla propios (no hay FR/SC: es un arreglo en modo bug) y este
  entorno no tiene stack local (docker/supabase) para validar un E2E nuevo. La regresión queda cubierta por Vitest en
  los dos diálogos; el E2E de «Responder por…» (MSF-244) sigue vigente.
- Si en el futuro se quiere conservar el borrador al «Recargar» por conflicto, es una decisión de producto (assessment,
  pregunta abierta): hoy el conflicto descarta lo pendiente a propósito, con aviso.
