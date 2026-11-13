# Feature Specification: Tiendas online · Tienda compra y cuentas (lista de pedido, presupuesto y «Mi cuenta»)

**Épica**: MSF-176 · **Spec**: `tienda-compra-y-cuentas` · **Historias**: F-CLI-20 (MSF-452; absorbe F-CON-07 y F-TDA-27, ya archivadas) y dos historias nuevas, «Lista de pedido sin cobro» y «Presupuesto desde la tienda» (claves por asignar en el tracker) · **Prioridad**: P3 (alcance aprobado por Nicolás el 2026-11-13)
**Alcance de entrega**: `refine`, `supabase` (sin `kestra`, `superset` ni `workers`: todo se resuelve con consultas en vivo y funciones SQL; el aviso por correo de Consultas ya existe)
**Fuente**: el alcance aprobado por Nicolás (2026-11-13), la evaluación previa `.specify/assessments/tienda-compra-y-cuentas/` y `clientes-pedidos-y-facturacion/` (rama `docs/evaluacion-msf-154-176`, commit `c4b24a46`) y el mapa del código verificado en `origin/dokploy` (2026-11-13). Modelo de estilo: `specs/20270305-100000-inicio-tablero-completo/`. Fuera de la épica heredada: el checkout (F-TDA-26 tal como estaba titulada).

## Objetivo

Al terminar, un cliente con cuenta web activa entra a **«Mi cuenta»** en la tienda, ve sus compras y presupuestos de esa tienda y guarda productos como favoritos (A); cualquier visitante arma una **lista de pedido** con cantidades y la envía sin pagar, y le llega al operador a la bandeja de Consultas **con los ítems** (B1); y el cliente con cuenta activa puede, desde esa misma lista, **pedir un presupuesto real** que queda `pendiente` en Ventas con canal `tienda_online`, calculado por el servidor y sin mover stock ni cobrar (B2). La venta se sigue cerrando (pago, envío, factura) fuera del sistema, como hoy.

## Alcance aprobado y fuera de alcance

| | |
|---|---|
| **Dentro** | (A) cuentas de clientes con «Mi cuenta», historial de compras y favoritos = F-CLI-20; (B1) lista de pedido sin cobro que llega a Consultas como consulta con ítems; (B2) presupuesto real creado desde la tienda para un cliente con cuenta activa (comprobante `presupuesto`, estado `pendiente`, canal `tienda_online`). |
| **Fuera** | Checkout y pagos en línea; envíos con cotización; facturación fiscal / ARCA; auto-registro de clientes; Mercado Libre; carrito persistente entre dispositivos; cupones y promociones dentro de la lista; reserva o descuento de stock desde la tienda; exponer cantidades exactas de stock (decisión previa: la tienda solo muestra «Disponible / Sin stock»); recuperación de contraseña y acceso (son de F-CLI-05 y F-CLI-06, ya entregadas); correo o notificación al cliente de que su pedido avanzó (la respuesta se da fuera del sistema); botón «Crear presupuesto desde la consulta» en el panel (D-14). |

## Modelo y supuestos (verificados en el código)

- **Cuenta web existente.** `public.cuentas_cliente` (una fila por cliente y tienda; estados `activa|suspendida`), identidad de Supabase Auth que **no** es miembro del panel (`private.organizacion_id()` es nulo para ella). `publico.acceso_cliente_por_dominio(host)` da el estado efectivo (`activa|suspendida|sin_cuenta|no_habilitado`) consultado en cada llamada, de modo que la suspensión rige al instante. Un usuario de Auth pertenece a un solo cliente (D1 de la cuenta web). Alta **solo por invitación** (D2); esta épica no la cambia.
- **Superficie pública.** Todo lo que ve o hace un visitante son funciones `publico.*` `security definer`, `search_path = ''`, sin tablas, con la empresa derivada **solo del `Host`** (`dominio.tiendas`); host desconocido y empresa desactivada responden lo mismo. `dominio` y `publico` están expuestos por PostgREST (`supabase/config.toml`), así que el control real es `revoke`/`grant` explícito y RLS, no «que nadie conozca la ruta».
- **Anti-spam existente.** `private.registrar_envio_tienda(empresa, origen, clave)`: tope de 5 envíos por hora por (empresa, hash de IP) con `pg_advisory_xact_lock`, idempotencia por `clave_envio` única y poda a 24 h (`dominio.tienda_envios`). `publico.crear_consulta_publica` quedó **solo interna** (sin `execute` para `anon` ni `authenticated`; migración `20261212120800`): el alta pública pasa por `enviar_consulta_contacto` o `registrar_consulta_whatsapp`, que aplican el límite.
- **Consultas hoy.** `dominio.consultas` (origen `formulario|whatsapp`, un solo `producto_id`, sin cantidades) y su bandeja (`public.consultas_bandeja`, estados `nueva|en_curso|resuelta`, aviso por correo con un trigger que encola). Es **solo un registro**: el panel no responde por el visitante.
- **Comprobantes hoy.** `public.crear_comprobante` y `public.guardar_lineas_comprobante` exigen sesión de panel (`private.organizacion_id()` y `auth.uid()`); `private.precio_para` es `security invoker` y devuelve vacío sin permiso de panel; la numeración (`private.siguiente_numero_comprobante`) también toma la organización de la sesión. El canal `tienda_online` ya es válido (`comprobantes_venta_canal_ck`); `operador_id` admite nulo. `aceptar_presupuesto` **no reserva ni descuenta stock** (FR-050 de Ventas): ese flujo del operador no cambia.
- **Precios.** Las líneas guardan una copia (descripción, código, precio, escala, alícuota) calculada **por el servidor** (`escala_para_linea`: minorista x1; mayorista x1/x5/x10/x50) más el descuento de la ficha del cliente. La tienda ya calcula el precio por escala de la cuenta activa con `private.precio_final_publico_escala` (`publico.precios_cliente_por_dominio`, tope 50 productos por llamada).
- **Coordinación con MSF-816** (precio promocional en comprobantes, spec lista sin código): propone `private.precio_linea_venta` como **única** función de precio de línea. Si al implementar B2 ya existe, B2 la reutiliza; si no, B2 trae su propio cálculo con una prueba de **paridad** contra `guardar_lineas_comprobante` y MSF-816 lo absorbe después (D-17).
- **No hay pantallas dibujadas** en el prototipo para «Mi cuenta», la lista de pedido ni la confirmación; se construyen con los componentes del template y el sistema de diseño (MSF-117), sin copiar HTML ni CSS del prototipo. Ver la matriz.
- **Carga infinita** (CLAUDE.md, Principio VI) en todos los listados nuevos, también los de «Mi cuenta» (`IntersectionObserver` + «Cargar más» por teclado); la lista de pedido es un máximo de 50 líneas y no pagina.

### Esquema de datos (Principio VII)

Cada tabla se ubica por su naturaleza; no se asume ningún esquema por defecto. Migraciones aditivas; versiones mayores que la última de `dokploy` al integrar (hoy `20270307100000`; las de esta spec van a partir de `20270308100000` y se renumeran al integrar).

