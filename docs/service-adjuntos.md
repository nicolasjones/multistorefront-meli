# Service técnico · Fotos y adjuntos del equipo (F-SVC-20)

Historia **MSF-134**, épica **MSF-124** · spec en `specs/20261028-100000-service-seguimiento-y-reportes/`
(User Story 1, FR-001 a FR-011). Permite dejar constancia fotográfica del estado en que llegó y en que se
entregó el equipo.

## Qué ve la persona del taller

En `/service-tecnico/reparaciones/:id`, debajo de «Mano de obra y repuestos», aparece la sección
**«Fotos y adjuntos»** (carga diferida):

- Botón **«Agregar fotos»** (selección múltiple; en el celular el selector ofrece galería o cámara) y
  grilla de miniaturas con texto alternativo igual al nombre original del archivo.
- Al pulsar una miniatura se abre la **vista ampliada** con nombre, fecha y quién la subió (nombre visible,
  nunca el correo) y la acción **«Quitar»** con confirmación.
- Estados de carga, vacío («todavía no tiene fotos») y error con «Reintentar». Un mensaje por archivo
  rechazado y el progreso de cada subida.
- Agregar y quitar solo con `edicion` en `service_tecnico` y la reparación **no anulada**. Las
  **entregadas** siguen admitiendo fotos (decisión abierta 2 de la spec). Con `lectura` o con la reparación
  anulada la sección es de solo lectura.
- Los adjuntos **no** aparecen en la orden de ingreso, el remito ni en la página pública de F-SVC-22.

## Modelo de datos

Esquema (Constitución, Principio VII): `dominio.reparacion_adjuntos` es una entidad de negocio del taller
→ **`dominio`**. El bucket y sus políticas sobre `storage.objects` son infraestructura de plataforma.

| Objeto | Migración | Notas |
|---|---|---|
| `dominio.reparacion_adjuntos` | `20270219140100` | `id`, `organizacion_id`, `reparacion_id`, `ruta` (única), `nombre_original`, `mime`, `bytes`, `creado_por`, `creado_en`. FK compuesta `(reparacion_id, organizacion_id)`. RLS por organización + nivel `service_tecnico` + tienda accesible. Sin `insert/update/delete` directos; `anon` sin privilegios. |
| Bucket `reparacion-adjuntos` | `20270219140200` | Privado, 5 MB, `image/jpeg`, `image/png`, `image/webp`. Políticas `select` (`lectura`/`edicion`), `insert` y `delete` (`edicion`) por prefijo; sin `update`. |
| Políticas del bucket (endurecidas) | `20270219140600` | `insert`: reparación no anulada y como máximo 20 objetos por carpeta. `delete`: solo objetos sin fila en `reparacion_adjuntos` (huérfanos) y reparación no anulada; un adjunto registrado solo se quita con `quitar_adjunto_reparacion`. |
| `public.registrar_adjunto_reparacion` | `20270219140300` | `security definer`; `edicion`, tienda accesible, no anulada (`55000`), ruta con el prefijo, objeto existente, mime/bytes (que coincidan con los metadatos `mimetype` y `size` que Storage guardó del objeto subido; `22023`, `hint = archivo`), máximo 20 (`22023`, `hint = maximo`) bajo el `for update` de la reparación. Actividad `reparacion.adjunto_agregado`. |
| `public.quitar_adjunto_reparacion` | `20270219140400` | Mismas reglas; borra la fila y devuelve la `ruta`. Actividad `reparacion.adjunto_quitado`. |
| `public.listar_adjuntos_reparacion` | `20270219140500` | `lectura` o `edicion`; solo tiendas accesibles; `subido_por` es el nombre visible, nunca el correo. |

Las tres RPC llevan `revoke … from public, anon` y `grant execute … to authenticated`.

## Ruta y límites

- Ruta del objeto: `<organizacion_id>/<reparacion_id>/<uuid>.<ext>`. La genera la interfaz con
  `crypto.randomUUID()`; **nunca** contiene el nombre del archivo de la persona (se guarda aparte en
  `nombre_original`).
- Tipos: JPG, PNG y WebP; la interfaz valida la extensión **y la cabecera real** del archivo. Máximo
  **5 MB** por archivo y **20** por reparación. La base rechaza lo mismo (bucket + RPC) si se la llama sin la
  interfaz.
- Las miniaturas y la vista ampliada usan **URLs firmadas de 5 minutos** pedidas con la sesión de la persona,
  en una sola llamada por listado.

## Flujo y huérfanos

1. La interfaz sube el archivo al bucket (política de `insert`) y llama a `registrar_adjunto_reparacion`.
   Si el registro falla, borra el objeto recién subido (con reintentos).
2. Para quitar, llama a `quitar_adjunto_reparacion` (borra la fila, devuelve la ruta) y después borra el
   objeto, con hasta 3 intentos. El orden no se puede invertir: la política de `delete` solo deja borrar objetos
   **sin fila**. Si los 3 intentos fallan queda un **archivo huérfano**: sin fila, no aparece en la aplicación.
   - **No es inaccesible del todo**: la política de `select` de `storage.objects` no mira la tabla (el borrado de
     Storage necesita poder listar el objeto), así que quien tenga `lectura` en esa reparación podría pedirlo a
     Storage si conoce su ruta (un UUID aleatorio). No hay forma de listar huérfanos desde la interfaz.
   - **Cuenta para el tope**: la política de `insert` cuenta objetos de la carpeta, no filas. Con huérfanos, la
     subida podría rechazarse aunque la lista muestre menos de 20.
   - **Limpieza**: cuando Storage rechaza una subida, la interfaz borra los objetos de esa carpeta que no tienen fila
     y tienen más de 10 minutos (los más nuevos pueden ser la subida en curso de otra persona) y reintenta una sola
     vez (`limpiarHuerfanos` en `apps/web/src/lib/reparacionAdjuntos.ts`). Una reparación que se anula después deja de
     poder limpiarse (la política de `delete` exige reparación no anulada); no hay purga automática. Para detectarlos:
     `select o.name from storage.objects o left join dominio.reparacion_adjuntos a on a.ruta = o.name where o.bucket_id = 'reparacion-adjuntos' and a.id is null`.
3. El tope de 20 de la política de `insert` no serializa cargas concurrentes (puede haber algo más de 20 objetos en
   Storage); el de 20 **filas** sí es exacto, por el bloqueo `for update` de `registrar_adjunto_reparacion`.

## Pruebas

pgTAP `supabase/tests/database/service_adjuntos.test.sql` (SC-001), Vitest `AdjuntosReparacion.test.tsx`
(SC-002) y E2E `apps/web/e2e/service-adjuntos.e2e.ts` (SC-003; se omite sin `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY`, ver `docs/e2e-app.md`).

## Reversión

Las migraciones son aditivas. Para deshacerlas (migración posterior; exportar antes los datos y vaciar el
bucket): `drop policy reparacion_adjuntos_select/_insert/_delete on storage.objects`,
`delete from storage.buckets where id = 'reparacion-adjuntos'`,
`drop function public.registrar_adjunto_reparacion(uuid, text, text, text, integer)`,
`drop function public.quitar_adjunto_reparacion(uuid)`, `drop function public.listar_adjuntos_reparacion(uuid)`,
`drop function private.bloquear_reparacion_para_adjuntos(uuid)` y `drop table dominio.reparacion_adjuntos`.
En la aplicación, revertir el merge del PR de la historia quita la sección sin afectar al resto del detalle.
