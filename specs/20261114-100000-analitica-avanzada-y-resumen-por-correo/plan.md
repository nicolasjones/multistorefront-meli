# Plan: Analítica avanzada y resumen por correo (MSF-265)

**Spec**: [`spec.md`](./spec.md) · **Estado**: implementado; decisiones P1–P4 cerradas (ver «Decisiones confirmadas» de la spec).

## Enfoque

- **F-REP-07 (elegir, no armar)**: una galería nueva (`/reportes/tableros`) sobre el componente de embebido existente (`ReporteEmbebido`) y la Edge Function `emitir-acceso-reporte`, **sin cambiarlos**. Las piezas nuevas son datos y UI: dos vistas `analitica` (cruces con la categoría), dos tableros versionados en YAML (`infra/superset/dashboards/analitica-avanzada/`), su alta en el catálogo `public.reportes` con asignación automática a todas las organizaciones, un catálogo en el código (`lib/tablerosAnaliticos.ts`) que describe cada tablero (cruces y filtros) y la pantalla. La regla de la spec 007 (el administrador no entra a Superset) no se toca: **no hay excepción de seguridad que documentar**.
- **F-REP-08 (patrón de MSF-394/405)**: flow de Kestra `resumen-semanal` (lunes 08:00 y cada 15 minutos, zona `America/Argentina/Buenos_Aires`) → Edge Function `enviar-resumen-semanal` (token compartido `RESUMEN_SEMANAL_TOKEN`) → RPC de `service_role` (`generar_resumen_semanal`, `cerrar_resumen_semanal`, `organizaciones_con_resumen_semanal_pendiente`) → SMTP del proyecto. La base calcula, congela el contenido y registra (un resumen por organización y semana, reserva de 2 minutos, tope de 5 intentos); la función arma el texto y envía; Kestra solo dispara. La pausa por organización y el evento en Actividad viven en dos RPC de la app solo para administradores; la baja personal reutiliza `tipos_aviso`/`preferencias_aviso` de MSF-189.

## Esquemas (Principio VII, re-verificado en spec, plan, tareas, implementación y revisión)

| Objeto | Esquema | Por qué |
|---|---|---|
| Vistas `analitica.ventas_empresa_categoria` y `analitica.margen_real_categoria` | `analitica` (solo vistas) | Contrato de lectura para Superset; no almacenan datos |
| Filas de catálogo en `public.reportes` y tablas hermanas; fila `resumen_semanal` en `public.tipos_aviso` | `public` (plataforma) | Catálogo transversal de reportes y de avisos: dato, no estructura |
| `public.resumen_semanal_config`, `public.resumen_semanal_envios` | `public` (plataforma) | Configuración por organización y outbox de un aviso de plataforma (como `organizaciones_features` y `avisos_pendientes`); **no** son entidades del negocio, así que no van en `dominio` |

Las dos tablas nuevas quedan fuera de la exportación total (`private.exclusiones_exportacion_total()`, migración `20270324100300`), con RLS activada y sin políticas ni privilegios para `anon`/`authenticated` (solo `security definer`).

## Migraciones (todas aditivas e idempotentes; reversión en el encabezado de cada una)

| Migración | Contenido |
|---|---|
| `20270324100000_analitica_tableros_avanzados.sql` | Vistas `analitica.ventas_empresa_categoria` y `analitica.margen_real_categoria` (`select` solo para `superset_analitica`) |
| `20270324100100_reportes_tableros_analiticos.sql` | 2 filas en `public.reportes` (prefijo «Analítica · »), roles por defecto, 3 disparadores de asignación a todas las organizaciones y backfill |
| `20270324100200_resumen_semanal.sql` | Tablas, tipo de aviso, contenido (`armar_resumen_semanal`), generación/cierre, configuración y estado; privilegios exactos |
| `20270324100300_exportacion_total_excluye_resumen_semanal.sql` | Redefine `private.exclusiones_exportacion_total()` con las dos tablas nuevas (rebasar si otra migración posterior a `20270320100500` la redefine) |

## Contratos / OpenAPI

Los contratos están en `contracts/`. Las Edge Functions de esta spec no se llaman desde el navegador ni son API pública: **sin cambios en `openapi/*.json`**. `emitir-acceso-reporte` no cambia de firma.

## Piezas fuera de la base

`supabase/functions/enviar-resumen-semanal/`, `infra/kestra/flows/resumen-semanal.yml` (+ variables en `infra/kestra/compose.yaml` y `.env.example`), `supabase/config.toml` (secreto del runtime), `.github/workflows/deploy-infraestructura-vps.yml` (importa los tableros), `apps/web` (`lib/tablerosAnaliticos.ts`, `pages/reportes/Tableros.tsx`, `pages/organizacion/ResumenSemanal.tsx`, destino de menú, ayuda).

## Documentación

`docs/analitica-avanzada.md` y `docs/resumen-semanal-correo.md` (técnico), `docs/producto/tableros-analiticos.md` (manual), `docs/revision-seguridad-analitica-avanzada.md` (revisión integral), y actualizaciones de `docs/operar-superset.md`, `docs/avisos-por-correo.md`, `docs/organizacion` (administracion-organizacion), `docs/actividad.md` y `docs/roadmap-template.md`.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Datos de otra organización o tienda en un tablero | Guest token con `rls` del servidor; vistas con `organizacion_id` y `empresa_id`; pgTAP de aislamiento |
| Correo duplicado por entrega «al menos una vez» | `unique (organizacion_id, semana_desde)`, reserva de 2 minutos, cierre solo desde `pendiente`; el duplicado posible (correo salió, cierre falló) queda registrado |
| Correo con datos sensibles de clientes | El contenido son agregados; test que busca nombres de cliente y correos en el resumen |
| Ventana de Kestra caído | Generación hasta el martes; después no se genera un resumen atrasado (decisión documentada) |
| YAML de tableros sin importar en un Superset real; flow sin ejecutar en un Kestra real; sin SMTP real; Edge Function sin registrar en dev | Pruebas estructurales, un Superset simulado, handlers con mocks y pgTAP; la validación contra sistemas reales y el recorrido de punta a punta quedan en **MSF-949**. Una función nueva en dev responde «Function not found» hasta recrear el stack (no basta reiniciar el runtime) |
| «Solo administradores» es de la UI; el servidor exige la sección del tablero | Declarado como desvío en la spec; el token sigue acotado por organización y empresa; no se cambió `emitir-acceso-reporte` |
| Cualquier reporte «Analítica · …» se asigna a todas las organizaciones | Solo el superadmin (o el importador, server-side) registra reportes; asignar es solo visibilidad; el token filtra por organización |
| Resumen pausado con el correo ya en camino | Un resumen en vuelo se deja terminar y `cerrar_resumen_semanal` acepta el éxito sobre `pausado`; uno de una semana anterior sin enviar queda `vencido` |
| Otra migración redefine `exclusiones_exportacion_total` | La mía va en `20270324*` (después); revisar al integrar |
