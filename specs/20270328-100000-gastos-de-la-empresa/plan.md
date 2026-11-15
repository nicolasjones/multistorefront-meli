# Plan: Gastos de la empresa y margen después de costos fijos (MSF-469)

**Spec**: [`spec.md`](./spec.md) · **Estado**: spec redactada, sin implementar. Decisión de Nicolás (2026-11-15): los gastos son los gastos **generales** de una empresa, para entender sus costos fijos; el impacto en el margen es una **medida nueva y separada** detrás de una bandera apagada. El resto son decisiones delegadas D1–D18 de la spec.

## Enfoque

- **Registro simple**: una tabla `dominio.gastos` escrita solo por RPC; la pantalla lista, filtra, totaliza y exporta. Nada del registro mueve una cifra existente.
- **Medida derivada, calculada al leer**: no se guarda ningún importe prorrateado. La vista nueva `analitica.margen_despues_costos_fijos` se construye **sobre** `analitica.margen_real_categoria` (sin modificarla) y le suma `tasa_fija` y `cargo_costos_fijos` a partir de dos vistas auxiliares (costos fijos por empresa y mes; ventas netas por empresa y mes).
- **Apagable**: la bandera `margen_costos_fijos` (apagada por defecto) hace que la vista no devuelva filas y que la pestaña no aparezca. Registrar y consultar gastos no depende de la bandera.
- **Orden por riesgo**: primero datos y pantalla (sin efecto en ninguna cifra), luego consultas y exportación, luego la medida nueva (única fase con efecto visible, detrás de la bandera) y al final el cierre.
- **Mínimo coherente de impactos**: producto, categoría y tienda salen de la misma vista y de una sola pestaña; correo semanal, Inicio, comparativos, alertas y precios quedan fuera (tabla «Impactos posibles» de la spec).

## Esquemas (Principio VII, re-verificado en spec, plan y tareas)

| Objeto | Esquema | Por qué |
|---|---|---|
| `dominio.gastos` | `dominio` | Dato de negocio de la empresa, como `costos_adicionales_canal` |
| Fila `margen_costos_fijos` en `public.banderas_plataforma` | `public` | Dato de plataforma |
| RPC `guardar_gasto`, `anular_gasto`, `listar_gastos`, `resumen_gastos` | `public` | Superficie de ejecución sin datos propios |
| Vistas `costos_fijos_empresa_mes`, `ventas_netas_empresa_mes`, `margen_despues_costos_fijos` y `bandera_activa` | `analitica` | Solo vistas y funciones de apoyo; sin tablas |
| Cotización congelada (si no alcanza lo existente) | `private` | Cálculo |

## Migraciones (todas aditivas e idempotentes; reversión en el encabezado de cada una)

Numeración **por encima de toda la cola de `dokploy`**: hoy la máxima es `20270326100000` (`node scripts/verificar-migraciones.mjs --estricto`). La ventana de esta spec es `20270343000000+` (mayor que la de listas de precios, `20270340000000+`); se **renumera al integrar** si otra rama la ocupó.

| Migración | Fase | Contenido |
|---|---|---|
| `20270343000000_gastos.sql` | 1 | Tabla `dominio.gastos` (checks, índices por organización/empresa/fecha, RLS, grants exactos) |
| `20270343000100_gastos_rpc.sql` | 1 | `guardar_gasto`, `anular_gasto` (`security definer`, `search_path = ''`, `edicion` en `rentabilidad`, bloqueo optimista, cotización congelada, eventos de Actividad) |
| `20270343000200_gastos_exportacion_total.sql` | 1 | Verifica/ajusta `private.exclusiones_exportacion_total()` para que la tabla **entre** (rebasar si otra migración la redefine) |
| `20270343000300_gastos_consulta.sql` | 2 | `listar_gastos` (cursor) y `resumen_gastos` |
| `20270343000400_costos_fijos_bandera_y_vistas.sql` | 3 | Bandera `margen_costos_fijos` apagada, `analitica.bandera_activa`, `analitica.costos_fijos_empresa_mes`, `analitica.ventas_netas_empresa_mes` |
| `20270343000500_margen_despues_costos_fijos.sql` | 3 | `analitica.margen_despues_costos_fijos` sobre `analitica.margen_real_categoria` |

La reversión de la última migración de cada fase queda **documentada** (no ejecutada en el mismo PR): `drop view` y `drop function` de lo nuevo; la tabla se retira solo en una migración posterior, exportando antes los datos.

## Contratos / OpenAPI

[`contracts/gastos.md`](./contracts/gastos.md). Las RPC se llaman desde el panel (no son API pública): **sin cambios en `openapi/*.json`**.

## Piezas fuera de la base

