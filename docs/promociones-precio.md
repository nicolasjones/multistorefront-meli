---
owner: tecnico
sources:
  - specs/20261104-103000-precios-masivos-y-promociones
  - specs/20261113-120000-precio-promocional-en-pos-y-comprobantes
---

# Promociones de precio por empresa (F-PRE-11, MSF-439)

Guía de la historia F-PRE-11 de la épica MSF-363. Requisitos: `specs/20261104-103000-precios-masivos-y-promociones/spec.md` (FR-011 a FR-018, SC-004 a SC-006).

## Qué hace

Una promoción fija un **precio promocional** (sin IVA, en pesos) para un producto en **una empresa**, válido entre `desde` (incluido) y `hasta` (excluido). Durante ese rango la tienda de la empresa muestra el precio promocional con el anterior tachado; fuera de él, el precio de siempre. Pantalla: **Productos → Promociones** (`/productos/promociones`, sección `productos`; edición requiere `edicion`).

## Modelo (esquema `dominio`, Principio VII)

Tabla `dominio.promociones_precio` (migración `20270221100001`): FK compuestas a empresa y producto de la misma organización, `precio_promocional > 0`, `hasta > desde`, `anulada_at`, índice `(empresa_id, producto_id, desde, hasta)`, RLS, sin política DELETE, sin privilegios para `anon`. **La lectura es por tienda** (migración `20270223200000`, aprobada retroactivamente por Nicolás el 2026-11-12): la política exige la organización y `private.nivel_productos_en_empresa(empresa_id)` en `lectura` o `edicion`; una tienda desactivada o una persona sin tiendas asignadas no leen promociones (el acceso por tienda exige `private.empresas_accesibles()`, solo tiendas activas). Un disparador impide que dos promociones **no anuladas** del mismo producto y empresa se solapen (`23P01`).

Los estados `programada`, `vigente` y `vencida` **no se guardan**: se derivan por consulta de `desde`/`hasta` y la hora actual (Decisión 1: sin Kestra ni worker, sin ventana de precio vencido por una tarea caída). Solo `anulada` es un dato. La vista `public.promociones_precio_estado` (`security_invoker`) los expone.

## RPC (`public`, migraciones `20270221100002`, `20270223200000` y `20270225100000`)

- `guardar_promocion_precio(...)`: crea o edita (bloqueo optimista con `updated_at`; idempotente; no edita vencidas ni anuladas).
- `anular_promocion_precio(id, actualizado)`: anula; repetirla no falla.
- Ambas son `security definer` (con `search_path` vacío) y validan sesión, sección `productos` = edición, que empresa y producto sean de la organización y que la persona tenga `productos` en edición **en la tienda de la promoción** (`private.nivel_productos_en_empresa`; quien edita productos en la tienda A no programa ni anula promociones de la B). El permiso por tienda se comprueba antes de bloquear la promoción: sin permiso siempre responde `42501`. Errores: `42501`, `P0002`, `22023`, `23P01`, `40001`, `22003`. Eventos de actividad `promocion_precio.programada|actualizada|anulada`.
- Permisos: `authenticated` ejecuta; `anon` y `public` revocados.
- `public.capacidades_precios()` (`20270228300300`) informa a la pantalla las banderas y el nivel de `productos` **por tienda** (`{ empresa_id: edicion|lectura|ninguno }`): «Nueva promoción», «Editar» y «Anular» se habilitan según la tienda de cada promoción, no con el nivel global (antes quien solo leía una tienda veía los botones y el servidor respondía `42501`). La autoridad sigue siendo la RPC.

## Bandera de apagado

Las promociones (y «Actualizar precios», ver [`precios-masivos.md`](./precios-masivos.md)) tienen una bandera **por entorno, APAGADA por defecto** (migración `20270228300000`, tabla `public.banderas_plataforma`, mismo patrón que `public.tienda_dns_plataforma`: la cambia el equipo técnico por SQL; `authenticated` solo lee). Claves: `promociones_precio` y `precios_masivos`. Una clave inexistente cuenta como apagada.

