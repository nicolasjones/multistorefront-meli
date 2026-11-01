# Ventas · Despacho: armado, control y entrega (F-VTA-15, F-VTA-16, F-VTA-17)

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
  tiene acceso. El **privilegio de lectura** sí es por columna desde `20270112140500_envio_aislamiento.sql` (F-VTA-16,
  ver «Transporte y guía»): las tres columnas del envío quedan sin lectura directa para `authenticated`.

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
aditiva `20270112100600_despacho_responsables_acceso_ventas.sql`.

## Acción `despachar` (FR-008)

Nueva acción `despachar` de la sección `ventas` en `public.permisos_rol_accion`:

- Amplía el check de acciones y la siembra inicial de `private.matriz_acciones_iniciales()`: **Administrador y
  Depósito en `true`**, el resto en `false`. Las organizaciones existentes reciben sus filas en la migración.
- `private.puede_accion` la exige **con Ventas al menos en `lectura`**: Depósito despacha aunque no tenga `edicion`.
  Es la respuesta a la decisión abierta 7 de la spec.
- El permiso se resuelve **en la empresa del comprobante**, no en la empresa activa: `private.puede_despachar_en_empresa`
  (migración `20270112100700`) usa el rol que la persona tiene en esa tienda. Tener `despachar` en la tienda activa no
  habilita facturas de otra tienda, y el `puede_despachar` de la tarjeta usa la misma regla.
- Editar `despachar` desde la pantalla de Roles queda fuera de esta historia (mismo criterio que `editar_precio`).
  Si otro rol debe entregar, se le da la acción en la matriz: no hace falta migración.

## Transporte y guía (FR-020, FR-021, FR-022, FR-023)

La factura que sale con transporte lo registra con su guía y fecha de envío. Los datos viven en la propia
factura (`dominio`), no en una tabla nueva:

- **Esquema `dominio`** (Principio VII): `dominio.comprobantes_venta` recibe, de forma aditiva, `transporte_id`
  (FK **compuesta** a `dominio.transportes (id, organizacion_id)`: el transporte tiene que ser de la misma
  organización), `guia` (texto ≤ 100 caracteres) y `fecha_envio` (date). Lo agrega
  `20270112140100_envio_columnas.sql` (alter aditiva, reversión en el encabezado).
- La RLS vigente no cambia: se lee por organización y sección `ventas`. Como las secciones por empresa se
  resuelven contra la **empresa activa**, la lectura del envío **no va contra la tabla**: va por la RPC
  `security definer` `obtener_envio_comprobante` (`20270112140400_envio_leer.sql`), que resuelve el permiso en la
  **empresa del comprobante**. Sin eso, una persona con Ventas en lectura en la tienda A podía leer el envío
  (transporte, guía y fecha) de un comprobante de la tienda B de la misma organización con solo pasarle el id
  (BOLA entre tiendas). Filtrar por `empresa_id` en el navegador no cerraba el hueco: ese parámetro también lo
  elige quien llama. **No hay grants de escritura nuevos**: el envío se escribe solo por la RPC `security definer`
  `guardar_envio_comprobante` (`20270112140200_envio_guardar.sql`). `anon` no tiene acceso.
- **La tabla tampoco deja leer el envío directo** (`20270112140500_envio_aislamiento.sql`): el privilegio de
  lectura de `dominio.comprobantes_venta` es **por columna**, no de tabla. Las tres columnas del envío
  (`transporte_id`, `guia`, `fecha_envio`) quedan **sin privilegio** para `authenticated`, así que ni la app ni una
  llamada directa a PostgREST las leen: la única lectura del envío es la RPC, que resuelve el permiso en la
  empresa del comprobante. Las demás columnas de la factura se leen igual que antes, con la misma RLS. Es el mismo
  patrón del repo para esconder columnas sensibles (`public.cola_eventos`, `public.conexiones_oauth`).
  - Consecuencia para las historias siguientes: **una columna nueva de `dominio.comprobantes_venta` no es legible
    por `authenticated` hasta que una migración la conceda**. El pgTAP de F-VTA-16 avisa si queda alguna sin
    conceder, así que el desvío se ve en el CI y no en producción.
