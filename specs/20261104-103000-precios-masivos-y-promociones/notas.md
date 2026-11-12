# Notas · Precios masivos y promociones (MSF-363)

Notas de cierre de la auditoría por roles de la épica (PR #822, seguimientos #842 y #845). No cambian requisitos: los requisitos viven en [`spec.md`](./spec.md).

## Lecciones

Cada una debería ser un script determinista en el CI (no una regla para recordar):

1. **Permiso por tienda en toda función `security definer` de `public` con parámetro `*_empresa*`**: debe llamar `private.nivel_*_en_empresa(...)` o comprobar con `private.empresas_accesibles()`. En MSF-363 las RPC de promociones comprobaban solo el nivel global y que la tienda fuera de la organización; quien editaba productos en la tienda A podía escribir en la B (corregido en `20270223200000`).
2. **Previsualizar y aplicar comparten validaciones y llevan test de paridad**: lo que la vista previa acepta, aplicar lo acepta, y viceversa. La vista previa aceptaba cambiar costos con `rentabilidad` en lectura y aplicar respondía `42501` (corregido en `20270223200100`).
3. **Todo archivo citado en «Verificación» debe existir**: la spec nombraba `e2e/*.spec.ts` (el `testMatch` del repo es `*.e2e.ts`, en `apps/web/e2e/`) y `aislamiento_rls.test.sql` (no existe; lo cubre `rls_en_toda_tabla.test.sql`).
4. **Ningún `.limit(n)` con `n` mayor que `max_rows` de PostgREST** (`supabase/config.toml`: `max_rows = 1000`). Hallazgo **cerrado en #859**: `leerPromociones` pide por tandas de 500 con `.range()` y el selector de productos busca por servidor (antes `.limit(2000)` y el servidor cortaba en 1000 sin avisar). Es lógica, no se corrigió en este PR de documentación: ver pendientes.

## Pendientes de Nicolás

Decisiones y verificaciones que no están aprobadas ni hechas. Ninguna se resolvió en este PR.

1. **Decisión 6 · cobrar el precio promocional en POS, carrito y comprobantes.** Hoy la tienda muestra $X con el precio anterior tachado y el local factura el precio normal (riesgo de cobrar distinto de lo mostrado). Abrir gate: decidir si el cálculo único `private.precio_vigente_empresa` se adopta en ventas.
2. **Aprobación retroactiva** de las Decisiones 2, 5, 7 y 8 de la spec y de los cambios de #842: permiso por tienda, tienda desactivada sin lectura, vista previa con carga infinita.
3. **Actualizar y aplicar precios masivos exigen `productos`=`edicion` global** (nivel más alto entre las tiendas), aunque el precio de lista y el costo son de la organización. ¿Debe ser por tienda, o por organización como hoy?
4. **Bandera de apagado**: no hay para promociones/precio tachado ni para «Actualizar precios». Hoy apagar es revertir migraciones o quitar permisos.
5. **E2E que nunca corrieron** (SC-003 `apps/web/e2e/precios-masivos.e2e.ts`, SC-006 `apps/web/e2e/tienda-promocion.e2e.ts`): escritos, sin Supabase local, no corren en el CI público. Las tareas T009 y T020 están marcadas hechas sin evidencia de ejecución.
6. **Capturas con TODO** en la documentación de la épica (pantallas «Actualizar precios», «Promociones» y precio tachado): pendientes de tomar.
7. **MSF-114 bloqueante**: falta la aprobación de despliegue DEV→STG; **verificar en ItsAPlan los gates de STG** de la épica antes de promover.
8. **UX**: `apps/web/src/pages/productos/promociones.tsx` (líneas ~46-47) calcula `puedeEditar` con el nivel **global** de `productos`; en una tienda donde la persona solo lee, los botones «Nueva promoción»/«Anular» aparecen y el servidor responde `42501`. Conviene calcularlo por la empresa activa (lógica: no tocado aquí).
9. ~~`.limit(2000)` > `max_rows` 1000~~ **Cerrado en #859** (tandas con `.range()` y búsqueda de productos por servidor).

## Documentación que no se tocó en este PR

- `docs/producto/` y `docs/tecnico/` viven en `main`, no en `dokploy`. **Hay que re-correr el Documentador sobre `dokploy` HEAD antes de promover** para que reflejen los permisos por tienda, la vista previa de costos y las migraciones `20270223200000`, `20270223200100`, `20270225100000`.
- `apps/web/src/ayuda/manualPorDestino.ts:8` mapea `promociones` → `precios-e-iva`. En `main` ya existen `docs/producto/promociones.md` y `docs/producto/precios-masivos.md`, pero no se verificó que el sitio publicado las sirva. El test `manual.test.ts` solo valida el formato del nombre de página, no que exista. **No se cambió**: tras republicar el sitio de documentación, apuntar `promociones: 'promociones'`. «Actualizar precios» no es un destino del menú (es un botón de Productos), así que no tiene clave propia; si se quiere su página del manual, hace falta un destino nuevo en `destinosPanel.ts`.