```sql
-- encender
update public.banderas_plataforma set activa = true  where clave = 'promociones_precio';
update public.banderas_plataforma set activa = true  where clave = 'precios_masivos';
-- apagar (reversión inmediata, sin migrar ni borrar datos)
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
update public.banderas_plataforma set activa = false where clave = 'precios_masivos';
```

Es un cambio de datos de la base: rige al instante, sin desplegar la aplicación ni reiniciar nada. Cada `update` queda con `updated_at`. **Impacto de despliegue:** las migraciones crean las banderas apagadas, así que al llegar a cada entorno (dev, stg, prd) la tienda deja de mostrar el precio tachado y «Actualizar precios» queda deshabilitado hasta que alguien con acceso a la base ejecute el `update`; una migración no las enciende (ver [`deployment.md`](./deployment.md), «Banderas de plataforma»).

Con `promociones_precio` **apagada** (migración `20270228300100`):

- `private.promocion_vigente` devuelve null: las cinco funciones públicas de la tienda (catálogo, ficha, destacados, sugerencias y búsqueda) calculan el precio con `private.precio_vigente_empresa` (y `catalogo_pagina_por_dominio`, desde `20270228300400`, directo con `private.promocion_vigente`, la misma regla), así que muestran el **precio normal** y `precio_anterior` null, idéntico a una tienda sin promociones (el orden y el filtro por precio también usan el normal).
- `guardar_promocion_precio` responde `55000` («Las promociones de precio están desactivadas en este entorno») después del permiso global y antes de tocar datos. `anular_promocion_precio` sigue permitida (apagar no impide limpiar).
- La pantalla **Promociones** sigue listando, en modo **solo-anular**: sin «Nueva promoción» ni «Editar», con «Anular» habilitado donde el permiso por tienda lo permite, y un aviso con el motivo (si no se pueden leer las banderas, falla cerrado: sin ninguna acción). Las promociones guardadas no se tocan: al encender la bandera vuelven a regir las que estén en su rango de fechas.
- La vista `promociones_precio_estado` sigue mostrando el estado por fecha, pero solo la lee esa pantalla (que queda oculta).

## Orden de encendido y gate (MSF-816)

