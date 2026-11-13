# Bug Fix: la baja de una organización con ingresos de mercadería difería demasiadas claves (MSF-844)

- **Slug**: msf-844
- **Fixed**: 2026-11-13
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

La migración que permite dar de baja una organización con ingresos de mercadería difería las claves
foráneas de TODA la clausura de la cascada de `public.organizaciones` (155 tablas, 71 FK), así que
rompía las pruebas de ventas, motos, cotizaciones y stock. Esta entrega la rehace con el alcance
acotado a las tablas de la baja (8 claves) y agrega una guarda en el pgTAP que impide que el alcance
vuelva a crecer. Del lado del panel, la tabla con scroll vuelve a ser una región con nombre y con
foco y la aserción de `listas.test.tsx` queda con el conteo real.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270304100001_baja_organizacion_con_ingresos_de_mercaderia.sql` | added | Alcance acotado: sólo se diferen las FK cuya tabla origen está en el alcance de la baja y cuya tabla destino también se borra en la cascada de la organización. |
| `supabase/tests/database/baja_organizacion_con_ingresos.test.sql` | added | pgTAP de la baja (11 casos) + guarda anti-regresión del alcance. |
| `apps/web/src/components/pagina/ContenidoAdaptable.tsx` | modified | La tabla con scroll es una región con nombre propio y con foco (`tabIndex`, `role="region"`, «… (se desplaza)»), como las demás tablas del panel; sin `etiquetaTabla` no inventa un nombre «undefined». |
| `apps/web/src/pages/configuracion/listas.test.tsx` | modified | La aserción de regiones pasa de 2 a 4 (las dos secciones + las dos tablas). |
| `docs/empresas.md` | modified | La baja con ingresos deja de ser un límite conocido: alcance, comportamiento y reversión. |
| `.specify/bugs/msf-844/assessment.md` | added | Evaluación del bug. |
| `.specify/bugs/msf-844/test.md` | added | Verificación. |

## Diff Highlights

El `do $$` de la migración (antes: toda la clausura; ahora: el alcance de la baja):

```sql
    with recursive cierre(rel) as (
      select 'public.organizaciones'::regclass
      union
      select k.conrelid
        from pg_constraint k
        join cierre c on k.confrelid = c.rel
       where k.contype = 'f' and k.confdeltype = 'c'
    ),
    alcance(rel) as (
      select 'dominio.empresas'::regclass
      union select 'dominio.proveedores'::regclass
      union select 'dominio.proveedores_contactos'::regclass
      union select 'dominio.productos'::regclass
      union select 'dominio.ingresos_mercaderia'::regclass
      union select 'dominio.ingresos_mercaderia_lineas'::regclass
    )
    select k.oid, k.conrelid::regclass as tabla, k.conname, k.confdeltype
      from pg_constraint k
     where k.contype = 'f'
       and k.confdeltype in ('r', 'a')
       and not k.condeferrable
       and k.conrelid in (select rel from alcance)
       and k.confrelid in (select rel from cierre)
```

La guarda del pgTAP que impide que el alcance vuelva a crecer:

```sql
select is(
  (select count(*)::int
     from pg_constraint k
     join pg_class c on c.oid = k.conrelid
     join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f'
      and k.condeferrable
      and not (n.nspname = 'dominio'
               and c.relname = any (array['proveedores_contactos', 'productos',
                                          'ingresos_mercaderia', 'ingresos_mercaderia_lineas']))),
  0, 'ninguna clave foránea fuera del alcance de la baja quedó diferida');
```

## Tests Added or Updated

- `supabase/tests/database/baja_organizacion_con_ingresos.test.sql::1` — borrar un producto usado
  por una línea de ingreso sigue prohibido (23503 al confirmar).
- `…::2` — borrar un producto usado por un ingreso sigue prohibido (23503 al confirmar).
- `…::3` — borrar un proveedor con productos y contactos sigue prohibido (23503 al confirmar).
- `…::4` — la baja de la organización con ingresos, productos con proveedor y contactos completa.
- `…::5-8` — la baja se llevó ingresos, contactos, productos y proveedores.
- `…::9` — las 7 claves del alcance (8 en total) están diferidas.
- `…::10` — ninguna clave foránea fuera del alcance quedó diferida (guarda anti-regresión).
- `…::11` — las claves de ventas, motos, cotizaciones y stock siguen siendo inmediatas.
- `apps/web/src/pages/configuracion/listas.test.tsx::149` — la pantalla «Listas configurables»
  expone 4 regiones (las dos secciones y las dos tablas con scroll).

## Local Verification

- `pnpm --filter @platform/web exec vitest run src/pages/configuracion/listas.test.tsx src/components/pagina/ContenidoAdaptable.test.tsx` → 2 archivos / 15 pruebas ✓
- `pnpm lint` → exit 0 (los warnings son preexistentes) ✓
- `pnpm build` (`tsc -b && vite build`) → exit 0 ✓
- `pnpm docs:check` → «Documentación de cambios: OK» + «Migraciones OK: 630 archivo(s), 1 nuevo(s)» ✓
- `node scripts/verificar-migraciones.mjs` → «630 archivo(s), 1 nuevo(s) contra origin/dokploy» ✓
- `node scripts/validar-migraciones-aditivas.mjs` → «ninguna destructiva sin camino de reversión documentado» ✓
- `pnpm calidad:code` → oxlint/knip/jscpd/dependency-cruiser/syncpack OK; gitleaks se saltea
  (necesita Docker, sin permisos en este entorno).
- pgTAP: **no se pudo correr localmente** (no hay Docker ni psql para levantar el stack de Supabase
  en este entorno); la suite completa queda para el job `database` del CI.

## Deviations from Assessment

- **`dominio.movimientos_stock` queda fuera del alcance de diferimiento.** El assessment tomaba el
  alcance del ticket (que lo incluía). No se puede diferir: sus claves `no action` dejan eventos de
  trigger pendientes y `truncate dominio.movimientos_stock` pasa a fallar con 55006
  («cannot TRUNCATE … because it has pending trigger events»), que es exactamente el fallo del pgTAP
  `stock_historial.test.sql` (caso 3) en el run 43342254406. Sus claves tampoco hacen falta para esta
  baja: la cascada ya borra los movimientos antes que las existencias y los motivos, que es lo que
  comprueba `stock_historial.test.sql:192` («se puede borrar una organización con movimientos
  (cascada)»).
- **El alcance se define por la tabla ORIGEN de la clave** (las cuatro tablas de la baja) y no por el
  par (origen, destino): así se incluye `ingresos_mercaderia_lineas → movimientos_stock`, que es
  indispensable y cuyo destino está fuera de las cuatro tablas.

## Follow-ups

- La baja sigue fallando por clave foránea con datos que tienen FK `restrict` fuera del alcance
  (p. ej. `dominio.reparaciones → dominio.empresas`). Ampliar el alcance es una historia aparte, con
  su propia prueba.
- Ninguna función SQL del repositorio atrapa `foreign_key_violation`: con las claves diferidas, el
  error de borrar un registro usado por otro llega al COMMIT.
