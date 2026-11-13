# Implementation Plan: Precio promocional en el mostrador (POS) y en los comprobantes

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-816 (gate MSF-834) · **Rama de implementación**: `epic/MSF-816-precio-promocional-en-pos-y-comprobantes` (a crear al aprobar la spec; esta rama, `spec/precio-promocional-en-pos`, solo trae documentos)
**Alcance de entrega**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Cuatro historias secuenciales por dependencia (F-1 → F-2 y F-3 en paralelo → F-4). El corazón es **una función de servidor** (`private.precio_linea_venta`) que envuelve `private.precio_para` sin tocarlo, suma la promoción vigente de la tienda del comprobante (con la bandera `promociones_precio`) y devuelve el precio de la línea junto con su referencia y la promoción aplicada. `guardar_lineas_comprobante` y `copiar_presupuesto` la usan; `confirmar_comprobante` suma una guarda de precios desactualizados; las pantallas solo muestran lo que vuelve.

## Contexto técnico (verificado en el repo, 2026-11-13)

- **Última migración en `origin/dokploy`**: `20270306140000_avisos_consulta_camino_directo.sql`. Los PRs abiertos con migraciones: #929 (`20270307110000`), #923 (`20270307100000`), #902 (`20270304100001`), #570 (`20270206120000`) y #616 (`20270202…`); #835 no tiene migraciones. Las de esta épica (`20270310100000`…) **superan** a todas. **Aviso #570 (MSF-656)**: cambia la política RLS de `comprobantes_venta_lineas` a por empresas accesibles; la spec hereda la política vigente al mergear, no una propia. Las de esta épica usan `20270310100000` a `20270310100400` (más una de verificación previa si hiciera falta) y **se renumeran al integrar** con `dokploy` (regla del flujo `desarrollo-manual`): verificar de nuevo con `git ls-tree -r --name-only origin/dokploy supabase/migrations | sed 's#.*/##' | sort | tail -3` y `gh pr diff` antes de abrir el PR de F-1.
- **Cuerpos vigentes a partir de los cuales se edita** (copiar el cuerpo, cambiar lo mínimo, mantener firma, `security definer`, `search_path = ''`, grants):

| Función | Última definición | Qué cambia |
|---|---|---|
| `public.guardar_lineas_comprobante(uuid, jsonb, timestamptz)` | `20270201200129_lineas_sin_stock.sql` (con `descuento_pct` de `20270201200103`) | calcula con `private.precio_linea_venta` y guarda `precio_referencia`/`promocion_id`; `descuento_pct = 0` si ganó la promoción |
| `public.obtener_comprobante(uuid)` | `20270201200132_obtener_comprobante_origen.sql` | cada línea suma `precio_referencia` (no expone `promocion_id`) |
| `public.confirmar_comprobante(uuid)` | `20270216400000_confirmar_comprobante_cotizacion_por_empresa.sql` | guarda de precios desactualizados al principio |
| `public.copiar_presupuesto(uuid)` | `20261204150100_copiar_presupuesto.sql` | usa `private.precio_linea_venta` (sin descuento, igual que hoy) |
| `private.copiar_costo_linea_nota()` + disparador `comprobantes_venta_lineas_costo_nota` | `20270202201006_confirmar_comprobante_costo_cotizacion.sql` | copia también `precio_referencia` y `promocion_id` |
| `private.precio_para(uuid, uuid, text)` | `20270213200002_precio_propio_tienda_y_lineas.sql` | **no se toca** |
| `private.promocion_vigente(...)`, `private.precio_vigente_empresa(...)` | `20270228300100` / `20270305100300` | **no se tocan** (la tienda sigue igual; alinearla es el seguimiento S5) |

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Sin tablas nuevas (se agrega un `unique` a `promociones_precio`); las columnas nuevas heredan la RLS de `comprobantes_venta_lineas`; la FK a `promociones_precio` es compuesta con `organizacion_id`; pgTAP con dos organizaciones y dos tiendas. |
| II Spec primero | Esta spec; cada tarea cita su FR/SC. |
| III Idempotencia/auditoría | `guardar_lineas_comprobante` sigue reemplazando por transacción; `confirmar_comprobante` sigue idempotente (la guarda solo corre en la primera confirmación); eventos de actividad sin cambios. |
| IV Despliegues independientes | Sin infraestructura nueva. |
| V Simplicidad | Una función nueva y dos columnas; sin workers ni jobs de re-precio. |
| VI Panel operable | Sin navegación ni rutas nuevas; cambios dentro de pantallas existentes con componentes compartidos; teclado, lector de pantalla y 320/768/1440 px; sin ids técnicos visibles (la leyenda es «Promoción»). |
| VII Esquemas | `dominio.comprobantes_venta_lineas` (+2 columnas, dominio); cálculo en `private`; RPC en `public` (no almacenan). Se re-verifica en cada fase y en el PR. |
| VIII Documentación / empresa activa | Docs y ayuda en el mismo cambio (FR-022). El precio usa la empresa del comprobante, no la activa (FR-014). |

