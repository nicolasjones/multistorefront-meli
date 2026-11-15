# Feature Specification: Opiniones de productos en la tienda (MSF-467)

**Épica**: MSF-467 «Tiendas online · Opiniones» (Etapa 2, P2 provisoria) · **Spec**: `opiniones-de-productos` · **Prioridad**: P2
**Alcance de entrega**: `refine` y `supabase` (sin `kestra`, `superset` ni `workers`).
**Estado**: spec redactada, **sin implementar**. La épica no tenía historias cargadas («se redactan al planificar la Etapa 2»): esta spec las define (US1–US3) para que el tracker las cree a partir de ella.
**Fuente**: decisión de Nicolás (2026-11-15), el ticket MSF-467, el prototipo `design/pantallas/Opiniones.dc.html` (+ `Opiniones.inventory.json` y la entrada «Opiniones (Etapa 2)» de `AdminSider.dc.html`), `docs/tienda-compra-y-cuentas.md` (cuenta web, MSF-237/MSF-176), `docs/tienda-contacto.md` y `docs/seguridad-tienda-compra-y-cuentas.md` (límites por visitante HMAC), `docs/tiendas-online.md` y el código vigente de `dokploy` (migraciones hasta `20270326100000`).

## Objetivo

Que un **cliente con cuenta web activa** deje una **opinión con puntuación** (1 a 5 estrellas y un comentario) sobre un producto de **su** tienda, y que un **administrador** la **modere antes de que se publique** (moderación previa): solo las opiniones **aceptadas** se muestran en la ficha pública del producto, junto con el **promedio** y la **cantidad**. Todo detrás de una bandera apagada por defecto.

## Decisión de negocio (Nicolás, 2026-11-15) y decisiones delegadas

**Decisión tomada por Nicolás**: (1) opinan los **clientes con cuenta web**, con puntuación, sobre un producto en la **tienda pública**; (2) el administrador **modera antes de publicar**: una opinión nueva queda **pendiente** y no se ve hasta que se acepta. Nicolás confirmó esta propuesta.

Todo lo demás lo decidió el redactor con criterio simple y coherente con el repo. **Cada «Decisión (delegada)» está para que Nicolás la revise**; cambiarla antes de implementar cuesta solo editar esta spec.

| # | Decisión (delegada) | Motivo |
|---|---|---|
| D1 | **Escala de 1 a 5 estrellas enteras**, sin medias estrellas. El comentario es **obligatorio** (10 a 1.000 caracteres). | El prototipo muestra «N sobre 5» y un texto en cada opinión. Un comentario obligatorio le da algo que moderar al administrador y evita puntuaciones vacías. |
| D2 | **Una opinión por cuenta web y producto** (única `(cuenta_cliente_id, producto_id)`). Para opinar de nuevo se **edita** la existente. | Evita inflar el promedio con duplicados; es el mismo tipo de unicidad que favoritos. |
| D3 | **No se exige haber comprado el producto.** Alcanza con una cuenta web **activa** en esa tienda. No hay marca «compra verificada». | Exigir compra obliga a cruzar comprobantes de cualquier canal (mostrador, teléfono, tienda) y deja afuera a quien compró sin cuenta; la moderación previa ya filtra abuso. Si Nicolás lo quiere, es un chequeo extra en una sola RPC (ver Fuera de alcance). |
| D4 | **Estados**: `pendiente` → `aceptada` / `rechazada`. «Aceptada» es lo que el roadmap llama «publicada» (el prototipo y la pantalla dicen «Aceptada»; un solo nombre en base, API y UI). Se puede aceptar una rechazada y rechazar (despublicar) una aceptada, como muestran los botones del prototipo (`canAcc` / `canRej`). | Igual al prototipo; permite corregir un error de moderación sin tocar la base. |
| D5 | **Motivo de rechazo opcional** (hasta 200 caracteres). Lo ve el administrador y **también el cliente** en «Mis opiniones», para que sepa qué corregir. | El prototipo no tiene el campo: se declara una UI mínima (diálogo corto al rechazar, ver la matriz). Sin motivo, el cliente solo ve «Rechazada». |
| D6 | **El cliente puede editar y borrar su opinión.** Editar una opinión **aceptada o rechazada la devuelve a `pendiente`** (y la oculta de la ficha hasta moderarla de nuevo); borrar la elimina por completo. | Con moderación previa, un texto editado es un texto nuevo y debe volver a revisarse; si no, se podría publicar algo limpio y cambiarlo después. Borrar atiende el pedido de supresión de datos sin intervención del comercio. |
| D7 | **Solo cuentan las aceptadas**: el **promedio** (un decimal) y la **cantidad** que se ven en la ficha salen únicamente de opiniones aceptadas de **esa tienda y ese producto**. Sin opiniones aceptadas no se muestra promedio, solo «Todavía no hay opiniones». | Un promedio con pendientes se movería antes de moderar y daría pistas del contenido. |
| D8 | **Aislamiento por tienda (empresa)**: cada opinión pertenece a la tienda de la cuenta que la escribió; una tienda **nunca** muestra opiniones de otra aunque comparta producto o cliente. | El prototipo dice «Cada opinión pertenece a la tienda donde se compró» y las cuentas web ya son por tienda (D-2 de MSF-176). |
| D9 | **Privacidad: en público se muestra solo el nombre de pila** (primera palabra de `clientes.nombre`, hasta 30 caracteres; «Cliente» si queda vacío), la fecha y la puntuación. Nunca apellido, correo, teléfono, DNI ni identificadores. El nombre se calcula al leer (no se copia a la opinión). El **administrador** ve el nombre completo del cliente en el panel (es su cliente y lo necesita para moderar). | Mínimo dato personal público; sin copia no queda un dato que sobreviva a un cambio o baja del cliente. |
| D10 | **Quién modera: el Administrador de la organización** (`private.es_administrador_de`); el prototipo marca la entrada de menú «Opiniones» solo para `admin`. Ningún otro rol ve la pantalla ni ejecuta las RPC de moderación. | Coherente con el prototipo y con Listas de precios; no se crea una sección de permisos nueva. |
| D11 | **Bandera `tienda_opiniones`, apagada por defecto en todo entorno** (`public.banderas_plataforma`). Se enciende solo en dev, con SQL del equipo técnico; ninguna migración ni despliegue la enciende. Apagada: las RPC del cliente y de lectura pública responden `sin_acceso` / lista vacía **sin tocar datos**; el panel muestra el aviso y solo permite lo que reduce exposición (rechazar). | Mismo patrón que `tienda_pedidos` (MSF-176) y `listas_precios`. |
| D12 | **Anti-abuso**: (a) límite por visitante con el HMAC existente: `private.visitante_publico(host)` + `private.registrar_pedido_publico` con clave propia `opinion\|…` (**10 llamadas por minuto** en escritura y 30 en lectura; falla cerrada sin IP); (b) tope de **50 opiniones por cuenta** y de **10 pendientes** a la vez; (c) el comentario **no admite enlaces** (`http`, `www.`, dominios) ni caracteres de control o marcas de dirección: responde `invalido`; (d) idempotencia: guardar dos veces el mismo texto no cambia estado ni gasta cupo extra. | Reutiliza lo ya revisado (MSF-945/946) en lugar de inventar un limitador; los enlaces son el spam típico (el prototipo lo ilustra con «Mensaje con enlaces a otro sitio de venta»). |
| D13 | **Sin avisos por correo** al administrador ni al cliente. La pantalla muestra el contador de **Pendientes**; el cliente ve el estado en «Mis opiniones». Los eventos de moderación quedan en **Actividad** (`opinion.aceptada`, `opinion.rechazada`; solo producto y puntuación, nunca el texto). | Sin infraestructura nueva (Kestra/Workers). Un aviso agrupado es una mejora posterior. |
| D14 | **Las opiniones entran en la exportación total** de la organización (son dato del negocio, a diferencia de favoritos, que es privado del cliente). | La exportación total es la garantía de portabilidad del administrador; incluye todo lo que el negocio posee. |
| D15 | **Retención**: no hay purga automática. Se conservan hasta que el cliente las borra, se da de baja su cuenta (`on delete cascade`) o se elimina el producto. | Evita un proceso nuevo; los casos de supresión ya están cubiertos. |
| D16 | **UI mínima de la tienda** (el prototipo solo dibuja la pantalla del administrador): bloque «Opiniones» en la ficha del producto (promedio, cantidad, lista con «Cargar más») y, con sesión, un formulario «Tu opinión» + «Mis opiniones» en la cuenta. Se arma con los componentes y tokens de la tienda, sin copiar HTML del prototipo. | Los requisitos mandan el comportamiento; sin dibujo, lo más cercano sin inventar secciones nuevas. |