| Objeto | Esquema | Historia | Justificación | Acceso (RLS y grants) |
|---|---|---|---|---|
| `dominio.favoritos_cliente` (**nueva**: `id`, `organizacion_id`, `empresa_id`, `cuenta_cliente_id`, `producto_id`, `creado_en`; única `(cuenta_cliente_id, producto_id)`) | `dominio` | A | Es dato del negocio sobre productos del catálogo (qué guardó un cliente de una tienda), no plataforma. Se ata a la cuenta (que vive en `public` por ser identidad) y al producto. FK compuestas con `organizacion_id` (una fila no puede apuntar a otra organización); `on delete cascade` desde la cuenta. | RLS **activada**; política `select` solo de la cuenta propia (defensa en profundidad); **sin ningún privilegio** para `anon`, `public` ni `authenticated` sobre la tabla: se lee y escribe únicamente por las RPC `publico.*`. |
| `dominio.consulta_items` (**nueva**: `id`, `organizacion_id`, `empresa_id`, `consulta_id`, `orden`, `producto_id`, `descripcion`, `sku`, `cantidad`, `precio_referencia`, `creado_en`) | `dominio` | B1 | Líneas de una consulta del negocio: copia de lo que vio el visitante (nombre, SKU, cantidad, precio de referencia que calculó el servidor). Hoy `dominio.consultas` tiene un solo `producto_id` sin cantidad. | RLS por organización, empresa accesible y sección `consultas` ≥ lectura (igual que `dominio.consultas`); `select` solo para `authenticated`; sin políticas ni grants de escritura; `anon` sin privilegios. Lectura del panel por la vista `public.consulta_items_bandeja` (`security_invoker`). |
| `dominio.consultas` (**alterada**: `origen` suma `pedido`; columna `cliente_id` nullable) | `dominio` | B1 | La tabla ya es de dominio y tiene RLS. `cliente_id` lo fija el servidor **solo** si hay una cuenta activa; nunca viene del llamador. FK a `public.clientes (id, organizacion_id)` (índice único existente `clientes_id_organizacion_uq`). | RLS vigente, sin cambios. `consultas_mensaje_requerido` también exime a `pedido` (la nota es opcional). |
| `dominio.tienda_envios` (**alterada**: `origen` suma `pedido` y `presupuesto`) | `dominio` | B1, B2 | Misma tabla de límite e idempotencia por visitante. | RLS vigente, sin cambios (`anon` sin privilegios). |
| `dominio.presupuestos_tienda` (**nueva**: `id`, `organizacion_id`, `empresa_id`, `cuenta_cliente_id`, `cliente_id`, `comprobante_id`, `clave_envio`, `creado_en`; únicas `(cuenta_cliente_id, clave_envio)` y `(comprobante_id)`) | `dominio` | B2 | Vínculo entre un presupuesto y la cuenta que lo pidió desde la tienda: da idempotencia, el tope diario por cuenta y la trazabilidad para el operador. Es registro de negocio atado a un comprobante de `dominio`. FK compuestas `(comprobante_id, organizacion_id)` y `(empresa_id, organizacion_id)`. | RLS por organización, empresa accesible y `ventas` ≥ lectura; `select` solo para `authenticated`; sin escritura directa; `anon` sin privilegios. |
| `private.siguiente_numero_comprobante_org(p_org, p_empresa, p_tipo)` (**nueva**) | `private` | B2 | Misma numeración atómica que la de panel, pero con la organización **explícita** (no hay sesión de panel). La existente no se toca. | Sin `execute` para `anon` ni `authenticated`; solo la llaman las funciones `security definer` del propio esquema. |
| `private.cuenta_de_tienda(p_host)` (**nueva**) | `private` | A, B1, B2 | **Un único punto de identidad y aislamiento**: devuelve `(cuenta_cliente_id, cliente_id, organizacion_id, empresa_id, tipo)` de la sesión `auth.uid()` en la tienda del host **solo** si la cuenta está `activa`, el cliente habilitado (`clientes_empresas`) y no archivado, y no es consumidor final; si no, nada. Reutiliza la misma regla que `publico.acceso_cliente_por_dominio`. | Sin `execute` para API; `security definer`, `search_path = ''`. |
| `private.motor_presupuesto_tienda(...)` y `private.validar_items_pedido(p_items)` (**nuevas**) | `private` | B1, B2 | Lógica sin datos: validación y topes de los ítems; cálculo de líneas (producto visible, escala, descuento, IVA, depósito). | Sin `execute` para API. |
| `publico.*` (ocho funciones nuevas, ver «Contratos») | `publico` | A, B1, B2 | Superficie de la tienda; `publico` sigue **sin tablas**. | `revoke … from public, anon`; `grant execute` explícito: `anon` + `authenticated` solo en las dos de visitante (`lista_pedido_por_dominio`, `enviar_lista_pedido`); el resto, **solo `authenticated`**. |
| `public.consulta_items_bandeja` (**nueva**, vista `security_invoker`) | `public` | B1 | Lectura del panel; aplica la RLS de `dominio.consulta_items`. | `select` para `authenticated`; sin `anon`. |
| `public.registro_actividad` (**sin cambios de estructura**) | `public` | B2 | Auditoría transversal; se suma el evento `presupuesto.creado_desde_tienda`. | Sin cambios. |

`rls_en_toda_tabla` (pgTAP, recorre `public` + `dominio`) debe seguir verde con las tres tablas nuevas. **Reversión** (migración posterior, nunca en el mismo PR, exportando antes los datos personales de consultas): `drop function` de cada RPC, `drop view public.consulta_items_bandeja`, `drop table dominio.presupuestos_tienda`, `drop table dominio.consulta_items`, `drop table dominio.favoritos_cliente`, `alter table dominio.consultas drop column cliente_id` y restaurar los `check` de `origen` solo si no quedan filas `pedido`/`presupuesto`. Los presupuestos ya creados son comprobantes de Ventas y se **anulan** con el flujo normal; no se borran. Tabla detallada con migraciones en `plan.md`.

## User Scenarios & Testing

Las historias se priorizan A → B1 → B2. **A** es independiente de las otras dos. **B1** es independiente de A y de B2 (usa solo Consultas y el catálogo públicos). **B2** reutiliza la pantalla «Lista» de B1 (el botón extra solo aparece con sesión activa) y la vista de presupuestos de A para que el cliente siga su estado; sin A, B2 igual se verifica por el panel de Ventas y por la confirmación con número. Cada una tiene su checkpoint en `plan.md`.

### Historia 1 — «Mi cuenta»: historial, presupuestos y favoritos (F-CLI-20 · MSF-452) · P1

Como **cliente con cuenta activa** quiero ver mis compras y presupuestos de esta tienda y guardar productos como favoritos, para volver a lo que me interesa sin repetir la búsqueda.

**Por qué P1**: es lo único de la épica que no cambia cómo se vende (riesgo bajo), reutiliza la cuenta web ya construida y cierra tres historias duplicadas (F-TDA-27, F-CON-07, F-CLI-20).

