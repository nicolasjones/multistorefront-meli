# Plan de implementación: Tiendas online · Tienda compra y cuentas (MSF-176)

**Spec**: `spec.md` · **Contratos**: `contracts/tienda-compra-y-cuentas.md` · **Rama**: `epic/MSF-176-tienda-compra-y-cuentas` (PR borrador a `dokploy`)
**Alcance de entrega**: `refine` (`apps/web`: tienda pública y detalle de Consultas / rótulo en Ventas) y `supabase` (migraciones, funciones `publico.*`, pgTAP). Sin `kestra`, `superset` ni `workers`.

## Resumen técnico

Todo es **aditivo** sobre lo que ya existe: la cuenta web (`public.cuentas_cliente`, `publico.acceso_cliente_por_dominio`), la superficie pública por `Host`, el límite por visitante (`private.registrar_envio_tienda`), la bandeja de Consultas, los comprobantes y la auditoría. La pieza nueva con riesgo es una función pública que crea un **comprobante sin sesión de panel** (B2); se construye sobre **un solo punto de identidad** (`private.cuenta_de_tienda`) y **un solo motor de cálculo** (`private.motor_presupuesto_tienda`) que usan tanto la cotización como la creación.

Decisiones de diseño:

1. **Identidad única.** Toda RPC de cuenta (`mis_*`, `cambiar_favorito`, `cotizar_*`, `crear_*`) llama primero a `private.cuenta_de_tienda(host)`. Ninguna recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id`.
2. **Sin tocar lo existente.** No se redefinen `crear_comprobante`, `guardar_lineas_comprobante`, `siguiente_numero_comprobante`, `crear_consulta_publica` ni `registrar_envio_tienda` (solo se amplían dos `check` de `origen`). La numeración y el cálculo de líneas se **duplican** en funciones `private` nuevas con pruebas de paridad; absorberlos en una sola función es una refactorización posterior (MSF-816 ya propone `private.precio_linea_venta`).
3. **Lista en el navegador, servidor como autoridad.** La lista solo guarda `producto_id` y `cantidad`; el servidor revalida y calcula todo cada vez.
4. **Bandera de plataforma.** Las funciones nuevas de escritura quedan detrás de una bandera apagada por defecto (mecanismo `private.bandera_activa` de `20270228300000`, como `promociones_precio`): se enciende por SQL en cada entorno cuando se haya medido la demanda y pasado la revisión de seguridad. La bandera es **global** (no por tienda); para limitar a una tienda se usa la pantalla de publicación existente (la tienda pausada no opera). El nombre (`tienda_pedidos`) se fija en T001.
5. **Carga infinita** en «Mi cuenta» (cursor por `(fecha, id)` / `(creado_en, id)`), sin `TablePagination`.

## Esquemas y reversión (aditivo)

Versiones provisionales (a partir de `20270308100000`; se renumeran al integrar con `dokploy` con `node scripts/verificar-migraciones.mjs`). Ninguna reversión se ejecuta en el mismo PR.

| Migración | Historia | Objetos (esquema) | Reversión (migración posterior) |
|---|---|---|---|
| `20270308100000_tienda_capacidad.sql` | transversal | bandera de plataforma `tienda_pedidos` (apagada por defecto; fila en la tabla de banderas, sin función nueva: se lee con `private.bandera_activa('tienda_pedidos')`) | borrar la fila de la bandera |
| `20270308100100_cuenta_de_tienda.sql` | A, B1, B2 | `private.cuenta_de_tienda(host)` (`private`) | `drop function private.cuenta_de_tienda(text)` |
| `20270308100200_favoritos_cliente.sql` | A | `dominio.favoritos_cliente` (**tabla**, `dominio`) con RLS «cuenta propia» y sin privilegios de API | `drop table dominio.favoritos_cliente` (exportar antes) |
| `20270308100300_tienda_favoritos_rpc.sql` | A | `publico.cambiar_favorito_por_dominio`, `mis_favoritos_por_dominio`, `favoritos_entre_por_dominio` (`publico`) | `drop function` de cada una |
| `20270308100400_tienda_historial_rpc.sql` | A | `publico.mis_compras_por_dominio`, `mi_compra_por_dominio` (`publico`) | `drop function` de cada una |
| `20270308110000_consulta_items.sql` | B1 | `dominio.consulta_items` (**tabla**, `dominio`); `dominio.consultas`: `check` de `origen` suma `pedido`, columna `cliente_id` nullable, `consultas_mensaje_requerido` exime a `pedido`; `dominio.tienda_envios`: `check` de `origen` suma `pedido` y `presupuesto`; vista `public.consulta_items_bandeja` (`security_invoker`) | `drop view`; `drop table dominio.consulta_items`; `alter table … drop column cliente_id`; restaurar los `check` **solo si no hay filas** `pedido`/`presupuesto` |
| `20270308110100_validar_items_pedido.sql` | B1, B2 | `private.validar_items_pedido(p_items)` (`private`): normaliza y valida la lista | `drop function` |
| `20270308110200_lista_pedido_rpc.sql` | B1 | `publico.lista_pedido_por_dominio` (`publico`, `anon`+`authenticated`) | `drop function` |
| `20270308110300_enviar_lista_pedido.sql` | B1 | `private.crear_consulta_pedido(...)` (`private`, insertor interno) y `publico.enviar_lista_pedido` (`publico`, `anon`+`authenticated`) | `drop function` de ambas |
| `20270308120000_presupuestos_tienda.sql` | B2 | `dominio.presupuestos_tienda` (**tabla**, `dominio`) con RLS por organización/empresa/`ventas`; `private.siguiente_numero_comprobante_org(org, empresa, tipo)` (`private`) | `drop table`; `drop function` |
| `20270308120100_motor_presupuesto_tienda.sql` | B2 | `private.motor_presupuesto_tienda(cuenta, items)` (`private`): líneas, escala, descuento, IVA, depósito | `drop function` |
| `20270308120200_presupuesto_tienda_rpc.sql` | B2 | `publico.cotizar_presupuesto_tienda`, `publico.crear_presupuesto_tienda` (`publico`, solo `authenticated`) y evento de actividad `presupuesto.creado_desde_tienda` | `drop function` de cada una; los presupuestos creados se **anulan** por el flujo normal (no se borran) |

**Re-verificación del Principio VII, tabla por tabla** (se repite en tareas, implementación y revisión del PR):

| Tabla | Esquema declarado | Por qué no `public` | RLS | Privilegios |
|---|---|---|---|---|
| `dominio.favoritos_cliente` | `dominio` | Datos del negocio sobre productos del catálogo; referencia a la cuenta (que sí es `public` por ser identidad de plataforma) | Habilitada; política solo cuenta propia | `anon`, `public`, `authenticated`: ninguno |
| `dominio.consulta_items` | `dominio` | Líneas de una consulta (`dominio.consultas`) | Habilitada; org + empresa accesible + `consultas` ≥ lectura | `select` a `authenticated`; nada a `anon` |
| `dominio.presupuestos_tienda` | `dominio` | Registro del negocio atado a un comprobante de `dominio` | Habilitada; org + empresa accesible + `ventas` ≥ lectura | `select` a `authenticated`; nada a `anon` |

`rls_en_toda_tabla` (recorre `public` + `dominio`) debe pasar; `has_table_privilege` de `anon` en las tres = falso; `has_function_privilege('anon', …)` = verdadero **solo** para `lista_pedido_por_dominio` y `enviar_lista_pedido` (y las ya existentes). Los tests de superficie existentes se actualizan con la lista cerrada (los de `acceso_cliente_por_dominio` y `consultas.test.sql` quedan como están).

## Orden de implementación (por historia, con checkpoints)

Se implementa **historia por historia** (CLAUDE.md), con `/clear` entre una y otra. Cada historia termina con: pgTAP, Vitest con axe (320/768/1440), guards locales, las revisiones QA y Código/Seguridad independientes y su merge a `dokploy` **antes** de empezar la siguiente.

### Fase 0 · Cimientos (transversal)

1. Bandera `tienda_pedidos` y su lector (T001). Apagada por defecto en todos los entornos.
2. `private.cuenta_de_tienda(host)` con su pgTAP de aislamiento (T002): es la pieza de la que cuelgan las tres historias.
3. Mini-spike de verificación (T003): leer la última versión de `guardar_lineas_comprobante` (`20270201200129` y las que agregan costo y cotización a la línea) y de `precio_para`, y dejar por escrito qué columnas debe llenar B2; contar cuentas web activas y consultas por semana (pregunta abierta de demanda).

**Checkpoint 0**: la función de identidad rechaza a todos los que no son una cuenta activa y habilitada de esa tienda (pgTAP verde); las tres tablas siguen sin crearse.

### Fase 1 · A — «Mi cuenta» (F-CLI-20)

1. `dominio.favoritos_cliente` + RPC de favoritos con tope y lock.
2. RPC de historial (`mis_compras`, `mi_compra`) con lista blanca y estado público.
3. Front: ruta `mi-cuenta` (pestañas, `CargaInfinita`), botón de favoritos en la ficha, «Mi cuenta» en `AccesoCliente`.
4. Docs, Vitest, E2E (dos tiendas del seed).

**Checkpoint A**: un cliente con cuenta activa ve su historial y sus favoritos por tienda, un cliente no ve nada de otro y quien no tiene cuenta activa va a «Ingresar»; sin B1 ni B2 construidas.

### Fase 2 · B1 — Lista de pedido sin cobro

1. Migración de `consulta_items` y ampliación de `origen` (aditiva).
2. `private.validar_items_pedido` + `lista_pedido_por_dominio` (lectura) + `enviar_lista_pedido` (escritura, con límite e idempotencia).
3. Panel: «Origen = Pedido» y detalle con ítems (vista `consulta_items_bandeja`); texto inicial de «Responder» con los ítems; aviso por correo con el resumen.
4. Front: almacenamiento local de la lista, botón en la ficha, indicador en el encabezado, ruta `lista`, confirmación.
5. Docs, Vitest, E2E (visitante → bandeja).

**Checkpoint B1**: un visitante envía una lista y el operador la ve con los ítems; seis envíos en una hora → el sexto `limite`; la lista no guarda precios; ningún dato de otra tienda.

### Fase 3 · B2 — Presupuesto desde la tienda

1. `dominio.presupuestos_tienda`, numeración con organización explícita, motor de cálculo.
2. `cotizar_presupuesto_tienda` (solo lectura) y `crear_presupuesto_tienda` (atómica, con topes, idempotencia, auditoría).
3. Front: «Pedir presupuesto» en la lista (solo con sesión activa), cotización previa, confirmación; rótulo «Creado desde la tienda» en Ventas.
4. pgTAP de seguridad extenso (IDOR, aislamiento, paridad, cero efectos de stock/cobro, concurrencia).
5. Docs, Vitest, E2E (cliente → presupuesto `pendiente` en Ventas).

**Checkpoint B2**: el presupuesto creado coincide en importes con el del panel, no mueve stock ni cobros y respeta los topes; el operador lo acepta con el flujo actual.

### Fase 4 · Cierre

Guía `docs/tienda-compra-y-cuentas.md`, revisión de seguridad integral (`docs/seguridad-tienda-compra-y-cuentas.md`, que recorre las tablas 1, 2 y 3 del modelo de amenazas contra el código final), fila del roadmap, índice de docs, seguimientos trazados y verificación en dev (bundle y RPC con una cuenta de prueba, como en el tablero). Ninguna tarea queda `[ ]`.

## Front (`apps/web`)

- Tienda pública: `pages/tienda-publica/rutas/mi-cuenta.tsx` y `lista.tsx` (el nombre de archivo define la ruta; `EnrutadorTienda` las carga con `lazy`); componentes en `pages/tienda-publica/cuenta/` (`ComprasCliente`, `DetalleCompra`, `FavoritosCliente`, `BotonFavorito`) y `pages/tienda-publica/lista/` (`BotonAgregarALista`, `IndicadorLista`, `PantallaLista`, `FormularioPedido`, `ConfirmacionPedido`).
- Estado de la lista: `apps/web/src/lib/listaPedido.ts` (almacenamiento local por host con `try/catch`, solo `producto_id` y `cantidad`, tope de 50 líneas y 9.999 unidades) y `hooks/useListaPedido.ts`.
- Llamadas: `lib/tiendaCuentaDatos.ts` (historial y favoritos), `lib/tiendaPedido.ts` (lista, envío, cotización, creación), con `clave_envio` generada al abrir el envío y una sola petición en vuelo.
- Listados con `CargaInfinita` y `useListadoAcumulado`; miniaturas con `MiniaturaProducto` (zoom); sin colores ni dimensiones literales (`pnpm estilos:check`); sin `FiltroEmpresa` (una sola tienda por dominio).
- Panel: `pages/consultas/` suma el origen «Pedido» y la lista de ítems en el detalle (texto plano, sin HTML); Ventas muestra el rótulo «Creado desde la tienda por el cliente» (front, no toca `obtener_comprobante`); Actividad rotula el evento con «Tienda online».
- Bandera: con `tienda_pedidos` apagada la tienda no muestra lista ni «Mi cuenta» y las funciones de escritura responden `error` genérico (el servidor lo impone; la lectura de historial/favoritos y la cotización también). Las funciones de cuenta ya existentes no cambian.

## Pruebas

- **pgTAP** (`supabase/tests/database/`): `tienda_cuenta_de_tienda.test.sql`, `tienda_favoritos.test.sql`, `tienda_historial.test.sql`, `tienda_lista_pedido.test.sql`, `tienda_presupuesto_cliente.test.sql` (dos organizaciones, dos tiendas, tres clientes; paridad; cero efectos de stock/cobro; concurrencia con lock; superficie `anon`). Más la actualización de `consultas.test.sql` (origen `pedido`) y de los tests de superficie de `publico`.
- **Vitest + axe** a 320/768/1440 para cada pantalla y hook; test de que el almacenamiento local no guarda precios; test de render literal de `<script>` en el detalle de Consultas.
- **E2E** (Playwright, sin escritura directa: `pnpm e2e:escritura:check`): `tienda-cuenta.e2e.ts`, `tienda-lista-pedido.e2e.ts`, `tienda-presupuesto.e2e.ts`.
- **Guards**: `pnpm matriz:check`, `pnpm prototipo:check`, `pnpm docs:check`, `pnpm estilos:check`, `pnpm ui:empresas:check`, `pnpm lint`, `pnpm build`, commitlint.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **B2 abre una vía de escritura de comprobantes para un rol que no es del panel** (el mayor riesgo del producto en esta épica) | Identidad única, motor único, lista blanca de entradas, topes y lock, sin efectos de stock/cobro, pruebas adversarias, bandera global apagada, revisión de seguridad independiente antes del merge de B2 (T048) |
| Divergencia entre el cálculo de B2 y el del panel (`guardar_lineas_comprobante`) | Prueba de paridad en CI; coordinación con MSF-816 (`private.precio_linea_venta`); si MSF-816 entra antes, B2 la usa |
| `guardar_lineas_comprobante` agregó columnas (costo, cotización, sin stock, promoción) que B2 debe completar igual | T003 las inventaría; la prueba de paridad compara **todas** las columnas de la línea |
| Spam y aviso masivo al equipo | Cupo existente por visitante, topes por cuenta, bandera; aviso ya agrupado y con reintentos |
| Datos personales sin política de retención | Mínimo de campos, sin IP, RLS por sección; la retención sigue como decisión abierta (D-7) y se traza |
| La demanda no está confirmada | Bandera global apagada; medir antes de encender (T060) |
| Cuenta web con pocas cuentas activas (valor de A) | Medir en T003; A es la historia de menor costo |
| Producto sin precio en pesos (falta dólar) o con precio ≤ 0 | Se rechaza la línea (`sin_precio`); nunca se crea en cero |
| Sin pantallas dibujadas | Se piden dibujar antes de implementar; diferencias anotadas en el PR (regla 5 de la Regla de fuentes) |
| Enumeración y cruce de tenants | Host como única fuente de la empresa; visibilidad efectiva; respuestas indistinguibles; pgTAP con dos organizaciones |
| Renumeración de migraciones al integrar | `node scripts/verificar-migraciones.mjs` en cada historia; versiones mayores que la última de `dokploy` |
| Hora «hoy» (UTC vs ART) en el tope diario y el «Vencido» | `private.hoy_argentina()` en las funciones; prueba cerca de medianoche |
| Documentación atrasada | Cada historia deja su sección en `docs/tienda-compra-y-cuentas.md`; el cierre suma seguridad, roadmap e índice |
