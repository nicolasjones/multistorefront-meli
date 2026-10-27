# Ventas · Despacho: armado, control y entrega (F-VTA-15, F-VTA-16)

Historias F-VTA-15 (MSF-152) y F-VTA-16 (MSF-166) de la épica MSF-135. Spec:
`specs/20261024-130000-ventas-despacho-y-faltantes/` (FR-001…FR-023, SC-001…SC-005). Prototipo:
`design/pantallas/VentasComprobante.dc.html` (tarjeta **Responsables**, chips del estado de despacho y bloque
**Envío y transporte**).

## Modelo

El despacho es un **campo propio de la factura**, separado del estado documental de MSF-159/MSF-177:

- **Esquema `dominio`** (Principio VII): `dominio.comprobantes_venta` (documento de venta) recibe, de forma
  aditiva, `estado_despacho`, `armo_id`, `controlo_id`, `entrego_id` (FK a `auth.users`, `on delete set null`) y
  `entregado_en`. Índice `(organizacion_id, empresa_id, estado_despacho)`.
- `estado_despacho` es nulable y solo puede existir en `tipo = 'factura'` (check). `estado` sigue siendo el estado
  documental (`borrador`, `confirmada`, `anulada`, …); los dos comparten los nombres `armando` e `incompleto` pero
  viven en columnas distintas y los mueven historias distintas.
- La RLS vigente de `dominio.comprobantes_venta` no cambia: se lee por organización y sección `ventas`. **No hay
  grants de escritura nuevos**: el estado y los responsables se escriben solo por RPC `security definer`. `anon` no
  tiene acceso.

## Estados y flujo (FR-001, FR-002, FR-003)

```
[*] --> sin_armar | armando | listo_para_despachar   (al confirmar, según la forma de envío)
sin_armar  --> armando               Empezar a armar
incompleto --> armando               Reanudar el armado (lo fija F-VTA-18)
armando    --> listo_para_despachar  Controlar
listo_para_despachar --> entregado   Entregar
entregado es terminal
```

- **Inicial (FR-002):** al pasar una factura a `confirmada`, el disparador
  `comprobantes_venta_estado_despacho_inicial` (`AFTER UPDATE OF estado`) fija el `estado_despacho_inicial` de su
  forma de envío (`envio_id`, misma organización y empresa) o `sin_armar` si no resuelve. Corre **una sola vez** (si
  ya hay estado no lo pisa), no toca `confirmar_comprobante` ni `updated_at`. Como corre después del `RETURNING`,
  la pantalla recarga el comprobante tras confirmar.
- **Transiciones (FR-003):** `cambiar_estado_despacho` solo acepta las del flujo. Un presupuesto, un borrador o una
  factura anulada se rechazan (`22023`/`55000`). Es **idempotente**: pedir el estado que ya tiene devuelve la fila
  sin tocar responsables ni stock. Usa **bloqueo optimista** por `p_actualizado_en` (`40001`) y toma la fila
  `for update`, así dos cambios simultáneos no se pisan.

## Responsables (FR-004, FR-005, FR-006)

| Paso | Quién puede | Regla |
|------|-------------|-------|
| Armó (`armando`) | Depósito o Administrador de la empresa | — |
| Controló (`listo_para_despachar`) | Depósito o Administrador de la empresa | Debe ser **distinto de quien armó**, salvo que sea Administrador |
| Entregó (`entregado`) | Rol con la acción `despachar` en Ventas | Fija `entregado_en` |

`listar_responsables_despacho(p_empresa_id, p_funcion)` devuelve los usuarios **activos** de la organización
elegibles para `armar`, `controlar` o `entregar` (nombre, rol y `user_id`); incluye a los Administradores de la
organización y a los miembros con rol en esa empresa. Exige ver Ventas en la tienda. Los selectores del comprobante
solo ofrecen esa lista; la autoridad final es la RPC.

