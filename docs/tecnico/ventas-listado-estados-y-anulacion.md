---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas · listado, estados y anulación (técnico, MSF-177)

Implementación de la épica **MSF-177** (spec `20261024-130000-ventas-listado-estados-y-anulacion`):
**F-VTA-09** listado con filtros y exportación, **F-VTA-10** estados del comprobante y de cobro, y
**F-VTA-11** anulación y nota de crédito. La vista de producto está en
[Ventas · listado, estados y anulación (producto)](../producto/ventas-listado-estados-y-anulacion.md); la de
MSF-159, de la que se parte, en [Ventas · comprobantes (técnico)](ventas-comprobantes.md).

!!! note "Estado"
    Implementado en la rama `epic/MSF-177-ventas-y-despacho-ventas-listado-estados`, **pendiente de merge a
    `main`**. Migraciones `20261212100500` … `20261212120600`: las de estados quedaron en
    `20261212100500`–`20261212100900` (renombradas desde `20261207*` al mergear la base `dokploy`, que ya
    usaba `20261212100100`–`20261212100300` para la impresión y el envío de presupuestos, MSF-213).
    Worker: `workers/exportar-comprobantes`. Flow: `infra/kestra/flows/exportar-comprobantes.yml`.

## Pantalla y rutas

- **Listado**: `/ventas/comprobantes` (`apps/web/src/pages/ventas/comprobantes.tsx`, hook
  `useComprobantes`). Antes de esta épica, `/ventas` y `/ventas/comprobantes` redirigían al alta.
- **Detalle**: `/ventas/comprobantes/:id` (`comprobante.tsx`), con la tarjeta **Estado**
  (`TarjetaEstadoComprobante.tsx`), la tarjeta **Historial de estados y acciones**
  (`HistorialComprobante.tsx`), el diálogo **Anular** (`DialogoAnular.tsx`) y el diálogo **Nota de crédito**
  (`DialogoNotaCredito.tsx` + `TarjetaNotaCredito.tsx`).
- **Presupuestos**: `/ventas/presupuestos` (MSF-159) suma el botón **Exportar**.
- Menú **Ventas** (`ReceiptLongIcon`), sección `ventas`; sin la sección, «Acceso restringido».
- El filtro **Tienda** usa `FiltroEmpresa` («Todas las tiendas» + empresas accesibles) y sigue a la empresa
  activa de la barra superior: al cambiarla, `ComprobantesList` se remonta (por `key`), vuelve a la página 1 y
  recarga todo (Principio VIII).
- Columnas del listado: Comprobante (número + tipo, enlace al detalle) · Tienda · Fecha · Cliente ·
  Operador · Estado (chip de `estadosComprobante`) · Pago · Envío · Total a la derecha. Contador «N
  comprobantes», paginación de 12 («1–12 de N»); en pantallas angostas, `ContenidoAdaptable` muestra las
  mismas columnas como tarjetas. Las notas de crédito se marcan con `varianteFila='negativa'`.

### Catálogo de estados (F-VTA-10)

`apps/web/src/lib/estadosComprobante.ts` es el **único** catálogo de etiqueta, tono y texto de ayuda:

| Estado | Etiqueta | Tono | Nota |
|---|---|---|---|
| `borrador` | Borrador | neutral | No descuenta ni reserva stock. |
| `confirmada` | **Pendiente** | neutral | Traducción: no se altera `confirmar_comprobante` de MSF-159. |
| `pendiente` | Pendiente | neutral | Estado de un presupuesto. |
| `aceptado` | Aceptado | contorno | |
| `cobrado` | Cobrado | éxito | Estado de cobro (MSF-195). |
| `en_proceso` | En proceso | info | |
| `deuda` | Deuda | error | Estado de cobro (MSF-195). |
| `armando` | Armando | primario | |
| `incompleto` | Incompleto | aviso | |
| `anulada` | Anulada | contorno | El documento dejó de valer. |

`ESTADOS_DE_LA_TARJETA` es el orden del prototipo (sin `borrador`, `pendiente` ni `anulada`).
`motivoDeshabilitado()` calcula por qué un chip está deshabilitado: el estado actual, `borrador`, `anulada`,
los estados de cobro («Se actualiza solo con el cobro del comprobante.») o «Tu rol no puede pasar de X a Y».
«Entregado» (MSF-135) no existe en el catálogo.

