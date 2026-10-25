---
owner: producto
sources:
  - specs
---

# Rentabilidad: margen por producto y canal (MSF-120)

**Épica:** MSF-120 · **Historias:** F-REN-01 (margen por producto y canal), F-REN-02 (resumen de
rentabilidad) y F-REN-03 (rentabilidad por producto).

La pantalla **Rentabilidad** (menú **Análisis**, ruta `/rentabilidad`) muestra, para cada producto y cada
tienda, cuánto se gana sobre el precio sin IVA. Tiene dos pestañas, **Resumen** y **Por producto**, y un
resumen por empresa y consolidado para ver de un vistazo dónde se gana poco o se pierde.

## Qué resuelve

Antes el margen se estimaba fuera del panel. Con esta entrega el administrador ve:

- El **margen** de cada producto en cada tienda, calculado sobre el precio neto (sin IVA).
- Un **Resumen** con una tarjeta por empresa y un bloque **Consolidado**.
- Un aviso cuando hay productos **bajo el umbral** o **negativos**, con acceso directo al detalle.
- Una tabla **Por producto** para revisar, filtrar y buscar.
- El **umbral de margen bajo** editable (10 % por defecto).

## Para quién

| Rol | Qué puede hacer en Rentabilidad |
|---|---|
| **Administrador/a** | Ve los tableros y edita el umbral de margen bajo. |
| **Administración** | Ve los tableros en modo lectura; no edita el umbral. |
| **Operador, Mostrador, Depósito, Consulta y demás roles** | No acceden: ven la pantalla de acceso restringido. |

El acceso se resuelve por la sección `rentabilidad` de la matriz de permisos. No alcanza con ocultar la
entrada del menú: la ruta, la emisión del token del tablero y la base lo vuelven a verificar.

**Empresa activa: no aplica.** Rentabilidad compara **todas** las empresas de la organización al mismo
tiempo (tarjetas por empresa y consolidado); no filtra por la empresa de la barra superior. El recorte por
tienda se hace dentro de **Por producto**, con el filtro de canal.

## Qué incluye

### Resumen

- Una **tarjeta por empresa** con nombre, cantidad de productos, margen promedio %, margen promedio por
  unidad en pesos, barra y chips de «margen bajo» y «negativo».
- El bloque **Consolidado** con productos con margen calculado, margen promedio ponderado, cantidad con
  margen bajo (con el umbral vigente) y cantidad con margen negativo.
- La tarjeta **Cómo se calcula** con las fórmulas, una fila por tienda y la aclaración de que es una
  estimación que no incluye impuestos, envíos ni otros costos.
- El aviso «Hay productos que se venden por debajo del costo o casi. Revisalos en Por producto.» con
  **Ver detalle**, que abre **Por producto** con el filtro **Bajo o negativo** ya aplicado. Si no hay
  productos en riesgo, el aviso no aparece.
- Estados de carga, vacío (ningún producto con margen calculado) y error con **Reintentar**.

### Por producto

- Una fila por producto y tienda, con **Producto** (nombre y SKU), **Canal**, **Precio**, **Costo**,
  **Comisión**, **Margen**, **Margen %** y **Estado** (OK / Bajo / Negativo).
- Filtros de **estado** (Todos, Bajo o negativo, Solo negativo) y de **canal** (una opción por tienda).
- Contador de filas, mensaje **Sin resultados** cuando no hay coincidencias y resalte de los márgenes
  negativos.
- La nota «Margen = Precio − Costo − Comisión. Las tiendas propias no tienen comisión en esta versión.»

### Umbral de margen bajo

- Se cambia desde el botón **Umbral de margen bajo** del Resumen, con un campo en porcentaje, **Cancelar**
  y **Guardar**.
- Solo lo ofrece a quien tiene edición; la base también lo exige.
- Valida que sea mayor a 0 % y hasta 100 %, con hasta dos decimales.
- Si otra persona lo cambió mientras se editaba, avisa y pide volver a abrirlo.
- Al guardar se recargan el tablero y el aviso, y queda el evento **`rentabilidad.umbral_actualizado`** en
  Actividad (actor y valor anterior/nuevo).

## Cómo se calcula

