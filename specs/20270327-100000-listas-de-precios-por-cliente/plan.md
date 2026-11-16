# Plan: Listas de precios por cliente (MSF-442 / F-PRE-14 y MSF-453 / F-CLI-21)

**Spec**: [`spec.md`](./spec.md) · **Estado**: spec redactada; Fases 1 y 2 implementadas, 3 a 5 sin implementar. Decisión de Nicolás (2026-11-15): la lista es un **porcentaje de ajuste sobre el precio central**; el resto son decisiones delegadas D1–D16 de la spec.

## Enfoque

- **Una lista es una fila con un porcentaje** (`dominio.listas_precios`); un cliente apunta a una lista (`clientes.lista_precio_id`). El precio **no se guarda**: lo calcula el motor existente en la base. La web no duplica la fórmula.
- **Un solo punto de cálculo**: se extienden `private.precio_para_calculo` y `private.precio_linea_venta(_calculo)` (las usan el mostrador, la tienda y el presupuesto de la tienda). La lista entra como un paso más de la precedencia (D5): manual > escala cargada > precio propio > **lista del cliente** > regla de la tienda; después el descuento personal (no si rigió la lista, D6) y la promoción («gana el más bajo», D7, sin tocar MSF-816).
- **Apagable**: la bandera `listas_precios` (apagada por defecto) hace que el motor ignore las listas y que las escrituras respondan `55000`; se enciende dev → stg → prd por SQL.
- **Orden de entrega por riesgo**: primero datos y pantalla de listas (sin efecto en precios), luego la asignación al cliente (sin efecto), luego el motor (único cambio de precio, detrás de la bandera), y al final la tienda. Cada fase se mergea y se verifica sola.
- **UI mínima declarada**: sin prototipo; pantalla de listas en Productos, campo en la ficha del cliente y una marca en el comprobante.

## Esquemas (Principio VII, re-verificado en spec, plan y tareas)

| Objeto | Esquema | Por qué |
|---|---|---|
| `dominio.listas_precios` | `dominio` | Regla comercial del negocio, como `precios_empresa` y `promociones_precio` |
| `dominio.clientes.lista_precio_id` | `dominio` | `clientes` vive en `dominio` (MSF-882; antes en `public`); solo una columna nulable con FK compuesta |
| `dominio.comprobantes_venta_lineas.lista_precio_id`, `lista_ajuste_pct` | `dominio` | Snapshot de la venta, junto a `descuento_pct` |
| Fila `listas_precios` en `public.banderas_plataforma` | `public` | Dato de plataforma |
| RPC y vista de lectura | `public` | Superficie sin datos propios |
| Motor | `private` | Cálculo |

## Migraciones (todas aditivas e idempotentes; reversión en el encabezado de cada una)

Numeración **por encima de toda la cola de `dokploy`** (`node scripts/verificar-migraciones.mjs --estricto`): las Fases 1 y 2 usaron `20270340000000` a `20270340000210`, las Fases 3 y 4 usan `20270348000000` a `20270348000300` y la Fase 5 (cierre) **no agrega migraciones**; si hiciera falta una, usa una versión mayor que la última de `origin/dokploy` (hoy la ventana libre empieza en `20270422…`) y se **renumera al integrar** si otra rama la ocupó (`desarrollo-manual`: renumerar antes del merge).

| Migración | Fase | Contenido |
|---|---|---|
| `20270340000000_listas_precios.sql` | 1 | Tabla `dominio.listas_precios` (checks, índice único por organización sin mayúsculas, RLS, grants exactos), bandera `listas_precios` apagada, vista `public.listas_precios_resumen`, RPC `guardar_lista_precios`, `archivar_lista_precios`, `restaurar_lista_precios` (con actividad y bloqueo optimista) |
| `20270340000100_exportacion_total_listas_precios.sql` | 1 | Verifica/ajusta `private.exclusiones_exportacion_total()` para que la tabla **entre** a la exportación total (rebasar si otra migración posterior a `20270324100300` la redefine) |
| `20270340000200_clientes_lista_precio.sql` | 2 | Columna `clientes.lista_precio_id` + FK compuesta + índice, RPC `asignar_lista_precios_cliente`, disparador que impide Consumidor final/archivada/ajena, `listas_precios_resumen` cuenta clientes |
| `20270348000000_lineas_snapshot_lista_precios.sql` | 3 | Columnas `lista_precio_id` y `lista_ajuste_pct` en `dominio.comprobantes_venta_lineas` |
| `20270348000100_motor_precio_lista_cliente.sql` | 3 | `private.lista_precios_cliente`, extensión de `precio_para_calculo` y `precio_linea_venta(_calculo)` (mismas firmas y columnas de retorno + columnas nuevas al final; sin lista = resultado idéntico) |
| `20270348000200_ventas_usan_lista_precios.sql` | 3 | `guardar_lineas_comprobante`, `copiar_presupuesto` y la validación de `confirmar_comprobante` leen la lista del cliente y guardan el snapshot; notas de crédito reutilizan el snapshot |
| `20270348000300_tienda_precios_lista_cliente.sql` | 4 | `publico.precios_cliente_por_dominio` y el motor del presupuesto de la tienda aplican la lista de la cuenta web |

La última migración de cada fase deja la reversión **documentada** (no ejecutada en el mismo PR): `drop` de funciones nuevas y restauración de las redefinidas a su cuerpo anterior (`20270322100000`, `20270310100200`…`20270310100400`); las columnas se retiran solo cuando ninguna función las lee.

## Contratos / OpenAPI

