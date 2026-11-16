---
owner: tecnico
sources:
  - specs/20270328-100000-opiniones-de-productos
  - supabase/migrations/20270341000000_opiniones_producto.sql
  - supabase/migrations/20270341000100_opiniones_validacion.sql
  - supabase/migrations/20270341000200_opiniones_moderacion_rpc.sql
  - supabase/migrations/20270341000500_exportacion_total_opiniones.sql
  - apps/web/src/pages/opiniones
---

# Opiniones de productos: base y moderación (MSF-467)

Guía de referencia de las **fases 1 («Base») y 2 («Moderación»)** de la spec `20270328-100000-opiniones-de-productos`. Las fases 3 («Opinar»), 4 («Leer») y 5 («Cierre») **no están implementadas**: las opiniones **no se muestran** en la tienda pública y los clientes todavía no pueden escribirlas desde ella. Nada de lo descripto acá cambia lo que ve un visitante.

## Qué hay

| Objeto | Esquema | Detalle |
|---|---|---|
| `dominio.opiniones_producto` | `dominio` | Opinión de una cuenta web sobre un producto de su tienda: puntuación 1–5, comentario, estado `pendiente`/`aceptada`/`rechazada`, motivo (≤ 200), quién y cuándo moderó, `actualizada_en` para el bloqueo optimista |
| `private.validar_texto_opinion`, `private.texto_opinion_no_permitido`, `private.nombre_publico_cliente` | `private` | Validación del texto (largo, control, marcas de dirección, enlaces) y nombre de pila; sin `execute` para la API |
| `public.listar_opiniones`, `public.moderar_opinion` | `public` | RPC del panel, solo Administrador (`42501` para otro rol) |
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

## Pantalla

`/opiniones` (carga diferida), entrada **Canales → Opiniones** solo para el Administrador. Filtro de tienda con `FiltroEmpresa`, contadores, filtros de estado, carga infinita y diálogo de motivo. Al cambiar la empresa activa se recargan lista y contadores y el diálogo de rechazo abierto se cierra con aviso.

## Limitación del filtro de enlaces

`private.texto_opinion_no_permitido` es una **heurística** `invoker` (pura, sin acceso a tablas). Detecta `http:`/`www.`, dominios con un TLD de **lista cerrada** (genéricos y de país como `.ar`, `.com.ar`, `.mx`, `.cl`, `.ly`, `.be`), acortadores como `t.me/`, `wa.me/`, `bit.ly/`, `youtu.be/`, `tinyurl.com/`, y normaliza al punto ASCII los puntos «。» (U+3002), «．» (U+FF0E), «｡» (U+FF61), «․» (U+2024) y «﹒» (U+FE52). Los TLD que son palabras comunes (`es`, `me`, `de`, `to`, `it`, `at`, `in`, `se`, `ve`) solo cuentan si no los sigue un espacio y lo anterior tiene forma de dominio (4 o más caracteres, guion o dígito): «mi-tienda.es,» se rechaza y «diario.es genial» pasa; con barra siempre se rechaza (`wa.me/…`). Un punto con espacio detrás no es enlace. **No detecta** ofuscación («ejemplo punto com», «ejemplo(.)com», «ejemplo[.]com»), homógrafos cirílicos ni TLD fuera de la lista. La palabra `http` suelta, sin dos puntos, se acepta a propósito. **Falso positivo residual aceptado:** «Lo uso en casa.Es» o «Es buenísimo.Se» (palabra de 4 o más caracteres, punto pegado y un TLD ambiguo, aunque vaya capitalizado, al final del texto o antes de puntuación) se rechazan: son indistinguibles de `mitienda.es`, y es preferible que el administrador lo vea en la moderación a dejar pasar enlaces de ese tipo. Con 200.000 caracteres hostiles tarda de 60 a 130 ms según la entrada (crecimiento lineal). La moderación previa es la defensa real; la fase 3 hereda este límite.

## Reversión

Migraciones aditivas; se deshacen con una migración posterior, sin ejecutarla en el mismo PR: `drop function` de las RPC y de las funciones `private`, restaurar `private.conjuntos_exportacion_total()` a la versión de `20270334000002`, borrar la bandera y los tipos de evento, y `drop table dominio.opiniones_producto` (exportar antes: pierde las opiniones). Apagar la bandera deja todo inerte sin tocar datos.