- **FR-001** El encabezado de la tienda muestra «Mi cuenta» (además de «Salir») solo con sesión de cuenta **activa** en esa tienda; sin sesión o con cuenta no activa no aparece. Ruta `/mi-cuenta`, con secciones «Compras y presupuestos» y «Favoritos» (pestañas; la sección viaja en `?seccion=`).
- **FR-002** Sin sesión, o con una cuenta que no está activa y habilitada en esta tienda, `/mi-cuenta` redirige a `/ingresar` conservando la ruta de vuelta; la respuesta del servidor es la misma en todos esos casos (no revela cuál).
- **FR-003** «Compras y presupuestos» lista, con **carga infinita** (nuevos primero; tandas de 20, tope 50 por llamada, cursor por `(fecha, id)`), los comprobantes de **ese cliente en esa tienda** (cualquier canal: mostrador, teléfono o tienda online): número, fecha, tipo (Compra / Presupuesto / Nota de crédito), estado público y **total con IVA**. Contador total visible, vacío «Todavía no tenés compras ni presupuestos en esta tienda», error con reintento.
- **FR-004** El **estado público** es simplificado y no expone el interno: presupuesto → «Pendiente», «Aceptado», «Vencido» (derivado de `valido_hasta`) o «Anulado»; compra (factura confirmada) → «Confirmada» o «Anulada»; nota de crédito → «Nota de crédito». Los estados de cobro y despacho (`cobrado`, `deuda`, `en_proceso`, `armando`, `incompleto`) **no se muestran** (D-10). Los borradores nunca aparecen.
- **FR-005** Cada fila abre el **detalle**: líneas (descripción, código, cantidad, precio unitario, subtotal) y totales. El servidor **no devuelve** costos, márgenes, descuento, operador, notas internas, depósito ni datos de otros clientes; el contrato es una lista blanca de campos, probada.
- **FR-006** Pedir el detalle de un comprobante que no es de esa cuenta (otro cliente, otra tienda, otra organización) responde igual que uno inexistente (IDOR).
- **FR-007** La ficha del producto muestra «Guardar en favoritos» / «Quitar de favoritos» (alternar, idempotente) solo con sesión activa; sin sesión, el control lleva a «Ingresar». El estado se pinta con una sola llamada por pantalla (`favoritos_entre_por_dominio`).
- **FR-008** «Favoritos» lista con carga infinita los productos guardados en esta tienda con foto (miniatura de tamaño del componente compartido), nombre, disponibilidad («Disponible / Sin stock») y precio según la cuenta (escala del tipo de cliente, como en la ficha), y permite quitarlos. Un favorito cuyo producto dejó de ser visible en la tienda **no se lista** (no se borra: vuelve a aparecer si se vuelve a publicar).
- **FR-009** Tope de **200 favoritos por cuenta**; el 201 responde «Llegaste al máximo de favoritos» sin guardar. Alternar es idempotente (guardar dos veces no duplica; quitar uno inexistente no falla).
- **FR-010** Favoritos e historial son **por tienda**: la misma persona con cuentas en San Javucho y Mundo JC ve en cada dominio solo lo suyo de esa tienda (D-2).
- **FR-011** La suspensión de la cuenta o su baja de «Habilitado en» rigen **en la próxima llamada** (el estado se consulta cada vez); la pantalla ya abierta pasa a «Tu cuenta no está activa en esta tienda» al primer error de acceso, sin mostrar datos previos.
- **FR-012** Quien opera el panel **no ve** los favoritos del cliente (D-11); la ficha del cliente y su historial del panel no cambian.
- **FR-013** Accesibilidad y adaptación: teclado, lector de pantalla y anchos de 320, 768 y 1440 px; estados de carga, vacío, error con reintento y fin de lista con los patrones compartidos; sin identificadores técnicos a la vista.

**Escenarios (Dado/cuando/entonces)**

1. Dado un cliente con cuenta activa en San Javucho, cuando abre «Mi cuenta», entonces ve solo sus comprobantes de San Javucho (no los de Mundo JC) con total con IVA y estado público.
2. Dado un cliente con una factura en estado `deuda` y otra `cobrado`, cuando abre su historial, entonces ambas figuran «Confirmada» (el cobro no se expone).
3. Dado un presupuesto `pendiente` con `valido_hasta` ayer, cuando lo ve, entonces figura «Vencido».
4. Dado un cliente A, cuando intenta abrir el detalle del comprobante de un cliente B (id válido), entonces recibe el mismo resultado que con un id inexistente y ningún dato de B.
5. Dado el detalle de una compra, cuando el cliente inspecciona la respuesta, entonces no hay costo, margen, descuento ni operador.
6. Dado un visitante sin sesión, cuando entra a `/mi-cuenta`, entonces va a «Ingresar» y, tras ingresar, vuelve a «Mi cuenta».
7. Dado un cliente con la cuenta suspendida a mitad de la sesión, cuando pide más compras, entonces ve «Tu cuenta no está activa en esta tienda» y nada del historial.
8. Dado un cliente, cuando guarda el mismo producto dos veces, entonces hay un solo favorito; cuando llega a 200, el 201 se rechaza con el aviso.
9. Dado un favorito cuyo producto se ocultó en la tienda, cuando abre «Favoritos», entonces no aparece; cuando el producto vuelve a publicarse, vuelve a aparecer.
10. Dado un usuario del panel de otra organización que llama a las RPC con su propia sesión, cuando consulta historial o favoritos, entonces recibe «sin acceso» (no tiene cuenta web).

### Historia 2 — Lista de pedido sin cobro (B1) · P2

Como **visitante** de la tienda quiero armar una lista con varios productos y cantidades y enviarla, para no repetir producto por producto lo que ya elegí; sé que **no pago ni compro** en ese momento.

**Por qué P2**: valida la demanda de pedir en línea con costo medio y sin pagos, sobre el circuito de bandeja y anti-spam que ya existe.