> **Para Nicolás (el ticket dice más que la decisión)**: la descripción de MSF-467 habla de que el equipo «**modera y responde**». La decisión del 2026-11-15 solo confirma moderar; las **respuestas del comercio quedan fuera** de esta spec (ver Fuera de alcance) y se pueden sumar después como una columna más.

## Modelo y supuestos (verificados en el código de `dokploy`)

- La cuenta web es `public.cuentas_cliente` (una por cliente y tienda, estado `activa`/`suspendida`). La identidad de las RPC públicas sale de **`private.cuenta_de_tienda(host)`**, que devuelve `(cuenta_cliente_id, cliente_id, organizacion_id, empresa_id, tipo)` solo si la cuenta está activa, el cliente habilitado y la tienda activa; **ninguna RPC recibe `cliente_id`, `empresa_id` ni `organizacion_id`**.
- La visibilidad de un producto en una tienda la define `private.catalogo_tienda_efectivo`; una opinión solo se escribe y se lee sobre un producto **efectivamente visible**.
- El límite por visitante ya existe: `private.visitante_publico(host)` (HMAC con secreto de Vault, MSF-946) y `private.registrar_pedido_publico(clave, tope)` sobre `public.limite_pedidos_publicos`.
- La ficha pública es `publico.producto_por_dominio(host, producto)`. Esta spec **no la modifica**: el bloque de opiniones llama a RPC propias, así no se rediseña una función que otras épicas redefinen.
- El panel usa RPC `security definer` en `public` con `private.es_administrador_de`, auditoría con `private.registrar_actividad` y banderas con `private.bandera_activa`.

### Esquema de datos (Constitución, Principio VII), verificado objeto por objeto

| Objeto | Esquema | Por qué |
|---|---|---|
| `dominio.opiniones_producto` (nueva) | **`dominio`** | Contenido de negocio sobre un producto del catálogo de una tienda; no es plataforma. Se ata a la cuenta (identidad, `public`) y al producto. |
| `private.validar_texto_opinion`, `private.nombre_publico_cliente` | `private` | Lógica interna sin `execute` para la API. |
| RPC del panel: `public.listar_opiniones`, `public.moderar_opinion` | `public` | Superficie del panel, igual que las RPC de listas de precios. |
| RPC de la tienda: `publico.guardar_opinion_por_dominio`, `borrar_opinion_por_dominio`, `mis_opiniones_por_dominio`, `opiniones_producto_por_dominio`, `capacidades_opiniones_por_dominio` | `publico` | Superficie de la tienda; `publico` sigue **sin tablas**. |
| Fila `tienda_opiniones` en `public.banderas_plataforma` | `public` | Bandera de plataforma, igual que `tienda_pedidos`. |

## Modelo de datos (DER)

