---
owner: plataforma
sources:
  - specs/20270328-100000-opiniones-de-productos
  - supabase/migrations/20270341000000_opiniones_producto.sql
  - supabase/migrations/20270341000100_opiniones_validacion.sql
  - supabase/migrations/20270341000200_opiniones_moderacion_rpc.sql
  - supabase/migrations/20270419000000_opiniones_cliente_rpc.sql
  - supabase/migrations/20270419000100_opiniones_lectura_publica.sql
  - supabase/migrations/20270419000200_opiniones_fusion_clientes.sql
  - supabase/migrations/20270507000001_opiniones_resumen_indice.sql
  - apps/web/src/pages/opiniones
  - apps/web/src/pages/tienda-publica/opiniones
  - apps/web/src/lib/opiniones.ts
  - apps/web/src/lib/tiendaOpiniones.ts
---

# Revisión de seguridad · Opiniones de productos (MSF-467)

Revisión de seguridad de la épica **MSF-467** «Tiendas online · Opiniones» (spec `specs/20270328-100000-opiniones-de-productos/`), hecha en la tarea de cierre **T029**. La guía funcional es [`tienda-opiniones.md`](./tienda-opiniones.md); acá solo va lo que importa para seguridad.

**Revisado**: la implementación completa de las cuatro historias de la épica (F-OPI-01 moderación, F-OPI-02 opinar, F-OPI-03 leer, y el cierre), tal como quedó mergeada en `dokploy` (PR #1044 y PR #1058), contra los requisitos de la spec (RF-OPI-1 a RF-OPI-21, CA-OPI-1 a CA-OPI-13) y sus criterios de éxito (SC-001 a SC-004).

**Veredicto**: **aprobada con dos hallazgos menores (H-1 y H-2), los dos corregidos** en este mismo cierre (`20270507000001_opiniones_resumen_indice.sql` y `apps/web/src/lib/opiniones.ts`). No queda ningún hallazgo abierto de la épica. Los riesgos que no se corrigen están declarados abajo como **aceptados**, con su mitigación.

## Modelo de tenencia y de propiedad (lo primero que hay que tener claro)

| Objeto | Dueño | Identidad de quien opera |
|---|---|---|
| `dominio.opiniones_producto` | La **cuenta web** (`cuenta_cliente_id`), dentro de una **tienda** (`empresa_id`) de una **organización** (`organizacion_id`) | En la tienda: `private.cuenta_de_tienda(host)` (sale de `auth.uid()`; nunca del navegador). En el panel: `private.organizacion_id()` + `private.es_administrador_de(org)`. |
| Las siete RPC de la épica | Superficie del panel (`public`) o de la tienda (`publico`) | Ninguna recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id` del cliente: la única excepción es `listar_opiniones(p_empresa_id)`, que **valida que la tienda sea de la organización de la sesión** (42501 si no). |

La tabla tiene FK compuestas `(cuenta_cliente_id, organizacion_id, empresa_id)` → `public.cuentas_cliente`, `(empresa_id, organizacion_id)` → `dominio.empresas` y `(producto_id, organizacion_id)` → `dominio.productos`, todas `on delete cascade`: **una fila no puede mezclar organizaciones ni apuntar a una tienda distinta de la de su cuenta**.

## Barreras revisadas

| # | Amenaza | Barrera (dónde vive) | Prueba |
|---|---|---|---|
| 1 | Lectura o escritura de la tabla desde el navegador | `dominio.opiniones_producto` tiene **RLS activada sin políticas** y **ningún privilegio** para `anon`, `authenticated` ni `public`: solo escriben y leen las RPC `security definer`. `service_role` conserva el patrón de las tablas operativas de `dominio` (siembra, E2E, workers) | pgTAP `opiniones_privilegios.test.sql`, `opiniones_producto.test.sql`, `rls_en_toda_tabla`, `privilegios_anon_endurecidos` |
| 2 | Escalada de privilegios en la moderación | `public.listar_opiniones` y `public.moderar_opinion` exigen Administrador (`private.es_administrador_de`); para cualquier otro rol responden **42501**. `moderar_opinion` además acota por organización (`o.organizacion_id = v_org`): una opinión de otra organización no se encuentra | pgTAP `opiniones_moderacion.test.sql` (miembro, cuenta web y administrador de otra organización) |
| 3 | IDOR en la moderación | `moderar_opinion` recibe el `id` del navegador pero **carga la fila con el filtro de organización** y la bloquea (`for update`): lo de otra organización responde `no_encontrada`, y lo que cambió desde que la pantalla la mostró responde `conflicto` (40001) | pgTAP `opiniones_moderacion.test.sql` |
| 4 | Filtración entre tiendas (D8) | La identidad de tienda sale del **host** (`private.cuenta_de_tienda(host)`), nunca del navegador; la lectura pública resuelve la empresa por el host y filtra por `empresa_id` y `organizacion_id`. Cada opinion pertenece a la tienda de su cuenta | pgTAP `opiniones_lectura.test.sql`, `opiniones_cliente.test.sql` (tienda A vs. B) |
| 5 | Que el cliente publique sin moderar (RF-OPI-2) | Ninguna RPC del cliente recibe ni escribe `estado`: `guardar_opinion_por_dominio` nace siempre `pendiente` y editar una aceptada o rechazada la devuelve a `pendiente`. Solo `moderar_opinion` (Administrador) cambia el estado | pgTAP `opiniones_cliente.test.sql`, `opiniones_moderacion.test.sql` |
| 6 | Exposición de datos personales en público (D9) | La RPC de lectura devuelve una **lista blanca** de claves por fila (`id`, `nombre_pila`, `puntuacion`, `comentario`, `fecha`, `es_mia`): nunca apellido, correo, teléfono, estado, motivo ni identificadores. El nombre público es **la primera palabra** del nombre del cliente (≤ 30 caracteres), calculada al leer | pgTAP `opiniones_lectura.test.sql` (claves exactas por fila y ausencia de ids y correos) |
| 7 | Que un usuario vea lo que otro escribió | «Mis opiniones» y el borrado filtran por `cuenta_cliente_id` **y** organización **y** tienda; borrar una opinión ajena no la toca (y responde `ok` para no revelar su existencia) | pgTAP `opiniones_cliente.test.sql` |
| 8 | Texto no confiable (XSS) | El servidor valida el texto (`private.validar_texto_opinion`: 10–1.000 caracteres, sin caracteres de control, sin marcas de dirección o de ancho cero, **sin enlaces**); el front **nunca** lo interpreta como HTML: se pinta como nodo de React (`dangerouslySetInnerHTML` no aparece en la app) | pgTAP `opiniones_validacion.test.sql`; Vitest `OpinionesProducto.test.tsx` (un `<script>` se muestra literal) |
| 9 | Escalada por `security definer` | Las RPC son `security definer` con `search_path = ''`, sin SQL dinámico; los helpers de `private` no tienen `execute` para la API; cada RPC lleva `revoke … from public, anon` y `grant execute` explícito (las de lectura, además, a `anon`) | pgTAP `opiniones_privilegios.test.sql`; `privilegios_anon_endurecidos` |
| 10 | Abuso de cuota (D12) | Límite por visitante con el HMAC ya revisado (`private.visitante_publico` + `private.registrar_pedido_publico`): **10 llamadas por minuto** al escribir y **30** al leer, con claves propias (`opinion|escritura|…`, `opinion|lectura|…`). Las llamadas inválidas también cuentan (el cupo se consume antes de validar) y sin IP la cuota es única y falla cerrada | pgTAP `opiniones_limites.test.sql` |
| 11 | Inundación de opiniones | Topes por cuenta: **50 opiniones** y **10 pendientes** a la vez, contados sobre los productos **visibles hoy**; un lock por cuenta evita que dos altas simultáneas los superen | pgTAP `opiniones_cliente.test.sql` |
| 12 | Que la bandera apagada deje algo visible | Apagada: las RPC del cliente responden `sin_acceso` sin tocar datos, la lectura devuelve lista vacía y el panel solo permite **rechazar** (aceptar → 55000). En la base la comprueba la función, no el front | pgTAP `opiniones_bandera.test.sql`, `opiniones_moderacion.test.sql` |
| 13 | Fuga en la fusión de clientes | `public.fusionar_clientes` (Administrador) reasigna las opiniones a la cuenta que se mantiene **de la misma tienda** antes de dar de baja la otra, y conserva la más reciente cuando chocan; la respuesta de la función no cambia | pgTAP `opiniones_fusion.test.sql` |
| 14 | Enumeración de productos y de tiendas | Producto inexistente, oculto, inactivo, de otra tienda u otra organización responden **todos** `no_encontrado`; el host desconocido, la empresa desactivada y la tienda pausada responden **todos** `error` | pgTAP `opiniones_lectura.test.sql` |
| 15 | Filtrar datos por el motivo de rechazo | El motivo (≤ 200) se valida con las mismas reglas que el comentario (sin enlaces, sin saltos de línea) y solo lo ve el cliente autor y el administrador | pgTAP `opiniones_moderacion.test.sql`; Vitest `list.test.tsx` |
| 16 | Auditoría sin datos sensibles | El evento de Actividad (`opinion.aceptada`, `opinion.rechazada`) lleva **producto y puntuación, nunca el texto ni el motivo**, y está declarado como no sensible | pgTAP `opiniones_privilegios.test.sql` |

## Hallazgos menores y su resolución

- **H-1 · El resumen de la ficha hacía un escaneo completo del producto en cada visita** (límites / agotamiento de recursos).
  El promedio y la cantidad se recalculaban en **cada** llamada (también en cada «Cargar más») uniendo además `public.cuentas_cliente` y `dominio.clientes`: esas uniones son redundantes (las FK ya garantizan que la cuenta y el cliente existen), pero obligaban a leer el heap de cada opinión aceptada del producto, y con el cupo de 30 llamadas por minuto por visitante el costo se multiplicaba.
  **Resuelto** en `20270507000001_opiniones_resumen_indice.sql`: el resumen se calcula solo sobre `dominio.opiniones_producto` y se agrega el índice parcial cubriente `opiniones_producto_resumen_idx (empresa_id, organizacion_id, producto_id) include (puntuacion) where estado = 'aceptada'`, para que la agregación sea *index-only*. **El resultado no cambia**: son las mismas aceptadas de ese producto en esa tienda. Vigila: pgTAP `opiniones_resumen.test.sql`.
- **H-2 · El cliente del panel confiaba en la forma de la respuesta** (texto no confiable / disponibilidad).
  `listarOpiniones` se hacía cargo de las filas tal como venían: una fila con un `comentario` que no fuera texto rompía el render de la pantalla de moderación (React no puede pintar un objeto) y una fila con un estado desconocido se pintaba sin etiqueta.
  **Resuelto** en `apps/web/src/lib/opiniones.ts`: la fila se valida antes de mostrarse (id, tienda, cliente, producto y fechas presentes; puntuación entera de 1 a 5; estado conocido; texto de verdad texto) y, si no cumple, **se descarta** en lugar de romper la pantalla o ofrecerse para moderar. Mismo criterio que el cliente de la tienda (`tiendaOpiniones.ts`). Vigila: Vitest `opiniones.test.ts`.

## Riesgos aceptados (no se corrigen; con su mitigación)

- **El filtro de enlaces es una heurística**: no detecta ofuscación («ejemplo punto com», «ejemplo(.)com»), homógrafos cirílicos ni TLD fuera de la lista cerrada. **Mitigación**: la moderación previa es la defensa real (el administrador ve el texto antes de que se publique) y el filtro rechaza además una banda amplia de enlaces «normales». Detalle en [`tienda-opiniones.md`](./tienda-opiniones.md#limitación-del-filtro-de-enlaces).
- **La cuota por visitante es por IP y host**: muchas personas detrás de la misma IP (NAT, oficina, empresa) comparten el cupo de 10 escrituras por minuto, y sin cabecera `x-forwarded-for` todas comparten una sola cuota («sin-ip», falla cerrada). **Mitigación**: es el mismo limitador ya revisado de la tienda (MSF-946) y el cupo es holgado para el uso real.
- **`service_role` conserva privilegios sobre la tabla** (siembra, E2E y workers): puede leer y escribir opiniones sin pasar por la moderación. **Mitigación**: es el patrón de las tablas operativas de `dominio` y `service_role` nunca está en el navegador.
- **La bandera es legible por cualquier usuario autenticado** (`public.banderas_plataforma`): se puede saber qué banderas están encendidas. **Mitigación**: no es información sensible (son interruptores de producto, no secretos) y el front solo usa el valor para decidir si dibuja el bloque; el servidor sigue imponiendo el comportamiento.

## Pendientes que NO son de esta épica

- **Encender la bandera fuera de dev** (staging o producción) requiere una decisión nueva de Nicolás (D11): el script `scripts/tienda-opiniones-dev.mjs` **se niega** a operar fuera de dev a propósito.
- **Las respuestas del comercio** a las opiniones (el ticket las pedía y la decisión del 2026-11-15 solo cubre moderar) siguen **fuera de alcance**: son una columna nueva y una RPC nueva, no un ajuste de seguridad.