- Los transportes salen del catálogo de MSF-139 (`dominio.transportes` + `dominio.transportes_empresas`, «Empresas
  donde se usa»): un transporte no usado en la tienda del comprobante no se puede elegir.

### Reglas de `guardar_envio_comprobante(p_id, p_transporte_id, p_guia, p_fecha_envio, p_actualizado_en)`

| Regla | Qué pasa |
|-------|----------|
| Factura viva (no borrador, pendiente ni anulada) no entregada | Un presupuesto, un borrador o una factura ya entregada no registran envío (`22023` / `55000`) |
| Transporte activo y de la tienda | Inactivo, de otra organización o de otra tienda → se rechaza (`22023`) |
| Permiso | La acción `despachar` **o** Ventas en `edicion`, resueltos en la **empresa del comprobante** (no en la empresa activa) (`42501`) |
| Bloqueo optimista | `p_actualizado_en` desactualizado → `40001` |
| Idempotencia | Guardar lo mismo no escribe otra vez ni rompe el bloqueo de quien lo está mirando |
| Guía | Texto de hasta 100 caracteres; en blanco = sin guía (`22023`) |
| Fecha de envío | Si no viene, se toma la de hoy: el día de **Argentina** (`private.hoy_argentina()`), no el del servidor (que corre en UTC y entre las 21:00 y las 23:59 de Argentina ya es el día siguiente) |
| Auditoría | Actividad `despacho.envio_guardado` («Envío: transporte X, guía Y, fecha Z en la factura N») |

**Dónde se exige el transporte y la guía**: al **entregar**, no al guardar. La forma de envío
(`dominio.formas_envio.exige_transporte_guia`) es la que exige transporte y guía, y esa comprobación vive en el
cambio de estado a `entregado` (FR-022). Guardar el envío es guardar el dato; el «no se puede entregar sin guía» se
resuelve al entregar.

### La exigencia al entregar (FR-022)

`20270112140300_envio_exige_al_entregar.sql` agrega el disparador
`comprobantes_venta_exige_envio_al_entregar` (`before update of estado_despacho` sobre
`dominio.comprobantes_venta`, función `private.exigir_envio_al_entregar`):

| Regla | Qué pasa |
|-------|----------|
| Forma que exige transporte y guía | Al pasar a `entregado` sin transporte o sin guía, la escritura se rechaza (`22023`) y el mensaje dice **qué falta**: «Una factura con la forma de envío «Expreso» no se puede entregar: falta el transporte» |
| Forma «Retiro en local» | Se entrega sin transporte ni guía: **manda el tipo de la forma**, no la casilla de exigencia. Aunque la forma venga con `exige_transporte_guia` marcado (así queda si se crea desde el diálogo sin desmarcar la casilla, porque cambiar el tipo no la desmarca), no exige nada: la pantalla de ese tipo no muestra los campos de transporte ni de guía, así que exigirlos dejaría la factura sin poder entregar nunca |
| Forma que NO lo exige (las demás) | Se entrega sin transporte ni guía |
| Sin forma de envío | No hay exigencia (mismo criterio que el estado inicial) |
| Guía en blanco | Es una guía ausente (se normaliza igual que en `guardar_envio_comprobante`) |

El mensaje arranca con **«Una factura»** a propósito: el panel muestra el mensaje de la base tal cual y solo
reconoce los prefijos de su lista blanca (`apps/web/src/lib/ventasDespacho.ts`), así que con otro prefijo la
persona vería un error genérico y no sabría qué falta. El pgTAP lo fija (`^Una factura `).

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
| `guardar_envio_comprobante(p_id, p_transporte_id, p_guia, p_fecha_envio, p_actualizado_en)` | Guarda transporte, guía y fecha de envío de una factura viva (confirmada, aceptada, en proceso, armando, incompleta, cobrada o deuda; MSF-598) no entregada (FR-021). Exige `despachar` o Ventas en `edicion` en la empresa del comprobante; el transporte tiene que estar activo y usarse en esa tienda; bloqueo optimista; registra la actividad `despacho.envio_guardado`. Devuelve el comprobante actualizado. |
| `obtener_envio_comprobante(p_id)` | Lee el transporte, la guía, la fecha de envío y el `updated_at` (el bloqueo optimista del guardado). Exige Ventas en `lectura` o `edicion` en la **empresa del comprobante** (`42501`): el envío de una factura de otra tienda no se lee, aunque la RLS de la tabla lo permita (ésta resuelve las secciones contra la empresa activa). Es la **única** lectura del envío: las columnas `transporte_id`, `guia` y `fecha_envio` no tienen privilegio de lectura para `authenticated` (`20270112140500_envio_aislamiento.sql`). |

