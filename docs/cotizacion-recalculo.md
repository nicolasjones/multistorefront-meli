---
owner: producto
sources: [specs]
---
# Vista previa de impacto y recálculo de la cotización (F-PRE-03)

Historia F-PRE-03 (MSF-267) de la épica MSF-116 (`specs/20261023-120000-dolar-y-recalculo/`).
Continúa [cotizacion-carga-diaria.md](cotizacion-carga-diaria.md): la cotización cargada queda **pendiente**;
acá se ve qué precios cambiarían, se **confirma** (recalcula todas las empresas juntas) o se **descarta**.
El historial inmutable y paginado es F-PRE-04; el aviso diario, F-PRE-05; el cierre de la épica
(`docs/dolar-y-recalculo.md`) integra este documento.

## Modelo

- **No se guarda ningún precio en pesos** (modelo de MSF-114: el precio se calcula al leer). «Recalcular todos
  los precios» es **cambiar atómicamente la cotización aplicada** (una sola fila por organización) y registrar
  cuántos precios cambian. Ninguna empresa puede quedar con un valor distinto de otra.
- `private.a_pesos` (único punto de lectura) ahora lee `coalesce(cotizacion_aplicada, cotizacion_inicial)`: misma
  firma, cambia solo la fuente. Sin ninguna fila, un producto en USD sigue sin precio (no se inventa un valor).
- **Umbral fijo de 1 %** (la configuración es F-PRE-06, Etapa 2): con |variación| ≥ 1 % la confirmación recalcula;
  con menos, **solo registra** la cotización (queda en el historial y como vigente, pero la aplicada no se toca).
  Sin cotización previa (ni inicial) siempre se aplica. El umbral se mide contra la cotización **vigente**
  (última confirmada o inicial), no contra la aplicada: con cargas chicas sucesivas la diferencia se acumula
  sin recalcular (Decisión abierta 3 de la spec, pendiente de OK; cambiarlo es una línea marcada «umbral» en
  `confirmar_cotizacion`).
- «Precios recalculados» = productos activos en USD × empresas activas (el mismo número del mosaico de la vista
  previa). Bajo el umbral es 0.
- Cancelar **descarta** la pendiente (supuesto RF-PRE-03-7, a confirmar). Cerrar el diálogo con la «X» o Escape
  en el paso de confirmación equivale a Cancelar.

## Datos (Principio VII)

| Objeto | Esquema | Acceso |
|---|---|---|
| `cotizacion_aplicada` (**nueva**, una fila por organización) | `dominio` | RLS por organización; select para quien ve `productos` (igual que `cotizacion_inicial`: si no, los roles sin acceso a la cotización verían precios vacíos); **sin** insert/update/delete para `authenticated`: escribe solo `confirmar_cotizacion`; `anon` sin privilegios |

Migraciones aditivas: `20261023140200_cotizacion_previsualizar.sql` y `20261023140300_cotizacion_confirmar_recalculo.sql`.

## RPC (`public`, `revoke … from public, anon`, `grant execute … to authenticated`)

- `previsualizar_cotizacion()` → `{ variacion_pct, recalcula, empresas: [{ empresa_id, nombre, precios }], muestra: [{ producto, sku, usd, por_empresa: [{ empresa_id, hoy, nuevo }] }] }`.
  Exige `edicion`. **Solo lee.** `hoy` y `nuevo` son el precio que ve el cliente en cada empresa (regla de la empresa
  y IVA si la empresa lo muestra), con una muestra de 6 productos activos en USD. `security definer` solo para
  leer la regla de cada empresa (sección `empresas`) sin exigírsela a quien carga el dólar; filtra por la
  organización de la sesión.
- `confirmar_cotizacion()` → `{ id, recalculo_aplicado, precios_recalculados }`. Exige `edicion`. **`security definer`**
  (único camino de escritura a `cotizaciones` y `cotizacion_aplicada`; excepción acotada al estilo `security invoker`).
  Una transacción: bloqueo por organización (`pg_advisory_xact_lock` + `for update` de la pendiente), historial,
  cotización aplicada (si alcanza el umbral), borrado de la pendiente y eventos. Errores: `42501` sin permiso,
  `P0002` `sin_cotizacion_pendiente` (no hay, venció o ya se confirmó). Ante doble clic o dos administradores
  gana una sola confirmación; la otra recibe `P0002` y no duplica el historial.
- `descartar_cotizacion()` → vacío. Exige `edicion`. `security definer` (para dejar el evento de actividad en la
  misma transacción). Idempotente: sin pendiente no hace nada ni deja evento.

## Eventos de actividad (`registro_actividad`, misma transacción que el cambio)

`cotizacion.cargada` (al confirmar), `recalculo.aplicado`, `recalculo.omitido` (bajo el umbral) y
`cotizacion.descartada`. Si alguno falla, la confirmación entera se deshace.

## Pantalla

El diálogo **Cargar dólar del día** tiene dos pasos. Paso 1: el valor (F-PRE-02); al continuar queda pendiente.
Paso 2: variación, alerta «Variación inusual» (> 15 %) y, si alcanza el umbral, el bloque **Qué va a cambiar**
(mosaico por empresa y tabla «Producto (muestra)» con «<Empresa> hoy» / «Nuevo», pie «Redondeo al $ 10 más
cercano.»); bajo el umbral, la alerta **Sin recálculo** y el botón **Registrar cotización**. Acciones:
**Cancelar** (descarta), **Aplicar y recalcular** / **Registrar cotización**. Avisos: «Cotización aplicada · N
precios recalculados» / «Cotización registrada · variación menor al umbral, precios sin cambios»; vencida o
ya confirmada: «La cotización cargada venció; volvé a cargarla.»

Mercado Libre (mosaico, columnas «ML» y su pie) queda fuera: es Etapa 2. **Empresa activa:** no aplica — la
cotización es de la organización; cambiar de empresa en la barra superior no altera la pantalla (probado).

## Pruebas

- pgTAP `supabase/tests/database/cotizacion_recalculo.test.sql` (SC-003): dos organizaciones, vista previa sin
  escritura, umbral (1005 sobre 1000 no recalcula; 1050 sí; justo 1 % sí), todas las empresas con el mismo valor,
  doble confirmación, vencida, permisos por rol, eventos, atomicidad con falla simulada, `a_pesos` con y sin
  aplicada y `anon`.
- Vitest (SC-004): `lib/cotizacion.test.ts`, `hooks/useCotizacion.test.tsx`,
  `hooks/usePrevisualizarCotizacion.test.tsx`, `components/cotizacion/BloqueQueVaACambiar.test.tsx`,
  `components/cotizacion/DialogoCargarDolar.test.tsx` y `pages/cotizacion/index.test.tsx` (incluye el cambio de empresa activa).

## Reversión

Migración posterior (exportar antes `cotizacion_aplicada`): quitar las RPC `descartar_cotizacion`,
`confirmar_cotizacion` y `previsualizar_cotizacion`; quitar las funciones privadas `precio_visible_desde_central`,
`precios_usd_por_empresa` y `cotizacion_vigente`; restaurar `private.a_pesos` para que lea solo
`dominio.cotizacion_inicial` (cuerpo de `20261022121001`); y eliminar la tabla `dominio.cotizacion_aplicada`. Los
precios vuelven a calcularse con la cotización inicial.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.