- **FR-020** La ficha del producto suma «Agregar a la lista» (junto a «Consultar por WhatsApp»; el prototipo no lo dibuja: ver matriz). Agregar el mismo producto suma una cantidad (tope 9.999 por producto).
- **FR-021** El encabezado muestra «Mi lista» con la cantidad de productos; la ruta `/lista` muestra las líneas (foto, nombre, SKU, disponibilidad, cantidad editable con mínimo 1 y botón «Quitar»), el **precio de referencia** y el total de referencia, con la leyenda «Precios de referencia: se confirman al responder. Este pedido no reserva stock ni es una compra.» (D-3, D-4).
- **FR-022** La lista vive **en el navegador** (almacenamiento local por tienda, `try/catch`: si el navegador la bloquea la lista dura mientras la página está abierta y avisa). No se guarda en el servidor ni se sincroniza entre dispositivos (D-15). Solo guarda `producto_id` y `cantidad`; **nunca precios**.
- **FR-023** Cada vez que se abre la lista (y antes de enviar) el servidor la **revalida**: `publico.lista_pedido_por_dominio(host, items)` devuelve, por línea, nombre, SKU, imagen, disponibilidad y precio de referencia **calculados por el servidor**, y la lista de ítems **no disponibles** (producto inexistente, oculto, inactivo o de otra tienda; todos indistinguibles). La pantalla los avisa y los quita al enviar.
- **FR-024** Los productos «Sin stock» **se pueden agregar** (el operador decide al responder), marcados «Sin stock hoy: lo confirmamos al responder» (D-4).
- **FR-025** Sin sesión activa la lista pide **Nombre** (1–100), **Contacto** (correo, o teléfono de 8 a 15 dígitos) y **Nota** opcional (hasta 500), con las reglas de `private.validar_contacto_tienda`, más el aviso «Usaremos estos datos solo para responderte» con el enlace legal de la tienda si lo tiene.
- **FR-026** Con una cuenta **activa**, el nombre y el contacto **no se piden**: el servidor usa los de la ficha del cliente y marca la consulta con su `cliente_id` (D-8); la nota sigue siendo opcional.
- **FR-027** «Enviar pedido» llama a `publico.enviar_lista_pedido(host, nombre, contacto, nota, items, clave_envio)` con una `clave_envio` generada **al abrir el envío** (idempotente: reintentar tras un corte no duplica). Respuestas: `ok | invalido (campos) | limite | error`, sin datos internos.
- **FR-028** El servidor valida **todo**: host, lista de 1 a 50 líneas únicas (las repetidas se suman con tope), `cantidad` entera 1–9.999, cada producto **efectivamente visible** en la tienda del host, nombre/contacto/nota con las reglas de FR-025, y rechaza caracteres de control. Una lista vacía o que queda sin ítems válidos responde `invalido`.
- **FR-029** Límite por visitante: el **mismo** de la tienda (5 envíos por hora por empresa y hash de IP, compartido con el formulario y WhatsApp; falla cerrada sin IP) más la idempotencia por clave; si la entrega falla, el cupo no se gasta (misma sub-transacción que el formulario).
- **FR-030** Un envío válido crea **una** consulta `origen = 'pedido'` y sus `dominio.consulta_items` en una sola transacción (todo o nada), con `precio_referencia` calculado por el servidor y nunca recibido del cliente. El aviso por correo de Consultas la encola como a cualquier consulta (con el resumen de ítems en texto plano).
- **FR-031** La bandeja del panel muestra el origen «Pedido» y el detalle de la consulta lista los ítems (producto, SKU, cantidad, precio de referencia rotulado «referencia») y el total de referencia, con el nombre y contacto del visitante y, si lo hay, el cliente (Nº y nombre). El texto se renderiza **como texto** (nunca HTML). `Responder por correo/WhatsApp` sigue igual y su texto inicial incluye los ítems.
- **FR-032** La pantalla de confirmación dice «Recibimos tu pedido. Te vamos a responder para confirmar disponibilidad y precio. No se cobró nada.» y vacía la lista; con error o límite conserva la lista y ofrece reintentar (con el tiempo de espera de `limite` en minutos).
- **FR-033** Accesibilidad y adaptación (teclado, lector, 320/768/1440 px) y estados de carga, vacío («Tu lista está vacía» con «Ver catálogo»), error con reintento.

**Escenarios**

1. Dado un visitante con 3 productos en su lista, cuando envía su nombre y teléfono, entonces la bandeja muestra una consulta «Pedido» con las 3 líneas, cantidades y precio de referencia, y llega el aviso por correo.
2. Dado un visitante que reintenta con la misma `clave_envio` tras un corte de red, cuando reenvía, entonces hay **una** consulta.
3. Dado un visitante que ya hizo 5 envíos en la hora, cuando envía el sexto, entonces recibe `limite` y no se crea nada.
4. Dado un cliente que manipula la petición y manda `precio` o `precio_referencia` en cada ítem, cuando se guarda, entonces el precio guardado es el del servidor (la clave ajena se ignora).
5. Dado un producto oculto o de otra tienda dentro de la lista, cuando se revalida, entonces figura «No disponible» igual que uno inexistente y no se envía.
6. Dado un pedido con 51 líneas o una cantidad de 10.000, cuando se envía, entonces `invalido` y no se crea nada.
7. Dado un nombre o una nota con `<script>` o con un carácter de control, cuando llega al panel, entonces el texto se ve literal (o se rechaza el carácter de control) y no se ejecuta nada.
8. Dado un cliente con cuenta activa, cuando envía la lista, entonces no se le pide nombre ni contacto y la consulta lleva su Nº de cliente.
9. Dado un envío con host de una tienda inexistente, cuando se llama, entonces la respuesta es la misma que con una empresa desactivada.
10. Dado un navegador que bloquea el almacenamiento local, cuando arma la lista, entonces funciona en memoria y avisa que no se conservará al cerrar.

### Historia 3 — Presupuesto desde la tienda (B2) · P3

Como **cliente con cuenta activa** quiero pedir un presupuesto desde mi lista, para recibir el precio que me corresponde (mi escala y mi descuento) sin esperar a que alguien lo arme a mano.

**Por qué P3 y la más sensible**: crea un **comprobante real** sin sesión de panel, solo con la sesión de un cliente de tienda. Cada decisión de abajo es una barrera de seguridad; el modelo de amenazas es parte de la spec.

- **FR-050** Con sesión de cuenta **activa**, la lista suma «Pedir presupuesto» (el prototipo no lo dibuja). Antes de enviar, la pantalla muestra la **cotización del servidor** (`publico.cotizar_presupuesto_tienda`): líneas con la escala y el precio que le corresponden y el total con IVA; «lo que ves es lo que se crea» (misma función que la creación).
- **FR-051** `publico.crear_presupuesto_tienda(host, items, nota, clave_envio)` es ejecutable **solo por `authenticated`** (`anon` sin `execute`); la identidad y la tienda salen **únicamente** de `private.cuenta_de_tienda(host)`: la función **no recibe** `cliente_id`, `empresa_id`, `organizacion_id`, precios, estado ni canal. Sin cuenta activa y habilitada responde `sin_acceso` (igual para todos los casos).
- **FR-052** La función acepta solo `items` (`producto_id`, `cantidad`) con las reglas de FR-028 y una `nota` opcional (≤ 500, sin caracteres de control). **Ninguna otra clave** del `jsonb` se lee: un `precio`, `descuento`, `escala` o `deposito_id` enviado no tiene efecto (probado).
- **FR-053** El **precio lo calcula siempre el servidor**, con el mismo pipeline que el panel: producto activo y visible en la tienda, escala según el tipo del cliente y la cantidad de **esa** línea, descuento de la ficha del cliente sobre el neto, IVA por alícuota, redondeo a 2 decimales. Un producto sin precio en pesos (falta la cotización del dólar) o con precio ≤ 0 se rechaza (`sin_precio`) y **nunca** crea una línea en cero. Prueba de **paridad**: el mismo conjunto de líneas dado por el panel y por la tienda da los mismos importes.
- **FR-054** Se crea, **en una sola transacción**, un comprobante `tipo = 'presupuesto'`, `estado = 'pendiente'`, `canal = 'tienda_online'`, de la empresa del host, a nombre del cliente de la cuenta, `operador_id` nulo, `valido_hasta` nulo (D-13), con numeración correlativa (`private.siguiente_numero_comprobante_org`), sus líneas, el registro `dominio.presupuestos_tienda` y el evento de actividad. Todo o nada: si algo falla no queda número consumido ni líneas sueltas.
- **FR-055** **Sin efectos de dinero ni de stock**: no se crea ningún cobro, contrarreembolso, reserva ni movimiento de stock, y el comprobante no pasa de `pendiente` (probado con pgTAP: cero filas nuevas en `movimientos_stock`, reservas y cobros). El stock «A pedido» y las reservas no se tocan (D-4).
- **FR-056** Depósito de las líneas: el depósito por defecto, activo, que vende la tienda (igual que el panel cuando no se elige); sin ninguno responde `error` genérico sin crear nada.
- **FR-057** **Topes por cuenta**: máximo **5 presupuestos creados por día** (día de Buenos Aires) y **10 presupuestos `pendiente` abiertos** a la vez desde la tienda por cuenta; superarlos responde `limite_cuenta` («Ya tenés presupuestos abiertos; esperá nuestra respuesta»). Más el cupo por hora de la tienda (FR-029, origen `presupuesto`). El conteo y el alta se serializan con `pg_advisory_xact_lock` por cuenta (dos llamadas simultáneas no superan el tope). Valores a confirmar (D-9).
- **FR-058** **Idempotencia**: `(cuenta_cliente_id, clave_envio)` es único; repetir una clave devuelve el **mismo** presupuesto (`ok`, mismo número) sin crear otro ni gastar cupo.
- **FR-059** Respuesta `ok` con `{numero, fecha, total_con_iva}` del presupuesto; `invalido (campos)`, `sin_precio (producto)`, `limite`, `limite_cuenta`, `sin_acceso` y `error` genérico. Ninguna respuesta lleva mensajes de Postgres ni datos internos.
- **FR-060** **Auditoría**: el evento `presupuesto.creado_desde_tienda` en `public.registro_actividad` (misma transacción) con empresa, número de presupuesto y **cliente (Nº y nombre)**, sin correo ni datos de contacto; el evento no tiene actor de panel (actor nulo) y Actividad lo rotula «Tienda online»; la persona queda identificada por el cliente del detalle.
- **FR-061** **Visibilidad para el operador**: el presupuesto aparece en Ventas › Presupuestos como cualquier otro (estado «Pendiente», canal «Tienda online», cliente) y en la ficha del comprobante se rotula «Creado desde la tienda por el cliente» cuando `canal = 'tienda_online'` y no tiene operador (el front resuelve el rótulo; no se toca `obtener_comprobante`). El operador lo acepta, modifica, copia o anula con los flujos de siempre; la tienda **no** puede modificarlo después de crearlo.
- **FR-062** La confirmación al cliente dice «Pedimos tu presupuesto Nº N. Es un presupuesto, no una compra: no reserva stock ni se cobró nada. Te vamos a responder para coordinar.» y lo enlaza en «Mi cuenta › Compras y presupuestos» (de A, si está construida); vacía la lista.
- **FR-063** Un aviso al equipo por presupuesto nuevo **no** forma parte de esta spec (D-12): queda como seguimiento; mientras tanto el operador lo ve en Presupuestos filtrando por canal.
- **FR-064** Accesibilidad, adaptación y estados como en FR-013/FR-033.