[`contracts/listas-de-precios.md`](./contracts/listas-de-precios.md). Las RPC se llaman desde el panel (no son API pública): **sin cambios en `openapi/*.json`**. `publico.precios_cliente_por_dominio` conserva firma y lista blanca de la respuesta (`producto_id`, `escala`, `desde`, `hasta`, `final`); no expone el nombre ni el porcentaje de la lista.

## Piezas fuera de la base

`apps/web`: `pages/productos/listas-de-precios.tsx` (ruta lazy `/productos/listas-de-precios`, destino de menú en Productos), `lib/listasPrecios.ts` y hooks, campo en `components/clientes/FormularioCliente.tsx` y `pages/clientes/show.tsx`, marca de lista en el comprobante, etiquetas de los eventos en Actividad, ayuda y manual. Sin `kestra`, `superset`, `workers` ni Edge Functions nuevas.

## Pruebas previstas

- **pgTAP**: `listas_precios.test.sql`, `listas_precios_bandera.test.sql`, `clientes_lista_precios.test.sql`, `precio_lista_cliente.test.sql`, `ventas_lista_precios.test.sql`, `precio_lista_tienda_paridad.test.sql`; extender `precios_cliente.test.sql` y `exportacion_total.test.sql`; recorrer `rls_en_toda_tabla`, `privilegios_anon_endurecidos` y los de paridad de MSF-816 (`ventas_precio_promocional_paridad`) con la bandera apagada.
- **Vitest**: pantalla de listas, ficha del cliente, marca en comprobante, cambio de empresa con la pantalla abierta, axe a 320/768/1440 px.
- **E2E**: sin E2E nuevo (la matriz no tiene criterios de pantalla propios del prototipo); el recorrido de punta a punta se verifica en dev al encender la bandera (Fase 5).

## RLS, permisos y grants

- `dominio.listas_precios`: RLS por `organizacion_id` con política `select` para `authenticated` con `private.nivel_seccion('clientes')` o `('ventas')` en lectura/edición; `revoke all` a `public`/`anon`/`authenticated` y `grant select` solo a `authenticated`; **sin política de escritura ni `DELETE`**. La escribe únicamente la RPC.
- RPC (`security definer`, `search_path = ''`, organización y rol desde la sesión): `revoke … from public, anon`, `grant execute … to authenticated`; el rol Administrador se comprueba adentro (`42501`), igual que el descuento personal. Errores: `42501`, `P0002`, `22023`, `23505` (nombre repetido), `23514`/`22003` (ajuste fuera de rango), `40001` (bloqueo optimista), `55000` (bandera apagada).
- `clientes.lista_precio_id`: sin `grant update` de columna; FK compuesta evita listas de otra organización; disparador defensivo ante cualquier otra vía de escritura.
- Motor: ninguna función nueva de `private` con `execute` para `anon`/`authenticated` (salvo lo que ya tienen las que se redefinen); lo prueba pgTAP.
- Tienda: `anon` no calcula listas; solo `authenticated` con cuenta web activa y habilitada.

## Reversión

1. **Inmediata y sin migrar**: `update public.banderas_plataforma set activa = false where clave = 'listas_precios';` — el motor vuelve a ignorar las listas y los precios son los de hoy.
2. **De la spec completa**: `git revert -m 1` del merge de cada fase (los PR se mergean con merge commit). Las columnas y la tabla quedan inertes (aditivas) hasta una migración posterior de retiro, que **no** va en el mismo PR que las crea.
3. Funciones redefinidas: restaurar el cuerpo anterior desde su migración original (listadas en el encabezado de `20270348000100` y `20270348000200`).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cambia lo que se cobra y se factura | Bandera apagada por defecto; pgTAP de paridad sin lista; encender dev → stg → prd con verificación |
| Precedencia mal entendida (lista vs precio propio, escala, descuento personal, promoción) | Regla única documentada (D5–D7), flujo en la spec, aviso en la ficha, pgTAP por cada combinación |
| La lista reemplaza el ajuste de la tienda (D3) y puede dar menos que el público | Ejemplo en el diálogo, documentado en el manual y en la spec; es lo buscado para revendedores |
| Redefinir `precio_para_calculo` / `precio_linea_venta(_calculo)` choca con otra rama | Mismas firmas y columnas (nuevas al final); revisar al integrar contra la última versión de `20270322100000`; renumerar migraciones |
| Mostrador y tienda muestran precios distintos | Una sola función; pgTAP de paridad `precio_lista_tienda_paridad` |
| Un cliente cambia de precio sin querer al archivar o editar una lista | No se archiva una lista con clientes; el % editado solo rige hacia adelante; snapshot en la línea; evento en Actividad con anterior y nuevo |
| Borradores abiertos al apagar o encender la bandera | Se recalculan al guardar; mismo comportamiento y procedimiento que las promociones (MSF-937) |
| Pantalla sin prototipo | UI mínima declarada (D16), componentes compartidos y revisión lado a lado al implementar |
| Deriva de funciones en dev (migraciones registradas con funciones viejas) | Revisar `precio_para` y `precio_linea_venta` en dev antes de encender; pgTAP corre en dev |

## Documentación

`docs/listas-de-precios.md` (técnico), `docs/producto/listas-de-precios.md` (manual), actualización de `docs/precios.md`, `docs/precios-escalas.md`, `docs/promociones-precio.md`, `docs/clientes.md`, `docs/cuentas-y-compras-a-proveedores.md`, `docs/actividad.md`, `docs/deployment.md` (bandera), `docs/permisos-por-rol.md`, `mkdocs.yml`, y las specs `20261105-100000-cotizacion-sugerida-y-mayoristas` y `20261029-100000-cuentas-y-compras-a-proveedores` (F-PRE-14 deja de estar cancelada) y `docs/roadmap-template.md`.