- `apps/web`: `pages/gastos/` (ruta lazy `/gastos`, destino de menú en Administración), `lib/gastos.ts` y hooks, diálogo «Nuevo gasto»/«Editar gasto», acciones «Anular», «Exportar» y «Mostrar anulados», `SelectorEmpresas` en modo una sola empresa si hace falta, pestaña `pages/rentabilidad/costos-fijos.tsx` (ruta `/rentabilidad/costos-fijos`, oculta con la bandera apagada), etiquetas `gasto.*` en Actividad y ayuda de la pantalla.
- `superset`: dashboard «Rentabilidad · Después de costos fijos» exportado a YAML en `infra/superset/dashboards/rentabilidad/` (tarjetas por tienda y consolidado, cortes por producto y categoría), con `rls` por `organizacion_id` y `empresa_id`.
- Sin `kestra` ni `workers`.

## Pruebas previstas

- **pgTAP**: `gastos.test.sql`, `gastos_rpc.test.sql`, `gastos_moneda.test.sql`, `gastos_actividad.test.sql`, `gastos_listado.test.sql`, `gastos_bandera.test.sql`, `margen_costos_fijos.test.sql`, `margen_costos_fijos_paridad.test.sql`, `gastos_superficies.test.sql`; extender `exportacion_total.test.sql`; `rls_en_toda_tabla` y `privilegios_anon_endurecidos` deben seguir verdes.
- **Vitest**: pantalla de gastos (períodos, carga infinita, filtros, diálogo, anulación, cambio de empresa con diálogo abierto, axe a 320/768/1440 px) y pestaña «Después de costos fijos».
- **E2E**: `apps/web/e2e/gastos.e2e.ts` (cargar un gasto, ver el total, anularlo).

## RLS, permisos y grants

- `dominio.gastos`: RLS por `organizacion_id`, `empresa_id in (select private.empresas_accesibles())` y `private.nivel_seccion('rentabilidad')` en lectura/edición; `revoke all` a `public`/`anon`/`authenticated` y `grant select` solo a `authenticated`; sin política `DELETE` ni de escritura.
- RPC: `revoke … from public, anon`, `grant execute … to authenticated`; el nivel `edicion` se comprueba adentro (`42501`).
- `analitica.*` nuevas: sin privilegios para `anon`/`authenticated`; `grant select`/`execute` solo a `superset_analitica`; las vistas no exponen detalle de gastos.

## Reversión

1. **Inmediata y sin migrar**: `update public.banderas_plataforma set activa = false where clave = 'margen_costos_fijos';` — la vista nueva deja de devolver filas y la pestaña desaparece; las cifras existentes nunca se movieron.
2. **De la spec completa**: `git revert -m 1` del merge de cada fase (merge commit, constitución). La tabla y las vistas quedan inertes (aditivas) hasta una migración posterior de retiro, que **no** va en el mismo PR que las crea.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Se mueve un margen existente | La vista nueva se apoya en `margen_real_categoria` sin tocarla; pgTAP de paridad con bandera apagada y encendida |
| Cifra sensible expuesta en otra superficie | Sin consumidores fuera de la pestaña; `gastos_superficies.test.sql`; Superset solo recibe totales por empresa y mes |
| Método de prorrateo no es el que Nicolás espera | Está en una sola vista; cambiarlo no toca datos ni pantalla (D6) |
| Mes en curso con tasa distorsionada | Rótulo en el tablero; alternativa por días fuera de alcance |
| Gasto mal clasificado fijo/variable | Valor por omisión por categoría, etiqueta visible, evento de Actividad |
| Rendimiento del cruce por mes | Columnas del filtro del token en el `GROUP BY`; `EXPLAIN` con datos reales antes de encender |
| Colisión de migraciones con otras ramas | Ventana `20270343000000+` y `verificar-migraciones --estricto` al integrar |
| Pantalla de margen sin prototipo | UI mínima declarada (D17), patrón de Comparativo/Historia, revisión lado a lado |

## Documentación

`docs/gastos.md` (técnico), `docs/producto/gastos.md` (manual), actualización de `docs/rentabilidad.md` y `docs/tecnico/rentabilidad.md` (pestaña nueva y regla «lo existente no cambia»), `docs/actividad.md`, `docs/deployment.md` (bandera) y `docs/roadmap-template.md` al cerrar.

## Plan de ejecución (historias) — respaldo

La tabla que consume el orquestador está al final de [`tasks.md`](./tasks.md); esta es el respaldo por si se lee el plan.

| Historia | Depende de | Grupo |
|----------|------------|-------|
| F-GAS-01 | — | 1 |
| F-GAS-02 | F-GAS-01 | 2 |
| F-GAS-03 | F-GAS-01 | 2 |
| [Cierre] | F-GAS-01, F-GAS-02, F-GAS-03 | 3 |

F-GAS-02 y F-GAS-03 son independientes entre sí (archivos, tablas, migraciones y rutas distintas) y van en paralelo; el cierre espera a las tres.