Encender `promociones_precio` enciende **a la vez** la tienda y el cobro en el local. Orden: **dev → stg → prd**, cada uno por SQL por el equipo técnico y con su verificación. Estado al 2026-11-14: **dev encendida desde 2026-11-13**; **stg y prd apagadas**. **No encender `promociones_precio` en producción antes de que la épica MSF-816 esté en dev y verificada** (cobro de una promoción en el mostrador y en el comprobante, nota de crédito, venta con vencimiento a mitad, bandera apagada idéntica). Con borradores abiertos al apagar o encender, ver S6 = MSF-937 en [`ventas-comprobantes.md`](./ventas-comprobantes.md#comportamiento-conocido-y-seguimientos-msf-816-f-4). Detalle del gate en [`deployment.md`](./deployment.md#banderas-de-plataforma-msf-363).

## Cálculo (migración `20270221100003`)

`private.precio_vigente_empresa(producto, empresa, ahora)` parte del neto de la empresa, aplica la promoción vigente, luego la alícuota de IVA según el interruptor «Precios que ve el cliente», y devuelve también el precio anterior. Desvío del plan: el precio normal sale de `private.precio_final_publico` (escala x1 + regla de la empresa), no de `private.precio_neto_empresa` (`20270221100003`), de modo que sin promoción es idéntico a lo que la tienda ya mostraba.

## Cobro en el mostrador y los comprobantes (MSF-816 · F-1, migraciones `20270310100000` a `20270310100300`)

Con la bandera `promociones_precio` encendida, `guardar_lineas_comprobante` y `copiar_presupuesto` cobran la promoción vigente **de la tienda del comprobante** si es menor al precio normal del cliente (sin acumular con su descuento ni con la escala), y la línea guarda el snapshot (`precio_referencia`, `promocion_id`). La lee `private.promocion_vigente_fila`; `private.promocion_vigente` (la tienda) no cambia. Encender la bandera enciende a la vez la tienda y el local. Detalle en [`ventas-comprobantes.md`](./ventas-comprobantes.md). Pantallas (F-2) y guarda de confirmar (F-3): ver `ventas-mostrador.md` y la sección de guarda de `ventas-comprobantes.md`. Pruebas de F-4: `ventas_precio_promocional_paridad.test.sql` y `ventas_precio_promocional_reportes.test.sql`.

## Contrato público (migración `20270221100004`)

`publico.catalogo_pagina_por_dominio` y `publico.producto_por_dominio` suman la clave `precio_anterior` (null sin promoción vigente) y `precio` sale del cálculo con promoción. Aditivo, misma lista blanca. El orden y el filtro por precio del catálogo usan el precio vigente. En la web, `PrecioTachado` tacha el anterior solo si es mayor que el vigente y lo dice también al lector de pantalla («Precio anterior», «Precio actual»).

## Decisiones

- **Decisión 6 (implementada, épica MSF-816, gate MSF-834)**: el mostrador (POS) y los comprobantes **cobran el precio promocional** de la tienda del comprobante (gana el más bajo, sin acumular con el descuento del cliente ni con la escala; el precio manual manda). Nicolás aprobó abrir el gate el 2026-11-12 y decidió el 2026-11-13 que sí se cobra. Mercado Libre, el carrito y el checkout quedan fuera (el carrito y el checkout no existen) y las reparaciones (Service) no cambian. Implementada en cuatro fases: F-1 servidor y snapshot (#944), F-3 guarda de confirmar (#950), F-2 pantallas (#957) y F-4 pruebas de consistencia (#958). Comportamiento conocido y seguimientos S1…S7 (MSF-932…MSF-938): [`ventas-comprobantes.md`](./ventas-comprobantes.md#comportamiento-conocido-y-seguimientos-msf-816-f-4).
- **Decisión 15 (aprobada 2026-11-12)**: bandera de apagado, apagada por defecto (ver arriba). Es un cambio de comportamiento respecto de lo desplegado hasta ahora: para que la tienda siga mostrando promociones hay que **encender** `promociones_precio`.
- **Decisión 7**: se adopta el precio vigente (con `precio_anterior`) en catálogo, ficha, destacados y búsqueda (migraciones `20270221100004` y `20270221100005`). No se tocan el precio por escala ni los precios de cliente por dominio: seguimiento **S1 = MSF-932** (la tienda con sesión de cliente no aplica promociones; MSF-816 es la épica del POS, no este seguimiento; spec `specs/20261113-120000-precio-promocional-en-pos-y-comprobantes/spec.md`).

## Límite de filas de PostgREST

`supabase/config.toml` fija `max_rows = 1000`: PostgREST recorta cada respuesta a ese tope sin avisar, así que un `.limit(2000)` no trae más. Por eso la pantalla **Promociones** (a) lee la lista por tandas de 500 con `.range()` (orden `desde`, `id`) hasta que una vuelve corta, y (b) busca el producto del diálogo «Nueva promoción» en el servidor (`useBuscadorCatalogo`: nombre o SKU, «contiene», con espera al escribir y tope de 500 opciones con aviso si el catálogo se cortó), en vez de bajar todos los productos activos. Con ~2.900 productos se llega a cualquiera escribiendo parte del nombre o del SKU.

## Verificación

pgTAP `supabase/tests/database/promociones_precio.test.sql`; Vitest `promociones.test.ts`, `promociones.test.tsx`, `PrecioTachado.test.tsx`; E2E `apps/web/e2e/tienda-promocion.e2e.ts` (ver [`e2e-app.md`](./e2e-app.md)).

## Reversión

Para apagar sin migrar: la bandera (ver arriba). Migraciones aditivas (`20270228300000`…`20270228300300` también: se revierten con el `drop` de su encabezado). Para volver atrás: migración posterior que restaure las dos funciones públicas de la tienda (`20261023150200`, `20261023150300`), elimine las RPC y la vista, y (solo si se decide perder los datos) la tabla; o `git revert -m 1` del merge de la spec. La clave `precio_anterior` extra no rompe a los clientes.