La única tabla nueva es `dominio.opiniones_producto`. No se altera ninguna tabla existente. Se muestra el grafo completo al que se ata (cuenta, cliente, tienda, producto, actividad, bandera y limitador).

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.opiniones_producto` | nueva | Opinión de una cuenta web sobre un producto de su tienda: puntuación 1–5, comentario, estado de moderación, motivo de rechazo y quién/cuándo moderó |
| `public.cuentas_cliente` | existente | Cuenta web del cliente en una tienda; autora de la opinión (FK compuesta con organización y tienda) |
| `public.clientes` | existente | Cliente; su nombre de pila es lo único que se publica |
| `public.clientes_empresas` | existente | Tiendas en las que el cliente está habilitado (parte de `cuenta_de_tienda`) |
| `dominio.empresas` | existente | Tienda dueña de la opinión |
| `dominio.tiendas` | existente | Dominio de la tienda; resuelve el host de las RPC públicas |
| `dominio.productos` | existente | Producto opinado |
| `public.organizaciones` | existente | Organización dueña de todo |
| `public.registro_actividad` | existente | Eventos `opinion.aceptada` y `opinion.rechazada` |
| `public.banderas_plataforma` | existente | Bandera `tienda_opiniones` (fila nueva, no cambia el esquema) |
| `public.limite_pedidos_publicos` | existente | Contador por visitante (HMAC) del límite de llamadas |

```mermaid
erDiagram
  organizaciones ||--o{ opiniones_producto : "es dueña"
  empresas ||--o{ opiniones_producto : "tienda de la opinión"
  productos ||--o{ opiniones_producto : "recibe"
  cuentas_cliente ||--o{ opiniones_producto : "escribe"
  organizaciones ||--o{ clientes : tiene
  clientes ||--o{ cuentas_cliente : "cuenta web"
  empresas ||--o{ cuentas_cliente : "tienda"
  clientes ||--o{ clientes_empresas : "habilitado en"
  empresas ||--o{ clientes_empresas : "tienda"
  empresas ||--o{ tiendas : "dominio"
  organizaciones ||--o{ productos : "catálogo"
  organizaciones ||--o{ registro_actividad : "actividad"
  banderas_plataforma ||--o{ opiniones_producto : "gobierna"
  limite_pedidos_publicos ||--o{ cuentas_cliente : "acota por visitante"

  opiniones_producto {
    uuid id PK "nueva"
    uuid organizacion_id FK "nueva"
    uuid empresa_id FK "nueva: tienda de la cuenta"
    uuid cuenta_cliente_id FK "nueva: FK compuesta (id, organizacion_id, empresa_id)"
    uuid producto_id FK "nueva: FK compuesta (id, organizacion_id)"
    smallint puntuacion "nueva: 1 a 5"
    text comentario "nueva: 10 a 1000 caracteres, sin enlaces"
    text estado "nueva: pendiente | aceptada | rechazada"
    text motivo_rechazo "nueva: hasta 200, opcional"
    uuid moderada_por "nueva: administrador que decidió"
    timestamptz moderada_en "nueva"
    timestamptz creada_en "nueva"
    timestamptz actualizada_en "nueva: bloqueo optimista"
  }
  cuentas_cliente {
    uuid id PK
    uuid organizacion_id FK
    uuid cliente_id FK
    uuid empresa_id FK
    uuid auth_user_id FK
    text estado
  }
  clientes {
    uuid id PK
    uuid organizacion_id FK
    text nombre
    boolean es_consumidor_final
  }
  clientes_empresas {
    uuid cliente_id FK
    uuid empresa_id FK
    uuid organizacion_id FK
  }
  empresas {
    uuid id PK
    uuid organizacion_id FK
    boolean activa
  }
  tiendas {
    uuid id PK
    uuid empresa_id FK
    text dominio
  }
  productos {
    uuid id PK
    uuid organizacion_id FK
    text nombre
  }
  organizaciones {
    uuid id PK
  }
  registro_actividad {
    uuid id PK
    uuid organizacion_id FK
    text tipo
    text detalle
  }
  banderas_plataforma {
    text clave PK
    boolean activa
  }
  limite_pedidos_publicos {
    text clave PK
    integer contador
  }
```

Reglas de la tabla (las impone la base, no el front):

- **Aislamiento**: FK compuestas `(cuenta_cliente_id, organizacion_id, empresa_id)` → `public.cuentas_cliente` (índice único `cuentas_cliente_id_org_empresa_uq` ya existente), `(empresa_id, organizacion_id)` → `dominio.empresas` y `(producto_id, organizacion_id)` → `dominio.productos`, todas `on delete cascade`: una fila no puede mezclar organizaciones ni apuntar a una tienda distinta de la de su cuenta.
- **Checks**: `puntuacion between 1 and 5`; `char_length(btrim(comentario)) between 10 and 1000`; `estado in ('pendiente','aceptada','rechazada')`; `motivo_rechazo` ≤ 200 y solo con estado `rechazada`; `moderada_por`/`moderada_en` presentes si y solo si el estado no es `pendiente`.
- **Índices**: único `(cuenta_cliente_id, producto_id)`; parcial `(empresa_id, producto_id, creada_en desc, id desc) where estado = 'aceptada'` para la ficha; `(organizacion_id, empresa_id, estado, creada_en desc, id desc)` para el panel.
- **RLS activada sin políticas y sin ningún privilegio** para `anon`, `authenticated` ni `public` (como `favoritos_cliente`): solo las RPC `security definer` leen y escriben.

## User Scenarios & Testing *(mandatory)*

### US1 — El administrador modera las opiniones (P1)

Un administrador abre **Opiniones** en el menú, ve cuántas hay **Pendientes / Aceptadas / Rechazadas**, filtra por estado y por tienda, lee cada opinión («Sobre: producto», estrellas, texto) y pulsa **Aceptar** o **Rechazar**. Solo lo aceptado se verá en la tienda.

1. **Dado** una opinión pendiente, **cuando** la acepto, **entonces** pasa a «Aceptada», el contador de pendientes baja, queda el evento en Actividad y, desde ese momento, aparece en la ficha de su tienda.
2. **Dado** una opinión pendiente, **cuando** la rechazo (con o sin motivo), **entonces** queda «Rechazada» y no se publica; el cliente la ve rechazada en «Mis opiniones» (con el motivo si lo hay).
3. **Dado** una opinión aceptada, **cuando** la rechazo, **entonces** deja de verse en la tienda y el promedio y la cantidad se recalculan.
4. **Dado** otro administrador que moderó la misma opinión un segundo antes, **cuando** pulso un botón con la pantalla vieja, **entonces** veo «La opinión cambió, recargá» y no se pisa su decisión.
5. **Dado** un usuario que no es administrador, **cuando** intenta abrir la pantalla o llamar la RPC, **entonces** no hay entrada de menú y la RPC responde `42501`.

### US2 — El cliente deja, edita y borra su opinión (P1)

Un cliente con sesión en la tienda abre la ficha de un producto, elige estrellas, escribe su comentario y lo envía. Ve «Gracias, tu opinión se publicará cuando la revisemos». En «Mis opiniones» ve el estado de cada una, puede editarla o borrarla.

1. **Dado** una cuenta activa y un producto visible, **cuando** envío 4 estrellas y un comentario válido, **entonces** queda `pendiente` y no aparece en la ficha pública.
2. **Dado** que ya opiné sobre ese producto, **cuando** vuelvo a enviar, **entonces** se edita la misma opinión (no se crea otra) y vuelve a `pendiente` si el contenido cambió.
3. **Dado** un comentario con un enlace, **cuando** lo envío, **entonces** veo el error del campo y no se guarda.
4. **Dado** un visitante sin sesión o con una cuenta suspendida, **cuando** intenta opinar, **entonces** ve la invitación a ingresar (o el mismo `sin_acceso` genérico) y nada se guarda.
5. **Dado** que borro mi opinión, **cuando** confirmo, **entonces** desaparece de «Mis opiniones», de la ficha y del promedio.

### US3 — El visitante ve las opiniones aceptadas, el promedio y la cantidad (P2)

En la ficha de un producto, cualquier visitante ve «4,5 de 5 · 12 opiniones» y la lista de opiniones aceptadas (nombre de pila, estrellas, fecha, texto), nuevas primero, con «Cargar más».

1. **Dado** un producto con opiniones aceptadas, **cuando** abro la ficha, **entonces** veo promedio, cantidad y las primeras 10, sin pendientes ni rechazadas.
2. **Dado** un producto sin opiniones aceptadas, **cuando** abro la ficha, **entonces** veo «Todavía no hay opiniones» y, si tengo sesión, el formulario.
3. **Dado** la bandera apagada, **cuando** abro la ficha, **entonces** no se dibuja ningún bloque de opiniones y la ficha es idéntica a la de hoy.
4. **Dado** dos tiendas con el mismo producto, **cuando** miro la ficha de cada una, **entonces** cada una muestra solo sus opiniones.

### Casos borde

- **Cuenta suspendida o baja de «Habilitado en» después de opinar**: las opiniones **aceptadas siguen visibles** (son contenido ya moderado); la persona ya no puede crear, editar ni borrar hasta recuperar el acceso.
- **Producto que se oculta, se desactiva o cambia de categoría oculta**: sus opiniones no se muestran ni cuentan en la tienda; **no se borran** y reaparecen si vuelve a ser visible. El panel las sigue listando.
- **Producto eliminado**: las opiniones se borran en cascada.
- **Cliente fusionado con otro** (fusión de clientes): se aplica la regla de fusión vigente a `cuentas_cliente`; la opinión sigue atada a la cuenta, así que no se duplica ni se pierde. Si dos cuentas de la fusión opinaron el mismo producto, la unicidad lo impide y la tarea de fusión conserva la más reciente (ver T018).
- **Texto con HTML, scripts o emojis**: se guarda y se muestra **literal** (nodos de React); un `<script>` no se interpreta. El largo se mide en caracteres de Postgres: con emojis el borde puede diferir en ±1 y el servidor manda.
- **Consumidor final / cliente archivado**: no tienen cuenta web válida (`cuenta_de_tienda` no devuelve nada); no pueden opinar.
- **Moderar a la vez que el cliente edita**: gana la última escritura **con bloqueo optimista**: la RPC de moderación recibe `actualizada_en` y responde `conflicto` si la fila cambió (D6: una edición vuelve a `pendiente`, así que una aceptación vieja no puede publicar el texto nuevo).
- **Cambio de empresa activa con la pantalla de moderación abierta**: ver la fila «Empresa activa» de la matriz.
- **Reintento por red caída**: guardar es idempotente (mismo contenido = misma fila, sin cambiar estado ni fecha).
- **Muchas opiniones**: la ficha y el panel cargan por tandas con cursor `(creada_en, id)`; el promedio y la cantidad se calculan con el índice parcial, sin leer el texto.

## Requirements *(mandatory)*

### Datos y reglas (US1–US3)

- **RF-OPI-1**: Existe `dominio.opiniones_producto` con las columnas, checks, FK compuestas e índices del DER; RLS activada sin políticas y sin privilegios para `anon`, `authenticated` ni `public`.
- **RF-OPI-2**: Una opinión nueva nace siempre `pendiente`. Solo una moderación explícita de un administrador la cambia a `aceptada` o `rechazada`; **ningún camino** del cliente publica directamente.
- **RF-OPI-3**: El cliente solo puede **crear, editar y borrar su propia** opinión (la de su cuenta); editar una `aceptada` o `rechazada` con contenido distinto la devuelve a `pendiente`, limpia motivo y moderación; borrar la elimina.
- **RF-OPI-4**: Unicidad por `(cuenta_cliente_id, producto_id)`; topes de 50 opiniones por cuenta y 10 pendientes a la vez (`limite_opiniones` / `limite_pendientes`).
- **RF-OPI-5**: Validación en servidor (`private.validar_texto_opinion`) y espejo en cliente: puntuación entera 1–5; comentario recortado de 10 a 1.000 caracteres, sin caracteres de control, separadores ni marcas de dirección, **sin enlaces**; motivo de rechazo ≤ 200.
- **RF-OPI-6**: Solo se escribe y se lee sobre productos **efectivamente visibles** en la tienda del host (`private.catalogo_tienda_efectivo`); inexistente, oculto, inactivo, de otra tienda u otra organización responden todos `no_encontrado`.

### Tienda (US2, US3)

- **RF-OPI-7**: `publico.guardar_opinion_por_dominio(host, producto_id, puntuacion, comentario)` y `publico.borrar_opinion_por_dominio(host, producto_id)`, solo `authenticated`; identidad exclusivamente de `private.cuenta_de_tienda(host)`; orden de verificaciones: bandera → cuenta → límite → validar → trabajar (contrato en `contracts/opiniones.md`).
- **RF-OPI-8**: `publico.mis_opiniones_por_dominio(host, desde_creada, desde_id, limite)` devuelve las opiniones de la cuenta con su estado y el motivo de rechazo; solo la cuenta autora las ve.
- **RF-OPI-9**: `publico.opiniones_producto_por_dominio(host, producto_id, desde_creada, desde_id, limite)` (`anon` y `authenticated`) devuelve el **resumen** (`promedio` con un decimal, `cantidad`) y las opiniones **aceptadas** con una **lista blanca** de campos: `nombre_pila`, `puntuacion`, `comentario`, `fecha` (día), y, si hay sesión, `es_mia`. Nunca ids de cliente, cuenta, organización ni empresa, correo, apellido, estado ni motivo.
- **RF-OPI-10**: `publico.capacidades_opiniones_por_dominio(host)` → `{estado:"ok", opiniones:true|false}` para que el front dibuje o no el bloque. Host desconocido, empresa desactivada y tienda pausada responden lo mismo (`{estado:"error"}`), sin distinguir casos.
- **RF-OPI-11**: Ficha pública: bloque «Opiniones» (promedio, cantidad, lista con carga por tandas y «Cargar más»), formulario «Tu opinión» (estrellas operables con teclado, contador de caracteres) con sesión, e invitación a ingresar sin sesión; «Mis opiniones» dentro de «Mi cuenta» con editar y borrar (con confirmación) y el estado de cada una.
- **RF-OPI-12**: Con la bandera apagada el servidor impone el comportamiento (RF-OPI-7 a 10 no tocan datos) y el front no dibuja nada; la ficha es idéntica a la actual.

### Moderación (US1)

- **RF-OPI-13**: `public.listar_opiniones(estado, empresa_id, desde_creada, desde_id, limite)` (solo Administrador) devuelve por tandas las opiniones de la organización (o de una tienda) con tienda, nombre completo del cliente, producto, puntuación, texto, estado, motivo y `actualizada_en`, más los **contadores** Pendientes / Aceptadas / Rechazadas del mismo ámbito.
- **RF-OPI-14**: `public.moderar_opinion(id, decision, motivo, actualizada_en_esperada)` (solo Administrador): `aceptar` o `rechazar`; idempotente (repetir la misma decisión responde `ok` sin duplicar el evento); bloqueo optimista (`40001` / `conflicto`); registra `opinion.aceptada` u `opinion.rechazada` en Actividad con producto y puntuación, **sin el texto**. Con la bandera apagada solo se permite `rechazar`.
- **RF-OPI-15**: Pantalla **Opiniones** del panel, según el prototipo: título, aviso «Las opiniones nuevas quedan pendientes hasta que las aceptes o rechazes. Solo las aceptadas se muestran en la tienda.», filtro de tienda, tres contadores, filtros Pendientes / Aceptadas / Rechazadas / Todas (por defecto Pendientes), lista con tienda, nombre, fecha, estado, «N sobre 5», texto y «Sobre: producto», y botones **Aceptar** / **Rechazar** (cada uno oculto cuando ya es el estado actual). Carga infinita con «Cargar más».

### Seguridad y datos (transversal)

- **RF-OPI-16**: Toda RPC pública lleva `revoke … from public, anon` y `grant execute … to authenticated` explícitos (las dos de lectura y la de capacidades, además a `anon`); `security definer`, `set search_path = ''`; el `exception when others` registra solo `sqlstate`. El test que prohíbe funciones de `public` ejecutables por `anon` sigue verde: las de `anon` viven en `publico` y figuran en su lista blanca.
- **RF-OPI-17**: Límite por visitante con `private.visitante_publico` y `private.registrar_pedido_publico` (D12); la IP nunca se guarda; sin cabecera `x-forwarded-for` todos comparten un único cupo («sin-ip», falla cerrada).
- **RF-OPI-18**: Las opiniones entran en la exportación total (`private.conjuntos_exportacion_total`) y no se agregan a las exclusiones.
- **RF-OPI-19**: Migraciones aditivas en la ventana `20270341000000`+ (mayores que toda la cola de `dokploy`), cada una con su reversión documentada; `node scripts/verificar-migraciones.mjs --estricto` verde.

### Criterios de aceptación

- **CA-OPI-1** (RF-OPI-2, 3): una opinión nueva y una editada quedan `pendiente`; ninguna llamada del cliente cambia `estado` a otro valor.
- **CA-OPI-2** (RF-OPI-4): el 51.º producto o la 11.ª pendiente responden `limite_opiniones` / `limite_pendientes` sin guardar; reenviar la misma opinión es `ok`.
- **CA-OPI-3** (RF-OPI-5): puntuación 0 o 6, comentario de 9 o 1.001 caracteres, con enlace o con caracteres de control responden `invalido` con los campos erróneos y no guardan.
- **CA-OPI-4** (RF-OPI-9, D7): la ficha muestra solo aceptadas; promedio y cantidad coinciden con ellas; pendientes y rechazadas no aparecen ni cuentan; la respuesta no contiene ninguna clave fuera de la lista blanca.
- **CA-OPI-5** (D8, RF-OPI-1): una cuenta de la tienda A no puede crear ni leer opiniones de la tienda B; las FK compuestas impiden insertar una fila con tienda distinta a la de su cuenta.
- **CA-OPI-6** (D9): el nombre público es solo la primera palabra del nombre del cliente; con «Valeria Sánchez» se ve «Valeria».
- **CA-OPI-7** (RF-OPI-14): aceptar y rechazar cambian el estado, registran el evento y recalculan promedio y cantidad; con `actualizada_en` vieja responde `conflicto`.
- **CA-OPI-8** (D10): un usuario no administrador recibe `42501` en `listar_opiniones` y `moderar_opinion`; no ve la entrada de menú.
- **CA-OPI-9** (RF-OPI-12, D11): con la bandera apagada, ninguna RPC de tienda lee ni escribe datos y el panel solo permite rechazar.
- **CA-OPI-10** (RF-OPI-17): superado el límite por minuto, la RPC responde `limite` con `espera_segundos` aun para llamadas inválidas.
- **CA-OPI-11** (RF-OPI-15): con la empresa activa elegida, la lista y los contadores corresponden solo a esa tienda; con «Todas», aparece la tienda de cada fila.
- **CA-OPI-12** (RF-OPI-18): la exportación total incluye `dominio.opiniones_producto` y su prueba falla si se omite.

### Criterios de éxito

- **SC-001**: ninguna opinión no moderada es visible para un visitante por ninguna RPC ni consulta directa (pgTAP con `anon`, `authenticated` de otra tienda y la propia cuenta).
- **SC-002**: promedio y cantidad de la ficha coinciden exactamente con las opiniones aceptadas del producto en esa tienda en una muestra con pendientes, rechazadas y otra tienda.
- **SC-003**: `rls_en_toda_tabla` y `privilegios_anon_endurecidos` verdes con la tabla nueva; ninguna función nueva de `public` ejecutable por `anon`.
- **SC-004**: con la bandera apagada, la ficha y la cuenta son idénticas a las de `dokploy` (prueba de paridad del front y de las RPC).

## Verificación por requisito

Las pruebas de base de datos corren en el job `database` del CI (`pnpm test:db`, pgTAP); las de interfaz con Vitest + axe; el recorrido completo con Playwright.

| Requisito | Verificación (test / comando) |
|---|---|
| RF-OPI-1 | pgTAP `opiniones_producto.test.sql`: estructura, checks, FK compuestas (fila con tienda ajena rechazada), RLS activa, **grants exactos** (ninguno a `anon`/`authenticated`/`public`), `search_path` |
| RF-OPI-2, 3 | pgTAP `opiniones_cliente.test.sql`: alta `pendiente`, edición que vuelve a `pendiente`, intento de forzar `estado`, borrado, no tocar la de otra cuenta |
| RF-OPI-4 | pgTAP `opiniones_cliente.test.sql`: unicidad, topes 50 y 10, idempotencia |
| RF-OPI-5 | pgTAP `opiniones_validacion.test.sql` y Vitest `validacion.test.ts` (espejo cliente-servidor: mismos casos) |
| RF-OPI-6 | pgTAP `opiniones_cliente.test.sql`: producto inexistente, oculto, inactivo, de otra tienda y de otra organización → `no_encontrado` idéntico |
| RF-OPI-7, 8 | pgTAP `opiniones_cliente.test.sql`: orden bandera → cuenta → límite → validar; `sin_acceso` idéntico (sin sesión, suspendida, no habilitada, usuario de panel, otra tienda, host desconocido, empresa desactivada) |
| RF-OPI-9, 10 | pgTAP `opiniones_lectura.test.sql`: lista blanca **por claves**, solo aceptadas, promedio/cantidad, cursor, producto oculto, aislamiento entre tiendas, `anon` puede leer y no escribir |
| RF-OPI-11 | Vitest `OpinionesProducto.test.tsx`, `FormularioOpinion.test.tsx`, `MisOpiniones.test.tsx` (estados vacío, carga, error con reintento, axe a 320/768/1440 px, estrellas con teclado) |
| RF-OPI-12 | pgTAP `opiniones_bandera.test.sql` (apagada: `sin_acceso`, sin cambios en la tabla) y Vitest de paridad de la ficha |
| RF-OPI-13, 14 | pgTAP `opiniones_moderacion.test.sql`: solo Administrador (`42501`), contadores, `40001`/`conflicto`, idempotencia, evento de Actividad sin texto, apagada solo rechaza |
| RF-OPI-15 | Vitest `pages/opiniones/list.test.tsx` (contadores, filtros, botones según estado, diálogo de motivo, carga infinita, axe) |
| RF-OPI-16 | pgTAP `privilegios_anon_endurecidos` y `opiniones_privilegios.test.sql` (`has_function_privilege` por rol de cada RPC) |
| RF-OPI-17 | pgTAP `opiniones_limites.test.sql` (11.ª llamada en el minuto → `limite`; «sin-ip» compartido; inválidas también cuentan) |
| RF-OPI-18 | pgTAP `exportacion_total.test.sql` extendido |
| RF-OPI-19 | `node scripts/verificar-migraciones.mjs --estricto` |
| CA-OPI-11 / empresa activa | Vitest `list.test.tsx`: cambiar la empresa activa recarga lista y contadores, reencuadra la tanda, descarta lo seleccionado y cierra el diálogo de rechazo con aviso |
| E2E | Playwright `apps/web/e2e/tienda-opiniones.e2e.ts`: cliente opina → no se ve en la ficha → admin acepta → se ve con promedio → cliente edita → desaparece hasta moderar → cliente borra (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, como los demás E2E de tienda) |
| SC-001 | `opiniones_lectura.test.sql` (barrido por rol) |
| SC-002 | `opiniones_lectura.test.sql` (muestra mixta) |
| SC-003 | `rls_en_toda_tabla.test.sql` y `privilegios_anon_endurecidos.test.sql` |
| SC-004 | `opiniones_bandera.test.sql` y Vitest de la ficha |

## Matriz pantalla↔criterios

`pnpm prototipo:inventario` se corrió: **existe** la pantalla `design/pantallas/Opiniones.dc.html` (título «Tienda · Opiniones (Etapa 2)») con inventario `Opiniones.inventory.json`: **botones** «Aceptar» y «Rechazar»; sin tablas con encabezados, campos, tabs ni diálogos declarados. El HTML dibuja además: aviso informativo, filtro de tienda (píldoras), tres contadores, filtros de estado, la lista de opiniones y un aviso flotante («Opinión aceptada: ya se muestra en la tienda», «Opinión rechazada»). **El prototipo no dibuja nada de la tienda pública** (bloque en la ficha, formulario, «Mis opiniones»): su UI es la mínima declarada en D16. Tampoco dibuja el motivo de rechazo (D5).

| Ítem | Dueño | Nota |
|---|---|---|
| Botón **Aceptar** (visible salvo si ya está aceptada) | RF-OPI-14, RF-OPI-15, CA-OPI-7 | Aviso «Opinión aceptada». **Desvío del prototipo** (decidido en la revisión): el prototipo dice «…: ya se muestra en la tienda», pero en las fases 1 y 2 nada se muestra en la tienda pública; el sufijo vuelve cuando exista la fase 4 |
| Botón **Rechazar** (visible salvo si ya está rechazada) | RF-OPI-14, RF-OPI-15, CA-OPI-7 | Aviso «Opinión rechazada». **Decisión D5**: abre un diálogo corto con «Motivo (opcional)», «Rechazar» y «Cancelar»; el prototipo no lo dibuja (UI mínima declarada) |
| Aviso «Las opiniones nuevas quedan pendientes…» | RF-OPI-15 | Texto literal del prototipo |
| Contadores Pendientes / Aceptadas / Rechazadas | RF-OPI-13, RF-OPI-15, CA-OPI-11 | Calculados en servidor para el mismo ámbito del filtro de tienda |
| Filtros Pendientes / Aceptadas / Rechazadas / Todas | RF-OPI-15 | Por defecto «Pendientes»; reinicia la lista |
| Filtro de tienda («Todas las tiendas» + una por empresa) | RF-OPI-15, CA-OPI-11 | `FiltroEmpresa` compartido; ver fila «Empresa activa» |
| Fila: chip de tienda, nombre, fecha, estado, «N sobre 5», texto, «Sobre: producto» | RF-OPI-13, RF-OPI-15, CA-OPI-6 | **Contradicción declarada**: el prototipo muestra «Valeria S.» (y «Cliente anónimo»); por D9/D10 el administrador ve el **nombre completo** del cliente y no existen opiniones anónimas. Mandan los requisitos; se anota en el PR |
| Entrada de menú «Opiniones (Etapa 2)», solo `admin` | RF-OPI-15, CA-OPI-8 | Se llama «Opiniones» (sin «Etapa 2»), en el grupo donde el prototipo la dibuja (junto a Mercado Libre y Newsletter), ruta `/opiniones`, sección de audiencia administrador, carga diferida (`lazy`), ícono de estrella del prototipo |
| Bloque «Opiniones» de la ficha, formulario «Tu opinión», «Mis opiniones» (tienda) | RF-OPI-11, CA-OPI-1…4 | **No dibujado**: UI mínima del repo (D16), sin inventar secciones; se agrega a la matriz si el equipo lo dibuja |
| **Empresa activa** | RF-OPI-13, RF-OPI-15, CA-OPI-11 | **Pantalla del panel**: el prototipo lo exige («Si elegís una empresa en la barra superior, se filtra por esa tienda»). La empresa activa de la barra superior es la única fuente: filtra lista y contadores a esa tienda; con «Todas mis empresas» se muestra el chip de tienda en cada fila. `FiltroEmpresa` refleja esa selección (no guarda otra). Al cambiar la empresa: se invalidan y recargan **lista y contadores**, se reinicia la tanda y el cursor, se descarta lo seleccionado y un diálogo de rechazo abierto **se cierra con aviso** (nunca guarda con la empresa anterior). Test: Vitest que cambia la empresa con la pantalla y el diálogo abiertos. **Tienda pública**: «Empresa activa: no aplica» (no es pantalla de panel; la tienda es la del dominio y se resuelve por host) |

## Contratos

`contracts/opiniones.md`: firmas, respuestas y errores de las siete RPC (dos del panel y cinco de la tienda), lista blanca de campos y eventos de Actividad.

## Riesgos y desvíos declarados

1. **El ticket habla de «responder»** y la decisión solo de moderar (nota de arriba): las respuestas quedan fuera; si Nicolás las quiere, se suma una columna `respuesta` y una RPC.
2. **Cuenta sin bandera `tienda_pedidos`**: las opiniones dependen de la cuenta web (MSF-237), no de la bandera de pedidos; se verifica en dev que ingresar a la tienda funciona con `tienda_pedidos` apagada y `tienda_opiniones` encendida. Si no fuera así, la bandera de opiniones exigiría ambas (cambio de una condición).
3. **Límite por visitante y NAT**: muchos clientes tras una misma IP comparten cupo (10 por minuto); es el mismo riesgo aceptado del formulario de contacto y de pedidos.
4. **Opiniones falsas de cuentas legítimas** (alguien con cuenta que opina sin haber comprado, D3): lo acota la moderación previa; es la contrapartida de no exigir compra.
5. **Fusión de clientes**: puede chocar la unicidad `(cuenta, producto)`; se resuelve en T018 y se prueba (caso borde).
6. **Redefiniciones**: la spec **no** redefine funciones existentes (ficha, capacidades, cuenta); solo agrega funciones nuevas, para no pelear con otras ramas.
7. **Sin aviso al administrador**: las opiniones pendientes pueden quedar sin moderar; el contador de la pantalla es la única señal (D13).

## Reversión

Todas las migraciones son aditivas y se deshacen con una migración posterior, **en este orden** y sin ejecutarla en el mismo PR: (1) `drop function` de las siete RPC y de `capacidades_opiniones_por_dominio`; (2) restaurar `private.conjuntos_exportacion_total()` a la versión previa; (3) `delete from public.banderas_plataforma where clave = 'tienda_opiniones'`; (4) `drop function private.validar_texto_opinion, private.nombre_publico_cliente`; (5) `drop table dominio.opiniones_producto` (**exportar antes**: pierde las opiniones). Apagar la bandera deja todo inerte sin tocar datos y es la reversión operativa inmediata. El código de `apps/web` se revierte con `git revert -m 1` del merge de la spec.

## Fuera de alcance

- **Respuestas del comercio** a las opiniones (ver nota para Nicolás).
- **Fotos o videos** en las opiniones.
- **Votos «útil»**, reportes de abuso por otros clientes y ordenamientos por utilidad.
- **Marca «compra verificada»** y exigir compra previa (D3).
- Estrellas en el **catálogo, buscador, resultados o tarjetas**, y datos estructurados `schema.org` (SEO): solo la ficha.
- **Distribución por estrellas** (gráfico de barras 5-4-3-2-1) y filtros por puntuación.
- **Avisos por correo o WhatsApp** al administrador o al cliente.
- Opiniones **anónimas** o de visitantes sin cuenta; opiniones sobre la tienda, servicios o reparaciones.
- Moderación **automática** por IA o listas de palabras (más allá del rechazo de enlaces).
- Importar opiniones de Mercado Libre.
- Opiniones en **Mercado Libre** u otros canales: solo la tienda propia.

### Limitaciones conocidas del filtro de enlaces (revisión de las fases 1 y 2)

`private.texto_opinion_no_permitido` (que usan `validar_texto_opinion` y el motivo de rechazo) es una **heurística**, no una garantía.

- **Qué detecta:** `http:`/`https:`/`ftp:` y `www.`; un dominio con el alfanumérico o guion pegado al punto y un TLD de una **lista cerrada** (genéricos y de país/acortadores que no son palabras comunes: `.ar`, `.com.ar`, `.mx`, `.cl`, `.uy`, `.br`, `.co`, `.pe`, `.py`, `.bo`, `.ec`, `.us`, `.uk`, `.fr`, `.ly`, `.tv`, `.cc`, `.ws`, `.gl`, `.gg`, `.be`, `.ee`, `.fm`, `.gd`, `.gy`, `.sh`, `.vc`, `.ph`, `.pt`, `.ru`, `.cn`, `.jp`, `.au`, `.nz`, `.ca`, `.nl`, `.ch`, `.pl`, `.tr`) seguido de un no alfanumérico o el final, lo que cubre `bit.ly/…`, `youtu.be/…`, `tinyurl.com/…`; y `algo.palabra/` (cualquier TLD seguido de barra: `t.me/…`, `wa.me/…`). Los puntos de otras escrituras (U+3002 «。», U+FF0E «．», U+FF61 «｡», U+2024, U+FE52) se normalizan al punto ASCII antes de evaluar.
- **Criterio para los TLD que son palabras comunes** (`es`, `me`, `de`, `to`, `it`, `at`, `in`, `se`, `ve`): `algo.es` se rechaza solo si el TLD NO va seguido de un espacio (va seguido de puntuación o del final) **y** lo anterior tiene forma de dominio (4 o más alfanuméricos o guiones seguidos, o termina en guion o dígito). Por eso «mi-tienda.es,» y «mitienda.es.» se rechazan, y «Muy bueno.me gustó», «Lo uso a diario.es genial», «Anda bien.No se calienta» y «Sí.No sé» se aceptan. Un punto seguido de espacio («Excelente producto. Top calidad», «Pedí el 10. Es ok.») no es enlace, y las palabras de dos letras fuera de la lista (`no`, `si`, `mi`, `te`, `la`, `el`, `ya`, `lo`, `le`, `en`, `un`, `al`, `su`) tampoco.
- **Qué NO detecta:** ofuscación («ejemplo punto com», «ejemplo . com», «ejemplo(.)com», «ejemplo[.]com»), homógrafos (letras cirílicas parecidas a las latinas), TLD genéricos fuera de la lista, enlaces con espacios dentro, ni `mi-tienda.es hoy` (TLD ambiguo seguido de espacio y palabra: es el precio de no rechazar frases como «diario.es genial»). Y a la inversa, «Excelente.Co» o «bueno.Ca» (TLD de la lista pegados) se tratan como dominio. La moderación previa (D5) es la defensa real.
- **`http` suelta:** la palabra `http`/`https` sin los dos puntos se **acepta** a propósito (rechazarla daría falsos positivos: «usan https para pagar»); hay una aserción pgTAP explícita.
- **Rendimiento:** sin cuantificadores anidados; con entradas hostiles de 50.000 caracteres cada comprobación tarda unos 14 ms y con 200.000 caracteres unos 60 ms (crecimiento lineal; aserciones pgTAP < 1 s).
- **Funciones `invoker`:** las funciones `private` de validación son `security invoker` a propósito: son puras (no leen tablas), no necesitan los privilegios del dueño y `security definer` solo ampliaría la superficie. Llevan `search_path` vacío y sin `execute` para la API; las RPC `security definer` que las llaman sí lo tienen.

La fase 3 hereda esta función y sus límites.
