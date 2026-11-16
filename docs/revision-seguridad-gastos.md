---
owner: tecnico
sources:
  - specs/20270328-100000-gastos-de-la-empresa
  - supabase/migrations
  - apps/web/src/pages/rentabilidad
---

# Revisión de seguridad integral: Gastos de la empresa y margen después de costos fijos (MSF-469)

Alcance: spec `specs/20270328-100000-gastos-de-la-empresa/` completa (fases 1 a 3), migraciones `20270349000000` a `20270349000300` (gastos), `20270421000000` y `20270421000100` (bandera, vistas y medida), `20270421000200` (Actividad por empresa accesible, MSF-968), la pestaña de Rentabilidad y el tablero de Superset. Metodología: lectura de cada objeto contra `CLAUDE.md`, la constitución (Principios I, III, VII, VIII), [aislamiento por organización](aislamiento-por-organizacion.md) y las pruebas pgTAP corridas a mano en la base de dev dentro de `begin … rollback`.

## Resultado

Sin hallazgos bloqueantes ni mayores abiertos. Un hallazgo previo **mayor** (los eventos de Actividad se veían aun de empresas ajenas, lo que filtraba la categoría de un gasto a quien tiene `actividad` sin acceso a esa tienda) quedó **resuelto** en este cambio (MSF-968).

| Superficie | Control | Verificación |
|---|---|---|
| `dominio.gastos` | RLS por organización, empresa accesible y sección `rentabilidad`; `authenticated` solo `select`; sin política ni privilegio de escritura ni `delete`; `anon` sin privilegios | `gastos.test.sql`, `rls_en_toda_tabla`, `privilegios_anon_endurecidos`, `service_role_privilegios` |
| RPC de gastos (5) | `security definer`, `search_path = ''`, `revoke … from public, anon`, nivel `edicion` o `lectura` comprobado adentro (`42501`), organización y rol desde la sesión, bloqueo optimista | `gastos_rpc.test.sql` |
| Importes en Actividad | Los eventos `gasto.*` no llevan cifras; muestran concepto, empresa y nombres de campos | `gastos_rpc.test.sql` |
| Actividad por empresa | La política de lectura y `exportar_actividad` filtran por empresa (`private.empresas_de_actividad()`, incluye pausadas); `anon` no ejecuta la función | `actividad_por_empresa.test.sql`, `registro_actividad.test.sql` |
| Bandera `margen_costos_fijos` | Apagada por defecto, `on conflict do nothing` (reaplicar no la pisa); `bandera_activa` solo para `superset_analitica`, `security definer`, `search_path = ''` | `gastos_bandera.test.sql` |
| Vistas de `analitica` (4) | Sin privilegios para `PUBLIC`, `anon`, `authenticated` ni `service_role`; `select` solo a `superset_analitica`; sin filas con la bandera apagada; sin detalle, categoría ni importe de un gasto individual | `margen_costos_fijos.test.sql`, `gastos_superficies.test.sql` |
| Token de Superset | Reporte con `filtro_empresa = true`: la cláusula `rls` lleva `organizacion_id` y las empresas accesibles; todas las vistas del tablero exponen `empresa_id` | `importar-dashboards.test.mjs`, pruebas de `emitir-acceso-reporte` |
| Otras superficies | Ninguna otra función ni vista lee gastos; el resumen semanal y Inicio no cambian | `gastos_superficies.test.sql`, `margen_costos_fijos_paridad.test.sql` |
| Exportación total | `dominio.gastos` entra a la exportación de la organización con la definición vigente completa de `conjuntos_exportacion_total` | `exportacion_total.test.sql` |
| Pantalla | Pestaña oculta con la bandera apagada; la ruta exige `rentabilidad ≥ lectura`; un 403 del token muestra el acceso restringido; el botón oculto no es la autorización (la base decide) | `costos-fijos.test.tsx`, `PestanasRentabilidad.test.tsx` |

## Observaciones aceptadas

- **D19**: Actividad muestra la categoría de un gasto (p. ej. «Sueldos») a quien accede a esa tienda y tiene `actividad` sin `rentabilidad`. Es la consecuencia aceptada de no llevar cifras; si se decide ocultarla, basta cambiar el `detalle` de `guardar_gasto` y `anular_gasto`.
- **MSF-968 cambia lo que ve quien tiene una sola tienda**: ya no ve el historial de las demás. Es el comportamiento buscado; los eventos sin empresa siguen visibles.
- **Evento de empresa borrada u huérfana**: un evento cuya `empresa_id` ya no existe en `dominio.empresas` no figura entre las empresas de nadie y queda invisible, incluso para el administrador (falla cerrada). Hoy las empresas no se borran (se pausan), así que no ocurre; si algún día se borran, habrá que decidir si esos eventos pasan a ser visibles para el administrador.
- **`gasto.exportado` sin empresa** (`20270349000300`): cuando se exporta con «todas las tiendas» el evento se registra sin empresa, por lo que quien tiene `actividad` ve que hubo una exportación de gastos, sus filtros y la cantidad de filas, sin importes. Decisión de diseño: es un hecho de toda la organización (como otras exportaciones) y no revela cifras ni tiendas concretas.
- **Rendimiento antes de encender**: la base de dev no tiene ventas con costo guardado; el `EXPLAIN` debe repetirse con datos reales (ver [Gastos](gastos.md)).
- **Mes en curso provisorio**: la tasa del mes en curso está incompleta; el tablero lo rotula.

## Reversión

Apagar la bandera (`activa = false`) retira la pestaña y vacía las vistas sin migrar. Las vistas y la función se retiran con una migración posterior; la política de Actividad se restaura recreándola con solo organización y sección (`20261016120000`) y `exportar_actividad` de `20270218300000`.
