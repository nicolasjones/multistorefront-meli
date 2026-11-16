---
owner: tecnico
sources:
  - specs/20270328-100000-opiniones-de-productos
  - supabase/migrations/20270341000000_opiniones_producto.sql
  - supabase/migrations/20270341000100_opiniones_validacion.sql
  - supabase/migrations/20270341000200_opiniones_moderacion_rpc.sql
  - supabase/migrations/20270341000500_exportacion_total_opiniones.sql
  - supabase/migrations/20270419000000_opiniones_cliente_rpc.sql
  - supabase/migrations/20270419000100_opiniones_lectura_publica.sql
  - supabase/migrations/20270419000200_opiniones_fusion_clientes.sql
  - apps/web/src/pages/opiniones
  - apps/web/src/pages/tienda-publica/opiniones
  - apps/web/src/lib/tiendaOpiniones.ts
  - apps/web/e2e/tienda-opiniones.e2e.ts
---

# Opiniones de productos: moderación y tienda (MSF-467)

Guía de referencia de la spec `20270328-100000-opiniones-de-productos`: fases 1 («Base») y 2 («Moderación»), 3 («Opinar»), 4 («Leer») y 5 («Cierre»). Todo está detrás de la bandera `tienda_opiniones`, **apagada por defecto en todo entorno**: con la bandera apagada la ficha del producto y «Mi cuenta» son idénticas a las de antes y las RPC de la tienda no tocan datos. La bandera se enciende solo en dev, con SQL del equipo técnico (ver «Encender y apagar»).

## Qué hay

| Objeto | Esquema | Detalle |
|---|---|---|
| `dominio.opiniones_producto` | `dominio` | Opinión de una cuenta web sobre un producto de su tienda: puntuación 1–5, comentario, estado `pendiente`/`aceptada`/`rechazada`, motivo (≤ 200), quién y cuándo moderó, `actualizada_en` para el bloqueo optimista |
| `private.validar_texto_opinion`, `private.texto_opinion_no_permitido`, `private.nombre_publico_cliente` | `private` | Validación del texto (largo, control, marcas de dirección, enlaces) y nombre de pila; sin `execute` para la API |
| `public.listar_opiniones`, `public.moderar_opinion` | `public` | RPC del panel, solo Administrador (`42501` para otro rol) |
| `publico.guardar_opinion_por_dominio`, `borrar_opinion_por_dominio`, `mis_opiniones_por_dominio` | `publico` | RPC de la cuenta web (solo `authenticated`): crear o editar, borrar y listar las propias |
| `publico.opiniones_producto_por_dominio`, `capacidades_opiniones_por_dominio` | `publico` | Lectura pública (`anon` y `authenticated`) de las opiniones aceptadas de un producto y de la capacidad para dibujar el bloque |
| `private.limite_opiniones_escritura_por_minuto`, `private.limite_opiniones_lectura_por_minuto` | `private` | Topes por minuto y por visitante (10 y 30); sin `execute` para la API |
| Bandera `tienda_opiniones` | `public.banderas_plataforma` | Apagada por defecto en todo entorno; ninguna migración la enciende |
| Tipos `opinion.aceptada` / `opinion.rechazada` | `public.tipos_evento_actividad` | **No sensibles** (no llevan valor anterior/nuevo: son decisiones de moderación); el detalle lleva producto y puntuación, nunca el texto ni el motivo |

## Reglas de la tabla

- FK compuestas `(cuenta_cliente_id, organizacion_id, empresa_id)` → `public.cuentas_cliente`, `(empresa_id, organizacion_id)` → `dominio.empresas` y `(producto_id, organizacion_id)` → `dominio.productos`, todas `on delete cascade`: una fila no puede mezclar organizaciones ni apuntar a una tienda distinta de la de su cuenta.
- Única `(cuenta_cliente_id, producto_id)`; checks de puntuación, largo del comentario, estado, motivo (solo con `rechazada`) y moderación (`moderada_por`/`moderada_en` presentes si y solo si el estado no es `pendiente`).
- RLS activada **sin políticas** y sin privilegios para `anon`, `authenticated` ni `public`; solo `service_role` conserva el patrón de las tablas operativas de `dominio` (siembra y E2E). Escriben únicamente las RPC `security definer`.
- Entra en la exportación total de la organización (`private.conjuntos_exportacion_total`).

## RPC del panel

