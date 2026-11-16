---
owner: tecnico
sources:
  - specs/20270328-100000-gastos-de-la-empresa
  - apps/web/src/pages/gastos
  - supabase/tests/database
  - infra/superset/dashboards/rentabilidad
---

# Gastos de la empresa y margen después de costos fijos (MSF-469)

**Épica:** MSF-469 · **Componente:** Plataforma · **Alcance:** `etapa2` · **Prioridad:** P2 (provisoria) ·
**Hito:** Etapa 2 (desde enero de 2027).

**Historias:** F-GAS-01 «Registrar gastos», F-GAS-02 «Consultar gastos por período y categoría» y F-GAS-03
«Margen después de costos fijos» (spec `specs/20270328-100000-gastos-de-la-empresa/`).

**Dónde vive:** rama `dokploy` (PR #1041 `feat/gastos-fases-1-y-2` y PR #1056 `feat/gastos-fases-3-y-4`),
**pendiente de promover a `main`**. En `main` todavía no hay migraciones, RPC, vistas ni pantallas de
gastos: lo de abajo describe lo que la épica construyó en su rama.

Alcance de entrega: `refine`, `supabase` y `superset`; **sin `kestra` ni `workers`** (el prorrateo es SQL
calculado al leer y el tablero lo sirve Superset).

Resumen para quien usa el panel: [Gastos de cada tienda](../producto/gastos.md). Revisión de seguridad:
[Revisión de seguridad de gastos](revision-seguridad-gastos.md).

## Qué resuelve

Un **administrador** registra los **gastos generales** de cada empresa (alquiler, servicios, sueldos…) y los
consulta por **período y categoría** para entender sus costos fijos. Los costos fijos impactan en el margen
como una **medida nueva y separada** («margen después de costos fijos»), **detrás de la bandera
`margen_costos_fijos`, apagada por defecto**: ninguna vista, tablero, RPC ni correo existente cambia su
resultado (`margen_costos_fijos_paridad.test.sql`).

**Alcance entregado:** registro y consulta (fases 1 y 2, sin efecto en ninguna cifra), la medida nueva (fase 3)
y el cierre (fase 4). **Pendientes:** encender la bandera en dev (T028, lo hace el equipo técnico por SQL) y
las decisiones de seguimiento de Nicolás (T029).

## Modelo

- Tabla `dominio.gastos` (migración `20270349000000_gastos.sql`): una fila por gasto de **una** empresa, con
  fecha (define el mes de imputación), categoría (catálogo cerrado de 7: Alquiler, Servicios, Sueldos, Fletes,
  Insumos, Impuestos, Otros), tipo de costo (`fijo` o `variable`), detalle (opcional, hasta 200), importe en la
  moneda original, moneda (`ARS` o `USD`), cotización usada e importe en pesos **congelados al guardar**,
  marca «recurrente» (informativa), anulación (`anulado_en`, `anulado_por`, `motivo_anulacion`) y `updated_at`
  como bloqueo optimista.
- Dos `check`: uno liga moneda, cotización e importe en pesos (`ARS` sin cotización y con pesos = importe;
  `USD` con cotización > 0) y otro exige el motivo **si y solo si** el gasto está anulado.
- Seguridad: RLS por organización, empresa accesible (`private.empresas_accesibles()`) y sección `rentabilidad`
  (lectura o edición). `authenticated` solo tiene `select`; no hay política ni privilegio de `insert`, `update`
  ni `delete` para los roles de la aplicación: **no existe borrado físico**, lo cargado por error se anula con
  motivo (D11). `anon` sin privilegios. `service_role` opera la tabla como el resto de `dominio`.
- La tabla entra a la exportación total de la organización (`20270349000200_gastos_exportacion_total.sql`).
- El DER completo está en [Datos y DER](datos.md).

## RPC (`public`, `security definer`, `search_path = ''`)

| Función | Qué hace | Errores |
|---|---|---|
| `guardar_gasto(p_id, p_empresa, p_fecha, p_categoria, p_tipo_costo, p_detalle, p_importe, p_moneda, p_recurrente, p_actualizado)` | Crea (`p_id` nulo) o edita; exige `edicion` en `rentabilidad`; congela la cotización | `42501`, `P0002`, `22023`, `40001` |
| `anular_gasto(p_id, p_motivo, p_actualizado)` | Anula con motivo obligatorio; repetirla no falla | `42501`, `P0002`, `22023`, `40001` |
| `listar_gastos(p_desde, p_hasta, p_empresa, p_categoria, p_tipo_costo, p_incluir_anulados, p_cursor_fecha, p_cursor_id, p_limite)` | Tandas con cursor `(fecha desc, id)` y filtros de empresa, categoría, tipo y anulados | `42501` |
| `resumen_gastos(p_desde, p_hasta, p_empresa, p_categoria, p_tipo_costo)` | Total en pesos, conteo y desglose por categoría y tipo (excluye anulados) | `42501` |
| `exportar_gastos(...)` | Filas del listado filtrado (tope 10.000) y evento `gasto.exportado` | `42501` |

`exportar_gastos` es una **quinta función** respecto del contrato original de la spec: el evento de exportación
solo puede registrarse desde la base (desvío declarado en T013).

**Dólar congelado:** un gasto en USD guarda la cotización aplicada del dólar de la empresa (o la general) **más
cercana a la fecha del gasto** (`analitica.cotizacion_cercana`) y el importe en pesos resultante; una cotización
cargada después no lo reescribe. Sin cotización, el alta se rechaza con «Cargá la cotización del dólar».

**Validación:** fecha entre 2000-01-01 y 31 días a futuro; importe con hasta 2 decimales y menor que 10^12; si el
importe en pesos de un gasto en USD desborda, `22023` con mensaje claro. Al editar un gasto en USD la
cotización se recalcula si cambia el importe, la fecha, la tienda o la moneda; si solo cambia otro dato, se
conserva.

## Pantalla

Administración → **Gastos** (`/gastos`). La ruta (`apps/web/src/App.tsx:520`) exige `RequiereAccesoSeccion
seccion="rentabilidad"`, o sea lectura o edición; el **destino de menú** «Gastos» en Administración es
`audiencia: 'administrador'` con `seccionPermiso: 'rentabilidad'`
(`apps/web/src/components/navegacion/destinosPanel.ts:253`), así que el rol **Administración** (que tiene lectura
en `rentabilidad` según la matriz inicial) no ve el ítem pero llega a la pantalla por la dirección y la ve sin
botones de escritura (CA-GAS-7). Períodos Hoy, Semana (últimos 7 días), Mes y Mes anterior en hora de Buenos
Aires, filtro de tienda (`FiltroEmpresa`), de categoría y de tipo de costo, total con desglose, «Mostrar
anulados», «Exportar» y «Nuevo gasto». El listado carga por tandas con carga infinita y «Cargar más». Al cambiar
la empresa activa se recarga todo y un diálogo abierto se cierra con aviso sin guardar.

El diseño visual viene del prototipo `design/pantallas/VentasGastos.dc.html` (pantalla «Ventas · Gastos»): tabla
Fecha / Concepto / Detalle / Tienda / Importe, panel «Por concepto», diálogo «Nuevo gasto» y estado vacío «Sin
gastos en el período». El prototipo **no** dibuja edición, anulación, moneda, tipo de costo, recurrente ni la
pestaña de margen: son adiciones declaradas de la spec (D17).

## Margen después de costos fijos (fase 3, F-GAS-03)

Medida **nueva y separada**, detrás de la bandera `margen_costos_fijos` (apagada por defecto en todo entorno).
Con la bandera apagada la pestaña no existe, las vistas nuevas no devuelven filas y todo lo existente es
idéntico (`margen_costos_fijos_paridad.test.sql`).

**Migraciones** (ventana `20270421…`, renumeradas por encima de la máxima de `dokploy`):
`20270421000000_costos_fijos_bandera_y_vistas.sql`, `20270421000100_margen_despues_costos_fijos.sql` y
`20270421000200_actividad_por_empresa_accesible.sql` (MSF-968).

| Objeto (esquema `analitica`) | Qué es |
|---|---|
| `bandera_activa(text)` | `true` solo si la bandera existe y está encendida; la ejecuta únicamente `superset_analitica` |
| `costos_fijos_empresa_mes` | Σ `importe_pesos` de los gastos **fijos** vigentes por organización × empresa × mes. Sin detalle, categoría ni importes individuales |
| `ventas_netas_empresa_mes` | Σ signo × `subtotal_sin_iva` de todas las líneas facturadas por empresa y mes, con el predicado y el signo del margen real (incluye líneas sin costo guardado) |
| `margen_despues_costos_fijos` | Las columnas de `margen_real_categoria` más `tasa_fija`, `cargo_costos_fijos`, `margen_despues_fijos` y `margen_despues_fijos_pct` |
| `margen_costos_fijos_empresa_mes` | **Cuarta vista, desvío declarado** (T018): por empresa y mes, ventas, fijos, margen vigente, cargo atribuido, margen después de fijos y «Sin atribuir». No se puede sumar desde la vista por producto sin repetir el costo fijo por cada fila |

**Fórmula** (D4 a D8): `tasa_fija = costos_fijos(empresa, mes) ÷ ventas_netas(empresa, mes)` (nula si las ventas
son ≤ 0); `cargo = vendido × tasa_fija`; `margen después de fijos = margen − cargo`. La nota de crédito resta
porque el `vendido` ya lleva el signo. **«Sin atribuir»** = costos fijos − Σ cargo: la parte que le toca a las
ventas sin costo guardado. No hay redondeo en la base (la suma de cargos más «Sin atribuir» da exactamente el
costo fijo del mes, SC-002); el tablero muestra a 2 decimales. Un gasto en USD entra con su cotización congelada
al guardarlo. El mes en curso es provisorio y el tablero lo rotula. El umbral de «margen bajo» no se aplica a la
medida nueva.

**Seguridad:** las cuatro vistas y la función solo las lee `superset_analitica`; el token de Superset del tablero
lleva `organizacion_id` y `empresa_id` (`reportes.filtro_empresa = true`: todas las vistas exponen `empresa_id`).
Ninguna otra función ni vista lee `dominio.gastos` (`gastos_superficies.test.sql`).

**Pantalla:** pestaña «Después de costos fijos» en Rentabilidad (`/rentabilidad/costos-fijos`,
`apps/web/src/pages/rentabilidad/CostosFijos.tsx`), visible solo con la bandera encendida y `lectura` en
`rentabilidad`; con la bandera apagada la ruta redirige a Rentabilidad. Sigue la empresa activa de la barra
superior (`FiltroEmpresa` y filtro nativo «Empresa» del tablero), muestra el método y el aviso del mes en
curso, y ante un 403 del token muestra el acceso restringido. Tablero:
`infra/superset/dashboards/rentabilidad/` («Rentabilidad · Después de costos fijos»: tarjetas por tienda y
consolidado, cortes por producto y por categoría y rótulo del método).

**Encender** (equipo técnico, dev → stg → prd): `update public.banderas_plataforma set activa = true where
clave = 'margen_costos_fijos';`. **Apagar** (reversión inmediata, sin migrar): `activa = false`. Importar el
tablero nuevo con `pnpm superset:importar-dashboards` antes de encender (sin el tablero, la pestaña muestra
«todavía no está disponible»).

**Rendimiento (EXPLAIN en dev):** el cruce por mes arma ventas y fijos por `organizacion_id`, `empresa_id` y mes
(columnas del `GROUP BY`, así el filtro del token se empuja al escaneo). En dev, con 282 líneas de comprobantes y
300 gastos sintéticos por empresa, `margen_costos_fijos_empresa_mes` ejecuta en ~180 ms y el plan usa
`gastos_org_empresa_fecha_idx` y los índices de comprobantes. La base de dev no tiene ventas con costo guardado,
así que **hay que volver a medir con datos reales antes de encender en producción** (T024).

## Actividad por empresa accesible (MSF-968)

`registro_actividad_select` y `exportar_actividad` (`security definer`) ahora también filtran por empresa: un
evento con empresa solo lo ve quien accede a esa empresa (administrador: todas las de su organización; el
resto, las asignadas; superadmin: las de su organización activa); los eventos sin empresa siguen visibles para
quien tiene la sección. Se usa `private.empresas_de_actividad()`, igual que `empresas_accesibles()` pero
**incluyendo las empresas pausadas**, para que su historial no desaparezca. `listar_actividad`,
`obtener_detalle_actividad` y `opciones_actividad` son `security invoker` y heredan el cambio. Ningún evento se
modifica. Pruebas: `actividad_por_empresa.test.sql`. Efecto visible: quien tiene `actividad` y una sola tienda
asignada ya no ve el historial de las demás tiendas.

## Empresa activa

Los gastos son de **una** empresa. La pantalla filtra por la empresa activa de la barra superior y, con «Todas
mis empresas», muestra la columna «Tienda» y los totales combinados (en pesos). Al cambiar de empresa se
invalidan y recargan **todas** las consultas (listado, total, desglose), se reencuadra la carga por tandas y se
descartan filtros y selección que ya no existen. Un diálogo abierto se **cierra con aviso** sin guardar; nunca
guarda datos de la empresa anterior bajo la nueva. Cobertura: `apps/web/src/pages/gastos/index.empresa.test.tsx`
y `apps/web/src/pages/rentabilidad/costos-fijos.test.tsx`. Principio VIII de la constitución; ver
[Empresa activa](../empresa-activa.md).

## Cómo probarlo (guía técnica)

Cada paso lleva el rótulo de su tarea para que se pueda automatizar. **El código está en la rama `dokploy`
(o en `feat/gastos-fases-1-y-2` / `feat/gastos-fases-3-y-4`), no en `main`**: en `main` no hay nada que
ejecutar.

### Prerrequisitos

- `pnpm dev:supabase` en la rama `dokploy` (aplica las migraciones `20270349000000`–`20270349000300` y
  `20270421000000`–`20270421000200`); si no, `supabase migration up --local`.
- Una organización con un Administrador activo y, para la medida, ventas del mes con costo guardado y gastos
  fijos del mismo mes y empresa.
- El panel: `pnpm dev:refine` (Docker) o `pnpm dev:refine:host`. Para el tablero: `pnpm dev:superset` con los
  dashboards importados (`pnpm superset:importar-dashboards`).
- Para el E2E: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del stack local (sin ellos el spec se omite).

### Pasos

1. `[MSF-469:T001]` Corré el pgTAP `supabase/tests/database/gastos.test.sql` (`supabase test db --local
   supabase/tests/database/gastos.test.sql`; `pnpm test:db` corre la suite completa). Comprobá: columnas de
   `dominio.gastos`, los dos `check` (moneda/cotización/pesos y motivo de anulación), la FK compuesta
   `(empresa_id, organizacion_id)`, **que no existe política ni privilegio de `delete`** y que `authenticated`
   solo tiene `select`.
2. `[MSF-469:T002]` Corré `supabase/tests/database/gastos_rpc.test.sql`. Comprobá: `42501` sin `edicion` en
   `rentabilidad`, `P0002` con empresa ajena, `22023` por validación y sin cotización, `40001` ante un cambio
   concurrente, el dólar de la empresa (y el general) más cercano a la fecha, el snapshot inmutable, la anulación
   con motivo y los eventos `gasto.creado|editado|anulado`.
3. `[MSF-469:T003]` Con la tabla nueva, `rls_en_toda_tabla`, `privilegios_anon_endurecidos` y
   `service_role_privilegios` siguen verdes, y `gastos.test.sql` prueba el aislamiento entre organizaciones y
   entre empresas de una misma organización.
4. `[MSF-469:T004]` Corré `supabase/tests/database/exportacion_total.test.sql`: `dominio.gastos` entra en la
   exportación de la organización y las aserciones de opiniones y newsletter siguen intactas.
5. `[MSF-469:T005]` Corré el Vitest de `apps/web/src/pages/gastos/index.test.tsx` (17 pruebas): ruta, tabla,
   estados compartidos y acceso restringido sin `lectura`.
6. `[MSF-469:T006]` En el mismo Vitest, el diálogo «Nuevo gasto»/«Editar gasto»: moneda, tipo de costo
   precargado por categoría y cambiable, recurrente, tienda única, importe con decimales, el mensaje «Cargá la
   cotización del dólar» y axe a 320/768/1440 px.
7. `[MSF-469:T007]` «Anular» pide motivo (sin motivo no guarda) y «Mostrar anulados» deja ver el gasto anulado;
   el pgTAP de T002 cubre que deja de contar.
8. `[MSF-469:T008]` Corré `apps/web/src/pages/gastos/index.empresa.test.tsx`: al cambiar de empresa con el
   diálogo abierto, el diálogo se cierra con aviso y **no** guarda nada en la empresa anterior.
9. `[MSF-469:T009]` Revisá `apps/web/src/lib/actividad.ts` (etiquetas `gasto.*`), la ayuda `gastos` en
   `apps/web/src/ayuda/contenidos/administracion.ts` y el mapa en `apps/web/src/ayuda/manualPorDestino.ts`:
   `ayuda-cobertura` y `apps/web/src/ayuda/manual.test.ts` en verde.
10. `[MSF-469:T011]` En `gastos_rpc.test.sql`: `listar_gastos` con cursor (`fecha desc, id`), los filtros de
    empresa, categoría, tipo y anulados, y `resumen_gastos` con total, conteo y desglose por categoría y tipo.
    Los anulados quedan excluidos del resumen y el resultado está acotado por empresa accesible.
11. `[MSF-469:T012]` Vitest de `apps/web/src/lib/gastos.test.ts` y de la pantalla: períodos Hoy / Semana / Mes /
    Mes anterior en hora de Buenos Aires, `FiltroEmpresa`, filtros de categoría y tipo, total con desglose y
    etiqueta fijo/variable, carga infinita y «Cargar más».
12. `[MSF-469:T013]` «Exportar» baja el listado filtrado (moneda, importe original e importe en pesos) y deja el
    evento `gasto.exportado` en Actividad (pgTAP `gastos_rpc.test.sql`).
13. `[MSF-469:T014]` Vitest de la consulta: al cambiar la empresa activa se recargan listado, total y desglose y
    se reencuadra la carga por tandas.
14. `[MSF-469:T015]` Corré el E2E `apps/web/e2e/gastos.e2e.ts` (`pnpm --filter @platform/web test:e2e
    gastos.e2e.ts`): el administrador carga un gasto, lo ve en el listado y en el total del mes, lo anula con
    motivo y lo ve con «Mostrar anulados». Corre verde en el CI (job `e2e-visible-sesion`, corrida
    `43741637212`).
15. `[MSF-469:T017]` Corré `supabase/tests/database/gastos_bandera.test.sql` (25 aserciones): la bandera
    `margen_costos_fijos` **nace apagada**, `analitica.bandera_activa` solo la ejecuta `superset_analitica` y
    las vistas de apoyo no devuelven filas con la bandera apagada.
16. `[MSF-469:T018]` Corré `supabase/tests/database/margen_costos_fijos.test.sql` (45 aserciones): el ejemplo
    numérico de la spec (tasa 20 %, producto A con cargo $ 200.000 y margen después de fijos $ 150.000, B con
    −$ 75.000), el signo de las notas de crédito, el mes sin ventas, el mes con solo gastos variables, el gasto en
    USD, «Sin atribuir», la anulación y el aislamiento.
17. `[MSF-469:T019]` Corré `supabase/tests/database/margen_costos_fijos_paridad.test.sql` (12): la foto (md5 y
    filas) de todas las vistas existentes de `analitica` y de las RPC de rentabilidad, Inicio y resumen semanal
    antes y después de cargar, editar y anular gastos, con la bandera apagada y encendida. **Ninguna cambia.**
18. `[MSF-469:T020]` Corré `supabase/tests/database/gastos_superficies.test.sql` (5): ninguna otra función ni
    vista lee gastos; el resumen semanal e Inicio no los mencionan.
19. `[MSF-469:T021]` Corré `pnpm test:superset:config` y `node --test infra/superset/importar-dashboards.test.mjs`
    (40 de 40): el tablero «Rentabilidad · Después de costos fijos» está versionado y el reporte se registra con
    `filtro_empresa = true`.
20. `[MSF-469:T022]` Vitest de `apps/web/src/pages/rentabilidad/costos-fijos.test.tsx` (12, con axe a
    320/768/1440 px) y de `PestanasRentabilidad.test.tsx` (3): con la bandera apagada la pestaña no se muestra y
    la ruta redirige; ante `prohibido` (403) se ve el acceso restringido; el error ofrece «Reintentar» y el mes
    en curso está rotulado.
21. `[MSF-469:T023]` Vitest «sigue la empresa activa» de la pestaña y la prueba del token: el reporte con
    `filtro_empresa` lleva `empresa_id` y todas las vistas del tablero exponen `empresa_id`.
22. `[MSF-469:T024]` En dev, `EXPLAIN (ANALYZE, BUFFERS)` del cruce por mes dentro de `begin…rollback`:
    `margen_costos_fijos_empresa_mes` con 300 gastos sintéticos por empresa y 282 líneas de comprobantes
    (~180 ms, índice `gastos_org_empresa_fecha_idx`). **Repetir con datos reales antes de encender en
    producción.**
23. `[MSF-469:T025]` Guards: `node scripts/verificar-migraciones.mjs --estricto`, `pnpm docs:check`,
    `pnpm matriz:check`, `pnpm der:check`, `pnpm prototipo:check`, `pnpm ui:empresas:check`, `tsc -b` y lint.
    Revisá además que **ninguna** migración nueva redefine `analitica.margen_real_categoria` ni
    `analitica.rentabilidad_ventas_real`.
24. `[MSF-469:T028]` **Pendiente** (equipo técnico, por SQL): encender la bandera en dev y verificar el
    recorrido completo —cargar un gasto, ver el total, ver el margen después de fijos, anular y ver el
    recálculo— con el tablero importado.

### Resultado esperado

- Un administrador carga, edita y anula gastos de su tienda; el gasto aparece en el listado, en el total del
  período y en el desglose por concepto, y la Actividad registra quién lo hizo (sin importes).
- Un gasto en dólares conserva la cotización congelada al guardarlo; sin cotización cargada, el alta se
  rechaza con «Cargá la cotización del dólar».
- Un gasto anulado deja de sumar y no se puede borrar; se ve con «Mostrar anulados».
- Con la bandera apagada, **todas** las cifras de rentabilidad, los tableros, las RPC y los correos devuelven
  exactamente lo mismo que antes de la épica.
- Con la bandera encendida, la medida nueva reparte los gastos fijos en proporción a las ventas netas del mes y
  la suma de cargos más «Sin atribuir» da el total de fijos del mes.

### Cómo automatizarlo

- Base: pgTAP `gastos.test.sql`, `gastos_rpc.test.sql`, `gastos_bandera.test.sql`,
  `margen_costos_fijos.test.sql`, `margen_costos_fijos_paridad.test.sql`, `gastos_superficies.test.sql`,
  `actividad_por_empresa.test.sql` y `exportacion_total.test.sql`.
- Web: Vitest de `apps/web/src/pages/gastos/` (`index.test.tsx`, `index.empresa.test.tsx`),
  `apps/web/src/lib/gastos.test.ts`, `apps/web/src/hooks/useGastos.test.tsx` y
  `apps/web/src/pages/rentabilidad/costos-fijos.test.tsx`.
- Tableros: `pnpm test:superset:config` e `infra/superset/importar-dashboards.test.mjs`.
- E2E: `apps/web/e2e/gastos.e2e.ts` (cargar → total → anular), con sesión real; se omite sin
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
- **Pendiente de automatizar:** el paso 24 (encendido de la bandera en dev) es una acción manual del equipo
  técnico por SQL; no hay test que la cubra.

## Capturas pendientes

- TODO (dueño: Documentador, tras la promoción de la épica a `main`): generar las capturas del manual con
  `pnpm docs:capturas` para la pantalla **Administración → Gastos** (listado con total y desglose, diálogo «Nuevo
  gasto» abierto, diálogo «Anular») y para la pestaña «Después de costos fijos» de Rentabilidad, en
  `docs/producto/img/gastos/`. La herramienta de capturas del manual (`pnpm docs:capturas`,
  `apps/web/e2e/capturas/` y `pnpm demo:dataset`) **no existe en este repo** y la pantalla todavía no está en
  `main`: hasta entonces las páginas de producto describen el comportamiento **sin imágenes nuevas**, no se
  inventó ninguna.

## Reversión

La tabla y las funciones son aditivas. La medida nueva se apaga al instante con la bandera (`activa = false`);
las vistas y la función de `analitica` se retiran con `drop view` y `drop function` en una migración posterior.
Para retirar el registro hay que escribir una migración posterior (`drop function` de las cinco funciones y
`drop table dominio.gastos`, exportando antes los datos); no se hace en el mismo PR que las crea.

## Fuera de alcance y seguimientos

Quedaron explícitamente afuera: contabilidad, impuestos, flujo de caja y conciliación bancaria; facturas de
proveedores y cuentas a pagar; carga masiva o importación de gastos; gastos recurrentes automáticos y «Repetir
en este mes»; buscador por texto en el listado; gastos compartidos entre empresas y categorías propias; cierre
de períodos; otros métodos de prorrateo (por unidades, por días, por rotación); y los impactos I5–I10 sobre el
resumen semanal por correo, el tablero de Inicio, Comparativo e Historia, las alertas de margen negativo, el
precio sugerido y la rentabilidad de Mercado Libre. **T029 (seguimiento de cada uno) está pendiente de decisión
de Nicolás.**

## Referencias

- Spec y plan: `specs/20270328-100000-gastos-de-la-empresa/` (spec.md, plan.md, tasks.md,
  contracts/gastos.md) en la rama `dokploy`.
- Migraciones: `20270349000000_gastos.sql`, `20270349000100_gastos_rpc.sql`,
  `20270349000200_gastos_exportacion_total.sql`, `20270349000300_gastos_consulta.sql`,
  `20270421000000_costos_fijos_bandera_y_vistas.sql`, `20270421000100_margen_despues_costos_fijos.sql`,
  `20270421000200_actividad_por_empresa_accesible.sql`.
- Pantalla: `apps/web/src/pages/gastos/`, `apps/web/src/lib/gastos.ts`, `apps/web/src/hooks/useGastos.ts`,
  `apps/web/src/pages/rentabilidad/CostosFijos.tsx`, `apps/web/src/lib/costosFijos.ts`,
  `apps/web/src/hooks/useBanderaMargenCostosFijos.ts`.
- Tableros: `infra/superset/dashboards/rentabilidad/` (dos datasets, cinco gráficos y el tablero «Rentabilidad ·
  Después de costos fijos»).
- Prototipo: `design/pantallas/VentasGastos.dc.html` y `design/pantallas/VentasGastos.inventory.json`; ítem de
  menú en `design/pantallas/AdminSider.dc.html` (Administración → Gastos, solo administrador).
- Producto: [Gastos de cada tienda](../producto/gastos.md) · [Ver la rentabilidad](../producto/rentabilidad.md).
- Seguridad: [Revisión de seguridad de gastos](revision-seguridad-gastos.md).