**Escenarios**

1. Dado un cliente mayorista activo con 12 unidades de un producto, cuando pide el presupuesto, entonces la línea sale en escala `x10` con su descuento y el total coincide con el que armaría el panel.
2. Dado el cliente A, cuando manipula la petición poniendo el `cliente_id` de B, entonces no hay efecto (la función ni lee ese campo) y el presupuesto, si se crea, es de A.
3. Dado un usuario sin cuenta web (o un usuario de panel), cuando llama a `crear_presupuesto_tienda`, entonces `sin_acceso` y no se crea nada.
4. Dado un cliente con la cuenta suspendida, cuando pide un presupuesto, entonces `sin_acceso` al instante.
5. Dado un cliente con cuenta en San Javucho, cuando llama a la función con el host de Mundo JC, entonces `sin_acceso` (la cuenta debe ser de esa tienda).
6. Dado un cliente que ya creó 5 presupuestos hoy, cuando pide el sexto, entonces `limite_cuenta` y nada se crea.
7. Dado dos llamadas simultáneas con 4 presupuestos ya creados hoy, cuando ambas intentan, entonces solo una se crea.
8. Dado un reintento con la misma `clave_envio`, cuando se repite, entonces devuelve el mismo número, sin otro comprobante.
9. Dado un producto sin precio en pesos, cuando se pide, entonces `sin_precio` con el producto y no se crea ningún comprobante ni se consume número.
10. Dado un presupuesto creado desde la tienda, cuando el operador abre Presupuestos, entonces lo ve «Pendiente», canal «Tienda online», sin ningún movimiento de stock, y puede aceptarlo con el flujo actual.
11. Dado un presupuesto creado, cuando se mira el registro de actividad, entonces hay un evento con número y cliente y sin correo.

### Casos borde

- Producto con variantes o sin precio visible; producto que se oculta entre que se agrega a la lista y se envía (se avisa y se quita).
- Cliente con descuento y producto con precio manual en panel: en la tienda **no hay precio manual**; el descuento se aplica como en el panel.
- Cliente `consumidor final` o archivado: nunca tiene cuenta activa; sin acceso.
- La tienda está pausada («Volvemos pronto»): ninguna función de esta épica opera (misma respuesta que host desconocido).
- Dos pestañas con la misma lista: gana la última escritura del almacenamiento local; el servidor es la autoridad al enviar.
- Contactos duplicados: la bandeja no deduplica (como hoy); vincular con `dominio.contactos` es del operador.
- Zona horaria: «hoy» del tope diario y el «Vencido» usan el día de Buenos Aires (trampa conocida UTC vs ART).

## Modelo de amenazas

Todo lo público se trata como hostil. Cada fila tiene su requisito y su prueba (T-ids en `tasks.md`); la revisión de seguridad integral (`docs/seguridad-tienda-compra-y-cuentas.md`) las recorre de nuevo contra el código final.

### 1 · Funciones `publico.*` ejecutables por `anon` (lista de pedido, B1)

