# Implementation Plan: Opiniones de productos (MSF-467)

**Spec**: [`spec.md`](./spec.md) · **Contratos**: [`contracts/opiniones.md`](./contracts/opiniones.md) · **Tareas**: [`tasks.md`](./tasks.md)
**Alcance de entrega**: `refine` y `supabase`. Sin `kestra`, `superset` ni `workers` (D13: sin avisos).
**Estado**: **Fases 1 a 4 implementadas y mergeadas en `dokploy`** (F-OPI-01 en el PR #1044, F-OPI-02 y F-OPI-03 en el PR #1058). La fase 5 (cierre) está a medias: T027 (E2E) y T028 (documentación) están hechas; **T029, T030 y T031 siguen pendientes** y se ejecutan sobre `dokploy`. El PR #1045 de esta rama de épica se cerró **sin merge** (ver `## Estado de la rama y decisión de orquestación`).

## Resumen técnico

Una tabla nueva (`dominio.opiniones_producto`), funciones nuevas de `private`, `publico` y `public`, una bandera, y front en dos zonas: la **ficha y la cuenta de la tienda pública** y una **pantalla Opiniones del panel**. Ninguna función existente se redefine (riesgo 6 de la spec), salvo `private.conjuntos_exportacion_total()` (D14) y `public.fusionar_clientes` (T018, misma firma).

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
| IX Documentación | `docs/tienda-opiniones.md`, `docs/producto/opiniones.md`, `docs/tiendas-online.md`, roadmap, `mkdocs.yml` |

## Migraciones (aditivas; numeradas por encima de la cola de `dokploy`)

| Migración | Historia | Contenido | Reversión (posterior) |
|---|---|---|---|
| `20270341000000_opiniones_producto.sql` | F-OPI-01 | tabla, checks, FK compuestas, índices, RLS sin políticas, grants cero, bandera `tienda_opiniones` apagada | borrar bandera; `drop table` (exportar antes) |
| `20270341000100_opiniones_validacion.sql` | F-OPI-01 | `private.validar_texto_opinion`, `private.nombre_publico_cliente` | `drop function` |
| `20270341000200_opiniones_moderacion_rpc.sql` | F-OPI-01 | `public.listar_opiniones`, `public.moderar_opinion` (+ evento de Actividad) | `drop function` |
| `20270341000500_exportacion_total_opiniones.sql` | F-OPI-01 | la tabla entra en `conjuntos_exportacion_total` | restaurar la versión previa |
| `20270419000000_opiniones_cliente_rpc.sql` | F-OPI-02 | `publico.guardar_opinion_por_dominio`, `borrar_opinion_por_dominio`, `mis_opiniones_por_dominio` | `drop function` |
| `20270419000100_opiniones_lectura_publica.sql` | F-OPI-03 | `publico.opiniones_producto_por_dominio`, `publico.capacidades_opiniones_por_dominio` | `drop function` |
| `20270419000200_opiniones_fusion_clientes.sql` | F-OPI-02 (T018) | redefine `public.fusionar_clientes` (misma firma) para reasignar las opiniones a la cuenta que se mantiene | restaurar la función desde `20270340000210` |

**Renumeración (la corrección que faltaba en el PR #1045):** F-OPI-01 ocupó la ventana `20270341000000`–`20270341000500`. Cuando arrancaron F-OPI-02 y F-OPI-03, la ventana `20270341…` **ya no era mayor que la cola de `dokploy`**, así que su migración se renumeró a `20270419000000`+ (`20270419000100` y `20270419000200`). Cualquier migración **nueva** de esta épica tiene que ir **por encima de `20270419000200`**. `node scripts/verificar-migraciones.mjs --estricto` en cada fase.

## Fases

1. **F-OPI-01 · Base de datos y bandera** (sin efecto visible): tabla, validación, bandera, exportación. — **Hecha** (PR #1044).
2. **F-OPI-01 · Moderación** (panel, US1): RPC del panel y pantalla; con datos sembradas se puede probar sin la tienda. — **Hecha** (PR #1044).
3. **F-OPI-02 · Opinar** (tienda, US2): RPC del cliente, formulario, «Mis opiniones». — **Hecha** (PR #1058).
4. **F-OPI-03 · Leer** (tienda, US3): RPC de lectura y capacidades, bloque en la ficha. — **Hecha** (PR #1058).
5. **Cierre**: E2E de punta a punta (T027 ✓), docs (T028 ✓), **revisión de seguridad (T029 ☐), encendido en dev (T030 ☐) y guards finales (T031 ☐)**.

Las fases se invocaron una por una (regla de `/speckit-implement`), con `/clear` entre cada una. El **plan de ejecución por historia** (tabla `Historia | Depende de | Grupo` y su Mermaid) está al final de `tasks.md`: es la autoridad que consume el orquestador. Los flujos que manda el prototipo (máquina de estados, secuencia de moderación, alta desde la tienda y lectura en la ficha) están dibujados en la sección `## Flujos` de `spec.md`.

## Front (`apps/web`)

- **Panel**: `pages/opiniones/list.tsx` (lazy), `lib/opiniones.ts`, `hooks/useOpinionesPanel.ts`; `FiltroEmpresa`, `EncabezadoPagina`, estados compartidos; diálogo de motivo.
- **Tienda**: `pages/tienda-publica/opiniones/` (`OpinionesProducto`, `EstrellasPuntuacion`, `FormularioOpinion`, `MisOpiniones`, `validacion.ts` espejo del servidor), `lib/tiendaOpiniones.ts`, `hooks/useCapacidadOpiniones.ts`; el bloque se monta en la ficha solo si `capacidades_opiniones_por_dominio` devuelve `opiniones:true`.
- Texto siempre como nodos de React (nunca `dangerouslySetInnerHTML`).

## Estado de la rama y decisión de orquestación

**🛡️ El release a DEV está trabado, y no es un conflicto a resolver.**

- El PR #1045 (`epic/MSF-467-tiendas-online-opiniones` → `dokploy`) lleva solo 2 commits de **docs** sobre una foto de `spec.md`/`plan.md`/`tasks.md` **anterior** a la implementación real. La implementación real (fases 1 a 5) ya está en `dokploy` por el PR #1044 y el PR #1058, con QA y Código/Seguridad aprobados y CI verde.
- Mergear el PR #1045 **pisaría** la evidencia de `dokploy` (su copia de `tasks.md` tiene T001 sin marcar). El conflicto de merge es una **rama de épica stale**, no un bug: mismo patrón que MSF-265/MSF-948.
- **El PR #1045 se cerró sin merge** (sin tocar código, con el motivo explicado en el PR). Los PRs #1068 y #1069, regenerados por Release con la misma cabeza, se cerraron igual.
- **Pendiente real**: T029, T030 y T031, que siguen su curso normal del SDLC **sobre `dokploy`**. No dependen del PR cerrado.
- **Causa raíz**: Release generó 3 PRs idénticos sin rebasar, ignorando la etiqueta `desarrollo-manual`. Se abrió **MSF-984** (hija de MSF-515) para que Release filtre esa label antes de reintentar.
- **Rebase**: es trabajo **manual de Nicolás**. Hasta que esta rama se rebasee contra `dokploy`, la épica queda flaggeada (`sindrome-bloqueo-importante`, `sindrome-escalado-humano`, `desarrollo-manual`) y **no se pide otro merge**.
- **Qué aporta esta rama**: el contenido documental corregido (este `plan.md`, el `spec.md` y el `tasks.md` reescritos) es justamente lo que faltaba en el PR #1045. Sirve de referencia para el rebase manual y para el cierre; **no** es una rama de release.

## Riesgos técnicos

- `private.registrar_pedido_publico` cuenta por minuto: se usa con claves nuevas (`opinion|escritura|` 10 por minuto, `opinion|lectura|` 30 por minuto); **no se modificó** la función existente, así que los pgTAP de búsqueda y pedidos siguen greens (T020).
- El cursor de ficha y panel usa `(creada_en, id)` con desempate; probado con filas de la misma fecha.
- El promedio se calcula al leer con el índice parcial; con ~10.000 opiniones por producto sigue siendo una agregación indexada. Si se midiera lento, se denormaliza después sin cambiar el contrato.
- **Límite por visitante y NAT**: muchos clientes tras una misma IP comparten cupo (10 por minuto); es el mismo riesgo aceptado del formulario de contacto y de pedidos.