**Acceso a la sección:** además del rol del paso, el responsable debe tener **Ventas al menos en `lectura`** en la
empresa del comprobante (FR-009). La regla vive en `private.responsable_despacho_habilitado` y la usan las dos
puertas —el desplegable (`listar_responsables_despacho`) y la autoridad (`cambiar_estado_despacho`)—: quien no
accede a Ventas en esa tienda no se ofrece ni se acepta como Armó, Controló o Entregó. Se completó en la migración
aditiva `20261214100600_despacho_responsables_acceso_ventas.sql`.

## Acción `despachar` (FR-008)

Nueva acción `despachar` de la sección `ventas` en `public.permisos_rol_accion`:

- Amplía el check de acciones y la siembra inicial de `private.matriz_acciones_iniciales()`: **Administrador y
  Depósito en `true`**, el resto en `false`. Las organizaciones existentes reciben sus filas en la migración.
- `private.puede_accion` la exige **con Ventas al menos en `lectura`**: Depósito despacha aunque no tenga `edicion`.
  Es la respuesta a la decisión abierta 7 de la spec.
- El permiso se resuelve **en la empresa del comprobante**, no en la empresa activa: `private.puede_despachar_en_empresa`
  (migración `20261214100700`) usa el rol que la persona tiene en esa tienda. Tener `despachar` en la tienda activa no
  habilita facturas de otra tienda, y el `puede_despachar` de la tarjeta usa la misma regla.
- Editar `despachar` desde la pantalla de Roles queda fuera de esta historia (mismo criterio que `editar_precio`).
  Si otro rol debe entregar, se le da la acción en la matriz: no hace falta migración.

## Transporte y guía (FR-020, FR-021, FR-022, FR-023)

La factura que sale con transporte lo registra con su guía y fecha de envío. Los datos viven en la propia
factura (`dominio`), no en una tabla nueva:

- **Esquema `dominio`** (Principio VII): `dominio.comprobantes_venta` recibe, de forma aditiva, `transporte_id`
  (FK **compuesta** a `dominio.transportes (id, organizacion_id)`: el transporte tiene que ser de la misma
  organización), `guia` (texto ≤ 100 caracteres) y `fecha_envio` (date). Lo agrega
  `20261214110100_envio_columnas.sql` (alter aditiva, reversión en el encabezado).
- La RLS vigente no cambia: se lee por organización y sección `ventas`. **No hay grants de escritura nuevos**: el
  envío se escribe solo por la RPC `security definer` `guardar_envio_comprobante` (`20261214110200_envio_guardar.sql`).
  `anon` no tiene acceso.
- Los transportes salen del catálogo de MSF-139 (`dominio.transportes` + `dominio.transportes_empresas`, «Empresas
  donde se usa»): un transporte no usado en la tienda del comprobante no se puede elegir.

### Reglas de `guardar_envio_comprobante(p_id, p_transporte_id, p_guia, p_fecha_envio, p_actualizado_en)`

| Regla | Qué pasa |
|-------|----------|
| Factura confirmada no entregada | Un presupuesto, un borrador o una factura ya entregada no registran envío (`22023` / `55000`) |
| Transporte activo y de la tienda | Inactivo, de otra organización o de otra tienda → se rechaza (`22023`) |
| Permiso | La acción `despachar` **o** Ventas en `edicion`, resueltos en la **empresa del comprobante** (no en la empresa activa) (`42501`) |
| Bloqueo optimista | `p_actualizado_en` desactualizado → `40001` |
| Idempotencia | Guardar lo mismo no escribe otra vez ni rompe el bloqueo de quien lo está mirando |
| Guía | Texto de hasta 100 caracteres; en blanco = sin guía (`22023`) |
| Fecha de envío | Si no viene, se toma la de hoy (la mercadería sale hoy) |
| Auditoría | Actividad `despacho.envio_guardado` («Envío: transporte X, guía Y, fecha Z en la factura N») |