## Diseño

### `private.promocion_vigente_fila(p_producto, p_empresa, p_ahora)` (nueva)

`returns table (promocion_id uuid, precio numeric)`, `language sql stable security definer set search_path = ''`. Misma consulta que `private.promocion_vigente` (`20270228300100`: bandera, no anulada, `desde <= p_ahora < hasta`, `order by desde desc limit 1`) pero devuelve también el `id` y **filtra además por `organizacion_id`** (la de la empresa: `x.organizacion_id = (select e.organizacion_id from dominio.empresas e where e.id = p_empresa)`; la `promocion_vigente` de la tienda filtra solo por producto y empresa). `revoke execute … from public, anon, authenticated` (la llama solo `precio_linea_venta`). Es la **única** puerta de lectura de la promoción para ventas (FR-013); `private.promocion_vigente` queda intacta para la tienda.

### `private.precio_linea_venta(...)` (nueva)

```
private.precio_linea_venta(
  p_producto uuid, p_empresa uuid, p_tipo_cliente text, p_cantidad integer,
  p_descuento numeric default 0, p_ahora timestamptz default now(),
  p_aplicar_descuento boolean default true)
returns table (
  escala_usada text, neto_unitario numeric, precio_referencia numeric, promocion_id uuid,
  descuento_aplicado numeric, alicuota_id uuid, alicuota_porcentaje numeric, alicuota_exenta boolean)
```

`language plpgsql stable security invoker set search_path = ''` (mantiene la compuerta de `precio_para`: `empresas` o `ventas` en lectura/edición). Cuerpo:

1. `v_escala := private.escala_para_linea(p_tipo_cliente, p_cantidad)`; `select * into v_p from private.precio_para(p_producto, p_empresa, v_escala)`; sin fila → no devuelve filas (el llamador ya levanta «No pudimos calcular el precio»).
2. `v_d := case when p_aplicar_descuento then coalesce(p_descuento, 0) else 0 end`; `v_normal := round(v_p.neto * (1 - v_d / 100), 2)` (la **misma** expresión que hoy, para que la bandera apagada sea idéntica bit a bit).
3. `select * into v_pr from private.promocion_vigente_fila(p_producto, p_empresa, p_ahora)` (solo se ejecuta si el paso 1 devolvió fila).
4. Si `v_pr.precio is not null and v_normal is not null and v_pr.precio < v_normal`: `neto_unitario = v_pr.precio`, `precio_referencia = v_normal`, `promocion_id = v_pr.promocion_id`, `descuento_aplicado = 0`. Si no: `neto_unitario = v_normal`, referencia y promoción nulas, `descuento_aplicado = v_d`.
5. `precio_manual` **no** pasa por esta función: lo resuelve el llamador antes (como hoy, `coalesce(v_manual, …)`).

**Reloj**: `now()` es el inicio de la transacción. Las RPC toman `clock_timestamp()` **después** del `for update` del comprobante y lo pasan como `p_ahora`; el valor por defecto `now()` y el parámetro existen para los pgTAP (bordes de vencimiento y medianoche en Buenos Aires).

**Grants**: `security invoker`; `revoke execute on function … from public, anon, authenticated`. La llaman `guardar_lineas_comprobante`, `copiar_presupuesto` y la función auxiliar de la guarda, todas `security definer` (se ejecuta con el dueño, sin `grant` a `authenticated`).

### `guardar_lineas_comprobante`