- `public.listar_opiniones(p_estado, p_empresa_id, p_desde_creada, p_desde_id, p_limite)`: filas por tandas (cursor `(creada_en, id)`, 1–50) y **contadores** Pendientes/Aceptadas/Rechazadas del ámbito de la tienda (no del filtro de estado). Muestra el nombre completo del cliente.
- `public.moderar_opinion(p_id, p_decision, p_motivo, p_actualizada_en_esperada)`: `aceptar` o `rechazar` (una decisión nula o desconocida responde `22023`); idempotente (repetir la decisión vigente responde `ok` sin duplicar el evento); bloqueo optimista (`40001`, mensaje `conflicto`); con la bandera apagada, `aceptar` responde `55000` y `rechazar` sigue permitido.
  - **Repetir «rechazar» con otro motivo** responde `ok` pero **no actualiza** `motivo_rechazo`: es idempotente a propósito (se conserva el primero).
  - **Con la bandera apagada, aceptar una opinión que ya está aceptada también da `55000`** (no un `ok` idempotente): se mantiene lo definido en la spec (D11); la comprobación de la bandera va antes de la de idempotencia.
  - El **motivo** (hasta 200 caracteres tras recortar) se valida con las mismas reglas que el comentario: sin caracteres de control (saltos de línea), marcas de dirección o de ancho cero, ni enlaces (`22023` con mensaje «caracteres no permitidos», distinto del de largo). El panel normaliza saltos y espacios múltiples a un espacio antes de enviar.

`listar_opiniones` pide `límite + 1` filas ya ordenadas (sin ventana sobre toda la organización); el índice `opiniones_producto_orden_idx (organizacion_id, creada_en desc, id desc)` sirve el orden global.

Ambas llevan `revoke … from public, anon` y `grant execute … to authenticated`.

## RPC de la tienda (`publico`)

Reglas comunes: `security definer`, `search_path` vacío, ninguna recibe cliente, cuenta, empresa ni organización (todo sale de `private.cuenta_de_tienda(host)`), orden **bandera → cuenta → límite → validar → trabajar**, y el `exception when others` registra solo `sqlstate`. `sin_acceso` es idéntico para sin sesión, cuenta suspendida, cliente no habilitado, usuario del panel, otra tienda u organización, host desconocido, tienda pausada y bandera apagada.

- `guardar_opinion_por_dominio(host, producto_id, puntuacion, comentario)`: **upsert por (cuenta, producto)**. Una opinión nueva o con contenido distinto queda siempre `pendiente` (limpia motivo y moderación); el mismo contenido responde `ok` sin cambiar estado, fecha ni cupo. El cliente nunca envía el estado. Topes: 50 opiniones por cuenta (`limite_opiniones`) y 10 pendientes a la vez (`limite_pendientes`), contando **solo las opiniones de productos visibles hoy**: una opinión sobre un producto que se ocultó, se desactivó o cambió de categoría oculta no ocupa cupo ni se lista (como los favoritos) y reaparece, contando de nuevo, si el producto vuelve a ser visible; por eso, tras volver a publicar productos, una cuenta puede superar transitoriamente el tope. Solo sobre productos efectivamente visibles en la tienda (`no_encontrado` idéntico para inexistente, oculto, inactivo, de otra tienda u organización). Inválido: `{estado:"invalido", campos:[…]}`.
- `borrar_opinion_por_dominio(host, producto_id)`: borra la propia; idempotente (borrar una inexistente es `ok`); no exige que el producto siga visible.
- `mis_opiniones_por_dominio(host, desde_creada, desde_id, limite)`: las de la cuenta, con estado y motivo de rechazo, nuevas primero, cursor `(creada_en, id)` y límite 1–50 (20). Comparte el cupo de lectura (30 por minuto por visitante) y responde `limite` al superarlo; el front lo muestra como el error con «Reintentar». Esto **suma un estado `limite` al contrato** de esta RPC (ver `contracts/opiniones.md`). El catálogo efectivo de la tienda se evalúa una sola vez por llamada.
- `opiniones_producto_por_dominio(host, producto_id, desde_creada, desde_id, limite)`: el resumen y la lista salen del mismo conjunto de aceptadas (con su cuenta y su cliente). Resumen `{promedio (un decimal), cantidad}` y solo las **aceptadas** de ese producto en esa tienda, con **lista blanca** de campos (`id`, `nombre_pila`, `puntuacion`, `comentario`, `fecha`, `es_mia`): nunca estado, motivo, apellido, correo ni identificadores. Con la bandera apagada devuelve una lista vacía. Lo aceptado de una cuenta suspendida sigue visible; un producto oculto no muestra ni cuenta opiniones (no se borran). Para validar que el producto es visible se evalúa el catálogo efectivo de la tienda (`private.catalogo_tienda_efectivo`, la misma regla única que usan la ficha, los favoritos y el presupuesto; no se duplica para un solo producto) y el costo queda acotado por el cupo de 30 llamadas por minuto por visitante.
- `capacidades_opiniones_por_dominio(host)`: `{estado:"ok", opiniones:true|false}`; host desconocido, empresa desactivada y tienda pausada responden `{estado:"error"}`.
- **Límites por visitante** (HMAC, `private.registrar_pedido_publico`): escritura (guardar y borrar) 10 por minuto con la clave `opinion|escritura|…`; lectura 30 por minuto con `opinion|lectura|…`. Cuentan también las llamadas inválidas (el cupo se consume antes de validar) y, sin cabecera `x-forwarded-for`, todos comparten un único cupo («sin-ip»). Sin cuenta o con la bandera apagada no se gasta cupo.
- **Fusión de clientes** (`20270419000200_opiniones_fusion_clientes.sql`, redefine `public.fusionar_clientes`): antes de dar de baja la cuenta web no elegida, sus opiniones se **reasignan** a la cuenta que se mantiene de la misma tienda. Si las dos opinaron el mismo producto (única cuenta + producto) se conserva la **más reciente** por `actualizada_en` (empate: la de la cuenta que se mantiene) y la otra se descarta. La respuesta de la función no cambia. Solo se pierde la opinión de una tienda donde la cuenta que se mantiene no tiene cuenta (la FK compuesta exige la misma tienda).