**Dónde se exige el transporte y la guía**: al **entregar**, no al guardar. La forma de envío
(`dominio.formas_envio.exige_transporte_guia`) es la que exige transporte y guía, y esa comprobación vive en el
cambio de estado a `entregado` (FR-022). Guardar el envío es guardar el dato; el «no se puede entregar sin guía» se
resuelve al entregar.

### La exigencia al entregar (FR-022)

`20261214110300_envio_exige_al_entregar.sql` agrega el disparador
`comprobantes_venta_exige_envio_al_entregar` (`before update of estado_despacho` sobre
`dominio.comprobantes_venta`, función `private.exigir_envio_al_entregar`):

| Regla | Qué pasa |
|-------|----------|
| Forma que exige transporte y guía | Al pasar a `entregado` sin transporte o sin guía, la escritura se rechaza (`22023`) y el mensaje dice **qué falta**: «No se puede entregar la factura: falta el transporte (la forma de envío «Expreso» lo exige)» |
| Forma que NO lo exige («Retiro en local») | Se entrega sin transporte ni guía |
| Sin forma de envío | No hay exigencia (mismo criterio que el estado inicial) |
| Guía en blanco | Es una guía ausente (se normaliza igual que en `guardar_envio_comprobante`) |

La regla vive en la **base**, no en la RPC: cualquier camino que marque `entregado` pasa por el disparador. Como
`cambiar_estado_despacho` descuenta las reservas «A pedido» en la misma transacción, el rechazo deja la entrega
entera sin aplicar (todo o nada): la factura no queda entregada ni con reservas descontadas.

**Elegibilidad por tipo** (Decisión abierta 8 de la spec: correo → transportes `correo`, expreso → `expreso`, moto →
`moto_propia`, terminal → cualquiera de la empresa): la lista de transportes elegibles la arma el frontend
(`apps/web/src/lib/ventasEnvio.ts`) y es una regla de la pantalla, no una frontera de seguridad: la base exige
**activo + usado en la empresa del comprobante** (FR-021).

**Cómo se manda `p_actualizado_en`**: como **texto** (el `updated_at` que devuelve la RPC, con sus microsegundos),
igual que en `guardar_comprobante` y `cambiar_estado_despacho`. Si se manda un `Date` de JavaScript se pierden los
microsegundos y la base responde siempre `40001` (conflicto).

### Dónde se carga (FR-023)

