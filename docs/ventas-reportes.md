# Ventas · Reportes (épica MSF-338)

Guía de la pantalla **Reportes de ventas** (`/ventas/reportes`, sección `reportes`): «Más vendidos»
(F-VTA-22, MSF-347) y «Ranking de clientes» con exportación a Excel (F-VTA-23, MSF-358). Spec:
[`specs/20270104-100000-ventas-reportes-basicos/`](../specs/20270104-100000-ventas-reportes-basicos/spec.md) ·
contrato de las vistas:
[`contracts/analitica-ventas-reportes.md`](../specs/20270104-100000-ventas-reportes-basicos/contracts/analitica-ventas-reportes.md) ·
operación de los tableros: [`operar-superset.md`](./operar-superset.md).

## Qué cuenta como venta (cálculo y predicado)

Una sola fuente para las dos pestañas y para el Excel; el criterio **no se reimplementa**:

- **Predicado**: cuenta un comprobante solo si `private.comprobante_cuenta_como_facturado(tipo, estado)`
  (factura o nota de crédito; nunca `borrador`, `anulada` ni presupuesto).
- **Signo**: `private.signo_comprobante(tipo)`; la **nota de crédito resta**.
- **Importe**: total **con IVA** (el mismo `total_con_iva` que muestran el listado y la exportación de
  comprobantes), para que el reporte cuadre con lo exportado.
- **Cliente con solo notas de crédito** en el período: facturación neta **negativa** (sin piso en cero).
- **Comprobante sin `empresa_id`**: no produce fila (no es atribuible a ninguna tienda).
- **Posición y participación** se recalculan sobre el resultado **filtrado** (período, tienda, «Consumidor
  final»); por eso el tablero y la RPC las calculan como métricas y no usan las de la vista.

## Vistas `analitica` y RPC

| Objeto | Esquema | Quién lo lee | Para qué |
|---|---|---|---|
| `analitica.ventas_producto_mas_vendido` | `analitica` | `superset_analitica` | Tablero «Más vendidos» (grano empresa × producto × depósito × fecha) |
| `analitica.ventas_ranking_clientes` | `analitica` | `superset_analitica` | Tablero «Ranking de clientes» (grano empresa × cliente × fecha) |
| `public.ventas_reportes_conteo(date, date, uuid)` | `public` | `authenticated` | Estado vacío «No hay ventas en ese período» |
| `public.leer_ranking_ventas(…)` | `public` | `authenticated` | Exportación a Excel (misma vista que el tablero) |

**Esquemas (Principio VII)**: la épica **no crea tablas**. Las vistas viven en `analitica` (superficie de
lectura de Superset, cerrada para `anon` y `authenticated`) y las dos RPC en `public` (superficie de
ejecución sin datos propios). El dato de dominio sigue en `dominio.comprobantes_venta*` y `public.clientes`,
con su RLS por organización.

## Filtro por empresa y permisos

- **Sección `reportes`** (matriz de `20261013130002`): Administrador y Administración editan; Operador,
  Consulta, Mostrador, Depósito y Miembro no la ven (pantalla «No tenés acceso a esta sección»). La sección
  es **por empresa**: el nivel sale de la empresa activa.
- **Guest token** (`emitir-acceso-reporte`): la cláusula `rls` lleva `organizacion_id` **y**
  `empresa_id IN (empresas accesibles del usuario)`, solo para los reportes con
  `public.reportes.filtro_empresa = true` (opt-in por tablero). Sin empresas accesibles la cláusula es
  `false`: no deja pasar filas. La lista son UUID validados, nunca texto libre del cliente.
- **Pantalla**: el filtro «Tienda» (`FiltroEmpresa`) sigue a la empresa activa de la barra superior
  (Principio VIII); al cambiarla se recarga el tablero y se descarta la selección vieja.

## Pestaña «Productos más consultados» (F-REP-04, MSF-236)

Tercera pestaña de la pantalla: qué productos tocaron más «Consultar por WhatsApp» (F-CON-02) en un período,
aunque todavía no los compren. Solo cantidades: **nunca costo ni margen** (decisión 3 de la épica MSF-192).

- **Datos**: vista `analitica.consultas_producto_mas_consultado` (empresa × producto × fecha, desde
  `dominio.intereses_whatsapp`; columnas `consultas` y `ultima_consulta`). `fecha` es el día en la zona
  `America/Argentina/Buenos_Aires`. Sin acceso para `anon` ni `authenticated`; la lee `superset_analitica`.