| # | Amenaza | Vector | Mitigación | Prueba |
|---|---|---|---|---|
| 1.1 | Abuso y spam (inundar la bandeja y el correo del equipo) | Llamar `enviar_lista_pedido` en bucle, con claves nuevas, desde muchas IP | Tope de 5 por hora por (empresa, hash de IP) con lock, falla cerrada sin IP, idempotencia por clave, poda a 24 h (reutiliza `private.registrar_envio_tienda`); el aviso por correo ya se agrupa y reintenta; campo trampa del formulario si el front lo trae | FR-029; pgTAP: sexto envío `limite`; clave repetida = una consulta |
| 1.2 | Evadir el límite llamando directo a los insertores | Llamar `crear_consulta_publica` o escribir las tablas por PostgREST | `crear_consulta_publica` sigue **solo interna**; el insertor de pedidos es `private.*` sin `execute` de API; `dominio.consultas` y `dominio.consulta_items` sin privilegios de escritura ni para `anon` | pgTAP: `has_function_privilege`/`has_table_privilege` de `anon` y `authenticated` en cada objeto |
| 1.3 | Listas gigantes o `jsonb` malicioso (agotar CPU, memoria o romper el parser) | `items` con 10.000 elementos, anidado, tipos raros, `cantidad` negativa, decimal o texto, `producto_id` no uuid | `jsonb_typeof = 'array'`, tope de 50 elementos y de tamaño del texto (8 kB) **antes** de recorrer; cada elemento debe ser objeto con `producto_id` que cumpla la forma uuid (regex, sin cast que falle) y `cantidad` de 1 a 4 dígitos; resto de claves ignoradas | pgTAP con una batería de entradas inválidas: todas `invalido`, ninguna con error de Postgres |
| 1.4 | **Enumeración de productos / tenants** | Probar ids o hosts para saber qué existe en otra tienda u organización | La empresa sale solo del host; un producto que no es **efectivamente visible** (`catalogo_tienda_efectivo`) en esa tienda es indistinguible de uno inexistente; host desconocido = empresa desactivada = tienda pausada; los ids son uuid no adivinables; la respuesta devuelve solo los mismos campos que la ficha pública | pgTAP: producto de otra org, oculto, inactivo e inexistente dan la misma respuesta |
| 1.5 | **XSS e inyección** en `nombre`, `contacto`, `nota` | `<script>`, `javascript:`, HTML en el aviso, fórmulas de CSV (`=HYPERLINK(...)`), saltos de línea para forjar encabezados de correo | Todo se guarda como **texto** con longitudes y juego de caracteres validados (sin control); SQL solo con parámetros y sin SQL dinámico; el panel renderiza con React (sin `dangerouslySetInnerHTML`); el aviso por correo es texto plano y el asunto no incluye datos del visitante; el CSV de exportaciones neutraliza fórmulas (patrón existente); los enlaces `mailto:`/`wa.me` del «Responder» se construyen codificados | Vitest del detalle (texto literal); pgTAP de rechazo de control; test del texto del aviso |
| 1.6 | **Datos personales y consentimiento** | Guardar de más; filtrar a quien no corresponde | Mínimo: nombre, contacto, nota e ítems; sin dirección, DNI ni CUIT (D-7); la IP **nunca** se guarda (solo el hash por empresa); el contacto lo ve solo quien tiene `consultas` ≥ lectura en esa empresa (RLS); el aviso de uso de datos se muestra antes de enviar; sin registro de consentimiento formal (igual que el formulario actual). **La retención sigue pendiente de decisión (D-7)** | pgTAP de RLS; revisión de campos |
| 1.7 | Fuga de información en los errores | Provocar errores para leer SQL, nombres o datos | Respuesta cerrada `ok | invalido | limite | error`; el `exception when others` registra solo `sqlstate` (nunca `sqlerrm`) | pgTAP: ningún camino de error devuelve texto de Postgres |
| 1.8 | **Manipulación de precios** | Mandar `precio` o `total` en el `jsonb` | La función no lee precios; el `precio_referencia` es una copia del cálculo del servidor y se rotula «referencia» | Escenario B1-4 |
| 1.9 | Denegación por lecturas baratas y repetidas | Llamar `lista_pedido_por_dominio` miles de veces | Acotada a 50 productos por llamada (mismo orden que `precios_cliente_por_dominio`); se evalúa aplicar el limitador de pedidos públicos de la búsqueda (`public.limite_pedidos_publicos`) y un `statement_timeout` versionado para `anon`/`authenticated` (seguimiento ya abierto en la épica del tablero, H-7) | Prueba de rendimiento con 50 líneas |
| 1.10 | Cruce de tenants | Pasar un `producto_id` de otra organización | Los joins van con `organizacion_id` del host; FK compuestas en `consulta_items` | pgTAP de aislamiento entre dos organizaciones |

### 2 · B2: crear un comprobante sin sesión de panel (la más sensible)

| # | Amenaza | Vector | Mitigación | Prueba |
|---|---|---|---|---|
| 2.1 | **IDOR / suplantación**: crear un presupuesto para otro cliente | Mandar `cliente_id` de otro; reutilizar un id de comprobante | La función **no recibe** cliente, empresa ni organización; la identidad sale solo de `private.cuenta_de_tienda(host)` con `auth.uid()`; un usuario de Auth tiene **un** cliente (D1); el detalle del historial exige `cliente_id` y `empresa_id` de la cuenta | pgTAP con dos clientes: A no crea ni lee para B |
| 2.2 | Un usuario autenticado que **no** es cliente (miembro de otro panel, otra organización) | Llamar con su JWT | `sin_acceso` si no hay fila `activa` en `cuentas_cliente` para `auth.uid()` y la tienda del host; el miembro del panel no tiene cuenta (D5: no mezcla identidades) | pgTAP: panel de otra org → `sin_acceso` |
| 2.3 | **Aislamiento por organización y tienda** | Usar el host de una tienda con la cuenta de otra | La cuenta debe ser de **esa** empresa y estar habilitada (`clientes_empresas`); la organización sale de la empresa del host y debe coincidir con la de la cuenta; FK compuestas | pgTAP: cuenta de San Javucho con host de Mundo JC → `sin_acceso` |
| 2.4 | **Precio manipulado por el cliente** | Mandar `precio`, `escala`, `descuento`, `deposito_id`, `estado` | Las claves ajenas no se leen; el servidor calcula escala, descuento (de la ficha), IVA y redondeo; sin precio manual; paridad con el panel | pgTAP: payload con claves extra = mismo resultado que sin ellas; paridad |
| 2.5 | Presupuestos «basura» que ensucian numeración y reportes | Bucle de creaciones | Tope de 5 por día y 10 abiertos por cuenta (lock por cuenta); cupo por hora por visitante; cuentas solo por invitación; el operador puede anular con el flujo existente; un presupuesto `pendiente` no cuenta como facturado (`comprobante_cuenta_como_facturado`) | pgTAP de topes y de concurrencia |
| 2.6 | **Doble creación** (doble clic, reintento) | Repetir la petición | Clave por cuenta única; devuelve el mismo número; alta atómica | Escenario B2-8 |
| 2.7 | **Efectos colaterales de dinero o stock** | Que el presupuesto reserve o descuente stock, o cree cobros | La función solo inserta comprobante, líneas, vínculo y actividad; no llama a funciones de stock, reservas ni cobros; estado fijo `pendiente`; las transiciones siguientes son del operador | pgTAP: conteo de filas antes y después en `movimientos_stock`, reservas y cobros |
| 2.8 | **Escalada de privilegios por `security definer`** | `search_path` manipulado, SQL dinámico, función ejecutable por quien no corresponde | `security definer`, `set search_path = ''` y nombres calificados; sin `execute format`; `revoke … from public, anon` y `grant … to authenticated` explícitos; el motor y los helpers `private.*` sin `execute` de API; dueño de las funciones sin `bypassrls` extra | pgTAP de privilegios; revisión de código |
| 2.9 | **Auditoría insuficiente** | Un presupuesto sin rastro de quién lo pidió | Evento `presupuesto.creado_desde_tienda` (empresa, número, cliente Nº y nombre) y vínculo `dominio.presupuestos_tienda` con cuenta y clave; el operador lo ve en Presupuestos (canal «Tienda online») y en Actividad. Sin correo ni contacto en el detalle del evento | pgTAP de actividad |
| 2.10 | Cuenta comprometida (robo de contraseña) | Quien tenga la sesión del cliente pide presupuestos en su nombre | El daño está acotado: presupuesto `pendiente`, sin stock ni cobro, con topes, validado por un operador antes de aceptarse; el bloqueo por intentos del template protege el ingreso; la suspensión es inmediata | Prueba de bloqueo existente (F-CLI-06) |
| 2.11 | **Divulgación al operador de datos de otro cliente** | Mezclar líneas o datos al crear | El presupuesto se arma solo con `producto_id` de la tienda y el cliente de la cuenta; el vínculo guarda la cuenta | pgTAP |
| 2.12 | Consumo de numeración desde afuera de la transacción | Fallar después de numerar | El número se toma dentro de la misma transacción: si falla, el contador revierte (no hay saltos) | pgTAP: error provocado = contador sin cambio |

### 3 · Favoritos e historial (datos propios del cliente)