El bloque **«Envío y transporte»** del comprobante es la pantalla de esos datos (se detalla en
«[Bloque «Envío y transporte»](#bloque-envío-y-transporte-fr-023)»): el selector de transporte lleva el rótulo de
la forma de envío («Transporte / expreso», «Correo» o «Mensajería propia»), con «Retiro en local» avisa que el
cliente retira en el local, y la **empresa activa** manda: al cambiarla se suelta lo elegido y se relee el envío.

## RPC (esquema `public`, `search_path = ''`, `revoke … from public, anon` + `grant execute … to authenticated`)

| Función | Qué hace |
|---------|----------|
| `obtener_despacho_comprobante(p_id)` | Estado de despacho, ids y nombres de Armó/Controló/Entregó, `entregado_en`, `updated_at` y `puede_despachar` (resuelto en la empresa del comprobante). Exige ver Ventas en la tienda. Es la lectura de la tarjeta «Responsables». |
| `listar_responsables_despacho(p_empresa_id, p_funcion)` | Elegibles para un paso (`armar`/`controlar`/`entregar`) en una tienda. Exige ver Ventas. |
| `cambiar_estado_despacho(p_id, p_estado, p_responsable_id, p_actualizado_en)` | Avanza el despacho con las reglas de arriba y registra la actividad `despacho.estado_cambiado` («Despacho: *anterior* → *nuevo* en la factura *N* (*responsable*)»). Exige `despachar` en la empresa del comprobante. |
| `private.descontar_reservas_entrega(p_comprobante_id)` | Al entregar, descuenta en la **misma transacción** las reservas activas de las líneas «A pedido» (referencia `comprobante:<id>:linea:<orden>`), con salida de stock y motivo «Entrega de producto a pedido». Todo o nada. Las líneas de stock normal no se tocan: ya se descontaron al confirmar. |
| `private.asignar_estado_despacho_inicial()` | Disparador del estado inicial al confirmar. Sin `grant` a `authenticated`. |
| `private.exigir_envio_al_entregar()` | Disparador de FR-022: rechaza pasar a `entregado` si la forma de envío exige transporte y guía y falta alguno de los dos. Sin `grant` a `authenticated`. |
| `private.rol_usuario_en_empresa` / `private.responsable_despacho_habilitado` | Ayudas internas de elegibilidad. La segunda exige, además del rol del paso, Ventas al menos en `lectura` en la empresa. Sin `grant` a `authenticated`. |
| `guardar_envio_comprobante(p_id, p_transporte_id, p_guia, p_fecha_envio, p_actualizado_en)` | Guarda transporte, guía y fecha de envío de una factura confirmada no entregada (FR-021). Exige `despachar` o Ventas en `edicion` en la empresa del comprobante; el transporte tiene que estar activo y usarse en esa tienda; bloqueo optimista; registra la actividad `despacho.envio_guardado`. Devuelve el comprobante actualizado. |

Errores: `42501` sin sesión/organización, sin `despachar` o responsable no elegible · `22023` estado o dato inválido ·
`55000` transición no permitida o factura sin estado de despacho · `P0002` comprobante inexistente · `40001`
conflicto de edición. Los mensajes de la RPC llegan en castellano y la tarjeta los muestra tal cual (los técnicos se
traducen a un texto claro).

## Pantalla (FR-010, FR-012, FR-023)

En `/ventas/comprobantes/:id`, **solo en una factura confirmada** (el despacho arranca al confirmar), aparece la
tarjeta **Responsables**:

- Chip del estado con su texto de ayuda, **Operador en solo lectura**, y **Armó / Controló / Entregó** con
  «Seleccionar». Solo es editable el campo del paso siguiente; los demás quedan en lectura con el responsable ya
  registrado.
- Acción de avance según el estado («Empezar a armar», «Reanudar el armado», «Controlar», «Entregar»), deshabilitada
  mientras no hay responsable o mientras la petición está en vuelo (el doble clic no manda dos veces).
- Carga, error con «Reintentar» y éxito con los componentes del kit.
- Si otra persona modificó el comprobante mientras lo mirabas (conflicto `40001`), la tarjeta suelta lo elegido, vuelve
  a leer el despacho y pide elegir de nuevo al responsable: el reintento manda el `updated_at` nuevo y no falla otra
  vez por lo mismo.
- Si la factura todavía no tiene estado de despacho (una factura confirmada antes de esta migración), la tarjeta avisa
  «Esta factura todavía no entró al despacho.» y no ofrece ninguna acción.
- Sin la acción `despachar` se ve el estado y los responsables, pero no se puede avanzar (`puede_despachar`).
- **Empresa activa (Principio VIII):** al cambiar de tienda, la tarjeta suelta lo elegido, muestra el aviso y relee
  el despacho; la pantalla se cierra con aviso si la nueva tienda no es la del comprobante. El aviso se muestra en
  el listado de comprobantes, que es el destino del cierre. Nunca se guarda un responsable bajo otra tienda.
  «Última petición gana»: una respuesta vieja de otra tienda no pisa la nueva.

Decisiones anotadas en el PR: el texto de «Entregado» se adapta a esta épica (el stock normal ya se descontó al
confirmar y al entregar solo se descuentan las reservas «A pedido»); la tarjeta no es un diálogo y se desmonta al
cerrar el comprobante.

### Bloque «Envío y transporte» (FR-023)

En la misma factura confirmada, antes de la tarjeta **Responsables**, aparece el bloque **Envío y transporte**
(`apps/web/src/components/ventas/EnvioTransporte.tsx`):

- El **selector de transporte** lleva el rótulo de la forma de envío: «Transporte / expreso» (expreso y terminal),
  «Correo» (correo) o «Mensajería propia» (moto). Con la forma «Retiro en local» no hay selector: el bloque dice
  «El cliente retira en el local. No hace falta transporte ni guía.»
- Debajo, los campos **Guía** (texto de hasta 100 caracteres) y **Fecha de envío**. Con «Guardar envío» se mandan
  transporte, guía y fecha a `guardar_envio_comprobante` (el `updated_at` leído al abrir va como bloqueo optimista).
- Solo se ofrecen los **transportes elegibles**: los que se usan en la tienda del comprobante, los **activos** y los
  del tipo que corresponde a la forma de envío (Decisión abierta 8). Un transporte desactivado que ya está cargado se
  muestra, pero no se puede elegir.
- Si la forma de envío **exige** transporte y guía y falta alguno, el bloque avisa **qué falta** («Falta la guía: con
  esta forma de envío la factura no se puede entregar.»). La base lo exige al entregar (FR-022); el aviso adelanta
  el problema.
- Sin la acción `despachar` y sin Ventas en `edicion` en esa tienda, el bloque se ve pero no se puede cargar.
- Si la factura no tiene forma de envío, el bloque avisa que falta («Esta factura todavía no tiene forma de envío:
  sin ella no se puede cargar el transporte ni la guía.»). La elección de la forma de envío es de MSF-159 (FR-005).
- **Empresa activa (Principio VIII):** al cambiar de tienda el bloque suelta lo elegido, muestra el aviso y relee el
  envío; nunca se guarda un envío de una tienda bajo otra. Después de guardar, la pantalla recarga el comprobante
  (su `updated_at` avanzó) para que la cabecera no se guarde con un valor viejo.

## Pruebas

- pgTAP: `supabase/tests/database/despacho_columnas_estado.test.sql` (FR-001: las cinco columnas, el `check` de los
  cinco estados, que solo las facturas tengan estado de despacho, el índice y `anon` sin acceso; FR-002: estado inicial
  según la forma de envío y `sin_armar` cuando no resuelve; FR-008: la acción `despachar` sembrada para
  Administrador y Depósito), `supabase/tests/database/despacho_estados.test.sql` (SC-001: estado inicial,
  transiciones, roles, Administrador, `40001`, `lectura` sin `despachar`, `anon`, otra organización; el permiso
  `despachar` resuelto en la empresa del comprobante; la lectura del despacho con `obtener_despacho_comprobante`
  —con Ventas en lectura se ve el estado y los responsables y sin `despachar` no se puede avanzar—; y los permisos de
  ejecución: las RPC son de `authenticated`, `anon` no las ejecuta y las ayudas de `private` no las ejecuta nadie
  del navegador) y `supabase/tests/database/despacho_entrega.test.sql`
  (SC-002: reservas «A pedido», todo o nada, reintento idempotente, stock normal intacto, presupuesto rechazado)
  (`pnpm test:db`).
- Vitest: `apps/web/src/components/ventas/ResponsablesDespacho.test.tsx` (SC-003: carga, selectores, acciones por
  estado, errores del servidor —incluidos el conflicto de concurrencia `40001` y el comprobante inexistente
  `P0002`—, `lectura`, doble clic, cambio de empresa) y
  `apps/web/src/pages/ventas/comprobante.despacho.test.tsx` (integración en el comprobante y cierre con aviso)
  (`pnpm --filter @platform/web test ResponsablesDespacho comprobante.despacho`).
- pgTAP de F-VTA-16: `supabase/tests/database/envio_transporte.test.sql` (verifica **FR-020** —columnas, FK
  compuesta a `dominio.transportes` y límite de 100 caracteres de la guía— y **FR-021** —transporte inactivo, de
  otra tienda o de otra organización rechazados; permiso `despachar` o Ventas en `edicion` en la empresa del
  comprobante; bloqueo optimista `40001`; idempotencia; presupuesto, borrador y factura entregada rechazados;
  aislamiento por organización y por empresa; `anon` sin acceso—; y **FR-022** —el disparador de entrega: sin
  transporte ni guía no se entrega y el error dice qué falta, con transporte pero sin guía tampoco, con la guía pero
  sin transporte tampoco (y una guía en blanco es una guía ausente), «Retiro en local» se entrega sin ellos, el
  rechazo no descuenta la reserva «A pedido» (todo o nada), sin la acción `despachar` no se entrega, otra
  organización no toca la factura y ni una escritura directa entrega sin envío—).
- Vitest de F-VTA-16: `apps/web/src/lib/ventasEnvio.test.ts` (los rótulos por tipo de forma de envío, los
  transportes elegibles por tipo —Decisión abierta 8—, el envío ya cargado, los parámetros que van a
  `guardar_envio_comprobante`, el límite de la guía y los mensajes de error) (`pnpm --filter @platform/web test
  ventasEnvio`) y `apps/web/src/components/ventas/EnvioTransporte.test.tsx` (SC-005, **FR-023**: el rótulo del
  selector por forma de envío —«Transporte / expreso», «Correo» y «Mensajería propia»—, «Retiro en local» sin
  selector, los transportes que se pueden elegir y el desactivado que ya está cargado, el aviso de qué falta, el
  guardado con el bloqueo optimista, la guía de más de 100 caracteres, el doble clic, los errores de la base
  —incluidos el conflicto `40001`—, el rol en `lectura` y el cambio de empresa activa con la respuesta vieja que no
  pisa la nueva) (`pnpm --filter @platform/web test EnvioTransporte`).

## Reversión

Migraciones **aditivas** (no se destruye nada que esta historia cree en el mismo PR). Para volver atrás, en una
migración posterior:

1. `drop trigger comprobantes_venta_estado_despacho_inicial` y `drop function private.asignar_estado_despacho_inicial()`.
2. `drop function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz)`,
   `public.obtener_despacho_comprobante(uuid)`, `private.descontar_reservas_entrega(uuid)`,
   `private.etiqueta_estado_despacho(text)`, `public.listar_responsables_despacho(uuid, text)` y las ayudas
   `private.responsable_despacho_habilitado`, `private.rol_usuario_en_empresa` y `private.puede_despachar_en_empresa`.
   Para revertir solo la regla de acceso sin borrar el despacho, reaplicar la definición de
   `private.responsable_despacho_habilitado` de `20261214100400_despacho_responsables.sql` (sin el nivel de Ventas);
   para volver al permiso por empresa activa, reaplicar las RPC de `20261214100500_despacho_cambiar_estado.sql`.
3. `delete from public.permisos_rol_accion where accion = 'despachar'`, restaurar el check de acciones y las
   definiciones previas de `private.matriz_acciones_iniciales()` y `private.puede_accion`.
4. `drop index comprobantes_venta_despacho_idx` y las columnas `estado_despacho`, `armo_id`, `controlo_id`,
   `entrego_id`, `entregado_en` (con sus checks).
5. `drop function public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz)` (de
   `20261214110200_envio_guardar.sql`) y las columnas `transporte_id`, `guia`, `fecha_envio` con su check y su FK
   compuesta a `dominio.transportes` (de `20261214110100_envio_columnas.sql`).
6. `drop trigger comprobantes_venta_exige_envio_al_entregar` y `drop function private.exigir_envio_al_entregar()`
   (de `20261214110300_envio_exige_al_entregar.sql`): sin este disparador se puede entregar sin transporte ni guía.

Los despachos ya hechos **no se deshacen solos**: exportar los responsables y los envíos (transporte, guía y fecha)
antes de borrar las columnas y, si hubo entregas, corregir el stock desde Stock (la entrega ya descontó las
reservas «A pedido»).
