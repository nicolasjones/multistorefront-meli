---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas · venta de mostrador (técnico, MSF-193)

Implementación de la épica **MSF-193** (*Ventas y despacho · Ventas mejoras*, spec
`specs/20261027-100000-ventas-mejoras`), historia **F-VTA-31** (Jira **MSF-329**): la **venta de
mostrador con lector de código de barras**. La vista de producto está en
[Venta de mostrador (producto)](../producto/ventas-mostrador.md).

Las otras dos historias de la épica están en
[Precios especiales por cliente (técnico)](ventas-precios-especiales.md) (F-VTA-32 / MSF-340) y en
[Cierre de caja (técnico)](ventas-cierre-caja.md) (F-VTA-33 / MSF-349).

!!! note "Estado"
    Implementado en las ramas `epic/MSF-193-ventas-mejoras` (rama de la épica) y `dokploy`
    (rama de integración), **pendiente de merge a `main`**. La historia llegó por la rama
    `feat/story-MSF-329` (PR #637, merge `aafba45e`). Migración: `20270202200400_mostrador_buscar_producto.sql`.
    Alcance de entrega: `refine` y `supabase`. Sin `kestra`, `superset` ni `workers`.

!!! warning "Banda de versiones de las migraciones"
    La migración usa una banda **nueva y mayor** a propósito (`20270202200400`): con los números que
    nombra `tasks.md` (`20261213100100`) quedaba por debajo de la cola ya aplicada en `dokploy` y
    `supabase db push` la rechaza (*«found local migration files to be inserted before the last
    migration on remote database»*); el guard `scripts/verificar-migraciones.mjs` lo marca como «versión
    REUSADA» y `pnpm docs:check` falla. La épica renumeró sus seis migraciones en el commit
    `9b546a58` y corrigió las referencias en `1d6db0d3`.

## Pantallas y rutas

| Ruta | Pantalla | Archivos | Historia |
|---|---|---|---|
| `/ventas/mostrador` | **Venta de mostrador**: campo de escaneo, tabla de líneas, totales y **Cobrar**. | `apps/web/src/pages/ventas/mostrador.tsx`, `apps/web/src/components/ventas/LectorCodigoBarras.tsx`, `apps/web/src/lib/ventasMostrador.ts` | F-VTA-31 |

- Menú **Ventas** (`apps/web/src/components/navegacion/destinosPanel.ts`): la épica agrega la entrada
  **«Venta de mostrador»** (`/ventas/mostrador`, icono `QrCodeScannerIcon`, `seccionPermiso: 'ventas'`),
  primera del grupo.
- Guarda de ruta (`apps/web/src/App.tsx`): `RequiereAccesoSeccion seccion="ventas" nivelMinimo="edicion"`
  — con `ventas` en solo lectura la ruta muestra **«Acceso restringido»**.
- Componente de campo: `LectorCodigoBarras` (`apps/web/src/components/ventas/LectorCodigoBarras.tsx`),
  un `TextField` con foco automático que se limpia tras cada lectura y un botón **Agregar**; el
  `submit` al `Enter` resuelve igual que el teclado (un lector USB «tipea» el código y manda `Enter`).

## Modelo de datos

La historia **no crea ni altera tablas**: la base ya tenía el producto con EAN-13, el comprobante, las
líneas y el libro de cobros.

| Objeto | Esquema | Estado | Cambio |
|---|---|---|---|
| `dominio.productos` | `dominio` | existente | Sin cambio: se lee `codigo_barras` (EAN-13, índice único `productos_org_codigo_barras_uidx`), `nombre`, `sku` y `activo`. |
| `dominio.comprobantes_venta` | `dominio` | existente | Sin cambio: la venta en curso es una factura `borrador` de canal Mostrador (MSF-159). |
| `dominio.comprobantes_venta_lineas` | `dominio` | existente | Sin cambio: las líneas se guardan con `guardar_lineas_comprobante` (MSF-159). |
| `dominio.cobros_comprobante` | `dominio` | existente | Sin cambio: el cobro del mostrador lo registra `registrar_cobro` (MSF-195). |
| `public.clientes` | `public` | existente | Sin cambio: se lee el cliente «Consumidor final» (`es_consumidor_final = true`, no archivado). |
| `public.buscar_producto_por_codigo_barras(text)` | `public` (RPC) | **nueva** | Función de plataforma que resuelve el producto por EAN-13. No es una tabla. |

El DER completo está en [Datos y DER](datos.md#ventas-mejoras-msf-193).

## RPC

### `public.buscar_producto_por_codigo_barras` (FR-001)

Migración `20270202200400_mostrador_buscar_producto.sql`.

```sql
public.buscar_producto_por_codigo_barras(p_codigo_barras text)
  returns table (producto_id uuid, nombre text, sku text, codigo_barras text)
```

- `security definer` + `set search_path = ''`: el aislamiento lo hacen el filtro por organización de la
  sesión y el gate de sección, no la RLS del llamador.
- **Gate**: exige `private.nivel_seccion('ventas') = 'edicion'` en la empresa activa. Sin `ventas` en
  edición responde `42501` («Tu rol no puede vender en el mostrador de esta tienda»). Con la sesión sin
  organización responde `42501`.
- **Formato**: valida EAN-13 con `^[0-9]{13}$`; otro formato responde `22023` con
  `hint = 'codigo_barras'`.
- **Resolución**: solo `dominio.productos` de la organización de la sesión y `activo = true`. Sin
  coincidencia **no devuelve filas** (la pantalla muestra «Producto no encontrado», CA-VTA-31-1): no
  distingue entre «no existe» y «es de otra organización».
- **Privilegios**: `revoke execute … from public, anon` + `grant execute … to authenticated`. No expone
  costo ni datos de otra organización.

## Reglas de negocio

### La venta en curso (FR-002, FR-003)

- **No se crea un borrador al abrir la pantalla**: el comprobante nace en el **primer escaneo** que
  resuelve un producto, con `crear_comprobante` (MSF-159) como factura `borrador`, canal **Mostrador**,
  cliente **Consumidor final** por defecto y la **empresa activa**.
- El cliente por defecto se resuelve con `obtenerConsumidorFinal()`: el cliente de la organización con
  `es_consumidor_final = true` y no archivado. Si la organización no tiene ese cliente, la pantalla avisa
  «No hay un cliente «Consumidor final» en tu organización. Pedile a un administrador que lo cree.» y no
  arma la venta.
- **Cada escaneo agrega una línea** con `guardar_lineas_comprobante`: cantidad 1; si el producto ya
  estaba en la venta, **incrementa** la cantidad y no duplica la línea (caso borde de la spec). Para que
  eso funcione, la línea nueva reutiliza el `deposito_id` que la base ya guardó en la venta
  (`depositoParaAgregar`): si se mandara `null`, el segundo escaneo del mismo producto no encontraría la
  línea guardada y la duplicaría.
- **Cola de escaneos**: un lector USB manda el siguiente código mientras el anterior todavía se resuelve.
  Los códigos se encolan (`pendientes` en `apps/web/src/pages/ventas/mostrador.tsx`) y se procesan en
  orden, cada uno con la tienda en la que se leyó: no se pierde ninguno y la venta no queda con el total
  corto.
- **Precios y totales los calcula la base**: la pantalla no calcula nada. La línea muestra el precio
  **sin** IVA; abajo se leen «Subtotal sin IVA», «IVA» y «Total», como en la pantalla de comprobante.

### Cobrar (FR-004)

1. `confirmar_comprobante(comprobante_id)` (MSF-159) — confirma la factura.
2. `registrar_cobro(comprobante_id, { forma_pago_id, cuenta_cobro_id, importe })` (MSF-195) — registra el
   cobro por el total (`total_con_iva`).

- La **forma de pago** se elige en la pantalla (las activas de la tienda); si la forma **exige cuenta de
  cobro**, aparece también el campo **Cuenta de cobro** y sin elegirlo el botón **Cobrar** queda
  deshabilitado.
- **Reintento sin duplicar**: si el cobro falla después de confirmar, la pantalla guarda el
  `confirmadaId` y el reintento **no vuelve a confirmar** ni habilita agregar más productos; el mensaje es
  «La venta se confirmó pero no pudimos registrar el cobro. Probá de nuevo: no se duplica la venta.»
- Si el rol no puede registrar cobros en esa tienda, la pantalla avisa «Tu rol no puede registrar
  cobros en esta tienda.» y **Cobrar** queda deshabilitado.

### Empresa activa (FR-005, Principio VIII)

- La venta es **de una sola tienda**: con «Todas mis empresas» la pantalla pide elegir una
  («Elegí una tienda… La venta de mostrador es de una sola tienda: elegila en la barra superior.»).
- Al **cambiar de empresa** la venta en curso se **descarta con aviso**: «Cambiaste de tienda: se
  descartó la venta en curso (…). Empezá una nueva escaneando un producto.» El borrador ya creado
  queda en Comprobantes como `borrador`; no se cobra ni se guarda bajo la otra empresa.
- Si la tienda cambia mientras un escaneo está en vuelo, la respuesta vieja se descarta: la venta no se
  muestra ni se cobra bajo la nueva tienda y se avisa.

### Permisos

| Acción | Requisito |
|---|---|
| Ver la pantalla | `ventas` en **edición** en la empresa activa (guarda de ruta y RPC). |
| Escanear y agregar líneas | La misma RPC; con solo lectura responde `42501`. |
| Cobrar | `registrar_cobro` de MSF-195 por empresa; la pantalla consulta `puedeRegistrarCobro`. |

La épica **no agrega** filas a `public.permisos_rol_accion`: reutiliza las acciones `ventas` (edición) y
`registrar_cobro` de MSF-195.

## Actividad

La venta de mostrador **no registra eventos propios**: reusa los de MSF-159 (`comprobante.editado`) y de
MSF-195 (`comprobante.cobro_registrado`). No hay evento de «venta de mostrador».

## Pruebas

- **pgTAP** `supabase/tests/database/ventas_mostrador.test.sql` (`pnpm test:db`): la RPC resuelve solo
  productos de la organización, ignora los inactivos, el código inexistente devuelve sin filas, el
  formato no EAN-13 se rechaza, el rol sin `ventas` en edición no accede y `anon` no ejecuta. La RPC no
  crea ni altera tablas, así que `rls_en_toda_tabla` sigue verde.
- **Vitest** (`pnpm test:web`): `apps/web/src/lib/ventasMostrador.test.ts` y
  `apps/web/src/pages/ventas/mostrador.test.tsx` (incremento de la línea con el depósito real, cola de
  escaneos, descarte al cambiar de tienda, error al cargar las formas de pago y totales con el IVA
  aparte).
- **E2E** (`pnpm test:e2e`): `apps/web/e2e/ventas-mostrador.e2e.ts`, rótulo
  **`[MSF-329:T007] [F-VTA-31#1]`**. Siembra con la API admin desde Node (la service-role key nunca
  llega al navegador) y **se omite** si no hay `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` locales: no
  corre en el CI público.

## Cómo probarlo

### Prerrequisitos

- Stack local: `pnpm dev:supabase` (Postgres + Auth) y `pnpm dev` (panel en `http://localhost:5173`).
- Sesión con **Ventas en edición** en la empresa activa (rol **Mostrador** o **Administrador**), con al
  menos una **forma de pago activa** en la tienda.
- Un producto **activo** con **código de barras EAN-13 de 13 dígitos** cargado (por ejemplo
  `7790001000011`) y un cliente «Consumidor final» en la organización (lo crea el sistema al dar de alta
  la organización).
- Para el E2E: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del stack **local**.

### Pasos (a mano, en el panel)

1. Entrá con tu usuario y elegí en la barra superior una **tienda concreta** (no «Todas mis empresas»).
2. Andá a **Ventas → Venta de mostrador**. Se ve el campo «Escaneá o ingresá el código de barras» y el
   aviso «Todavía no hay productos».
3. Escribí el EAN-13 del producto y apretá `Enter` (o el botón **Agregar**). **Se tiene que ver** una
   fila en la tabla con el nombre del producto, cantidad **1**, el precio sin IVA y el subtotal; abajo,
   «Subtotal sin IVA», «IVA» y «Total».
4. Escribí **el mismo código** otra vez y apretá `Enter`. **Se tiene que ver** la misma fila con
   cantidad **2** (no dos filas).
5. Escribí un código de 13 dígitos que no exista (por ejemplo `0000000000000`) y apretá `Enter`. **Se
   tiene que ver** el mensaje «Producto no encontrado» en el campo de escaneo.
6. Escribí un código con menos de 13 dígitos y apretá `Enter`. **Se tiene que ver** «El código de
   barras debe tener 13 dígitos (EAN-13).».
7. Elegí la **Forma de pago** (si la forma exige cuenta, elegí también la **Cuenta de cobro**) y hacé
   clic en **Cobrar**. **Se tiene que ver** el aviso «Venta cobrada · <número> · <importe>» y la tabla
   de líneas vacía de nuevo.
8. Cambiá de tienda en la barra superior. **Se tiene que ver** que la venta en curso se descarta con
   aviso y que no queda nada de la tienda anterior.

### Pasos (a nivel de base, pgTAP)

```bash
pnpm dev:supabase          # base local
pnpm test:db               # corre supabase/tests/database/ventas_mostrador.test.sql
```

Con la base a mano, la comprobación del aislamiento se puede hacer con el cliente SQL de Supabase
Studio, con la sesión de un usuario **autenticado** de la organización de ejemplo:

```sql
-- 1. Resuelve el producto de la organización (FR-001).
select * from public.buscar_producto_por_codigo_barras('7790001000011');

-- 2. Código inexistente: no devuelve filas (no es un error).
select * from public.buscar_producto_por_codigo_barras('0000000000000');

-- 3. Formato inválido: 22023 con hint 'codigo_barras'.
select * from public.buscar_producto_por_codigo_barras('123');

-- 4. Sin sesión de organización: 42501.
select * from public.buscar_producto_por_codigo_barras('7790001000011');
```

### Resultado esperado

- **Given** un producto activo con EAN-13, **when** el vendedor escanea el código, **then** se agrega
  una línea al comprobante de mostrador (cantidad 1; si ya estaba, se incrementa) — CA-VTA-31-1.
- **Given** un código de barras inexistente, **when** el vendedor escanea, **then** se muestra
  «Producto no encontrado» — CA-VTA-31-1.
- **Given** la venta de mostrador, **then** el comprobante nace como factura con canal Mostrador,
  cliente **Consumidor final** por defecto y la empresa activa preseleccionada.
- **Given** líneas cargadas, **when** el vendedor pulsa «Cobrar», **then** se confirma la factura y se
  registra el cobro por el total.

### Cómo automatizarlo

- **Ya existe**: `apps/web/e2e/ventas-mostrador.e2e.ts` con el rótulo **`[MSF-329:T007] [F-VTA-31#1]`**
  (escaneo agrega la línea; código inexistente muestra «Producto no encontrado»). Corre solo contra el
  stack local.
- **Pendiente de automatizar**: la cobertura de la **cola de escaneos** y del **descarte al cambiar de
  tienda** está en Vitest (`apps/web/src/pages/ventas/mostrador.test.tsx`), no en E2E. Cuando se quiera
  un E2E de esos dos casos, el rótulo a asignar es **`[MSF-329:T007]`** (mismo archivo).

## Reversión

Migración **aditiva**; el encabezado trae la reversión:

```sql
drop function public.buscar_producto_por_codigo_barras(text);
```

No hay tablas ni datos que respaldar: la RPC no altera ninguna. La venta de mostrador no crea
comprobantes propios (usa los de MSF-159), así que revertir la historia no deshace ventas ya cargadas.

## Fuera de alcance

- **Editar el cliente de la venta**: la venta de mostrador es a «Consumidor final»; no hay pantalla para
  cambiarle el cliente al comprobante.
- **Cobrar en cuotas o con cuentas de cobro Multiple**: la pantalla cobra el total de una vez.
- **Aplicar un descuento al mostrador**: el descuento por cliente (F-VTA-32) se aplica en el cálculo de
  la línea, pero la venta de mostrador es siempre a «Consumidor final», que no tiene descuento.
- **Impresión del ticket**: la impresión de comprobantes es de MSF-213
  ([Impresión (técnico)](ventas-impresion.md)).
- **Pedidos deDelivery, preventa y reservas**: no pertenecen a esta historia.
- **Gastos**: la pantalla `VentasGastos.dc.html` del prototipo no corresponde a esta épica ni a ninguna
  de sus historias.

## Pendientes

- **TODO (Documentación · Owner: agente Documentador)**: faltan las **capturas** de la pantalla
  `/ventas/mostrador` en `docs/producto/img/ventas-mostrador/`. El repositorio no trae hoy un comando
  `pnpm docs:capturas` ni una carpeta `apps/web/e2e/capturas/` (las capturas existentes se versionaron a
  mano), y esta máquina no tiene acceso al daemon de Docker, así que no se pudo levantar el stack local
  para tomarlas. **No se inventaron imágenes.** Para generarlas: levantar `pnpm dev:supabase` + `pnpm dev`,
  sembrar un producto con EAN-13 y una forma de pago, y capturar (1) la pantalla vacía, (2) la pantalla
  con líneas y totales, (3) el mensaje «Producto no encontrado», (4) el aviso de descarte por cambio de
  tienda.