| # | Amenaza | Vector | Mitigación | Prueba |
|---|---|---|---|---|
| 3.1 | Leer o modificar lo de otro | Pasar ids ajenos | Ninguna RPC recibe `cuenta_cliente_id` ni `cliente_id`; todo sale de `private.cuenta_de_tienda`; la tabla de favoritos no tiene privilegios de API y su RLS es «solo la cuenta propia» | pgTAP con dos cuentas |
| 3.2 | Exponer costos, márgenes, descuentos u otros datos internos | Respuestas con columnas de más | Lista blanca de campos en el `jsonb` (probada por claves); nunca `costo*`, `margen`, `operador`, `nota*`, `descuento_pct`, `deposito`, estados de cobro/despacho | pgTAP: las claves devueltas son exactamente las del contrato |
| 3.3 | Fuga entre tiendas del mismo cliente | Ver en una tienda lo de la otra | Todo se filtra por `empresa_id` del host | Escenario A-1 |
| 3.4 | Crecimiento sin tope (favoritos) | Millones de filas | Tope 200 por cuenta con lock; `on delete cascade` al borrar la cuenta | pgTAP |
| 3.5 | Paginación abusiva | `limite` enorme, cursores forjados | Tope de 50 por llamada; el cursor `(fecha, id)` solo ordena, no autoriza (la consulta siempre filtra por cuenta) | pgTAP |
| 3.6 | Mostrar compras de un cliente fusionado o archivado | Cliente archivado con sesión viva | `cuenta_de_tienda` exige cliente no archivado; la fusión de clientes ya mueve los comprobantes | pgTAP |

## Decisiones tomadas (a confirmar por Nicolás)

Resuelven las preguntas de negocio de `decision.md` con **las recomendaciones de la evaluación**. No son requisitos inventados: son el supuesto con el que se especifica y se implementa si Nicolás no indica otra cosa.

| # | Decisión | Alternativa |
|---|---|---|
| D-1 | Solo **ordenar el pedido sin cobrar**; la venta se cierra fuera del sistema. F-TDA-26 completa (checkout, pagos, envíos, ARCA) queda **fuera**: se cierra o se reabre solo con evidencia de demanda (eval. P1) | Cobrar en línea (≥ 5 specs: carrito, pagos, envíos, facturación, pedidos) |
| D-2 | **Una cuenta por tienda**, creada **por invitación**, sin auto-registro; favoritos e historial **por tienda** (eval. P8–P10; D1 y D2 de la cuenta web) | Cuenta única entre tiendas; auto-registro con aprobación |
| D-3 | El precio mostrado en la lista es **referencia no firme** («se confirma al responder»); el presupuesto de B2 usa el precio que calcula el servidor pero sigue siendo `pendiente`: el operador decide (eval. P11) | Precio firme |
| D-4 | El pedido **no reserva stock** ni descuenta; se permiten productos sin stock marcados; el operador confirma disponibilidad (eval. P7). La tienda sigue sin mostrar cantidades | Reservar en la tienda |
| D-5 | El presupuesto es un **comprobante interno no fiscal** (sin ARCA), canal `tienda_online` (eval. P6) | Facturación fiscal electrónica como spec propia |
| D-6 | **Envíos y cobros se coordinan fuera del sistema**, como hoy (transportes, contrarreembolso y cuentas de cobro manuales) (eval. P3–P5) | Cotización de envío y pasarela de pago |
| D-7 | Datos personales **mínimos** (nombre, contacto, nota, ítems), sin dirección, DNI ni CUIT; sin consentimiento formal guardado, igual que el formulario actual; **retención de consultas: pendiente** (eval. P12) | Registrar consentimiento como `dominio.contactos` |
| D-8 | Con cuenta activa, la lista de B1 usa nombre y contacto de la ficha y guarda `cliente_id` en la consulta | Pedir los datos igual y no vincular |
| D-9 | Topes: 50 líneas, 9.999 u. por producto, nota ≤ 500; envíos de la tienda 5/h (existente); B2 5 por día y 10 abiertos por cuenta | Otros valores; sin tope diario |
| D-10 | El historial muestra **todos** los comprobantes del cliente en esa tienda (cualquier canal), con **estado público simplificado**, total con IVA, sin cobro ni despacho | Solo los creados en línea; mostrar el estado de cobro |
| D-11 | Los favoritos son **privados del cliente**: el operador no los ve; tope 200 | Visibles en la ficha del cliente |
| D-12 | **Sin aviso al equipo** de presupuestos nuevos desde la tienda en esta spec (se ven en Presupuestos, canal «Tienda online»); recomendado como seguimiento reusar el aviso por correo de Consultas o una alerta de Inicio | Crear además una consulta `pedido` vinculada |
| D-13 | El presupuesto nace **sin validez** (`valido_hasta` nulo); el operador la fija | Validez por defecto (p. ej. 7 días) [NEEDS CLARIFICATION: cuántos días] |
| D-14 | «Crear presupuesto desde la consulta» (panel, para B1) queda **fuera**: seguimiento recomendado por la evaluación (spec 3 opcional) | Incluirlo en esta spec |
| D-15 | La lista vive **en el navegador** (por tienda), sin carrito persistente entre dispositivos | Guardarla en la cuenta |
| D-16 | Las líneas de B2 salen del depósito por defecto activo que vende la tienda (como el panel sin elegir) | Elegir depósito en la tienda |
| D-17 | B2 usa `private.precio_linea_venta` de MSF-816 si ya existe; si no, motor propio con paridad contra `guardar_lineas_comprobante`, que MSF-816 absorbe | Esperar a MSF-816 |
| D-18 | F-TDA-27 y F-CON-07 ya archivadas; MSF-176 se reencuadra en las tres historias de arriba; la dependencia circular F-TDA-27 ↔ F-CON-07 ↔ MSF-176 ↔ MSF-154 desaparece | — |
| D-19 | Las tres historias quedan detrás de la bandera de plataforma `tienda_pedidos`, **apagada por defecto** y encendida por SQL por entorno tras medir demanda y pasar la revisión de seguridad (patrón `promociones_precio`) | Encender al desplegar |

## Preguntas abiertas

- `[NEEDS CLARIFICATION]` **Demanda real** (P2 y P15 de la evaluación): cuántas consultas por semana tiene cada tienda y cuántas cuentas web activas hay en producción. No bloquea la spec (el alcance está aprobado); `tasks.md` incluye medirlo antes de encender la función en producción (T060) y una **bandera de plataforma** (`tienda_pedidos`, apagada por defecto) para encender o apagar las tres historias.
- `[NEEDS CLARIFICATION]` **Retención y política de privacidad** de las consultas con datos personales (hoy «pendiente» en Consultas): qué se conserva y cuánto tiempo; qué texto de privacidad se muestra (D-7).
- `[NEEDS CLARIFICATION]` **Validez del presupuesto** desde la tienda (D-13) y **aviso al equipo** (D-12).
- `[NEEDS CLARIFICATION]` **Topes** de B2 (5 por día / 10 abiertos) y de la lista (D-9): son un supuesto técnico, no una regla del negocio.
- `[NEEDS CLARIFICATION]` **Textos y pantallas**: «Mi cuenta», la lista y las confirmaciones no están dibujadas; se piden dibujar antes de implementar y, mientras tanto, se anotan en el PR las diferencias (regla 5 de la Regla de fuentes).
- `[NEEDS CLARIFICATION]` **Clientes sin correo** en la ficha (la cuenta web exige correo): no aplica a esta spec, pero B1 con cuenta usa el correo de la ficha como contacto.

