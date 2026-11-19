---
owner: tecnico
sources:
  - specs/20270327-100000-listas-de-precios-por-cliente
  - supabase/migrations/20270340000000_listas_precios.sql
  - supabase/migrations/20270340000100_exportacion_total_listas_precios.sql
  - supabase/migrations/20270340000200_clientes_lista_precio.sql
  - supabase/migrations/20270340000210_fusion_clientes_lista_precio.sql
  - supabase/migrations/20270346000000_archivar_lista_precios_mensaje_plural.sql
  - supabase/migrations/20270348000000_lineas_snapshot_lista_precios.sql
  - supabase/migrations/20270348000100_motor_precio_lista_cliente.sql
  - supabase/migrations/20270348000200_ventas_usan_lista_precios.sql
  - supabase/migrations/20270348000300_tienda_precios_lista_cliente.sql
  - supabase/migrations/20270507110000_lista_pedido_precio_de_la_lista_del_cliente.sql
  - supabase/tests/database/listas_precios.test.sql
  - supabase/tests/database/clientes_lista_precios.test.sql
  - supabase/tests/database/precio_lista_cliente.test.sql
  - supabase/tests/database/ventas_lista_precios.test.sql
  - supabase/tests/database/precio_lista_tienda_paridad.test.sql
  - supabase/tests/database/tienda_lista_pedido_lista_precios.test.sql
---

# Revisión de seguridad integral: listas de precios por cliente (F-PRE-14 y F-CLI-21)

Alcance: spec `specs/20270327-100000-listas-de-precios-por-cliente/`, migraciones `20270340000000` a `20270340000210` y `20270346000000` (Fases 1 y 2) y `20270348000000` a `20270348000300` (Fases 3 y 4). Metodología: lectura de cada objeto contra `CLAUDE.md` y la constitución, y **comprobación de los privilegios reales en la base de dev** con una consulta de solo lectura (2026-11-15) sobre `information_schema`, `pg_policy` y `pg_proc`. La bandera `listas_precios` estaba apagada en dev durante la revisión y sigue apagada.

## Resultado

Sin hallazgos críticos ni altos abiertos. Tres observaciones de bajo riesgo en «Riesgos residuales»; la limitación de producto de la lista de pedido de la tienda (MSF-969) ya está resuelta.

## 1. RLS, esquemas y grants

| Objeto | Esquema | Control | Evidencia |
|---|---|---|---|
| `dominio.listas_precios` | `dominio` (regla comercial, Principio VII) | RLS activada; política única `listas_precios_select` (solo `select`, `authenticated`, misma organización y sección `clientes` o `ventas` en lectura o edición); **sin política de `insert`, `update` ni `delete`** | Consulta en dev: `relrowsecurity = true`, una política `r`; pgTAP `listas_precios.test.sql`, `rls_en_toda_tabla.test.sql` |
| Privilegios de la tabla | — | `authenticated`: solo `select`; `anon`: ninguno; `service_role`: `select, insert, update, delete` (exigido por el check T1 de trampas conocidas) | Consulta en dev; pgTAP `privilegios_anon_endurecidos` |
| `public.listas_precios_resumen` (vista) | `public` | `security_invoker = true` (la RLS de la tabla decide); `select` solo a `authenticated` | Consulta en dev |
| `dominio.clientes.lista_precio_id` | `dominio` | Lectura por RLS de clientes; **sin `grant insert` ni `update`** a `authenticated`: solo la escribe `asignar_lista_precios_cliente` | Consulta en dev: `authenticated` solo `select` de la columna |
| `dominio.comprobantes_venta_lineas.lista_precio_id` y `lista_ajuste_pct` | `dominio` | `authenticated` **sin `select` de columna** (el panel las lee por `obtener_comprobante`, `security definer`, que expone el porcentaje congelado y el nombre actual de la lista, nunca el id); `service_role` conserva solo el privilegio de tabla que ya tenía | Consulta en dev; E2E del recorrido (lee por `obtener_comprobante`) |
| Aislamiento entre organizaciones | — | FK compuestas `(lista_precio_id, organizacion_id)`; disparador `validar_lista_precio_cliente` rechaza listas archivadas o ajenas; las RPC toman la organización de la sesión, nunca de un parámetro | pgTAP `listas_precios.test.sql` y `clientes_lista_precios.test.sql` (dos organizaciones) |
| Exportación total | — | La tabla entra a `private.conjuntos_exportacion_total()` (`20270340000100`) | pgTAP `exportacion_total.test.sql` (48) y check T6 |