Errores: `42501` sin sesión/organización, sin `despachar` o responsable no elegible · `22023` estado o dato inválido ·
`55000` transición no permitida o factura sin estado de despacho · `P0002` comprobante inexistente · `40001`
conflicto de edición. Los mensajes de la RPC llegan en castellano y la tarjeta los muestra tal cual (los técnicos se
traducen a un texto claro).

## Pantalla (FR-010, FR-012, FR-023)

En `/ventas/comprobantes/:id`, **en una factura viva** (confirmada, aceptada, en proceso, armando, incompleta, cobrada o en deuda; MSF-598: el despacho es independiente del cobro), aparece la
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

En la misma factura, antes de la tarjeta **Responsables**, aparece el bloque **Envío y transporte**
(`apps/web/src/components/ventas/EnvioTransporte.tsx`):

- El **selector de transporte** lleva el rótulo de la forma de envío: «Transporte / expreso» (expreso y terminal),
  «Correo» (correo) o «Mensajería propia» (moto). Con la forma «Retiro en local» no hay selector: el bloque dice
  «El cliente retira en el local. No hace falta transporte ni guía.»
- Debajo, los campos **Guía** (texto de hasta 100 caracteres) y **Fecha de envío**. Con «Guardar envío» se mandan
  transporte, guía y fecha a `guardar_envio_comprobante` (el `updated_at` leído al abrir va como bloqueo optimista).
- El aviso «Envío guardado.» sale cuando la base confirma el guardado y **desaparece en cuanto se edita la guía**:
  si la nueva no entra (más de 100 caracteres), el campo avisa el problema y no queda un «guardado» al lado del error.
- El aviso también se limpia **al empezar cada intento de guardado** (antes de que la base conteste): si el
  guardado falla, el error queda solo y no convive con un «Envío guardado.» de un intento anterior.
- Solo se ofrecen los **transportes elegibles**: los que se usan en la tienda del comprobante, los **activos** y los
  del tipo que corresponde a la forma de envío (Decisión abierta 8). Un transporte desactivado que ya está cargado se
  muestra, pero no se puede elegir.
- El transporte **ya cargado en la factura** se muestra siempre, aunque hoy no se pueda elegir, y el motivo queda a
  la vista: «(desactivado)», «(no corresponde a esta forma de envío)» o «(no se usa en esta tienda)». Este último caso
  aparece cuando en Transportes se le quitó la tienda al transporte (MSF-139) sin tocar los comprobantes que lo usan:
  el selector no queda en blanco ni hace creer que la factura no tiene transporte (se lee por id, porque el catálogo
  de la tienda ya no lo trae).
- En una factura **entregada** el bloque es de solo lectura y avisa «Esta factura ya fue entregada: no se puede
  cambiar el envío.»: la base rechaza siempre cualquier cambio de envío (`55000`), así que no se ofrece la acción
  ni se dejan los campos editables.
- El bloque **espera al estado del despacho** antes de ofrecer el envío (lo lee `obtener_despacho_comprobante`):
  mientras no se sabe si la factura ya fue entregada, queda en carga y no ofrece «Guardar envío». Si la factura
  **todavía no entró al despacho**, avisa «Esta factura todavía no entró al despacho.» y tampoco lo ofrece (la base
  rechaza ese envío con `55000`). Si la lectura falla, el bloque se ve igual y la base vuelve a validar al guardar.
- Si la forma de envío **exige** transporte y guía y falta alguno, el bloque avisa **qué falta** («Falta la guía: con
  esta forma de envío la factura no se puede entregar.»). La base lo exige al entregar (FR-022); el aviso adelanta
  el problema.