## Modelo de datos

| Objeto | Esquema | Estado | Cambio |
|---|---|---|---|
| `dominio.transiciones_estado_comprobante` | `dominio` | **nueva** | Matriz de transiciones por organización, tipo, estado desde/hasta y rol. |
| `dominio.comprobantes_venta` | `dominio` | **alterada** | Columnas nulables de anulación y nota de crédito; `check` de `tipo` ampliado con `nota_credito`. |
| `dominio.comprobantes_venta_numeracion` | `dominio` | **alterada** | `check` de `tipo` ampliado con `nota_credito` (correlativo propio de las notas). |
| `dominio.comprobantes_venta_lineas` | `dominio` | **existente** | Sin cambio de estructura: las líneas de una nota reutilizan la tabla (mismo `orden` que la línea acreditada). |
| `public.permisos_rol_accion` | `public` | **existente** | Solo **datos**: acciones `exportar` (F-VTA-09), `anular` y `emitir_nota_credito` (F-VTA-11). |
| `public.registro_actividad` | `public` | **existente** | Sin cambio: de ahí sale el historial del comprobante. |
| Bucket `exportaciones-ventas` | Storage | **nuevo** | CSV de la exportación diferida; no es tabla. |

### `dominio.transiciones_estado_comprobante`

`20261212100500_comprobante_transiciones_estado.sql`. Columnas: `id`, `organizacion_id` (FK a
`public.organizaciones`), `tipo` (`factura` | `presupuesto`), `estado_desde`, `estado_hasta`, `rol_id`,
`creado_en`.

- `check` de estados en ambos lados: `borrador`, `confirmada`, `pendiente`, `aceptado`, `cobrado`,
  `en_proceso`, `deuda`, `armando`, `incompleto`, `anulada`; `estado_desde <> estado_hasta`.
- `check` de rol: `administrador`, `administracion`, `operador`, `mostrador`, `deposito`, `tecnico`,
  `consulta`, `sistema`.
- Único `(organizacion_id, tipo, estado_desde, estado_hasta, rol_id)`; índice
  `(organizacion_id, tipo, estado_desde)`.
- RLS: `select` para `authenticated` con `organizacion_id = private.organizacion_id()` y
  `private.nivel_seccion('ventas') in ('lectura','edicion')`. **Sin escritura directa**
  (`revoke all … from public, anon, authenticated`; solo `grant select`); `anon` sin privilegios.
- La siembra es la **única** vía de escritura: `private.sembrar_transiciones_comprobante(org)`, idempotente
  (`on conflict do nothing`), llamada para las organizaciones existentes y por trigger en cada organización
  nueva.

### Columnas agregadas a `dominio.comprobantes_venta`

`20261212120000_anulacion_nota_credito_base.sql` (todas nulables):

- `comprobante_origen_id` (FK compuesta `(comprobante_origen_id, organizacion_id)` a
  `dominio.comprobantes_venta`): la factura que acredita una nota de crédito.
- `nc_tipo`: `devolucion_productos` | `devolucion_importe` | `descuento`.
- `nc_concepto`: el concepto de la nota (obligatorio en «Devolución de importe» y «Descuento»).
- `anulado_en`, `anulado_por` (FK a `auth.users`), `motivo_anulacion` (obligatorio, ≤ 300 caracteres).

Checks: `comprobantes_venta_tipo_ck` (`factura`, `presupuesto`, `nota_credito`),
`comprobantes_venta_nc_ck` (una nota cuelga siempre de una factura y trae tipo; ningún otro documento los
lleva), `comprobantes_venta_nc_tipo_ck` y `comprobantes_venta_motivo_anulacion_ck`. Índice parcial
`comprobantes_venta_origen_idx (organizacion_id, comprobante_origen_id)`.

RLS vigente: sin escritura directa, solo RPC `security definer`; `anon` sin acceso.

