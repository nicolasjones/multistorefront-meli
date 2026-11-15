# Implementation Plan: Opiniones de productos (MSF-467)

**Spec**: [`spec.md`](./spec.md) · **Contratos**: [`contracts/opiniones.md`](./contracts/opiniones.md) · **Tareas**: [`tasks.md`](./tasks.md)
**Alcance de entrega**: `refine` y `supabase`. Sin `kestra`, `superset` ni `workers` (D13: sin avisos). **Estado**: plan, sin implementar.

## Resumen técnico

Una tabla nueva (`dominio.opiniones_producto`), funciones nuevas de `private`, `publico` y `public`, una bandera, y front en dos zonas: la **ficha y la cuenta de la tienda pública** y una **pantalla Opiniones del panel**. Ninguna función existente se redefine (riesgo 6 de la spec), salvo `private.conjuntos_exportacion_total()` (D14).

## Constitución: verificación

| Principio | Cómo se cumple |
|---|---|
| I Aislamiento | RLS sin políticas ni privilegios; FK compuestas con organización y tienda; identidad solo de `cuenta_de_tienda(host)`; pgTAP de aislamiento entre tiendas y organizaciones |
| II Spec antes | Esta spec y sus RF/CA numerados |
| III Idempotencia y auditoría | `guardar` idempotente; moderación idempotente con evento de Actividad |
| IV Despliegues | Sin servicios nuevos |
| V Simplicidad | Sin Kestra/workers; reutiliza límite HMAC, banderas y cuenta web |
| VI Panel | Entrada de menú, ruta, audiencia, carga infinita, estados compartidos, 320/768/1440 px, teclado |
| VII Esquemas | Tabla en `dominio`; RPC en `publico`/`public`; lógica en `private` (tabla de la spec; **se re-verifica en cada fase**) |
| VIII Empresa activa | Fila en la matriz, test que cambia de empresa con el diálogo abierto |
| IX Documentación | `docs/tienda-opiniones.md`, `docs/tiendas-online.md`, roadmap, `mkdocs.yml` |

## Migraciones (aditivas, ventana `20270341000000`+)

| Migración | Contenido | Reversión (posterior) |
|---|---|---|
| `20270341000000_opiniones_producto.sql` | tabla, checks, FK compuestas, índices, RLS sin políticas, grants cero, bandera `tienda_opiniones` apagada | borrar bandera; `drop table` (exportar antes) |
| `20270341000100_opiniones_validacion.sql` | `private.validar_texto_opinion`, `private.nombre_publico_cliente` | `drop function` |
| `20270341000200_opiniones_moderacion_rpc.sql` | `public.listar_opiniones`, `public.moderar_opinion` (+ evento de Actividad) | `drop function` |
| `20270341000300_opiniones_cliente_rpc.sql` | `publico.guardar_opinion_por_dominio`, `borrar_opinion_por_dominio`, `mis_opiniones_por_dominio` | `drop function` |
| `20270341000400_opiniones_lectura_publica.sql` | `publico.opiniones_producto_por_dominio`, `publico.capacidades_opiniones_por_dominio` | `drop function` |
| `20270341000500_exportacion_total_opiniones.sql` | la tabla entra en `conjuntos_exportacion_total` | restaurar la versión previa |

`node scripts/verificar-migraciones.mjs --estricto` en cada fase; rebasar con `origin/dokploy` y renumerar si otra rama ocupó la ventana. Antes de redefinir `conjuntos_exportacion_total` se lee su **última** versión en `dokploy`.

## Fases

1. **Base de datos y bandera** (sin efecto visible): tabla, validación, bandera, exportación.
2. **Moderación** (panel, US1): RPC del panel y pantalla; con datos sembrados se puede probar sin la tienda.
3. **Opinar** (tienda, US2): RPC del cliente, formulario, «Mis opiniones».
4. **Leer** (tienda, US3): RPC de lectura y capacidades, bloque en la ficha.
5. **Cierre**: E2E de punta a punta, docs, roadmap, encendido en dev y guards finales.

Las fases se invocan una por una (regla de `/speckit-implement`), con `/clear` entre cada una.

## Front (`apps/web`)

- **Panel**: `pages/opiniones/list.tsx` (lazy), `lib/opiniones.ts`, hooks de listado con cursor y de moderación; `FiltroEmpresa`, `EncabezadoPagina`, estados compartidos, `Switch` no aplica; diálogo de motivo.
- **Tienda**: `pages/tienda-publica/opiniones/` (`OpinionesProducto`, `EstrellasPuntuacion`, `FormularioOpinion`, `MisOpiniones`, `validacion.ts` espejo del servidor), `lib/tiendaOpiniones.ts`, `hooks/useOpinionesTienda.ts`; el bloque se monta en la ficha solo si `capacidades_opiniones_por_dominio` devuelve `opiniones:true`.
- Texto siempre como nodos de React (nunca `dangerouslySetInnerHTML`).

## Riesgos técnicos

- `private.registrar_pedido_publico` cuenta por minuto: se usa con claves nuevas; si su firma o el tope fijo no sirven, se agrega un parámetro **sin romper** las llamadas existentes (tarea T020 lo verifica).
- El cursor de ficha y panel debe usar `(creada_en, id)` con desempate; probado con filas de la misma fecha.
- El promedio se calcula al leer con el índice parcial; con ~10.000 opiniones por producto sigue siendo una agregación indexada. Si se midiera lento, se denormaliza después sin cambiar el contrato.