- Sin la acción `despachar` y sin Ventas en `edicion` en esa tienda, el bloque se ve pero no se puede cargar.
- Si la factura no tiene forma de envío, el bloque avisa que falta («Esta factura todavía no tiene forma de envío:
  sin ella no se puede cargar el transporte ni la guía.»). La elección de la forma de envío es de MSF-159 (FR-005).
- **Empresa activa (Principio VIII):** al cambiar de tienda el bloque suelta lo elegido, muestra el aviso y relee el
  envío; nunca se guarda un envío de una tienda bajo otra. Después de guardar, la pantalla recarga el comprobante
  (su `updated_at` avanzó) para que la cabecera no se guarde con un valor viejo.

## Tablero (F-VTA-17, FR-030…FR-033)

La pantalla **Despacho** (`/ventas/despacho`, grupo **Ventas** del menú, icono `LocalShippingIcon`, sección `ventas`,
lectura o edición) lista las facturas por armar, controlar y entregar. **No hay artboard** en `design/pantallas/`: la
decisión (spec, *Decisiones abiertas* 4) es construirla con el kit —`EncabezadoPagina`, `BarraHerramientas`,
`ContenidoAdaptable`, `FiltroEmpresa` y los estados de carga/vacío/error— sin inventar un diseño propio; si más
adelante se dibuja el artboard, se actualiza la matriz de la spec. Es de **solo lectura**: avanzar el despacho se sigue
haciendo en la tarjeta «Responsables» del comprobante, y cada fila abre el comprobante (el número es un enlace).

- **Columnas:** Comprobante, Tienda, Fecha, Cliente, Estado (chip), Responsables (Armó / Controló / Entregó, «—» si
  ese paso no se dio) y Transporte y guía (transporte, guía y fecha de envío; «—» sin transporte). En pantallas
  angostas se ven tarjetas con los mismos datos.
- **Filtros:** «Buscar por cliente o número» (espera 300 ms a que se deje de tipear), píldoras de estado con su conteo
  («Todos (N)», «Sin armar (N)», «Armando (N)», «Incompleto (N)», «Listo para despachar (N)», «Entregado (N)»),
  «Limpiar filtros» y `FiltroEmpresa`. Paginación de 10 en el servidor.
- **Estados:** carga, vacío «Sin resultados» (distingue «sin filtros» de «probá con otra búsqueda») y error con
  «Reintentar».
- **Empresa activa (Principio VIII, FR-033):** el filtro de tienda sigue a la empresa activa de la barra superior. Al
  cambiarla se descartan filas, total y conteos de la anterior (cada lectura queda atada a su ámbito organización +
  tienda; una respuesta vieja no pisa a la nueva), se recarga y la paginación vuelve a la primera página con una sola
  consulta.

### `listar_despacho(p_busqueda, p_estado, p_empresa_id, p_pagina, p_tamano)` (FR-030)

`security definer`, `stable`, `search_path = ''`; `revoke … from public, anon` y `grant execute … to authenticated`
(`20270112150000_despacho_listar.sql`). Sin tablas nuevas (esquema `dominio` existente; solo se agrega el índice
parcial `comprobantes_venta_despacho_listado_idx`).

- Entran las **facturas** con `estado_despacho` (vivas: confirmada, aceptada, en proceso, armando, incompleto, cobrada o deuda; MSF-598) y `estado <> 'anulada'`: los borradores, presupuestos,
  notas de crédito y anuladas quedan fuera.
- Solo de las empresas donde la persona tiene Ventas en `lectura` o `edicion` **en esa empresa**
  (`private.nivel_ventas_en_empresa`); una tienda ajena o sin Ventas (`ninguno`) devuelve cero filas, no un error. La
  organización y el actor salen de la sesión.
- Búsqueda sin mayúsculas ni tildes y con el texto literal (se escapan `\ % _`), como `listar_comprobantes`.
- `puede_despachar` por fila: la acción `despachar` resuelta en la empresa de la factura
  (`private.puede_despachar_en_empresa`), no en la activa.
- `conteos` (jsonb `{estado: cantidad}`) cuenta dentro de la tienda y la búsqueda **sin** el filtro de estado. Si la
  página queda sin filas, devuelve **una** fila con `id` nulo que lleva `filas = 0` y los `conteos`: la pantalla
  conserva las píldoras y muestra «Sin resultados». `lib/ventasDespachoLista.ts` descarta esa fila.