## Success Criteria

- **SC-001** Un cliente con cuenta activa llega a «Mi cuenta» desde el encabezado y ve su historial de la tienda en menos de 3 s con 200 comprobantes (carga por tandas).
- **SC-002** Un visitante arma una lista de 5 productos y la envía en 4 pasos (agregar, abrir la lista, completar datos, enviar) y el operador ve los 5 ítems con cantidades en la bandeja.
- **SC-003** Con cuenta activa, el presupuesto pedido tiene **los mismos importes** que el que armaría el panel con las mismas líneas (paridad de pgTAP, 0 diferencias).
- **SC-004** Cero escrituras de stock, reservas o cobros por B1 y B2 (pgTAP) y cero funciones nuevas ejecutables por `anon` fuera de las dos de visitante (pgTAP de superficie).
- **SC-005** Un cliente no puede ver ni crear nada para otro cliente, tienda u organización (batería de pgTAP con dos organizaciones y tres clientes).
- **SC-006** El 100 % de los listados nuevos cargan por tandas con «Cargar más» por teclado y pasan axe a 320, 768 y 1440 px.

## Contratos

El detalle de entradas, salidas, errores y permisos de cada RPC está en `contracts/tienda-compra-y-cuentas.md`. Resumen:

| RPC (`publico.*`) | Historia | Quién ejecuta | Devuelve |
|---|---|---|---|
| `mis_compras_por_dominio(host, desde_fecha, desde_id, limite)` | A | `authenticated` | `{estado, total, filas[], siguiente}` |
| `mi_compra_por_dominio(host, comprobante_id)` | A | `authenticated` | detalle con líneas (lista blanca) |
| `mis_favoritos_por_dominio(host, desde_creado, desde_id, limite)` | A | `authenticated` | `{estado, total, filas[], siguiente}` |
| `cambiar_favorito_por_dominio(host, producto_id, favorito)` | A | `authenticated` | `{estado: ok|limite_favoritos|sin_acceso|error, favorito}` |
| `favoritos_entre_por_dominio(host, productos uuid[])` | A | `authenticated` | `uuid[]` de los que son favoritos (máx. 50) |
| `lista_pedido_por_dominio(host, items)` | B1 | `anon`, `authenticated` | líneas revalidadas con precio de referencia y `no_disponibles` |
| `enviar_lista_pedido(host, nombre, contacto, nota, items, clave_envio)` | B1 | `anon`, `authenticated` | `{estado: ok|invalido|limite|error}` |
| `cotizar_presupuesto_tienda(host, items)` | B2 | `authenticated` | cotización con escala, descuento, IVA y total |
| `crear_presupuesto_tienda(host, items, nota, clave_envio)` | B2 | `authenticated` | `{estado, numero, fecha, total_con_iva}` |

## Matriz pantalla↔criterios

**El prototipo no dibuja ninguna pantalla de esta épica** (la propia épica lo declara: «las pantallas se dibujan cuando la épica entre en una etapa»). Se implementan con los componentes del template y los tokens del sistema de diseño (MSF-117), sin copiar HTML ni CSS, y se pide dibujarlas antes de implementar. Inventarios revisados: `design/pantallas/MJC_Producto.dc.html` (ficha pública; botones «Consultar por WhatsApp», «Escribinos»), `MJC_Home` y `MJC_Catalogo` (sin acceso a cuenta ni lista), `Consultas.dc.html` (tabla `Estado · Cuándo · Empresa · Contacto · Producto · Origen`, diálogo «Consulta de ·», botón `Responder por ·`) y `ClienteFicha.dc.html` (bloque «Cuenta web»; no cambia).

| Ítem | Pantalla / componente | Estado en el prototipo | Dueño |
|---|---|---|---|
| Acceso «Mi cuenta» y «Salir» en el encabezado de la tienda | `AccesoCliente` (existente; se suma «Mi cuenta») | **Sin dibujar** (solo «Ingresar»/«Salir» de F-CLI-06, tampoco dibujado) | FR-001 |
| Página «Mi cuenta» con pestañas «Compras y presupuestos» y «Favoritos» | Ruta pública nueva `mi-cuenta` (`Tabs`, `Tabla`/tarjetas del template, `CargaInfinita`) | **Sin dibujar** | FR-001 a FR-013 |
| Detalle de una compra o presupuesto | Diálogo/página con tabla de líneas y totales | **Sin dibujar** | FR-005, FR-006 |
| Botón «Guardar en favoritos» en la ficha | `MJC_Producto` junto a «Consultar por WhatsApp» | **Sin dibujar** (el prototipo no tiene el botón) | FR-007 |
| Botón «Agregar a la lista» en la ficha | `MJC_Producto` junto a «Consultar por WhatsApp» | **Sin dibujar** | FR-020 |
| Indicador «Mi lista (n)» en el encabezado | Barra superior de la tienda | **Sin dibujar** | FR-021 |
| Página «Lista de pedido» (líneas, cantidades, referencia, formulario, «Enviar pedido» / «Pedir presupuesto») | Ruta pública nueva `lista` | **Sin dibujar** | FR-021 a FR-033, FR-050 a FR-064 |
| Confirmación de pedido y de presupuesto | Pantalla de resultado | **Sin dibujar** | FR-032, FR-062 |
| Bloque «Retiro y envíos / No hay compra online en esta versión» del prototipo de la ficha | `MJC_Producto` | Dibujado, **fuera de alcance**: promete un estado de compra que esta épica no cambia (el prototipo y los requisitos se contradicen: manda el comportamiento; ya anotado en `docs/tiendas-online.md`) | — |
| Columna «Origen» de la bandeja con el valor «Pedido» | `Consultas.dc.html` (tabla) | Dibujada la columna; el valor `Pedido` y la **lista de ítems** del detalle **no** están dibujados | FR-031 |
| Detalle «Consulta de ·» con ítems y total de referencia | `Consultas.dc.html` (diálogo) | Dibujado el diálogo, **sin ítems** | FR-031 |
| Rótulo «Creado desde la tienda por el cliente» y canal «Tienda online» en Ventas | Presupuestos / detalle del comprobante | Pantallas de Ventas existentes; el rótulo es nuevo | FR-061 |
| Marca de «Favoritos» en la ficha del cliente del panel | `ClienteFicha.dc.html` | **Fuera de alcance** (D-11) | — |
| Aviso al equipo por presupuesto nuevo | Inicio / correo | **Fuera de alcance** (D-12, seguimiento) | FR-063 |
| Checkout, medios de pago, envío, «Seguir mi pedido» | — | **Fuera de alcance** (D-1, D-6) | — |

Componentes del template a reutilizar: `Tabs`, `Button`, `Chip` (estados), `TextField`, tabla/tarjeta de listados y `CargaInfinita` / `useListadoAcumulado`, `MiniaturaProducto` (zoom), patrones compartidos de carga, vacío y error con reintento, `EtiquetaDisponibilidad` de la ficha, y los tokens del tema de la tienda (sin colores ni dimensiones literales: `pnpm estilos:check`). No hay selección de empresas en estas pantallas (la tienda es una sola empresa), así que `FiltroEmpresa` no aplica; el panel no suma pantallas nuevas (solo el detalle de Consultas y el rótulo en Ventas).