Dentro del bucle, donde hoy está `select * into v_precio from private.precio_para(...)` y `v_unitario := coalesce(v_manual, round(v_precio.neto * (1 - v_descuento / 100), 2))`: llamar a `private.precio_linea_venta(v_producto.id, v_c.empresa_id, v_tipo_cliente, v_cantidad, v_descuento)` y usar `neto_unitario`, `escala_usada`, `descuento_aplicado` y las columnas de alícuota. Con precio manual: `precio_referencia`/`promocion_id` nulos y `descuento_pct = 0` (como hoy). El `insert` suma las dos columnas. `v_previas`, permisos, topes, orden, `sin_stock`, y el bloqueo `for update` no cambian.

### `confirmar_comprobante` — guarda de precios desactualizados (FR-009)

Después de bloquear el comprobante y comprobar estado/permiso, y **antes** de mover stock o costos, la guarda **empieza con `if not private.bandera_activa('promociones_precio') then` no hacer nada**; si la bandera está encendida, para cada línea `not precio_manual and not sin_stock and producto_id is not null`, calcular `private.precio_linea_venta(...)` con la escala y el descuento **actuales** (tipo de cliente y descuento leídos como en `guardar_lineas_comprobante`) y marcar la línea desactualizada si `promocion_id` calculado `is distinct from` el guardado, o si ambos existen y `neto_unitario` difiere de `precio_unitario` en más de `0.005`. Una línea cuyo precio no se puede calcular hoy (`precio_linea_venta` sin fila o `neto_unitario` nulo: producto desactivado, cotización quitada, permiso perdido) **se omite** de la guarda. El instante es `clock_timestamp()` tomado tras el `for update`. Si hay alguna desactualizada: `raise exception 'Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total' using errcode = '40001', hint = 'precios_cambiaron'`. Con la bandera apagada la guarda **no actúa ni siquiera** sobre líneas guardadas con la bandera encendida (conservan `promocion_id`): tras apagar, los borradores abiertos conservan su precio promocional hasta el próximo guardado; al volver a encender, cada borrador abierto con promoción se rechaza una vez y se reprecia (pgTAP para ambos casos; seguimiento operativo S6). No se comparan precios de lista: un cambio de lista entre el guardado y la confirmación sigue sin rechazarse, igual que hoy. Una factura ya `confirmada` devuelve antes de llegar a la guarda (idempotencia intacta).

Mismo cálculo para ambos lados mediante una función auxiliar `private.lineas_con_promocion_desactualizada(p_comprobante uuid, p_ahora timestamptz default now()) returns integer` (cantidad de líneas desactualizadas), para poder probarla aislada. Es `security definer` con `set search_path = ''` y `revoke execute … from public, anon, authenticated` (igual que `promocion_vigente_fila`); la llama `confirmar_comprobante`.

### `copiar_presupuesto`

Reemplaza `precio_para` + `round(neto, 2)` por `private.precio_linea_venta(..., p_descuento => 0, p_aplicar_descuento => false)` y guarda las dos columnas nuevas. Sin descuento (hallazgo 3), conserva `precio_manual` tal cual.

### Notas de crédito

`private.copiar_costo_linea_nota()` ya copia `costo_unitario` y `cotizacion` desde la línea original (misma factura, mismo `orden`) con un `BEFORE INSERT`. Se amplía con `precio_referencia` y `promocion_id`: la cláusula actual `if new.costo_unitario is null and new.cotizacion is null` es un gate propio del costo, así que las dos columnas nuevas se copian **fuera de ese `if`** (con su propio gate: solo si la fila nueva las trae nulas). El disparador solo actúa en notas `devolucion_productos` (las `devolucion_importe` y `descuento` no tienen líneas; `emitir_nota_credito` copia `precio_unitario`). `emitir_nota_credito` **no se reescribe**.

## Capa web (Refine)

Archivos a tocar:

- `apps/web/src/lib/ventasLineas.ts`: `LineaComprobante` suma `precio_referencia?: number | null` (sin `promocion_id`: `obtener_comprobante` no lo expone); nuevo `lineaEnPromocion(linea)` (`precio_referencia != null`); `rotuloEscalaLinea` devuelve «promoción» cuando la línea está en promoción (omite `x10` y el descuento).
- `apps/web/src/lib/ventas.ts`: tipos/mapeo de `obtenerComprobante` (clave nueva `precio_referencia` por línea).
- `apps/web/src/components/ventas/LineasComprobante.tsx`: celda de precio (líneas ~124 y ~294 de hoy): precio cobrado + `<s>` del referencia + «Promoción», con texto accesible («Precio promocional», «Precio anterior»), sin tocar la edición de precio manual.
- `apps/web/src/pages/ventas/mostrador.tsx`: tabla de líneas (~246-260) con la misma celda; aviso «Los precios cambiaron…» y re-guardado ante el error.
- `apps/web/src/pages/ventas/comprobante.tsx` y `components/ventas/ConfirmarFacturaDialog.tsx` (el diálogo que llama a `confirmarComprobante` y usa `mensajeDeConfirmacion`): mismo aviso y re-guardado en «Confirmar». En el mostrador, el cobro usa `ventaVigente.total_con_iva` del estado del cliente: tras el re-guardado ya es el total nuevo, refuerzo de la guarda del servidor. El mostrador compara también los precios antes y después de cada escaneo y muestra el aviso informativo si una promoción venció o empezó entre escaneos (FR-017).
- `apps/web/src/lib/ventasConfirmacion.ts` y `ventasMostrador.ts` (`mensajeDeConfirmarVenta`): reconocer `code === '40001' && hint === 'precios_cambiaron'` **antes** del mapeo genérico de `40001` («Otra persona modificó…») de `mensajeDeErrorComprobante`.
- Componente de precio compartido: reutilizar el patrón de `PrecioTachado` de la tienda (`pages/tienda-publica`) solo si ya es genérico; si no, extraer a `components/` sin cambiar la tienda.
- Ayuda: `apps/web/src/ayuda/contenidos/ventas.ts` (texto del mostrador y del comprobante), con `ayuda-cobertura.test.ts` verde.

## Pruebas

| Capa | Archivo | Cubre |
|---|---|---|
| pgTAP | `supabase/tests/database/ventas_precio_promocional.test.sql` (nuevo) | precedencia (tabla de la spec), snapshot, bandera apagada ≡ baseline, vigencia en bordes y medianoche de Buenos Aires (`p_ahora`), tienda A vs B, aislamiento entre organizaciones, permisos (solo `ventas` cobra la promoción; `anon` sin ejecución), inmutabilidad tras anular/editar/vencer, borrador/presupuesto/aceptar, guarda de confirmar (rechazo sin efectos, idempotencia, bandera apagada), copiar presupuesto, nota de crédito total y parcial con saldo neto y cobros, abono de motos sobre factura promocional, paridad con `precio_vigente_empresa`, 200 líneas |
| pgTAP existentes | `ventas_comprobantes_lineas`, `ventas_mostrador`, `comprobante_*`, `cobros_comprobante`, `ventas_precios_especiales`, `precios_escala`, `promociones_precio` | **sin modificar** y verdes (regresión) |
| Vitest | `LineasComprobante.test.tsx`, `mostrador.test.tsx`, `comprobante.test.tsx`, `ventasLineas.test.ts`, `ventasConfirmacion`/`ventasMostrador.test.ts` | celda de precio, precio manual sin leyenda, aviso y re-guardado, mensaje por `hint`, axe 320/768/1440 px |
| E2E | `apps/web/e2e/ventas-mostrador.e2e.ts` (ampliar) y `ventas-mostrador-promocion.e2e.ts` (nuevo) contra el build; **fija y restaura la bandera `promociones_precio`** (como `tienda-promocion.e2e.ts` con `fijarBandera`), corre con `--workers=1` (comparte bandera global y seed con los specs de la tienda) y **depende de ejecución local**: no corre en el CI público, solo en el job nocturno `e2e-nocturno.yml` | escaneo de producto en promoción, tachado y leyenda, cobro al precio promocional, venta cuyo precio cambia a mitad (aviso y recobro) |
| Mutaciones | Registro declarativo de Stryker (FEAT-236) si ya existe al implementar; si no, mutación manual documentada | `least`→`greatest`, `<`→`<=`, `now()`→`p_ahora`, quitar `descuento_aplicado = 0`, quitar el filtro `empresa_id`: cada mutante debe hacer fallar al menos un pgTAP o Vitest; las pruebas de `lib/ventasLineas.ts` entran al registro |
| Contratos | `pnpm test:openapi` | sin diff |

## Fases (historias independientes del tracker)