- Errores: `42501` sin sesión con organización · `22023` estado desconocido. Orden: fecha, número e id descendente.

Pruebas: pgTAP `supabase/tests/database/despacho_listar.test.sql` (SC-006: qué entra y qué no, datos de la fila,
conteos, filtros, búsqueda literal, paginación, aislamiento por empresa y organización, `ninguno` y `anon`) y Vitest
`apps/web/src/pages/ventas/despacho.test.tsx` (SC-007: columnas, filtros, conteos, vacío/error, solo lectura, ruta
protegida por `ventas` y cambio de empresa) más la entrada de menú en `destinosPanel.permisos.test.ts`
(`pnpm test:db`, `pnpm --filter @platform/web test despacho`).

Reversión (migración posterior): `drop function public.listar_despacho(text, text, uuid, integer, integer);` y
`drop index if exists dominio.comprobantes_venta_despacho_listado_idx;`.

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
  aislamiento por organización y por empresa; `anon` sin acceso; la fecha de envío que no viene es el día de
  Argentina—; y **FR-022** —el disparador de entrega: sin
  transporte ni guía no se entrega y el error dice qué falta, con transporte pero sin guía tampoco, con la guía pero
  sin transporte tampoco (y una guía en blanco es una guía ausente), el mensaje del rechazo arranca con el prefijo
  que el panel muestra tal cual, «Retiro en local» se entrega sin ellos —también cuando la casilla de exigencia
  viene marcada, porque manda el tipo de la forma—, una factura sin forma de envío también,
  el rechazo no descuenta la reserva «A pedido» (todo o nada), sin la acción `despachar` no se entrega, otra
  organización no toca la factura y ni una escritura directa entrega sin envío—; y la **lectura**: con
  `obtener_envio_comprobante` se lee el envío de una factura de la tienda propia y NO el de otra tienda de la misma
  organización —la RLS de la tabla resuelve las secciones contra la empresa activa—, otra organización no lo lee, un
  comprobante inexistente da `P0002` y `anon` no ejecuta la RPC; y el **aislamiento de la tabla**: las tres
  columnas del envío no tienen privilegio de lectura para `authenticated` (leerlas directo de la tabla falla con
  `42501`), las demás columnas de la factura sí se leen, y ninguna columna quedó sin conceder).
- Vitest de F-VTA-16: `apps/web/src/lib/ventasEnvio.test.ts` (los rótulos por tipo de forma de envío, los
  transportes elegibles por tipo —Decisión abierta 8—, el envío ya cargado leído **por la RPC**
  `obtener_envio_comprobante` —y no contra la tabla—, la lectura del transporte cargado por id
  cuando el catálogo de la tienda no lo trae, los parámetros que van a `guardar_envio_comprobante`, el límite de la
  guía y los mensajes de error) (`pnpm --filter @platform/web test ventasEnvio`) y
  `apps/web/src/components/ventas/EnvioTransporte.test.tsx` (SC-005, **FR-023**: el rótulo del
  selector por forma de envío —«Transporte / expreso», «Correo» y «Mensajería propia»—, «Retiro en local» sin
  selector, los transportes que se pueden elegir, el desactivado que ya está cargado y el que no corresponde a la
  forma de envío, el transporte que ya no se usa en la tienda, el aviso de qué falta —los dos, el transporte o la
  guía—, el guardado con el bloqueo optimista, la guía de más de 100 caracteres (que no se guarda y deja fuera el
  aviso de éxito de un guardado anterior),
  el doble clic, los errores de la base —incluidos el conflicto `40001`—, el rol en `lectura`, la factura entregada (sin
  «Guardar envío» y con los campos deshabilitados) y el cambio de empresa activa con la respuesta vieja que no
  pisa la nueva) (`pnpm --filter @platform/web test EnvioTransporte`).
- Vitest de página de F-VTA-16: `apps/web/src/pages/ventas/comprobante.envio.test.tsx` (la compuerta del bloque: en
  una factura confirmada aparece la región «Envío y transporte» y en un borrador o en un presupuesto no; al cambiar
  de tienda el comprobante se cierra con aviso y el bloque no queda con datos de la tienda anterior; y el lado del
  panel de FR-022: al entregar sin el envío guardado, el mensaje de la base —que dice qué falta— llega a la persona
  y no como un error genérico) (`pnpm --filter @platform/web test comprobante.envio`).

