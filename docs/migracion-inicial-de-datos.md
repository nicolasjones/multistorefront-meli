# Migración inicial de datos · ensayo, conciliación y plan de corte

Cierre de la épica MSF-142 (F-MIG-04, MSF-343). Spec:
[`specs/20261023-120000-migracion-inicial-de-datos/`](../specs/20261023-120000-migracion-inicial-de-datos/spec.md).
Las reglas de importación de cada entidad están en [migracion-datos.md](migracion-datos.md) y el
archivo de ingresos en [ingreso-de-mercaderia.md](ingreso-de-mercaderia.md).

## 1. Informe de conciliación (FR-040, FR-044)

Cada carga de migración se concilia contra su archivo de origen. La RPC
`public.informe_conciliacion_migracion(p_carga uuid)` (solo lee, `security definer`, solo
Administrador, acotada a su organización) devuelve:

| Campo | Qué es |
|---|---|
| `origen.filas` | Filas del archivo que se subió (`migracion_cargas.filas_total`). |
| `cargado.nuevos / actualizados / con_error` | Filas con resultado, contadas desde `migracion_filas` (no desde los contadores guardados). |
| `cargado.omitidos` | Filas del archivo **sin resultado** (carga incompleta o interrumpida). |
| `diferencia` | `origen.filas − (nuevos + actualizados + con_error)`: la calcula la base. Debe ser 0. |
| `destino.verificadas` / `destino.diferencia` | Cuántas filas aplicadas están **realmente** en la tabla destino de la organización con su identificador externo, y cuántas faltan. Detecta datos borrados o alterados después de la carga. |
| `conciliado` | `true` solo si la carga está `aplicada`, `diferencia = 0` y `destino.diferencia = 0`. |
| `errores` | Hasta 200 filas con error y su motivo. |

Tabla destino que se verifica por entidad: clientes → `clientes_identificadores_externos`
(`panel_actual`); proveedores → `dominio.proveedores.id_externo`; vínculos →
`dominio.productos` (SKU con proveedor fijado); ingresos → `dominio.archivo_ingresos_mercaderia`.

Dónde se ve: **al terminar el asistente** (bloque «Conciliación» del resultado) y **de nuevo en
cualquier momento** en `Informes de conciliación` (`/migracion/informes` y
`/migracion/informes/:carga`, botón en el asistente). Es de la organización: cambiar la empresa
activa de la barra superior no lo reencuadra (Principio VIII, igual que el asistente).

Migración: `20261201130000_migracion_conciliacion.sql` (aditiva; solo agrega una función; sin
tablas nuevas, por eso no hay esquema que declarar). Reversión en una migración posterior:
`drop function public.informe_conciliacion_migracion(uuid);`.

## 2. Ensayo completo con datos inventados (FR-041, FR-042, SC-001…SC-004)

El ensayo es la prueba pgTAP `supabase/tests/database/migracion_ensayo.test.sql`. Corre el
procedimiento entero **dos veces** sobre los mismos archivos sintéticos, en el orden del plan de
corte, y verifica el informe de cada entidad:

1. Clientes → proveedores → vínculos proveedor↔producto → archivo de ingresos.
2. Por entidad: iniciar carga → aplicar lote → cerrar carga → informe de conciliación.
3. Corrida 1: 2 filas válidas + 1 con error por entidad; las cuatro quedan `conciliado = true`, diferencia 0.
4. Corrida 2 (mismos archivos): nada se crea de nuevo (todo lo válido se **actualiza**), los errores son
   idénticos y no hay duplicados (SC-004). El stock vivo no cambia (SC-003).
5. Otra organización no ve nada del ensayo (SC-006).

Cómo correrlo:

```bash
pnpm dev:supabase                                    # base local
supabase test db --local supabase/tests/database/migracion_ensayo.test.sql
supabase test db --local supabase/tests/database/migracion_conciliacion.test.sql
```

La **evidencia** del ensayo son las líneas `# EVIDENCIA corrida 1/2: {...}` que imprime el test (el
informe JSON de cada entidad) y el resultado `ok` de sus 17 pruebas; el CI las ejecuta con
`pnpm test:db` en el PR. Para ensayar a mano con el asistente: usar solo CSV inventados (las
plantillas descargables son el contrato de columnas), cargar en el orden de abajo, abrir
`Informes de conciliación` y repetir el mismo archivo para comprobar que no hay duplicados.

> Límites del informe: la lista de errores muestra hasta 200 filas (la pantalla avisa «Mostrando 200
> de N»; el contador «Con error» es el total). En vínculos proveedor↔producto, la verificación contra
> el destino exige que el SKU exista con algún proveedor asignado, no que sea el del archivo.

> Estado del ensayo al armar esta historia: el entorno de desarrollo no tenía Docker/Supabase local,
> así que la corrida verificada de los tests pgTAP es la del CI del PR (ver sus checks). Los tests
> Vitest del informe y de la pantalla sí se corrieron localmente.

## 3. Plan de corte (FR-043, SC-005)

