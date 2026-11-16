# Plan de implementación: Inicio y alertas (MSF-156)

**Spec**: [`spec.md`](./spec.md) · **Contratos**: [`contracts/inicio-y-alertas.md`](./contracts/inicio-y-alertas.md)

## Enfoque técnico

- **Refine** (`apps/web`): página `pages/inicio/` (tarjetas independientes, cada una con su consulta y su estado de error), reemplaza `Home` en la ruta `index`; ítem de navegación en `destinosPanel.ts`; campo de búsqueda global en `EncabezadoPanel`. Estados con `EstadoVacio`/`EstadoError`/`EstadoCargaPagina`; layout con `ContenidoAdaptable`.
- **Permisos**: la visibilidad de cada tarjeta sale de `ContextoPanel` (`contexto_panel_actual()`); la seguridad real vive en la base (`security_invoker` + `private.nivel_seccion`).
- **Empresa activa** (Principio VIII): todas las consultas llevan la empresa activa en su `queryKey`; al cambiar se invalidan (patrón de `docs/empresa-activa.md`).
- **Supabase**: una migración por historia con objetos propios (F-INI-02 y F-INI-03 no comparten tabla ni archivo). F-INI-01 no migra.
- **Kestra**: flow `infra/kestra/flows/alertas-inicio.yml` → Edge Function `recalcular-alertas-inicio` (token compartido, como `avisos-reposicion-stock`); la base calcula y registra, no dispara HTTP.
- **Mercado Libre / precios en revisión**: la tarjeta y el tipo de alerta se condicionan con `tiene_feature`; no se implementan hasta las épicas de Mercado Libre.

## Esquemas y reversión (aditivo)

| Migración | Historia | Objetos | Reversión |
|---|---|---|---|
| `…_alertas_inicio_tabla.sql` | F-INI-02 | `dominio.alertas_inicio`, RLS, índices | `drop table dominio.alertas_inicio;` (migración posterior) |
| `…_alertas_inicio_recalculo.sql` | F-INI-02 | `public.recalcular_alertas_inicio`, `public.alertas_inicio_visibles` | `drop view …; drop function …;` |
| `…_busqueda_global_productos.sql` | F-INI-03 | `public.buscar_productos_global` | `drop function public.buscar_productos_global(text, int);` |

Cada tabla/vista/RPC re-verificada contra el Principio VII (spec → plan → tareas → implementación → PR).

## Riesgos

- Recalcular por organización con muchos productos: una sola consulta agregada por tipo, no por producto.
- La Edge Function y su token son infraestructura nueva: variables en `.env.example`, documentadas en `docs/`.