- **Tablero**: «Reportes · Productos más consultados», paquete propio
  `infra/superset/dashboards/consultas-reportes/` (`seccion = 'reportes'`, `filtro_empresa = true`, rol por
  defecto `administracion`). Filtros nativos: rango de fechas y empresa. Se importa con
  `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/consultas-reportes --entorno staging|production`
  (el workflow de despliegue lo hace después de `ventas-reportes`).
- **Estado vacío**: `public.consultas_reportes_conteo(desde, hasta, empresa)` (`security definer`, exige
  lectura o edición en `reportes`, acota a las empresas accesibles; `anon` sin ejecución) cuenta los toques del
  período: «No hay consultas por WhatsApp en ese período». Se rige por `reportes` aunque la tabla exija `consultas`.
- **Pantalla**: reutiliza `TableroReporte` y `FiltrosPeriodo`; sigue a la empresa activa (Principio VIII).
- **Reversión** (migración `20270201120000`, aditiva): `drop function public.consultas_reportes_conteo(date, date, uuid);`
  y `drop view analitica.consultas_producto_mas_consultado;`.
- **Pruebas**: `consultas_mas_consultados.test.sql`, `consultas_mas_consultados_aislamiento.test.sql`, Vitest de la pestaña
  (`index.test.tsx`, `MasConsultados.test.tsx`) y `pnpm test:superset:importar-dashboards`.

## Importación de tableros

`pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/ventas-reportes --entorno staging|production`
importa los dos tableros y los registra en `public.reportes` (`seccion = 'reportes'`,
`filtro_empresa = true`) de forma idempotente. Detalle, filtros nativos y límites conocidos en
[`operar-superset.md`](./operar-superset.md).

## Exportación a Excel

- Botón **«Exportar a Excel»** en la pestaña «Ranking de clientes», visible solo con la sección `reportes`.
- Genera un `.xlsx` real con **todas** las filas y los mismos filtros de la pantalla (período, tienda,
  «Consumidor final»), leídas por lotes de `public.leer_ranking_ventas` (tope de 5.000 filas por pedido en
  la base y de 100.000 filas por archivo en la web). `write-excel-file` se carga de forma diferida.
- Texto neutralizado con `neutralizarFormula` (`=`, `+`, `-`, `@` iniciales).
- **Quien autoriza es el servidor**: la RPC exige la organización activa y lectura o edición en `reportes`
  (`42501` si no) y acota a las empresas accesibles; ocultar el botón no es la autorización.

## Revisión de seguridad de la superficie nueva (T014, FR-010)

Verificada con `supabase/tests/database/ventas_reportes_superficie.test.sql` (pgTAP, corre con
`pnpm test:db`) además de los tests de cada historia:

| Control | Resultado |
|---|---|
| `anon` | Sin `USAGE` sobre `analitica`, sin `SELECT` en las vistas y sin `EXECUTE` en las dos RPC |
| `authenticated` | Sin `USAGE` ni `SELECT` sobre `analitica`; lee solo por las RPC (autorizan adentro) |
| Rol `superset_analitica` | Solo `SELECT` en vistas; no es superusuario ni salta RLS; no lee `dominio.comprobantes_venta*` ni `public.clientes` |
| RPC `security definer` | `search_path` fijo (`''`), `revoke … from public, anon`, `grant execute … to authenticated`; autorización explícita adentro |
| Token por empresa | `organizacion_id` + `empresa_id IN (…)` forzados en el servidor (`emitir-acceso-reporte`) |
| Principio VII | Sin tablas nuevas; `analitica` sigue sin tablas; `rls_en_toda_tabla` sigue verde |

## Reversión

Todo es aditivo y sin datos propios. Para quitar la funcionalidad: (1) `drop function
public.leer_ranking_ventas(date, date, boolean, uuid, integer, integer)` y
`drop function public.ventas_reportes_conteo(date, date, uuid)`; (2) `drop view
analitica.ventas_ranking_clientes, analitica.ventas_producto_mas_vendido` y las funciones de apoyo de
`analitica`, en una migración posterior (no se destruye nada en el mismo PR que lo crea); (3) dar de baja
las filas de `public.reportes` de los dos tableros; (4) revertir el PR de la spec con
`git revert -m 1 <merge>`.

## Preguntas abiertas

Las decisiones provisionales de la spec siguen vigentes hasta que Nicolás las confirme:
duplicado con el ranking de Clientes (MSF-126), exportación propia en lugar de la nativa de Superset,
facturación negativa para clientes con solo notas de crédito, «último comprador» como fecha, horas de la
épica (12 h contra la suma nominal de 16 h) y prioridad en el roadmap de diciembre. Además hay que
**verificar en un Superset real** que los filtros nativos lleguen preseleccionados y que la barra de
participación se pinte (no hay Superset en desarrollo).
