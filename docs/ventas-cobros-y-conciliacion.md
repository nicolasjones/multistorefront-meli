# Ventas · Cobros y conciliación (épica MSF-195)

Guía de la épica: los **cobros** de una factura (parciales o totales), la **conciliación** de los
pagos que tienen cuenta de cobro y los **contrarreembolsos** que cobran los transportes al
entregar.
Spec: `specs/20261024-150000-ventas-cobros-y-conciliacion/` (FR-001…FR-060, SC-001…SC-007).
Detalle por historia: [cobros-por-comprobante.md](cobros-por-comprobante.md) (F-VTA-12),
[pagos-conciliacion.md](pagos-conciliacion.md) (F-VTA-13) y
[contrarreembolsos-transporte.md](contrarreembolsos-transporte.md) (F-VTA-14).

La épica **no crea** una tercera forma de cobrar: el libro de cobros (`dominio.cobros_comprobante`)
es el único sitio donde se guarda el dinero que entra, y tanto la conciliación como el
contrarreembolso lo usan.

## Modelo (Principio VII: las dos tablas nuevas en `dominio`)

Son entidades de negocio del producto (la plata que entra y sale de la venta), no mecanismos de
plataforma: ninguna vive en `public`. El pgTAP `rls_en_toda_tabla` recorre `public` + `dominio` y
falla si alguna queda sin RLS.

| Tabla | Qué guarda | Historia | Migraciones |
|---|---|---|---|
| `dominio.cobros_comprobante` | El **libro de cobros**: un cobro por fila (importe, forma de pago, cuenta de cobro, quién lo registró y quién lo aprobó). | F-VTA-12 (MSF-389) | `20261215100000`…`20261215100400` |
| `dominio.contrarreembolsos` | Lo que un **transporte cobra al entregar** y rinde después (guía, importe, estado). | F-VTA-14 (MSF-410) | `20261217100000`…`20261217100200` |

Se usan (sin cambio de esquema) `dominio.comprobantes_venta`, `dominio.formas_pago`,
`dominio.cuentas_cobro` (+ `cuentas_cobro_empresas`), `dominio.transportes` (+ `transportes_empresas`),
`public.permisos_rol_accion` y `public.registro_actividad`.

Reglas comunes de las dos tablas nuevas:

- **Son libros de dinero**: un cobro ni se borra ni se edita (solo la conciliación mueve
  `aprobado_*`). No hay política ni permiso de `insert`, `update` o `delete`: escribe la función
  interna `private` o la RPC `security definer` que la envuelve.
- **FK compuestas contra `organizacion_id`**: un cobro o un contrarreembolso no puede apuntar a
  la comprobante, la forma de pago, la cuenta o el transporte de otra organización.
- **`anon` sin privilegios** y `authenticated` con solo lectura: la escritura llega por RPC.
- Los nombres de quien registra, aprueba o cobra son **fotos**: el historial sobrevive a la baja de
  la cuenta (mismo criterio que `dominio.movimientos_stock.actor_id`).

## Estados

### Del comprobante (Cobrado y Deuda)

`Cobrado` y `Deuda` **nunca** se cambian a mano:

| Estado | Quién lo pone | Cuándo |
|---|---|---|
| `cobrado` | `private.marcar_estado_cobro_comprobante` (MSF-177) | El saldo de la factura queda en 0. |
| `deuda` | `private.marcar_estado_cobro_comprobante` (MSF-177) | Queda saldo y la forma de pago «genera deuda». |
| Cualquier otro | la matriz de estados de MSF-177 | El cambio de estado normal (borrador → confirmada, anulación, …). |

El único camino a Cobrado/Deuda es `private.registrar_cobro_interno`, que usan
`public.registrar_cobro` (una persona) y `public.marcar_contrarreembolso_cobrado` (un transporte).
`cambiar_estado_comprobante` **rechaza** Cobrado y Deuda: nadie los pone desde la pantalla.