```text
precio neto = precio de la tienda sin IVA
costo       = costo del producto en pesos, sin IVA (con la cotización vigente si está en USD)
comisión    = 0 (las tiendas propias no cobran en línea en esta versión)
margen      = precio neto − costo − comisión
margen %    = margen ÷ precio neto
```

El estado surge de comparar el margen % con el umbral de la organización:

| Estado | Cuándo |
|---|---|
| **Negativo** | margen % menor a 0. |
| **Bajo** | margen % mayor o igual a 0 y menor al umbral. |
| **OK** | margen % mayor o igual al umbral (incluido el valor exacto). |

- **No se inventa un margen:** si falta el costo, el precio neto no es positivo o falta la cotización para
  un importe en USD, el producto no aparece con margen y no cuenta como «con margen calculado».
- Se calcula **al leer**, no se guarda un importe en pesos: si cambia el costo, la cotización o la regla de
  precio, el margen cambia solo.
- Solo se consideran productos y tiendas **activos**.
- El **consolidado** pondera con una unidad de cada producto y tienda: suma de márgenes ÷ suma de precios
  netos (no es el promedio simple de los porcentajes). Los productos con margen calculado y los conteos se
  cuentan por producto distinto, tomando su peor estado entre tiendas.

## Límites de esta entrega

- **Sin Mercado Libre.** La pestaña «Por publicación de ML», su comisión y su tarjeta no existen todavía;
  llegan con la épica de Mercado Libre (Etapa 2). Por eso no hay comisión distinta de 0.
- **No incluye impuestos, envíos ni otros costos.** La pantalla lo aclara: es una estimación con los datos
  disponibles.
- **No pondera por stock ni por ventas reales.** Hoy usa una unidad de cada producto; la ponderación real
  queda para MSF-192.
- **No hay costos sin producto ni margen sin costo.** Un producto sin costo cargado no aparece.
- **El filtro inicial desde el aviso depende de Superset.** Si la versión de Superset no respeta el filtro
  nativo, la pestaña abre sin él y ordenada por menor margen (donde primero aparecen los negativos).
- **Búsqueda y orden con desvío (MSF-556).** «Buscar producto o SKU» es una lista desplegable con búsqueda,
  no un campo de texto libre, y el orden está fijo por menor margen: no existe el selector «Mayor/Menor
  margen primero». Queda como seguimiento.
- **E2E con tres roles escrito, pendiente de ejecución.** No se corrió en el entorno del desarrollo por
  falta de Docker; se corre con el stack local y Supabase (`docs/e2e-app.md`).

## Preguntas abiertas (a confirmar con el cliente)

1. ¿Administración debe ver los tableros? Hoy sí, porque la matriz vigente le da `lectura`; la épica decía
   «solo Administrador».
2. ¿El rol Consulta debe ver costos? Hoy no: la matriz le da `ninguno` y el token solo se emite a quien
   tiene la sección.
3. ¿El consolidado debe ponderar por stock o por ventas reales en vez de una unidad por producto?
4. El Roadmap a diciembre manda «Rentabilidad y reportes avanzados» a enero; el documento del componente la
   deja P0 en el Hito 4. La decisión de producto sigue pendiente.
5. El token filtra por **organización**, no por las empresas acotadas de una persona. Si Administración
   tuviera empresas restringidas, esta entrega no lo refleja.
6. Los eventos de Actividad dependen de F-AUD-01, que no está cargada como historia en Jira; se construyen
   contra el contrato existente de `private.insertar_actividad`.

## Estado

Implementado en la rama de la épica (spec `rentabilidad-margen`; commits `0aab690`, `730d42d` y `1cf16a9`),
pendiente de merge a `main`. Los tableros de Superset están versionados como YAML y se importan de forma
idempotente; ver el detalle técnico.

## Para seguir

- **[Rentabilidad: datos, RPC y tableros](../tecnico/rentabilidad.md)** — modelo, contrato `analitica.*`,
  RPC, permisos, importación de tableros y reversión.
- **[Capacidades](capacidades.md)** — el resto de los módulos del producto.
- **[Permisos por rol](../permisos-por-rol.md)** — la matriz de la sección `rentabilidad`.
- **[Catálogo](../catalogo.md)** — de dónde salen el precio de lista y el costo del producto.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
