---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Cuentas y compras a proveedores (MSF-450)

**Épica:** MSF-450 — Clientes y proveedores · Cuentas y compras a proveedores · **Spec:** `specs/20261029-100000-cuentas-y-compras-a-proveedores/` (`spec.md`, `plan.md`, `tasks.md`) · **Rama:** `epic/MSF-450-clientes-y-proveedores-cuentas-y-compras` (PR #829, abierto; la épica está integrada en `dokploy` por el PR #826, merge `a559fbf0`; en `main` llega con la próxima promoción — las citas de este documento salen de `dokploy`) · **Alcance de entrega de la épica:** ninguno (solo documentación); la historia que sí se construyó declara `refine` y `supabase`.

La épica registra **cuatro ideas condicionadas a validar demanda**, todas P3 y en Backlog, con la regla explícita de que «los requisitos se redactan cuando cada historia pase a un hito». De las cuatro, **solo una llegó a un hito y se construyó**: F-CLI-19 (MSF-451), «Cuenta corriente y saldo del cliente». Las otras tres siguen **sin código** y no tienen requisitos de comportamiento: inventarlos sería decidir por el cliente lo que todavía no pidió.

Resumen de producto: [Clientes](../producto/clientes.md) (ficha del cliente) y [Proveedores](../producto/proveedores.md).

## Las cuatro ideas de la épica

| ID | Nombre | Prioridad | Talla | Estado | Dependencia que cita la épica |
|---|---|---|---|---|---|
| F-CLI-19 | Cuenta corriente y saldo del cliente | P3 | L | **Construida** (MSF-451), con definición provisoria | Cómo Ventas maneja los cobros y el estado «Deuda» |
| F-CLI-20 | Historial y favoritos en la cuenta web | P3 | L | Backlog, sin código | La cuenta web del cliente (MSF-237); equivale a F-CON-07 y F-TDA-27, acotados a esto |
| F-CLI-21 | Listas de precios por cliente | P3 | L | Backlog, sin código | Relacionada con F-PRE-14 (Precios) |
| F-PRV-09 | Órdenes de compra a proveedores | P3 | L | Backlog, sin código | El ingreso de mercadería por proveedor y el listado de reposición de Stock (MSF-368) |

En `specs/20261029-100000-cuentas-y-compras-a-proveedores/tasks.md`, las tareas T002, T003 y T004 (F-CLI-20, F-CLI-21 y F-PRV-09) quedan **abiertas a propósito** por decisión del responsable: no hay requisitos que implementar. T001 (F-CLI-19) se cerró con la spec de la historia; T010–T012 (cierre: guía, roadmap y gates) están cerradas.

## Qué se construyó: F-CLI-19 (MSF-451)

**Spec:** `specs/20261109-100000-cuenta-corriente-y-saldo-cliente/` (`spec.md`, `plan.md`, `tasks.md`) · **Rama:** `feat/story-MSF-451` (PR #817, merge `9daa892f`; el cierre de la historia quedó en `52671e91` y `ea75c62d`).

La idea entró a hito sin requisitos del cliente: **la spec y las reglas las redactó el desarrollo** a partir de [Ventas · cobros y conciliación](ventas-cobros-y-conciliacion.md) (MSF-195). Queda como **definición provisoria**, a confirmar con el cliente cuando la idea vuelva a un hito.

### Pantalla

La ficha `/clientes/show/:id` suma a la tarjeta **«Resumen comercial»** el **«Saldo deudor»** (lo que el cliente debe, **con IVA**) y, debajo de «Últimos comprobantes», la tarjeta **«Cuenta corriente»**: los comprobantes con saldo pendiente (Comprobante, Fecha, Estado, Total, Cobrado y Saldo; del más reciente al más antiguo).

- Si el cliente no debe nada, la cuenta corriente muestra el vacío («Este cliente no tiene comprobantes con saldo.») y el saldo es `$ 0`.
- Si la base no responde, el bloque muestra el error con **«Reintentar»** y el «Saldo deudor» queda en «—»: el error no se come el resto de la ficha.
- El saldo no depende de las compras: si la sección «Compras» falla, el «Saldo deudor» se sigue viendo (el «Facturado en el año» queda en «—»).
- Los números de comprobante son texto y el enlace al comprobante es de Ventas.
- Colores: el «Saldo deudor» va **ámbar** con deuda y **verde** cuando el cliente no debe; la etiqueta «Deuda» de la cuenta corriente va en ámbar, «Cobrado» en verde y «Armando» en azul (el resto, neutro).

Archivos: `apps/web/src/components/clientes/ComprasCliente.tsx` (la tarjeta y la tabla) y `apps/web/src/hooks/useCuentaCorrienteCliente.ts` (la llamada; política de «última petición gana»).

**Empresa activa (Principio VIII):** la cuenta corriente suma **las tiendas a las que la persona accede**, no la empresa activa de la barra superior: es la deuda del cliente en esas tiendas. La sección **no depende** del selector de empresa y no hay datos que reencuadrar al cambiarla. Lo que sí depende de la empresa activa en esa ficha —el bloque «Cuenta web», que es por tienda— ya se reencuadra.

### API

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.cuenta_corriente_cliente(p_cliente_id uuid) returns table (id uuid, saldo_total numeric, comprobantes bigint, numero text, fecha date, tipo text, estado text, total_con_iva numeric, cobrado numeric, saldo numeric)` | Una fila por comprobante **con saldo**, del más reciente al más antiguo. El encabezado (`saldo_total`, `comprobantes`) viaja en cada fila; sin documentos abiertos vuelve solo la fila de encabezado (saldo 0, 0 comprobantes). Cada fila trae el **`id`** del comprobante: el correlativo es por organización, empresa y tipo, así que el número se repite entre tiendas y el `id` es lo que identifica la fila | `security definer`, `search_path = ''`, `stable`; organización de `private.organizacion_id()` (nunca de un argumento); exige la sección `clientes` en `lectura`/`edicion` (`42501`); un cliente de otra organización o inexistente devuelve saldo 0 y sin documentos (no revela si existe); `p_cliente_id` nulo → `22023`; `revoke execute … from public, anon` y `grant execute … to authenticated` |

Migración: `supabase/migrations/20270222100000_cuenta_corriente_cliente.sql`. **Renumerada** al integrar `dokploy` (commit `86c2c6fe`): en la rama de la historia era `20270221100000`, y ese número ya lo usaba MSF-363. El commit `cb7eebaf` borró el archivo viejo de la rama de la épica.

### Cómo se calcula el saldo

1. **El saldo no se recalcula**: lo trae `private.saldo_comprobante` (F-VTA-12, `supabase/migrations/20270114100100_saldo_y_lectura_cobros.sql`), que es su **único dueño** (`total con IVA − Σ cobros`, nunca negativo). Si esta función recalculara el saldo habría dos reglas que pueden divergir.
2. **El estado «Deuda» no se consulta**: una factura en «Deuda» no tiene cobros y debe su total completo; una factura «Cobrada» tiene el saldo en 0. El saldo se calcula siempre con el mismo criterio, sin mirar el estado.
3. **Entran solo las facturas** que no están en `borrador`, `anulada` ni `cobrado`: un borrador no se debe, una anulada no le debe nada a nadie y una «Cobrada» está saldada aunque su cobro no esté en el libro (cobrada en mostrador o anterior al libro de cobros).
4. **Los presupuestos no son deuda** y no entran. Las **notas de crédito no restan**: su efecto en la cuenta corriente es de MSF-195 (hoy la nota de crédito no admite cobros) y esta historia no lo reasigna.
5. **`saldo_total` es la suma de los saldos listados** y `comprobantes`, la cantidad de ellos.
6. **Alcance por tienda**: solo las tiendas a las que la persona accede (`private.empresas_accesibles()`, como `public.saldo_comprobante`); el administrador accede a todas. No ve deuda de tiendas ajenas.

Índices: los que ya existen bastan (`comprobantes_venta_cliente_fecha_idx` por organización/cliente/fecha, la clave primaria de `dominio.comprobantes_venta` y `cobros_comprobante_comprobante_idx` por comprobante, que es lo que usa `private.saldo_comprobante`).

### Datos (Principio VII)

**Sin cambios de esquema**: la RPC no crea ni altera tablas, así que **no hay DER que actualizar** en [Datos y DER](datos.md). Los objetos que toca, todos preexistentes:

| Objeto | Esquema | Qué es |
|---|---|---|
| `dominio.comprobantes_venta` | `dominio` (existente) | Los documentos del cliente: se leen. |
| `dominio.cobros_comprobante` | `dominio` (existente) | El libro de cobros (F-VTA-12): se lee. |
| `private.saldo_comprobante` | `private` (existente) | El saldo del comprobante: se llama; es su único dueño. No está expuesta (`revoke … from public, anon, authenticated`). |
| `public.clientes` | `public` (existente) | Se lee para saber si el cliente es de la organización de la sesión. |
| `public.cuenta_corriente_cliente` | `public` (RPC nueva) | Mecanismo de plataforma (lo usan el panel y la tienda), no una entidad de negocio. |

## Guía de prueba

### Prerrequisitos

- **Local**: `pnpm dev:supabase` (aplica `supabase/seed.sql`) y la web servida (`pnpm dev:refine:host`).
- **Datos**: el seed deja el cliente **nº 9100** («Distribuidora del Centro (DEV)», mayorista) habilitado en dos
  tiendas («Mundo JC» y «Mundo JC Centro») con seis facturas: cuatro con saldo (60.000 + 50.000 + 40.000 +
  70.000 = **$ 220.000**) y dos totalmente cobradas. La E2E lo busca por número.
- **Persona**: la de ejemplo del seed, `ventas@local.test` / `Ventas-Local1!` (Administradora de «Mundo JC
  (demo)», con acceso a todas las tiendas).
- **Roles**: además, un usuario de Consulta **asignado a una sola tienda** (para comprobar el alcance por
  tienda).
- **Base**: la RPC exige la sección `clientes` en `lectura`/`edicion`; el rol Depósito (`ninguno`) no la ejecuta.

### Pasos (a mano)

1. Entrá a **Contactos → Clientes**, abrí la ficha del cliente de ejemplo (nº 9100) y bajá a la sección
   **Compras**. **Se ve** la tarjeta «Resumen comercial» con **Facturado en el año (sin IVA)** y **Saldo
   deudor** (con IVA), y debajo la tarjeta **«Cuenta corriente»** con la tabla de comprobantes con saldo.
2. Revisá la tabla. **Se ve** una fila por comprobante abierto con **Comprobante**, **Fecha**, **Estado**,
   **Total**, **Cobrado** y **Saldo**, de la más reciente a la más antigua.
3. Sumá a mano los saldos de la tabla. **Se ve** que el «Saldo deudor» es exactamente esa suma ($ 220.000 en
   el cliente de ejemplo). El «Facturado en el año» es otro número: va **sin IVA** y son las ventas del año,
   no la deuda.
4. Abrí una de las facturas abiertas del cliente desde **Ventas → Comprobantes** y, en la tarjeta **Cobros**,
   hacé clic en **Registrar cobro**. Volvé a la ficha del cliente y recargá. **Se ve** que el «Saldo deudor»
   baja por el importe cobrado y que la fila de esa factura muestra el nuevo «Cobrado» y el nuevo «Saldo».
5. Cobrá el resto de esa factura (de nuevo en la tarjeta **Cobros**). Volvé a la ficha. **Se ve** que la factura
   **desaparece** de la cuenta corriente (ya no tiene saldo) y que el «Saldo deudor» baja por el resto.
6. Buscá un cliente sin facturas abiertas (o con todo cobrado). **Se ve** el saldo en `$ 0` y el mensaje «Este
   cliente no tiene comprobantes con saldo.» en la cuenta corriente.
7. Con un cliente que tenga un **presupuesto** y una **nota de crédito** además de sus facturas, revisá la
   cuenta corriente. **Se ve** que **no** aparecen: solo las facturas con saldo.
8. Entrá con un usuario de Consulta **asignado a una sola tienda**. **Se ve** que el saldo suma **solo esa
   tienda** (la administradora ve la suma de las dos); con un usuario sin tiendas asignadas, el saldo es
   `$ 0`.
9. Con la web levantada pero **sin** la base (o con la sesión sin permiso), recargá la ficha. **Se ve** que
   el bloque «Cuenta corriente» muestra «No pudimos cargar la cuenta corriente del cliente.» con
   **Reintentar**, el «Saldo deudor» queda en «—» y **el resto de la ficha sigue visible**.

### Resultado esperado

- **Given** un cliente con facturas de $1.210 totalmente cobrada, otra de $1.210 con un cobro de $400 y otra de $605 en «Deuda», **When** se lee su cuenta corriente, **Then** el saldo total es **$1.415** ($810 + $605) y hay **2** comprobantes con saldo, con su total, cobrado y saldo.
- **Given** una factura con un cobro que **supera** su total, **Then** su saldo es 0 y no aparece en la lista (no hay saldo a favor).
- **Given** un cliente con un presupuesto, una factura anulada, una factura en borrador y una nota de crédito, **Then** ninguno aparece y no suma al saldo.
- **Given** un cliente sin comprobantes con saldo, **Then** el saldo es 0, hay 0 comprobantes y no hay filas.
- **Given** un cliente de otra organización (o inexistente), **Then** el saldo es 0 y no hay documentos: no se revela si existe.
- **Given** un usuario sin la sección Clientes, **Then** la RPC devuelve error de permiso (`42501`); `anon` no puede ejecutarla.
- **Given** que la base no responde, **Then** el bloque muestra el error con «Reintentar» y la ficha no se rompe.

### Cómo automatizarlo

| Recorrido | Rótulo | Prueba |
|---|---|---|
| Saldo por documento (cobro parcial, total, cobro que supera el total), estados que no son deuda, cliente sin deuda, cliente ajeno, alcance por tienda, sección `clientes` en `ninguno` y `anon` sin ejecución | `[MSF-451:T002]` | pgTAP `supabase/tests/database/cuenta_corriente_cliente.test.sql` (25 aserciones) |
| Pantalla: carga, vacío, error + «Reintentar», colores del prototipo y accesibilidad a 320/768/1440 px | `[MSF-451:T003]` | Vitest `apps/web/src/components/clientes/ComprasCliente.test.tsx` y `apps/web/src/hooks/useCuentaCorrienteCliente.test.tsx` |
| Ficha del cliente con el «Saldo deudor» y la tabla «Cuenta corriente» | `[MSF-451:T001]` | E2E `apps/web/e2e/cuenta-corriente-cliente.e2e.ts` (comprueba el saldo de $ 220.000 y los 4 comprobantes con saldo del cliente nº 9100; requiere el stack local de Supabase) |
| Tarjeta «Cuenta corriente» en el prototipo e inventarios al día | `[MSF-451:T004]` | `pnpm prototipo:inventario && pnpm prototipo:check` |

El rótulo `[MSF-451:T001]` es el que ya usa la E2E del repo, aunque en `tasks.md` esa tarea (T005) es la que
escribe el E2E y la T001 es la migración: el desfasaje se ajusta al abrir el seguimiento. El resto de los
rótulos propuestos sigue la numeración de `tasks.md` de la spec.

**Estado de la ejecución:** la pgTAP y la E2E quedaron **escritas pero no ejecutadas** en la máquina de la épica (no hay Supabase local ahí); las valida el CI. En `tasks.md` el desvío está anotado en T002 y T005.

## Pruebas

| Tipo | Archivos |
|---|---|
| pgTAP | `supabase/tests/database/cuenta_corriente_cliente.test.sql` |
| Vitest | `apps/web/src/components/clientes/ComprasCliente.test.tsx`, `apps/web/src/hooks/useCuentaCorrienteCliente.test.tsx` |
| E2E | `apps/web/e2e/cuenta-corriente-cliente.e2e.ts` |
| Prototipo | `design/pantallas/ClienteFicha.dc.html` y su copia `design/pantallas/ClienteFicha/ClienteFicha.dc.html`; inventarios regenerados (`pnpm prototipo:inventario`) |

## Seguridad

Revisada por un agente independiente (técnica + seguridad) sobre el commit final:

- **Sin tablas nuevas**: no hay RLS que agregar; la función solo lee `dominio.comprobantes_venta`, `public.clientes` y `private.saldo_comprobante`.
- **`security definer` con `search_path = ''`**: todo está calificado (`public.`, `dominio.`, `private.`).
- **Aislamiento**: la organización sale de `private.organizacion_id()`, nunca de un argumento; el alcance por tienda sale de `private.empresas_accesibles()`.
- **Permisos**: exige la sección `clientes` en `lectura`/`edicion` (`42501` si no); `revoke … from public, anon` y `grant execute … to authenticated`; `private.saldo_comprobante` no está expuesta.
- **Sin SQL dinámico**: el único parámetro es un `uuid`.

## Reversión

La migración es **aditiva** y lleva su reversión en el encabezado: `drop function public.cuenta_corriente_cliente(uuid);` en una migración posterior. **No se destruye ninguna tabla**: la cuenta corriente es una lectura de los documentos y los cobros. A nivel de épica, el cierre es un merge commit: `git revert -m 1 <hash>` deshace la épica completa.

## Preguntas abiertas (de la épica, sin resolver)

1. **Tipo de cliente vs. cantidad (F-CLI-21 / F-PRE-14):** ¿el tipo de cliente fija la escala de precios o la escala depende de la cantidad? Chocan F-PRE-14 (listas mayoristas, P3) y que el tipo de cliente defina la escala en P0.
2. **F-CLI-20 = F-CON-07 = F-TDA-27:** Tiendas online deja las cuentas en P3; manda el roadmap hasta que se defina.
3. **Cuenta corriente (F-CLI-19):** qué estados cuentan como deuda, si las notas de crédito restan, si el saldo a favor se muestra y si el saldo se ve por tienda o por organización. La definición que quedó implementada es **provisoria** (la redactó el desarrollo).
4. **Sin pantallas ni horas:** el documento exige pantalla antes de cargar a Jira; las historias se cargaron igual por pedido, con aviso en cada una.

## Fuera de alcance y pendientes

- **Notas de crédito restando de la cuenta corriente**: el prototipo de Ventas lo dice, pero ese efecto pertenece a **MSF-195**. Esta historia no lo reasigna; queda anotado como diferencia conocida, con seguimiento trazado (tarea `seguimiento` en It's a Plan para MSF-195).
- Vencimientos, límites de crédito, pago a plazo, descuentos por pronto pago y saldo a fin de mes: no existen.
- Un estado nuevo de comprobante o una tabla propia de «movimientos de la cuenta corriente»: la cuenta corriente es una **lectura** de los documentos abiertos, no un libro propio.
- El saldo por tienda o el detalle por tienda de la tabla: el número de comprobante puede repetirse entre tiendas y lo que distingue las filas es el `id`.
- La exportación de la cuenta corriente y el «Nuevo comprobante» de la ficha (son de Ventas).
- **Diferencia conocida:** la sección «Compras» de la misma ficha es de toda la organización, mientras que la cuenta corriente suma solo las tiendas a las que la persona accede.
- **F-CLI-20, F-CLI-21 y F-PRV-09 no tienen código**: no hay requisitos, pantallas, migraciones ni RPC. Cuando el cliente valide la demanda y asigne la historia a un hito, se redactan sus requisitos, se dibuja su pantalla y se escribe su spec propia.
- **TODO (dueño: Documentador, tras el merge de la épica en `main`):** generar las capturas del manual para la ficha con el «Saldo deudor» y la tabla «Cuenta corriente» en `docs/producto/img/clientes/`. La herramienta de capturas del manual (`pnpm docs:capturas`, `apps/web/e2e/capturas/` y `pnpm demo:dataset`) **no existe en este repo**: lo más cercano es `pnpm --filter @platform/web pantallas:capturar`, que renderiza el prototipo y, con `PANTALLAS_APP_URL` y un `storageState` de Playwright, también las rutas de la app. Hasta entonces la página de producto describe el comportamiento **sin imágenes nuevas**: no se inventó ninguna.
- **TODO (dueño: el responsable de la épica):** confirmar con el cliente la definición provisoria de la cuenta corriente (pregunta abierta 3) antes de tomar F-CLI-19 como cerrada.

## Ver también

- [Clientes: modelo, RPC y pantallas](clientes.md) — la ficha, el modelo de datos y las RPC de Clientes.
- [Ventas · cobros y conciliación](ventas-cobros-y-conciliacion.md) — el libro de cobros y la regla del saldo (F-VTA-12).
- [API y RPC](api.md) — el contrato de la RPC nueva.
- [Datos y DER](datos.md) — esquemas, tablas y RLS (esta épica no altera ninguno).
- Manual: [Clientes](../producto/clientes.md).