1. **F-1 · Precio en el servidor y snapshot (US1)**: migraciones M1 `20270310100000_comprobantes_lineas_promocion.sql` (**idempotente**, como exige el guard de migraciones: `alter table dominio.promociones_precio drop constraint if exists promociones_precio_id_organizacion_uk` + `add constraint … unique (id, organizacion_id)` —hoy solo hay `PK(id)` y la FK compuesta lo exige—; `add column if not exists` de las dos columnas; `drop constraint if exists` + `add constraint` de la FK compuesta con `no action` y del `check`; `create index if not exists` parcial por `promocion_id`; reversión), M2 `20270310100100_precio_linea_venta.sql` (dos funciones de `private`), M3 `20270310100200_lineas_precio_promocional.sql` (`guardar_lineas_comprobante` y `obtener_comprobante`), pgTAP de US1. **Antes de F-1 (T000)** se verifica el estado real de la bandera en dev y stg: en dev está **encendida desde 2026-11-13**, así que al desplegar F-1 en dev los precios del local cambian (esperable); en producción está apagada y no cambia nada visible.
2. **F-2 · Mostrador y comprobante (US2)**: dependencia F-1 (claves nuevas en `obtener_comprobante`). Su primera tarea (T007) suma al prototipo los tres elementos visuales nuevos, sin depender de nadie. Incluye el manejo UI del error de F-3 solo como mensaje; el flujo completo se prueba en F-3.
3. **F-3 · Confirmación, presupuestos y devoluciones (US3)**: dependencia F-1. M4 `20270310100300_confirmar_comprobante_precios_vigentes.sql` (guarda + función auxiliar), M5 `20270310100400_copiar_presupuesto_y_notas_precio_promocional.sql` (`copiar_presupuesto` y disparador de notas). Puede ir en paralelo a F-2 (archivos distintos; el mensaje de UI de FR-018 lo hace F-2).
4. **F-4 · Reportes, API, documentación y ayuda (US4)**: verificaciones de reportes/exportación/OpenAPI, test de paridad (FR-020), docs, ayuda, roadmap.
5. **[CIERRE]**: verificación en dev (bundle y esquema), encender la bandera **solo en dev** para el recorrido, registrar evidencia, dejar apagada en stg/prd hasta decisión de Nicolás; merge con merge commit; actualizar roadmap.

Orden de merge sugerido: F-1 → (F-2 ∥ F-3) → F-4 → cierre. Cada fase abre su PR contra `dokploy`; ninguna enciende la bandera.

## Despliegue, encendido y reversión

1. Las migraciones llegan con la bandera **apagada** en todos los entornos: ningún comprobante cambia. Verificable por pgTAP (equivalencia).
2. **Encendido** (equipo técnico, por SQL, entorno por entorno): `update public.banderas_plataforma set activa = true where clave = 'promociones_precio';` — **primero dev** (recorrido del E2E y prueba manual en el mostrador contra el bundle desplegado), luego stg, y **producción solo cuando esté en dev y verificada y Nicolás lo decida**. Encender la bandera enciende a la vez la tienda y el local: no hay un orden en que uno cobre distinto del otro.
3. **Reversión**: apagar la bandera (efecto inmediato en tienda y local; las líneas ya emitidas conservan su precio); o revertir el PR de la épica; la baja de columnas, solo en una migración posterior tras exportar.
4. Verificar siempre el despliegue: que el PR esté mergeado en `dokploy` no es que esté en dev; comprobar el bundle y la existencia de la función en dev antes de decir «está en dev».

## Riesgos técnicos

- Las dos RPC grandes se copian de la última migración: un cuerpo equivocado revertiría mejoras anteriores (p. ej. `sin_stock`, `descuento_pct`). Mitigación: diff contra el cuerpo vigente, suite existente intacta.
- `precio_para` es `security invoker` y la nueva función también: la lectura de la promoción es la única parte `security definer` y está acotada (FR-013).
- Rendimiento: una búsqueda indexada por línea; medir con 200 líneas en `guardar_lineas_comprobante` **y** en `confirmar_comprobante`, con la misma carga con bandera apagada contra encendida (< 1,5×) (FR-024).
- Concurrencia: `confirmar_comprobante` y `guardar_lineas_comprobante` ya toman `for update` sobre el comprobante; la guarda corre dentro del bloqueo.