El modelo completo y el DER están en [Datos y DER](datos.md#ventas-listado-estados-y-anulacion-msf-177); el
[ERD interactivo (Archify)](../diagrams/msf-177-erd.html) muestra el documento de venta, sus líneas, el
correlativo, la matriz de transiciones y las tablas de referencia.

## RPC

Las RPC de `public` están en `public`, con `set search_path = ''`, `revoke execute … from public, anon` y
`grant execute … to authenticated`. Las de apoyo en `private` **no** se otorgan a `authenticated` (solo las
llaman las RPC `security definer`) salvo que se indique lo contrario. La organización y el actor salen de la
sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. La sección `ventas` se evalúa **en
la empresa del comprobante** (`private.nivel_ventas_en_empresa`).

### F-VTA-10 · Estados

| RPC | Qué hace | Seguridad |
|---|---|---|
| `cambiar_estado_comprobante(p_id uuid, p_estado text, p_actualizado_en timestamptz)` | Cambia el estado de una factura si la transición existe para el **rol del actor en la empresa del comprobante**. Idempotente (mismo estado = devuelve el actual, sin evento). Rechaza `borrador`/`anulada` (`55000`), presupuestos y estados inválidos (`22023`) y `cobrado`/`deuda` (`42501`). Bloqueo optimista por `updated_at` (`40001`) y fila `for update`. Registra `comprobante.estado_cambiado`. | `security definer` |
| `transiciones_permitidas_comprobante(p_id uuid)` | `text[]` con los estados a los que el rol de la sesión puede pasar hoy. **Informativa**: la autoridad es `cambiar_estado_comprobante`. | `security definer` |
| `historial_comprobante(p_id uuid)` | `table (cuando timestamptz, accion text, quien text, empresa_id uuid, empresa text)`: los eventos del comprobante, más recientes primero. | `security definer` |
| `private.marcar_estado_cobro_comprobante(p_id uuid, p_estado text)` | Pasa a `cobrado`/`deuda` con actor `sistema`. **Sin `grant` a `authenticated`**: es el punto de entrada de MSF-195 (F-VTA-12), que ya lo dispara con `private.registrar_cobro_interno`. | `security definer`, sin grant |

**Por qué `historial_comprobante` es `security definer`:** el contrato original decía `security invoker`, pero
`public.registro_actividad` solo se lee con la sección `actividad`, que un vendedor no tiene: con `invoker` vería
su propio historial vacío. La función valida organización, `ventas` ≥ `lectura` en la empresa del comprobante y
filtra por empresa y por comprobante.

**Cómo reconoce los eventos:** `registro_actividad` no guarda el id de la entidad, así que el historial los
reconoce por tipo (`comprobante.%`), empresa y el texto «factura|presupuesto {número}» (número completo, como
palabra, no prefijo). En `comprobante.estado_cambiado` se quita el sufijo « in la factura N» para mostrar
«Estado: Pendiente → Aceptado». `quien` es «Sistema» cuando lo hizo el cobro automático.

### F-VTA-09 · Listado y exportación

| RPC | Qué hace | Seguridad |
|---|---|---|
| `listar_comprobantes(p_busqueda text, p_estado text, p_pago_id uuid, p_envio_id uuid, p_operador_id uuid, p_empresa_id uuid, p_pagina integer, p_tamano integer)` | Página de `factura` y `nota_credito` con `filas` (total del filtro). Devuelve id, número, tipo, empresa, fecha, cliente, operador, estado, forma de pago, envío y total (con signo). | `security invoker` |
| `operadores_de_comprobantes(p_empresa_id uuid)` | `(id, nombre)` con las opciones del filtro Operador, acotadas por tienda. | `security invoker` |
| `exportar_comprobantes(p_tipo text, p_busqueda, p_estado, p_pago_id, p_envio_id, p_operador_id, p_empresa_id)` | Todas las filas del filtro (no la página), hasta **10.000**; `p_tipo` ∈ `comprobantes` | `presupuestos`. Exige la acción `exportar` de Ventas. | `security invoker` |
| `solicitar_exportacion_comprobantes(p_tipo text, p_filtros jsonb)` | Registra la exportación **diferida** (más de 10.000 filas) en el ciclo de ejecuciones y devuelve el id de la ejecución. Idempotente con los mismos filtros; bloquea otra simultánea del mismo usuario (`YA_EN_CURSO`). | `security definer` |
| `archivo_exportacion_comprobantes(p_ejecucion_id uuid)` | `(estado text, archivo text)`: el estado de la ejecución y la ruta del CSV **solo si** terminó `exitosa`. Solo el solicitante, con `exportar` (`42501`/`P0002` si no). | `security definer` |
| `private.comprobantes_consulta(...)` / `private.comprobantes_consulta_sesion(...)` | Consulta **única** compartida por el listado, la exportación y el worker, para que lo que se ve y lo que se exporta nunca difieran. La sesión deriva organización y empresas del JWT; `private.comprobantes_consulta` no tiene grant a `authenticated`. | `security definer` |

Reglas del listado:

- Solo `factura` y `nota_credito`; los presupuestos tienen su pestaña y su propia exportación.
- La búsqueda compara **cliente o número** (`numero` o `numero_entero`) sin mayúsculas ni tildes de vocales,
  recorta espacios y escapa `\`, `%` y `_`.
- Filtros: Operador, Estado, Pago, Envío y empresa. `pendiente` y `confirmada` son equivalentes (`confirmada` se
  muestra «Pendiente»); `vencido` de un presupuesto se deriva de `valido_hasta` < hoy.
- Orden estable: `fecha desc, numero_entero desc nulls last, id`. Tope 200 por página.
- El total de una nota de crédito **resta** (signo negativo).
- Solo entran las empresas donde la persona tiene `ventas` en lectura o edición: una empresa ajena devuelve
  **cero filas**, no un error que delate su existencia.

### F-VTA-11 · Anulación y nota de crédito

| RPC | Qué hace | Seguridad |
|---|---|---|
| `anular_comprobante(p_id uuid, p_motivo text, p_actualizado_en timestamptz)` | Anula una factura confirmada: estado `anulada`, `anulado_en/por`, `motivo_anulacion`, reversión del stock y liberación de reservas, todo o nada e idempotente. El número **no** se reutiliza. Registra `comprobante.anulado`. | `security definer`; exige `ventas` en edición y la acción `anular` en la empresa |
| `emitir_nota_credito(p_factura_id uuid, p_tipo text, p_lineas jsonb, p_concepto text)` | Emite la nota: `p_tipo` ∈ `devolucion_productos` | `devolucion_importe` | `descuento`; `p_lineas` es `[{linea_id, cantidad}]` para productos o `[{importe_sin_iva}]` para los otros. No excede lo acreditable; numeración propia; registra `comprobante.nota_credito_emitida`. | `security definer`; exige `ventas` en edición y la acción `emitir_nota_credito` en la empresa |
| `detalle_anulacion_nota_credito(p_id uuid)` | `jsonb` de lectura: `puede_anular`, `puede_emitir_nota_credito`, la anulación, lo acreditable, las líneas acreditables y las notas asociadas. | `security definer` (lectura) |
| `private.revertir_venta_comprobante(p_id uuid)` | Entradas inversas al mismo depósito y liberación de reservas «A pedido». Sin grant a `authenticated`. | `security definer` |
| `private.devolver_stock_nota_credito(p_nota_id uuid)` | Entrada al depósito de origen (solo «Devolución de productos»). Sin grant. | `security definer` |
| `private.signo_comprobante(p_tipo text)` / `private.comprobante_cuenta_como_facturado(p_tipo text, p_estado text)` | **BREAKING interno**: la nota emitida cuenta como facturado **con signo negativo** en las sumas (la segunda ahora devuelve verdadero para `nota_credito`). | `immutable`, sin grant |

Errores: `42501` permiso · `22023` dato inválido (`hint` = campo) · `P0002` inexistente o ajeno ·
`55000` estado no válido · `40001` conflicto de edición · `P0001` con `hint = 'tope'` (excede lo acreditable) y
`P0001` con `hint = 'stock'` (falta stock). Los mensajes de las RPC están en castellano.

## Reglas de negocio

### Anulación (FR-040, FR-041)

- Solo una **`factura` confirmada** y no anulada, en cualquier estado operativo **salvo Cobrado**. Un
  borrador no se anula (no movió nada), y un presupuesto o una nota de crédito tampoco.
- **Motivo obligatorio** (≤ 300 caracteres).
- Con una **nota de crédito emitida** o **ya cobrada** se rechaza (`55000`): se corrige con nota de crédito.
- **Idempotente**: una factura ya anulada devuelve el comprobante sin tocar el stock ni duplicar el evento.
- **Todo o nada**: la reversión corre en la misma transacción; si algo falla, no queda ningún movimiento
  parcial. Dos anulaciones simultáneas no revierten dos veces (fila `for update`).
- La reversión (`private.revertir_venta_comprobante`) reconstruye lo que movió la factura desde sus **líneas**:
  - línea de stock → una **entrada** al mismo depósito por la cantidad de la salida, motivo de sistema
    «Anulación de factura»;
  - línea «A pedido» con reserva **activa** (`referencia = 'comprobante:<id>:linea:<orden>'`) → se **libera** (el
    reservado vuelve, la cantidad no cambia);
  - línea «A pedido» con reserva ya **descontada** por la entrega (MSF-135) → vuelve con una entrada;
  - reserva ya liberada o inexistente → nada.
- Los bloqueos de existencias se toman siempre en el orden (producto, depósito, línea), igual que la
  confirmación.

### Nota de crédito (FR-043, FR-044, FR-047)

- Solo sobre una **`factura` confirmada y no anulada** (borrador, anulada, presupuesto o nota: `55000`/`22023`).
- **No excede lo acreditable**: por línea en «Devolución de productos» (cantidad facturada − devuelta en notas
  previas) y por importe en los otros dos (total sin IVA y con IVA de la factura − notas previas). Se admiten
  notas **parciales**; el error `P0001` dice cuánto queda por acreditar.
- Las cantidades e importes de la nota se guardan **positivos**; el signo negativo lo aplican las lecturas
  (`private.signo_comprobante`).
- El **IVA** de «Devolución de importe» y «Descuento» sale de la proporción IVA/neto de la factura; si la nota
  cierra exactamente lo acreditable, se lleva el resto exacto (sin deriva de redondeo).
- La factura se toma `for update`: dos notas simultáneas no exceden el tope (la segunda ve la primera). La RPC
  también avanza `updated_at` de la factura, para que quien la tenía abierta reciba el conflicto.
- El **número** es correlativo propio por organización y empresa (`private.siguiente_numero_comprobante` con
  `tipo = 'nota_credito'`), en la misma transacción: si algo falla, el número no se consume.
- **Efecto en stock**: solo «Devolución de productos» genera una entrada al **depósito de origen** de cada
  línea, motivo de sistema «Devolución de cliente». Los otros dos motivos no tocan stock.
- La línea de la nota copia la de la factura con el **mismo `orden`** (el `orden` es único por comprobante), así
  el tope por línea se calcula sin columna nueva.

### Estados: matriz inicial (FR-021)

Propuesta **a confirmar con el cliente** (spec, *Decisiones abiertas* 2). Está sembrada por organización:

| Rol | Transiciones (`desde → hasta`) |
|---|---|
| Mostrador | Pendiente → Aceptado · Pendiente → En proceso · Aceptado → En proceso |
| Depósito | Aceptado → Armando · En proceso → Armando · Armando → Incompleto · Incompleto → Armando |
| Administración, Administrador | todas las anteriores |
| `sistema` (cobros, MSF-195) | → Cobrado y → Deuda desde cualquier estado operativo · Cobrado ↔ Deuda |

Operador y Consulta no tienen transiciones: ven la tarjeta con todos los chips deshabilitados. Corregir la
matriz es una **migración de datos**, no de estructura.

## Exportación

- **Hasta 10.000 filas** (`exportar_comprobantes`): el navegador arma el CSV con separador `;`, BOM UTF-8 y
  CRLF para Excel, reutilizando la neutralización de fórmulas de `apps/web/src/lib/exportarClientes.ts`. El
  botón está en Comprobantes y en Presupuestos y no se ofrece sin la acción `exportar`.
- **Más de 10.000 filas** (`solicitar_exportacion_comprobantes`): guarda tipo, filtros y **empresas visibles**
  en una ejecución `manual` (`public.ejecuciones_worker`) y deja una orden en `public.despachos_ejecucion` para
  Kestra. Es idempotente con los mismos filtros y bloquea otra simultánea del mismo usuario (`YA_EN_CURSO`,
  con `pg_advisory_xact_lock` por usuario). La pantalla avisa y ofrece **Descargar** en el mismo aviso:
  `archivo_exportacion_comprobantes(uuid)` devuelve el estado y, si terminó, la ruta del CSV; la app firma una
  URL de 60 s del bucket `exportaciones-ventas`. No depende de la vista «Ejecuciones».
- Si entre el listado y el clic el total pasa de 10.000, la vía inmediata **no** baja un archivo recortado:
  pasa a la diferida (`20261212110400_exportacion_comprobantes_endurecimiento.sql`).
- **Bucket** `exportaciones-ventas`: privado, `file_size_limit` 100 MB, `allowed_mime_types` `text/csv`.
  La política de Storage deja descargar solo a quien lo pidió, de su organización y con `exportar` (prefijo
  `<organizacion_id>/<usuario_id>/`). Los CSV llevan nombres de clientes: al terminar una exportación el worker
  borra los CSV anteriores de ese usuario (queda solo el último; mejor esfuerzo, se reintenta en la próxima).
- **Worker** `workers/exportar-comprobantes`: lee una ejecución por `ORGANIZACION_ID`/`EJECUCION_ID`, pagina
  con `private.filas_exportacion_comprobantes` y escribe el CSV una sola vez (idempotente al reintentar) y
  cierra la ejecución con estado y error útil. Códigos de salida del contrato: `0` (éxito), `78`
  (no reintentable), `1` (falla técnica; el flow reintenta).
- **Kestra** `infra/kestra/flows/exportar-comprobantes.yml`: reclama las capacidades
  `exportar-comprobantes-*` (nunca las de otros productos), lanza el worker en el servidor de la organización y
  resuelve la orden con confirmar, liberar o agotar. Corre sobre la conexión `historial-ventas` (mismo servidor
  y red de egress que el importador): no hace falta una conexión nueva.
- Las funciones de datos del worker (`private.datos_exportacion_comprobantes`,
  `private.filas_exportacion_comprobantes`) se otorgan **solo** a `workers_orquestacion`. La
  `SUPABASE_SERVICE_ROLE_KEY` vive en el entorno del contenedor que lanza Kestra: nunca llega al navegador ni a
  Git.

## Actividad

Cada cambio deja evento en `public.registro_actividad` con `private.registrar_actividad`, en la misma
transacción que la escritura y asociado a la tienda del comprobante:

| Evento | Cuándo |
|---|---|
| `comprobante.estado_cambiado` | Cambio de estado («Estado: Pendiente → Aceptado en la factura N»). |
| `comprobante.anulado` | Anulación («Anuló la factura N: {motivo}»). |
| `comprobante.nota_credito_emitida` | Emisión de nota («Emitió la nota de crédito N (motivo) sobre la factura M»). |

## Permisos

- Sin la sección `ventas`: «Acceso restringido» (no se llega a la pantalla).
- La **matriz de transiciones por rol es la autoridad** para cambiar el estado: `cambiar_estado_comprobante`
  exige poder **ver** `ventas` (lectura o edición) en la empresa del comprobante —no `edición`— y que exista la
  transición para el **rol del actor en esa empresa** (`private.rol_actor_en_empresa`). Depósito tiene `ventas`
  en lectura y aun así pasa Aceptado → Armando.
- **Acciones** (`public.permisos_rol_accion`, sección `ventas`): `exportar` para Administrador, Operador y
  Administración (F-VTA-09); `anular` y `emitir_nota_credito` solo para Administrador y Administración (F-VTA-11),
  y exigen `ventas` en **edición** en la empresa del comprobante (`private.puede_accion_comprobante`, que
  resuelve con el rol del usuario en ESA empresa, no con la suma de sus roles).
- Las RPC verifican el permiso, no solo la UI. `private.puede_accion_comprobante` no tiene grant a
  `authenticated`: solo la llaman las RPC `security definer`.
- El listado solo devuelve las empresas donde la persona tiene `ventas` en lectura o edición.

## Pruebas

- pgTAP: `supabase/tests/database/comprobante_estados.test.sql`,
  `supabase/tests/database/comprobante_anulacion.test.sql`,
  `supabase/tests/database/comprobante_nota_credito.test.sql` y
  `supabase/tests/database/ventas_listado_exportacion.test.sql`.
- Vitest: `apps/web/src/pages/ventas/comprobantes.test.tsx`,
  `comprobante.estados.test.tsx`, `comprobante.anulacion.test.tsx`, `presupuestos.test.tsx` y
  `apps/web/src/lib/exportarComprobantes.descarga.test.ts`.
- Worker: `workers/exportar-comprobantes/test/` (CSV con filtros, separador/codificación, idempotencia, error
  útil y códigos de salida).
- Guards: `pnpm ui:empresas:check`, `pnpm prototipo:check`, `pnpm matriz:check` y `pnpm infra:config`.

## Revisión de seguridad del cierre (T039, SC-009)

Alcance: migraciones `20261212*`, worker, flow de Kestra y bucket. Resultado: **sin hallazgos bloqueantes**.

| Tema | Resultado |
|---|---|
| RPC de `public` | Las 11 RPC nuevas llevan `revoke … from public, anon` y `grant execute … to authenticated` explícitos. |
| `security definer` | Todas con `set search_path = ''`; los ayudantes de `private` no se otorgan a `authenticated`, salvo los usados como política o desde RPC `invoker`. |
| Concurrencia de stock | Factura y existencias `for update` en anulación, nota y reversión; bloqueo optimista por `updated_at` (`40001`); `pg_advisory_xact_lock` por usuario en la exportación. |
| Bucket | `exportaciones-ventas` privado, solo `text/csv`, tope 100 MB; lectura limitada a `<org>/<usuario>/…` del propio usuario con `exportar`. |
| Worker / secretos | La `SUPABASE_SERVICE_ROLE_KEY` solo existe en el servidor; nunca llega al navegador ni a Git. |
| Pendiente menor | `private.comprobante_cuenta_como_facturado` y `private.matriz_acciones_iniciales` son puras (`immutable`) y no tienen `revoke` explícito. Sin impacto: no exponen datos ni están en un esquema expuesto. |
| Pendiente de negocio | Los valores de la matriz de estados y de las acciones `anular`/`emitir_nota_credito` son propuestos y esperan confirmación del cliente. |

## Reversión

Las migraciones son **aditivas** y documentan su reversión en el encabezado de cada una:

1. `20261212100500_comprobante_transiciones_estado.sql`: `drop table dominio.transiciones_estado_comprobante`.
2. `20261212100600_transiciones_matriz_inicial.sql`: `drop trigger
   organizaciones_sembrar_transiciones_comprobante` y `drop function` de las dos funciones de siembra.
3. `20261212100700`–`20261212100900`: `drop function` de `cambiar_estado_comprobante`,
   `transiciones_permitidas_comprobante`, `historial_comprobante`,
   `private.marcar_estado_cobro_comprobante`, `private.etiqueta_estado_comprobante` y
   `private.rol_actor_en_empresa`.
4. `20261212110000`–`20261212110400`: `drop function` de `listar_comprobantes`,
   `operadores_de_comprobantes`, `exportar_comprobantes`, `solicitar_exportacion_comprobantes`,
   `archivo_exportacion_comprobantes` y los ayudantes de `private`, `drop policy
   exportaciones_ventas_select` y el bucket `exportaciones-ventas` (tras vaciarlo desde la API de Storage).
5. `20261212120000`–`20261212120600`: `drop function` de `anular_comprobante`,
   `emitir_nota_credito`, `detalle_anulacion_nota_credito` y las RPC privadas de apoyo; restaurar el predicado
   previo de `private.comprobante_cuenta_como_facturado` / `ranking_clientes` / `compras_de_cliente`; borrar las
   columnas de anulación y nota de crédito y el `check` de `tipo` original.

Los datos ya generados (estados, anulaciones, notas, CSV) **no se deshacen solos**: se corrigen con el ajuste
de stock, liberando la reserva o con una nota de crédito.

## Fuera de alcance

Cobro y conciliación (MSF-195), despacho, entrega y «A pedido» descontado (MSF-135), RMA y devoluciones
(MSF-178), transportes y contrarreembolsos (MSF-139), impresión y envío por correo (MSF-213), reportes de
ventas (MSF-338), rentabilidad real (MSF-192), edición de la matriz de transiciones desde una pantalla (Etapa
2) y el canal Mercado Libre (Etapa 2).