Los **datos reales se manejan solo en producción**; los ensayos usan datos inventados. Nada de datos
reales en git, en tests ni en el PR.

### Prerrequisitos (antes del día del corte)

- [ ] Catálogo de productos cargado (lo migra Catálogo): los vínculos necesitan los SKU.
- [ ] Stock inicial cargado por Stock (F-STK-07, P1): el archivo de ingresos **no** modifica stock.
- [ ] El panel actual exportó a CSV UTF-8: clientes (confirmado), **proveedores, vínculos e ingresos
      (a confirmar por Nicolás, FR-024/FR-035)**. Un export Excel se guarda como CSV UTF-8.
- [ ] Ensayo del §2 en verde (dos corridas, `conciliado = true`, sin duplicados).
- [ ] Copia de seguridad de la base de producción tomada y verificada (ver [copias-y-restauracion.md](copias-y-restauracion.md)).
- [ ] Un usuario con rol **Administrador** de la organización destino.

### Responsables

| Rol | Hace |
|---|---|
| Administrador de la organización | Ejecuta la carga real con el asistente y revisa cada informe. |
| Quien opera el repo (agente / desarrollo) | Mantiene herramientas y ensayos; no carga datos reales. |
| Persona de negocio que aprueba el corte | Valida el informe final y decide seguir o volver atrás. *(Nombre a confirmar por Nicolás.)* |

### Orden de carga

1. **Clientes** — `/migracion/importar/clientes`.
2. **Proveedores** — `/migracion/importar/proveedores`.
3. **Vínculos proveedor↔producto** — `/migracion/importar/vinculos-proveedor-producto`.
4. **Archivo de ingresos** — `/migracion/importar/ingresos_archivo`.

Por cada paso: subir → mapear → vista previa (corregir el CSV si hay errores que no deberían
estar) → importar → **leer el informe de conciliación** → recién entonces pasar al siguiente. Si un
paso falla a medias, **reintentar con la misma carga**: lo ya cargado no se duplica.

### Criterios de aceptación del corte

- Las cuatro cargas con `estado = aplicada` y `conciliado = true`.
- `diferencia = 0` y `destino.diferencia = 0` en cada informe.
- Las filas con error están explicadas (motivo por fila) y fueron revisadas por negocio; las que no
  se pueden cargar quedan en una lista de corrección posterior.
- El conteo de clientes, proveedores y líneas de archivo coincide con el del origen menos los errores aceptados.
- El stock no cambió por efecto de la carga.

### Vuelta atrás

- **Antes de cargar:** nada que revertir.
- **Una carga con datos malos:** `migracion_filas` (estado `nueva`) lista qué se creó. Los registros
  creados se desactivan/borran por el circuito normal de cada pantalla (Clientes, Proveedores); el
  archivo de ingresos no se edita desde la app, se corrige con un CSV corregido (el upsert por
  `id_externo` actualiza). Reimportar un archivo corregido **actualiza**, no duplica.
- **Corte entero:** restaurar la copia de seguridad previa al corte.
- **Las migraciones** de la épica son aditivas; su reversión (un `drop function` / `drop table` en una
  migración posterior) está documentada en el encabezado de cada una y **no** borra los datos ya cargados.

## 4. Revisión de seguridad del conjunto (SC-006)

Revisión de las cuatro migraciones (`20261201100000`, `…110000`, `…120000`, `…130000`), el asistente
y las pantallas de informe. Resultado:

| Punto | Verificación |
|---|---|
| `anon` | Ninguna RPC de migración es ejecutable por `anon`: cada una hace `revoke execute … from public, anon` y `grant execute … to authenticated` (grep sobre las 4 migraciones). Las tablas nuevas nacen sin privilegios para `anon` (`revoke all`). Los tests pgTAP comprueban `has_function_privilege('anon', …) = false`. |
| Rol | Toda RPC valida `private.puede_escribir()` (Administrador) y la organización de la sesión (`private.organizacion_id()`); un rol de consulta recibe `42501` (pgTAP). |
| RLS | `migracion_cargas` / `migracion_filas`: `select` del Administrador de su organización, sin grants de escritura. `dominio.archivo_ingresos_mercaderia`: solo `select`. |
| Aislamiento | El informe filtra la carga y cada tabla destino por la organización de la sesión; otra organización recibe `P0002` y no mezcla destinos aunque repita el identificador externo (pgTAP `migracion_conciliacion` y `migracion_ensayo`). |
| Service-role | Ninguna pantalla ni librería de migración la usa: el único hallazgo de `grep -i service.role` en `apps/web/src/lib/migracion.ts` es el comentario que dice que **no** se usa. El navegador viaja con la sesión del Administrador. |
| Entrada del usuario | Las RPC reciben JSON y validan cada fila (largos, formatos, número de fila entero); el informe no devuelve datos de la fila, solo número y motivo; `mensajeDeErrorMigracion` no vuelca el error crudo (PII). |
| Hallazgos abiertos | Ninguno. |
