# Notas · Precios masivos y promociones (MSF-363)

Notas de cierre de la auditoría por roles de la épica (PR #822, seguimientos #842 y #845). No cambian requisitos: los requisitos viven en [`spec.md`](./spec.md).

## Lecciones

Cada una debería ser un script determinista en el CI (no una regla para recordar):

1. **Permiso por tienda en toda función `security definer` de `public` con parámetro `*_empresa*`**: debe llamar `private.nivel_*_en_empresa(...)` o comprobar con `private.empresas_accesibles()`. En MSF-363 las RPC de promociones comprobaban solo el nivel global y que la tienda fuera de la organización; quien editaba productos en la tienda A podía escribir en la B (corregido en `20270223200000`).
2. **Previsualizar y aplicar comparten validaciones y llevan test de paridad**: lo que la vista previa acepta, aplicar lo acepta, y viceversa. La vista previa aceptaba cambiar costos con `rentabilidad` en lectura y aplicar respondía `42501` (corregido en `20270223200100`).
3. **Todo archivo citado en «Verificación» debe existir**: la spec nombraba `e2e/*.spec.ts` (el `testMatch` del repo es `*.e2e.ts`, en `apps/web/e2e/`) y `aislamiento_rls.test.sql` (no existe; lo cubre `rls_en_toda_tabla.test.sql`).
4. **Ningún `.limit(n)` con `n` mayor que `max_rows` de PostgREST** (`supabase/config.toml`: `max_rows = 1000`). Hallazgo **cerrado en #859**: `leerPromociones` pide por tandas de 500 con `.range()` y el selector de productos busca por servidor (antes `.limit(2000)` y el servidor cortaba en 1000 sin avisar). Es lógica, no se corrigió en este PR de documentación: ver pendientes.

## Decisiones tomadas (2026-11-12)

- **Aprobación retroactiva** de las Decisiones 2, 5, 7 y 8 de la spec y de los cambios de #842: permiso por tienda, tienda desactivada sin lectura, vista previa con carga infinita. Aprobada por Nicolás el 2026-11-12 («avanza con todo»)

## Pendientes de Nicolás

Decisiones y verificaciones que no están hechas. Las marcadas «aprobada el 2026-11-12, en implementación» las implementan otros PRs; hasta entonces siguen abiertas.

1. **Decisión 6 · cobrar el precio promocional en POS, carrito y comprobantes** *(aprobada el 2026-11-12, en implementación: Nicolás aprobó abrir el gate)*. Hoy la tienda muestra $X con el precio anterior tachado y el local factura el precio normal (riesgo de cobrar distinto de lo mostrado). Decisión: adoptar el cálculo único `private.precio_vigente_empresa` en ventas.
3. ~~**Actualizar y aplicar precios masivos exigen `productos`=`edicion` global**~~ **Decidido el 2026-11-12 (decisión 14)**: ver «Decisiones tomadas (2026-11-12)».
4. ~~**Bandera de apagado**~~ **Decidido el 2026-11-12 (decisión 15)**: ver «Decisiones tomadas (2026-11-12)».
5. **E2E que nunca corrieron** (SC-003 `apps/web/e2e/precios-masivos.e2e.ts`, SC-006 `apps/web/e2e/tienda-promocion.e2e.ts`): escritos, sin Supabase local, no corren en el CI público. Las tareas T009 y T020 están marcadas hechas sin evidencia de ejecución.
6. **Capturas con TODO** en la documentación de la épica (pantallas «Actualizar precios», «Promociones» y precio tachado): pendientes de tomar.
7. **MSF-114 bloqueante**: falta la aprobación de despliegue DEV→STG; **verificar en ItsAPlan los gates de STG** de la épica antes de promover.
8. ~~**UX**: `promociones.tsx` calculaba `puedeEditar` con el nivel global~~ **Resuelto el 2026-11-12** junto con la decisión 14: ahora es por tienda (`public.capacidades_precios()`).
9. ~~`.limit(2000)` > `max_rows` 1000~~ **Cerrado en #859** (tandas con `.range()` y búsqueda de productos por servidor).

## Decisiones tomadas (2026-11-12)

Nicolás aprobó las recomendaciones («avanza con todo»). Implementadas en el PR «precios masivos por tienda y bandera de apagado» (tareas T028–T031).

- **Decisión 14 · precios masivos por tienda.** `previsualizar_` y `aplicar_actualizacion_precios` pasan de `productos` = edición global a edición **en la tienda** (`private.nivel_productos_en_empresa`). Interpretación: el precio de lista y el costo son de la organización y los precios por tienda se calculan al leer, así que un cambio mueve todas las tiendas donde se vende el producto y no hay un subconjunto «afectado» limpio (productos sin asignar, alcance por categoría, planilla). Se aplicó la regla más estricta razonable: edición en **todas las tiendas activas de la organización** (una sin acceso cuenta como sin edición) y al menos una (`private.productos_edicion_en_todas_las_tiendas`, migración `20270228300200`), `42501` sin distinguir «otra tienda» y comprobada antes de cualquier lock. Nicolás confirmó el endurecimiento (todas las tiendas de la organización, no solo las accesibles).
- **Decisión 15 · bandera de apagado.** `public.banderas_plataforma` (`20270228300000`): claves `promociones_precio` y `precios_masivos`, APAGADAS por defecto, por entorno. En el repo de producto no existía un mecanismo de banderas (las de BUG-397/398 son variables de entorno del orquestador, no aplican a la base); se siguió el patrón de configuración de plataforma de `public.tienda_dns_plataforma` (carga el equipo técnico por SQL, `authenticated` solo lee). Apagada `promociones_precio`: la tienda muestra el precio normal (sin `precio_anterior`), la pantalla Promociones lo explica y guardar responde `55000` (`20270228300100`); apagada `precios_masivos`: ambas RPC responden `55000` y la UI oculta el botón. Reversión: `update public.banderas_plataforma set activa = false where clave = '…'`. **Aviso de despliegue:** al nacer apagadas, promociones y «Actualizar precios» dejan de estar disponibles hasta que se encienda la bandera de cada entorno.
- **Pendiente 8 (UX).** `puedeEditar` de Promociones es por tienda (`20270228300300`).

## Documentación que no se tocó en este PR

- `docs/producto/` y `docs/tecnico/` viven en `main`, no en `dokploy`. **Hay que re-correr el Documentador sobre `dokploy` HEAD antes de promover** para que reflejen los permisos por tienda, la vista previa de costos y las migraciones `20270223200000`, `20270223200100`, `20270225100000`.
- `apps/web/src/ayuda/manualPorDestino.ts:8` mapea `promociones` → `precios-e-iva`. En `main` ya existen `docs/producto/promociones.md` y `docs/producto/precios-masivos.md`, pero no se verificó que el sitio publicado las sirva. El test `manual.test.ts` solo valida el formato del nombre de página, no que exista. **No se cambió**: tras republicar el sitio de documentación, apuntar `promociones: 'promociones'`. «Actualizar precios» no es un destino del menú (es un botón de Productos), así que no tiene clave propia; si se quiere su página del manual, hace falta un destino nuevo en `destinosPanel.ts`.