## Revisión de seguridad de la épica (cierre, T039)

Revisadas las migraciones `20270112100100`…`20270112150000` (despacho, faltantes, envío, tablero):

- **`anon`**: ninguna RPC de despacho/faltantes/envío es ejecutable por `anon` (todas `revoke … from public, anon` y
  `grant execute … to authenticated`); las funciones `private.*` internas se revocan también a `authenticated`.
  `dominio.faltantes_venta` se crea con `revoke all … from public, anon, authenticated` y `grant select` solo a `authenticated`.
- **`security definer`**: todas las funciones llevan `set search_path = ''` y objetos calificados.
- **RLS y escritura**: `dominio.faltantes_venta` (esquema `dominio`, entidad del producto — Principio VII) tiene RLS por
  empresa; sin políticas ni grants de INSERT/UPDATE/DELETE: se escribe solo por RPC. `dominio.comprobantes_venta` no gana
  escritura directa (estado, responsables y envío solo por RPC).
- **Acción `despachar`**: se resuelve en la empresa del comprobante (`private.puede_despachar_en_empresa`), no en la empresa activa.
- **Secretos y criptografía**: no aplica (sin claves, tokens ni cifrado nuevos).

## Reversión

Migraciones **aditivas** (no se destruye nada que esta historia cree en el mismo PR). Para volver atrás, en una
migración posterior:

1. `drop trigger comprobantes_venta_estado_despacho_inicial` y `drop function private.asignar_estado_despacho_inicial()`.
2. `drop function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz)`,
   `public.obtener_despacho_comprobante(uuid)`, `private.descontar_reservas_entrega(uuid)`,
   `private.etiqueta_estado_despacho(text)`, `public.listar_responsables_despacho(uuid, text)` y las ayudas
   `private.responsable_despacho_habilitado`, `private.rol_usuario_en_empresa` y `private.puede_despachar_en_empresa`.
   Para revertir solo la regla de acceso sin borrar el despacho, reaplicar la definición de
   `private.responsable_despacho_habilitado` de `20270112100400_despacho_responsables.sql` (sin el nivel de Ventas);
   para volver al permiso por empresa activa, reaplicar las RPC de `20270112100500_despacho_cambiar_estado.sql`.
3. `delete from public.permisos_rol_accion where accion = 'despachar'`, restaurar el check de acciones y las
   definiciones previas de `private.matriz_acciones_iniciales()` y `private.puede_accion`.
4. `drop index comprobantes_venta_despacho_idx` y las columnas `estado_despacho`, `armo_id`, `controlo_id`,
   `entrego_id`, `entregado_en` (con sus checks).
5. `drop function public.guardar_envio_comprobante(uuid, uuid, text, date, timestamptz)` (de
   `20270112140200_envio_guardar.sql`) y las columnas `transporte_id`, `guia`, `fecha_envio` con su check y su FK
   compuesta a `dominio.transportes` (de `20270112140100_envio_columnas.sql`).
6. `drop trigger comprobantes_venta_exige_envio_al_entregar` y `drop function private.exigir_envio_al_entregar()`
   (de `20270112140300_envio_exige_al_entregar.sql`): sin este disparador se puede entregar sin transporte ni guía.
7. `drop function public.obtener_envio_comprobante(uuid)` (de `20270112140400_envio_leer.sql`): sin esta RPC la
   lectura del envío vuelve a depender de la RLS de la tabla, que resuelve las secciones contra la empresa activa.
8. `grant select on table dominio.comprobantes_venta to authenticated` (de `20270112140500_envio_aislamiento.sql`):
   vuelve el privilegio de lectura de la factura a nivel de tabla (y con él, la lectura directa de las columnas
   del envío).

Los despachos ya hechos **no se deshacen solos**: exportar los responsables y los envíos (transporte, guía y fecha)
antes de borrar las columnas y, si hubo entregas, corregir el stock desde Stock (la entrega ya descontó las
reservas «A pedido»).
