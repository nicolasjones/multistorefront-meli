---
owner: producto
sources: [apps/web/src, specs]
---
# Rentabilidad (margen por producto y canal)

Épica MSF-120 · spec [`rentabilidad-margen`](https://github.com/nicolasjones/multistorefront-meli/blob/main/specs/20261023-170000-rentabilidad-margen/spec.md) ·
historias F-REN-01 (MSF-204), F-REN-02 (MSF-221) y F-REN-03 (MSF-242) · cierre MSF-553.
Alcance de entrega: `refine`, `supabase` y `superset` (sin `kestra` ni `workers`: el cálculo es SQL y
el tablero lo sirve Superset). Todos los supuestos de negocio están **a confirmar con el cliente**.

## Qué hace

La pantalla `/rentabilidad` (menú «Análisis») muestra, para cada producto y cada tienda, cuánto se gana
sobre el precio sin IVA. Tiene dos pestañas: **Resumen** (tarjetas por empresa y Consolidado, aviso de
productos en riesgo, «Cómo se calcula») y **Por producto** (tabla con filtros). La pestaña «Por publicación
de ML» no existe todavía: se oculta hasta que la organización tenga Mercado Libre activo.

Las tarjetas y la tabla son tableros de Superset embebidos; las pestañas, el aviso, el diálogo del umbral,
el acceso restringido y el error con reintento son de Refine (`apps/web/src/pages/rentabilidad/`).

## Fórmula

```text
precio_neto = precio de la tienda sin IVA (private.precio_neto_empresa)
costo       = costo del producto en pesos (private.a_pesos, cotización vigente)
comision    = 0                       (las tiendas no cobran en línea)
margen      = precio_neto − costo − comision
margen_pct  = margen / precio_neto
estado      = negativo  si margen_pct < 0
              bajo      si margen_pct < umbral
              ok        en otro caso
```

- Se calcula **al leer** (vistas), no se guarda ningún importe: cambia el costo, la cotización o la regla de
  precio y el margen cambia solo.
- **Sin fila** si falta el costo, el precio neto no es positivo o falta la cotización (no se inventa).
- Solo productos y empresas activos.

## Umbral de margen bajo

- Por organización, en `dominio.rentabilidad_config` (fracción: `0,10` = 10 %). Sin fila rige **10 %**.
- Lo cambia **solo quien tiene `edicion` en `rentabilidad`** (hoy el Administrador) desde el diálogo
  «Umbral de margen bajo» del Resumen: `guardar_umbral_margen_bajo` valida `0 < umbral ≤ 1` con hasta 2
  decimales en %, usa bloqueo optimista por `updated_at` (`40001` si otra persona lo cambió) y deja el evento
  `rentabilidad.umbral_actualizado` en Actividad.
- Al guardar se recargan el tablero y el aviso.

## Ponderación del consolidado

Una unidad de cada producto: **Σ márgenes ÷ Σ precios netos** sobre las filas producto × tienda. «Productos
con margen calculado» cuenta productos **distintos**; un producto con margen negativo en una tienda cuenta
como negativo aunque en otra sea bajo. Ponderar por stock o ventas reales queda fuera de esta épica
(MSF-192 lo retoma).

## Contrato `analitica.*`

Esquema `analitica`: **solo vistas** (sin tablas) y dos funciones de apoyo `security definer`. Cada vista
expone `organizacion_id`: es la columna por la que el guest token filtra (`rls`). Contrato completo en
[`contracts/analitica-margen.md`](https://github.com/nicolasjones/multistorefront-meli/blob/main/specs/20261023-170000-rentabilidad-margen/contracts/analitica-margen.md).

| Objeto | Qué es | Consumidores |
| --- | --- | --- |
| `analitica.margen_producto_canal` | una fila por producto y tienda (`precio_neto`, `costo`, `comision`, `margen`, `margen_pct`, `estado`) | tablero «Por producto»; MSF-156, MSF-127, MSF-128, MSF-192, MSF-265 |
| `analitica.rentabilidad_resumen_empresa` | una fila por empresa con margen | tarjetas del Resumen |
| `analitica.rentabilidad_consolidado` | una fila por organización (ponderado, conteos, umbral) | tarjeta Consolidado |
| `public.leer_umbral_margen_bajo()` / `guardar_umbral_margen_bajo(...)` | RPC `security invoker` | diálogo del umbral |
| `public.rentabilidad_conteo_margen()` | RPC `security definer` con control de sección y organización adentro | aviso y estado vacío |

## Esquemas (Principio VII)

| Objeto | Esquema | Por qué |
| --- | --- | --- |
| `rentabilidad_config` | `dominio` | regla de negocio de la organización |
| vistas y funciones de apoyo | `analitica` | contrato de lectura para Superset y otras épicas, sin tablas |
| RPC | `public` | superficie de ejecución, no almacena datos |
| `reportes.seccion` | `public` | plataforma (catálogo de reportes) |

## Permisos

| Rol | Sección `rentabilidad` | Ve la pantalla y el token | Edita el umbral |
| --- | --- | --- | --- |
| Administrador | edición | sí | sí |
| Administración | lectura | sí | no (el botón no existe) |
| Operador, Consulta, Mostrador y demás | ninguno | `AccesoRestringido`, sin pedir token | no |

- La ruta exige `lectura` y **no se oculta solo en el menú**; ante un 403 del token se muestra lo mismo.
- `emitir-acceso-reporte` solo emite token si el reporte tiene `reportes.seccion` y la persona tiene esa
  sección (`resolver_organizacion_reporte` devuelve `null` si no → 403 sin token). La cláusula `rls` del
  token es siempre `organizacion_id = '<org>'`.
- La pantalla **no depende de la empresa activa** de la barra superior: compara todas las empresas de la
  organización (Principio VIII, no aplica; ver la matriz de la spec).

## Seguridad de la superficie (revisión de cierre, T031)

Revisada contra RLS, grants, `anon`, esquema `analitica`, rol de Superset, token por sección y esquema de
cada objeto. Guardas en pgTAP: `rentabilidad_superficie.test.sql` (invariantes), más
`rentabilidad_permisos`, `rentabilidad_aislamiento`, `rentabilidad_margen`, `rentabilidad_consolidado`,
`rentabilidad_por_producto` y `rls_en_toda_tabla`.

- **`dominio.rentabilidad_config`**: RLS por organización y por sección; sin `DELETE`; `anon` sin privilegios;
  `authenticated` solo `select` y escritura por columna.
- **`analitica`**: `revoke all` a `public`, `anon` y `authenticated`; solo el rol `superset_analitica` (sin login
  por defecto, sin superusuario, sin escritura) usa el esquema y lee las vistas.
- **Funciones `security definer`**: todas con `set search_path = ''`; las de `analitica` solo las ejecuta el rol
  de Superset; `rentabilidad_conteo_margen` valida sección y organización antes de leer.
- **Hallazgos aceptados** (sin cambio de código; la mitigación es la guarda pgTAP):
  - Las vistas corren con los permisos de su dueño, así que **no rige RLS dentro de Superset**: el aislamiento
    entre organizaciones depende de la cláusula `rls` del guest token. Por eso la guarda exige `organizacion_id`
    en toda vista de `analitica` y SC-003 prueba dos organizaciones.
  - `alter default privileges … grant select on tables to superset_analitica` hace que una vista futura de
    `analitica` quede legible por Superset: toda vista nueva debe exponer `organizacion_id` (la guarda lo verifica).
  - `analitica.neto_empresa` y `analitica.a_pesos` aceptan ids de cualquier organización; solo las ejecuta el
    rol de Superset, con el mismo alcance que las vistas.

## Importación de tableros

Los tableros viven como YAML en `infra/superset/dashboards/rentabilidad/` (nunca solo en la UI).

```bash
pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/rentabilidad --entorno staging|production
```

Empaqueta, importa en Superset y registra los reportes en `public.reportes` (con `seccion = 'rentabilidad'`)
desde `reportes.json`, de forma idempotente. Variables (solo en `.env`/secrets, nunca en Git):
`SUPERSET_ANALITICA_DB_HOST`, `SUPERSET_ANALITICA_DB_PASSWORD`, y para el registro `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (solo server-side) y `SUPERSET_REPORTE_CREADO_POR`. El rol `superset_analitica` lo
crea la migración `20261130100300` como `nologin`: el operador le asigna login y contraseña por entorno.
Detalle del tablero «Por producto» y sus límites en [`operar-superset.md`](./operar-superset.md).

## Reversión

Las migraciones son aditivas; el camino de vuelta va en el encabezado de cada una y se aplica en **una
migración posterior**, nunca en el PR que las crea: quitar las tres vistas y el esquema `analitica`, las tres
RPC, `dominio.rentabilidad_config` (exportar antes los datos) y `public.reportes.seccion`, y restaurar
`resolver_organizacion_reporte` de la spec 007. Para deshacer la épica completa: `git revert -m 1` del merge.

## Pruebas

pgTAP (`supabase/tests/database/rentabilidad_*.test.sql`), Vitest (`apps/web/src/pages/rentabilidad/`,
`lib/rentabilidad`) y E2E con los tres roles (`apps/web/e2e/rentabilidad-roles.e2e.ts`, ver
[`e2e-app.md`](./e2e-app.md)).

## Preguntas abiertas (a confirmar con el cliente)

1. ¿Administración debe ver los tableros? Hoy sí (la matriz le da `lectura`; la épica decía «solo Administrador»).
2. ¿El rol Consulta ve costos? Hoy no (`ninguno`).
3. ¿Ponderar el consolidado por stock o ventas reales? Hoy una unidad de cada producto (MSF-192).
4. El Roadmap a diciembre manda «Rentabilidad y reportes avanzados» a enero; el doc del componente la deja P0
   en el Hito 4: Nicolás decide y alinea.
5. El token filtra por organización, no por las empresas acotadas de una persona (permisos por empresa).
6. Pendientes de F-REN-03 trazados en **MSF-556**: selector «Mayor/Menor margen primero» y buscador de texto
   libre (hoy orden fijo por menor margen y lista con búsqueda).