## Tienda pública (front)

- **Ficha** (`/producto/:id`): el bloque «Opiniones» (`pages/tienda-publica/opiniones/OpinionesProducto.tsx`, carga diferida) solo se monta si `capacidades_opiniones_por_dominio` dice `true`. Muestra el promedio y la cantidad, las opiniones por tandas con «Cargar más», y, con sesión, el formulario «Tu opinión» (estrellas con teclado, contador de caracteres, errores por campo y el aviso «se publicará cuando la revisemos»); sin sesión, una invitación a ingresar. El texto de una opinión siempre se pinta como texto de React (nunca como HTML).
- **Mi cuenta**: «Mi cuenta» existe solo con la bandera `tienda_pedidos` encendida; con `tienda_opiniones` también encendida aparece la pestaña «Mis opiniones» (`?seccion=opiniones`): estado de cada opinión («Pendiente de revisión», «Publicada», «Rechazada» con su motivo), editar (vuelve a pendiente) y borrar con confirmación.
- La validación del cliente (`validacion.ts`) es un **espejo** de `private.validar_texto_opinion` para avisar antes de enviar; el servidor manda siempre.

## Encender y apagar

La bandera se enciende solo en dev, con SQL del equipo técnico (ninguna migración ni despliegue la enciende):

```sql
update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones';
```

Para apagarla (reversión operativa inmediata, sin tocar datos): el mismo `update` con `activa = false`. Apagada, la ficha y «Mi cuenta» son idénticas a las de antes; el panel solo permite rechazar. Staging y producción quedan apagados (D11).

## Pantalla del panel

`/opiniones` (carga diferida), entrada **Canales → Opiniones** solo para el Administrador. Filtro de tienda con `FiltroEmpresa`, contadores, filtros de estado, carga infinita y diálogo de motivo. Al cambiar la empresa activa se recargan lista y contadores y el diálogo de rechazo abierto se cierra con aviso.

## Limitación del filtro de enlaces

`private.texto_opinion_no_permitido` es una **heurística** `invoker` (pura, sin acceso a tablas). Detecta `http:`/`www.`, dominios con un TLD de **lista cerrada** (genéricos y de país como `.ar`, `.com.ar`, `.mx`, `.cl`, `.ly`, `.be`), acortadores como `t.me/`, `wa.me/`, `bit.ly/`, `youtu.be/`, `tinyurl.com/`, y normaliza al punto ASCII los puntos «。» (U+3002), «．» (U+FF0E), «｡» (U+FF61), «․» (U+2024) y «﹒» (U+FE52). Los TLD que son palabras comunes (`es`, `me`, `de`, `to`, `it`, `at`, `in`, `se`, `ve`) solo cuentan si no los sigue un espacio y lo anterior tiene forma de dominio (4 o más caracteres, guion o dígito): «mi-tienda.es,» se rechaza y «diario.es genial» pasa; con barra siempre se rechaza (`wa.me/…`). Un punto con espacio detrás no es enlace. **No detecta** ofuscación («ejemplo punto com», «ejemplo(.)com», «ejemplo[.]com»), homógrafos cirílicos ni TLD fuera de la lista. La palabra `http` suelta, sin dos puntos, se acepta a propósito. **Falso positivo residual aceptado:** «Lo uso en casa.Es» o «Es buenísimo.Se» (palabra de 4 o más caracteres, punto pegado y un TLD ambiguo, aunque vaya capitalizado, al final del texto o antes de puntuación) se rechazan: son indistinguibles de `mitienda.es`, y es preferible que el administrador lo vea en la moderación a dejar pasar enlaces de ese tipo. Con 200.000 caracteres hostiles tarda de 60 a 130 ms según la entrada (crecimiento lineal). La moderación previa es la defensa real; la fase 3 hereda este límite.

## Reversión

Migraciones aditivas; se deshacen con una migración posterior, sin ejecutarla en el mismo PR (la fusión de clientes se restaura desde `20270340000210`, con `dominio.clientes`): `drop function` de las RPC (panel y tienda: `guardar_opinion_por_dominio`, `borrar_opinion_por_dominio`, `mis_opiniones_por_dominio`, `opiniones_producto_por_dominio`, `capacidades_opiniones_por_dominio`) y de las funciones `private` (incluidos los dos topes por minuto), restaurar `private.conjuntos_exportacion_total()` a la versión de `20270334000002`, borrar la bandera y los tipos de evento, y `drop table dominio.opiniones_producto` (exportar antes: pierde las opiniones). Apagar la bandera deja todo inerte sin tocar datos.