> **MSF-177 es una dependencia de despliegue**: hasta que `private.marcar_estado_cobro_comprobante`
> esté mergeada, el cobro se registra y el saldo se calcula igual, pero la factura no pasa a
> Cobrado/Deuda. Los pgTAP de esos dos escenarios quedan `skip` (no «verdes falsos») y los datos
> de prueba de DEV cargan el cobro total por la vía directa (ver
> [Datos de prueba de DEV](#datos-de-prueba-de-dev)).

### Del contrarreembolso

`pendiente` → `cobrado`. Lo mueve `public.marcar_contrarreembolso_cobrado` (idempotente, con
bloqueo optimista); nadie lo cambia a mano. Un contrarreembolso de una factura anulada queda
**visible pero no cobrable** (FR-044).

### De la conciliación

No es un estado del comprobante: es la **aprobación** del cobro (`aprobado_por`,
`aprobado_por_nombre`, `aprobado_en` en `dominio.cobros_comprobante`).

| Conciliación | Qué ve la persona |
|---|---|
| Sin conciliar | El pago aparece en «Por conciliar» y el chip del detalle dice «Sin conciliar». |
| Conciliado | El chip dice «Conciliado», el pago suma en la tarjeta «Conciliado» y queda «Aprobado por». |

**Conciliar o revertir no cambia el estado del comprobante ni el saldo** (FR-022): el dinero se
registra al cobrarlo (F-VTA-12) y la conciliación solo confirma, contra el extracto del banco, que
ese pago llegó a la cuenta.

## Roles: las tres acciones de Ventas

Las tres acciones viven en la matriz de permisos por organización × rol × sección
(`public.permisos_rol_accion`, esquema `public` = plataforma) y **solo en la sección `ventas`**.
Los valores iniciales son *datos*: se corrigen por organización desde «Roles y permisos»
(`public.guardar_matriz_permisos`).

| Acción | Qué habilita | Mostrador | Administración | Administrador | Operador | Depósito / Consulta / Miembro / Técnico |
|---|---|---|---|---|---|---|
| `registrar_cobro` | Registrar un cobro en el detalle de la factura | Sí | Sí | Sí | No | No |
| `conciliar_pago` | Aprobar o revertir la conciliación de un pago (Pagos) | No | Sí | Sí | No | No |
| `cobrar_contrarreembolso` | «Marcar cobrado» de un contrarreembolso (Transportes) | No | Sí | Sí | No | No |

Reglas que aplican a las tres (las verifica la **base**, no solo la pantalla):

- Escribir exige `ventas` en **edición** en la empresa del dato: quien solo tiene lectura nunca
  cobra, concilia ni rinde.
- El permiso se resuelve con el rol del usuario **en esa empresa**, no con la suma de sus roles:
  quien no puede cobrar en la tienda A no lo hereda por ser Administración en la B.
- El botón de la pantalla se muestra (o se deja deshabilitado) con la lectura del permiso
  (`public.puede_registrar_cobro`, `public.puede_conciliar_pago`,
  `public.puede_cobrar_contrarreembolso`): esas lecturas **no autorizan nada**, solo evitan
  ofrecer una acción que la base va a rechazar. Si la lectura falla, la pantalla queda **sin
  permiso** (deny-by-default).
- La matriz completa está en [permisos-por-rol.md](permisos-por-rol.md).

> Los roles son un **supuesto provisional** de la spec (*Decisiones abiertas* 1): registrar es de
> Mostrador, Administración y Administrador; conciliar y cobrar contrarreembolsos, de
> Administración y Administrador. Confirmarlo con el cliente es un cambio de datos, no de código.

## Simulación de la guía de despacho

La guía de despacho es de **F-VTA-16 (MSF-135)**, que todavía no existe: es la que abre el
contrarreembolso cuando el transporte cobra al entregar. Para no esperar a esa historia, la
épica deja el punto de entrada preparado y **simulable**:

```
private.abrir_contrarreembolso(p_comprobante_id uuid, p_transporte_id uuid, p_guia text) → uuid
```

- Vive en `private` **sin `grant` a `authenticated`**: la usará el servidor de la guía de despacho
  (F-VTA-16), no la app.
- La organización y la empresa salen del **comprobante**, no de un argumento; si la sesión trae
  organización, tiene que ser la del comprobante.
- Solo abre el contrarreembolso si el transporte tiene `cobra_contrarreembolso`.
- El importe es el **saldo** de la factura y es idempotente por (comprobante, guía): la misma
  guía no abre dos contrarreembolsos.
- Deja el evento `contrarreembolso.abierto` con el actor, la tienda y la guía.

Mientras F-VTA-16 no exista, la simulación se hace desde la base (los datos de prueba de DEV lo
hacen) o a mano:

```sql
-- DEV: simula la guía de despacho de una factura con saldo
select private.abrir_contrarreembolso(
  '<comprobante_id>', '<transporte_id>', 'GUIA-DEV-0001');
```

## Pantallas y rutas (grupo **Ventas** del menú, sección `ventas`)

| Ruta | Pantalla | Historia |
|---|---|---|
| `/ventas/comprobantes/:id` | Detalle del comprobante: tarjeta **Cobros**, diálogo «Registrar cobro» y campo «Cuenta de cobro» (chip Sin conciliar/Conciliado + «Ir a Pagos →»). | F-VTA-12 |
| `/ventas/pagos` | **Pagos**: tres tarjetas (Por conciliar, Conciliado, Saldo pendiente de clientes), filtro Tienda, filtro de cuentas, «Solo con saldo», tabla con el interruptor «Cobrado» y la tarjeta Cuentas de cobro. | F-VTA-13 |
| `/ventas/transportes` | **Transportes y contrarreembolsos**: sub-pestañas «Contrarreembolsos» (tarjetas, tabla y «Marcar cobrado») y «Terminales de retiro» (la tabla de MSF-139, sin cambios). | F-VTA-14 |

Las tres pantallas respetan la **empresa activa** de la barra superior (Principio VIII): al
cambiarla recargan todas sus consultas, reencuadran la paginación y descartan el filtro que ya no
existe; el detalle además **cierra con aviso** el diálogo «Registrar cobro» que estuviera abierto.

Fuera de alcance de la épica (son de MSF-135/MSF-139 u otras): la pestaña «Motos», «Exportar»,
la importación de extractos bancarios, el reverso de un cobro mal cargado, el cobro sobre
presupuestos y los campos de despacho (Guía, Fecha de envío, Armó, Controló, Entregó).

## Datos de prueba de DEV

`supabase/seed.sql` deja datos de ejemplo para probar las tres pantallas en el stack local
(`pnpm dev:supabase` + `pnpm dev:refine`). Solo corre en local: el seed **no** se aplica contra un
proyecto remoto.

Qué siembra (todo en la organización de ejemplo «Mundo JC (demo)»):

| Dato | Para qué |
|---|---|
| Una persona de ejemplo (`ventas@local.test` / `Ventas-Local1!`) como Administradora de la organización de ejemplo | Poder entrar al panel y ver las pantallas con datos. |
| Una segunda tienda («Mundo JC Centro») | El filtro **Tienda** de Pagos y Transportes con dos tiendas. |
| Formas de pago «Efectivo», «Transferencia bancaria» y «Contrarreembolso» por tienda | El diálogo «Registrar cobro» y el catálogo por tienda. |
| Dos cuentas de cobro (Banco de Galicia y Banco Macro) y una tercera marcada «No usar» | La tarjeta **Cuentas de cobro** y el filtro de cuentas de Pagos. |
| Dos transportes: uno que cobra contrarreembolso y otro que no | La pestaña «Contrarreembolsos» y la regla de que solo los que cobran generan algo. |
| Facturas con **cobros parciales** y **totales** en las dos tiendas y en las dos cuentas | La tarjeta **Cobros** del detalle, las tarjetas de Pagos y el filtro «Solo con saldo». |
| Un **contrarreembolso pendiente** abierto con `private.abrir_contrarreembolso` | La tabla de contrarreembolsos y el botón «Marcar cobrado». |

Cómo se aplica: `supabase db reset` (o `pnpm db:reset:ci` en el stack del CI) lo siembra todo. Para
volver a los datos de ejemplo: `supabase db reset`.

> El seed es **idempotente**: se puede correr de nuevo sin duplicar nada. Y es **dato inventado**:
> no hay datos reales ni datos bancarios reales (los CBU/CUIT son de prueba y validados por la base).

El pgTAP `supabase/tests/database/datos_prueba_ventas_cobros.test.sql` comprueba que el seed dejó
esos datos: la persona de ejemplo con sus tres acciones, las dos tiendas, las dos cuentas activas,
los cobros parciales y totales, el pago conciliado, el contrarreembolso pendiente y que ningún
evento de la épica lleve el CBU ni el CUIT completos.

## Reversión

Todas las migraciones de la épica son **aditivas** y llevan su reversión en el encabezado (drop de
funciones, tablas, filas sembradas de la matriz y restoration del `check` de acciones). Descartar
una tabla borra los datos cargados: **exportar antes** los cobros y los contrarreembolsos. Cada
historia se revierte con `git revert -m 1` de su merge; la épica entera, con el revert de su merge.

Los datos de prueba de DEV no se revierten con la base: son del `seed.sql` (y `supabase db reset`
los vuelve a dejar).

## Revisión de seguridad de cierre (T032 · SC-007)

Revisión `authz-security` + `supabase` del diff de la épica (las doce migraciones de F-VTA-12,
F-VTA-13 y F-VTA-14), con lectura de los pgTAP `cobros_comprobante`, `pagos_conciliacion`,
`contrarreembolsos` y `rls_en_toda_tabla`:

- **Esquema (Principio VII)**: las dos tablas nuevas están en `dominio`, como declara la spec; los
  mecanismos (`permisos_rol_accion`, `registro_actividad`) siguen en `public` sin cambio.
- **RLS**: las dos tienen `enable row level security` y **solo** una política `select` (por
  organización, empresa accesible y `ventas` en lectura o edición). Sin política ni permiso de
  escritura directa: `revoke all … from public, anon, authenticated` y `grant select` a
  `authenticated`.
- **`anon`**: `revoke … from public, anon` y `grant execute … to authenticated` en cada RPC
  pública; ninguna función de `private` es ejecutable por `anon` ni por `authenticated`.
- **Funciones internas**: `private.registrar_cobro_interno`, `private.saldo_comprobante`,
  `private.abrir_contrarreembolso`, `private.aplicar_conciliacion` y las de permiso por empresa
  son `security definer` con `search_path = ''` y **sin `grant`**: su permiso vive en la RPC
  pública que las envuelve (y tampoco la ejecuta `service_role`).
- **Autorización en el servidor**: cada RPC revalida organización, empresa y acción **en el cuerpo**
  (no solo en la UI); el permiso es por empresa del dato y no por la empresa activa.
- **Datos bancarios**: los eventos de actividad (`comprobante.cobro_registrado`,
  `pago.conciliado`, `pago.conciliacion_revertida`, `contrarreembolso.abierto`,
  `contrarreembolso.cobrado`) llevan nombre de cuenta, importe y guía, **nunca** el CBU ni el CUIT
  completos. El pgTAP de los datos de DEV lo comprueba sobre los eventos sembrados.
- **Service-role**: sin referencias en `apps/web/src` (la clave del servidor no llega al
  navegador).
- **Consola del navegador**: el detalle crudo de Postgres puede nombrar políticas, tablas o
  columnas, y una fila que falló un check puede traer los datos de la cuenta de cobro. Por eso las
  tres pantallas de la épica loguean **solo el código** del error
  (`codigoDeError`/`codigoDeErrorCobro`), nunca el error entero.

**Hallazgo corregido en este cierre**: el detalle del comprobante y la tarjeta «Cobros» logueaban
el error crudo (`console.error(..., error)`), que puede incluir el detalle de la fila. Ahora
loguean solo el código (`codigoDeErrorCobro` de `apps/web/src/lib/ventas/cobros.ts`), igual que
transportes y contrarreembolsos. El test está en
`apps/web/src/pages/ventas/comprobante.cobros.test.tsx` (falla sin la corrección).

Los pgTAP corren con `pnpm test:db` contra `pnpm dev:supabase`.