## 2. Funciones (`security definer`, `search_path` y `anon`)

Comprobado en dev para las 18 funciones que tocan listas: todas con `search_path = ''` (la única `security invoker` es el envoltorio `private.precio_linea_venta`, que ya lo era) y **ninguna ejecutable por `anon`**.

| Grupo | Funciones | `authenticated` | Notas |
|---|---|---|---|
| RPC de escritura | `guardar_lista_precios`, `archivar_lista_precios`, `restaurar_lista_precios`, `asignar_lista_precios_cliente` | sí | Solo Administrador (`private.es_administrador_de`, `42501` para los demás); bloqueo optimista; `55000` con la bandera apagada salvo archivar, restaurar y quitar |
| Ventas | `guardar_lineas_comprobante`, `copiar_presupuesto` | sí (ya lo tenían) | Mismas firmas, mismos grants que antes |
| Tienda (cuenta web) | `precios_cliente_por_dominio`, `mis_favoritos_por_dominio`, `crear_presupuesto_tienda` | sí, **no `anon`** | La lista sale de `private.cuenta_de_tienda(host)` (la sesión), no de un parámetro; el cliente no puede pedir la lista de otro |
| Motor interno | `lista_precios_cliente`, `precio_para_calculo`, `precio_linea_venta(_calculo)`, `precio_final_publico_escala`, `motor_presupuesto_tienda`, `lineas_con_promocion_desactualizada`, `cantidad_clientes_lista`, `validar_lista_precio_cliente` | no (`private`, sin acceso de API) | `revoke … from public, anon, authenticated, service_role` |

## 3. Lista blanca de la tienda

La respuesta pública de la tienda **no agrega ninguna clave**: `precios_cliente_por_dominio` sigue devolviendo `tipo` y, por producto, `escalas` con `escala`, `desde`, `hasta` y `final`; no revela el nombre ni el porcentaje de la lista. El visitante, la cuenta suspendida o no habilitada no ven listas (devuelven `null` o el precio público). Las tarjetas del catálogo no reciben nada del cliente. Evidencia: pgTAP `precio_lista_tienda_paridad.test.sql` (35, con estados de cuenta, visitante y lista blanca) y `tienda_presupuesto_cliente.test.sql` (182).

## 4. Integridad del dinero

- Con la bandera apagada, o sin lista, el precio es idéntico al vigente (pgTAP de paridad `precio_lista_cliente.test.sql`, 97).
- La lista fija solo el precio normal; el precio manual, la escala cargada y el precio propio ganan; el descuento personal no se acumula; la promoción gana solo si es estrictamente menor.
- Snapshot en la venta y herencia en la nota de crédito (la devolución es al precio cobrado); cambiar la lista después no mueve lo vendido (pgTAP `ventas_lista_precios.test.sql`, 65, y E2E del recorrido).
- La guarda de la confirmación (`40001`, `precios_cambiaron`, `detail = 'lista_precios'`) impide cobrar un total que dejó de ser el de la pantalla.
- Una línea que la lista lleva a $0 se rechaza (`22023`).

## 5. Riesgos residuales

1. **MSF-969 (resuelto, `20270507110000`):** la lista de pedido de la tienda («Enviar consulta») ahora usa la lista del cliente con sesión. El cliente nunca viene del llamador: sale de `private.cuenta_de_tienda(host)` (sesión y cuenta activa en esa tienda), así que el visitante anónimo no obtiene ninguna lista, y la respuesta pública conserva las mismas claves, sin revelar la lista ni su porcentaje (encabezado de la migración; pgTAP `tienda_lista_pedido_lista_precios.test.sql`).
2. **`service_role` conserva privilegios de tabla** sobre `listas_precios` y las columnas de snapshot: es lo que exige el repo para tablas de `dominio` y nunca llega al navegador; el E2E del recorrido solo lo usa para sembrar.
3. **Al encender la bandera**, los borradores guardados antes reciben un `40001` en su primera confirmación si el cliente tiene lista: es un rechazo seguro (no cobra), documentado en `docs/deployment.md`.
4. La bandera la cambia solo el equipo técnico por SQL: ninguna RPC la modifica y `authenticated` no puede escribirla; solo `service_role`, que nunca llega al navegador. Es global (afecta a todas las organizaciones del entorno).

## 6. Reversión

Apagar la bandera (`update public.banderas_plataforma set activa = false where clave = 'listas_precios';`) vuelve al precio de siempre sin migrar. De cada fase: `git revert -m 1` de su merge; la tabla y las columnas quedan inertes (aditivas).
