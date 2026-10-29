---
owner: producto
sources:
  - specs
---

# Rentabilidad: margen por producto y canal (MSF-120, MSF-127)

**Épicas:** MSF-120 (historias F-REN-01 *margen por producto y canal*, F-REN-02 *resumen* y F-REN-03 *por
producto*) · **MSF-127** (F-REN-06 *comparativo entre canales y empresas* y F-REN-07 *rentabilidad con la
cotización de cada fecha*).

La pantalla **Rentabilidad** (menú **Análisis**, ruta `/rentabilidad`) muestra, para cada producto y cada
tienda, cuánto se gana sobre el precio sin IVA. Tiene cuatro pestañas: **Resumen** y **Por producto** (MSF-120),
más **Comparativo** y **Historia** (MSF-127), y un resumen por empresa y consolidado para ver de un vistazo
dónde se gana poco o se pierde.

## Qué resuelve

Antes el margen se estimaba fuera del panel. Con esta entrega el administrador ve:

- El **margen** de cada producto en cada tienda, calculado sobre el precio neto (sin IVA).
- Un **Resumen** con una tarjeta por empresa y un bloque **Consolidado**.
- Un aviso cuando hay productos **bajo el umbral** o **negativos**, con acceso directo al detalle.
- Una tabla **Por producto** para revisar, filtrar y buscar.
- El **umbral de margen bajo** editable (10 % por defecto).
- Un **Comparativo** (F-REN-06, MSF-127) que pone el mismo producto lado a lado en cada empresa, con la
  diferencia en puntos porcentuales y la mejor y la peor empresa.
- Una **Historia** (F-REN-07, MSF-127) que reconstruye cómo evolucionó el margen de un producto con la
  cotización del dólar y el costo que regía en cada fecha.

## Para quién

| Rol | Qué puede hacer en Rentabilidad |
|---|---|
| **Administrador/a** | Ve los tableros y edita el umbral de margen bajo. |
| **Administración** | Ve los tableros en modo lectura; no edita el umbral. |
| **Operador, Mostrador, Depósito, Consulta y demás roles** | No acceden: ven la pantalla de acceso restringido. |

El acceso se resuelve por la sección `rentabilidad` de la matriz de permisos. No alcanza con ocultar la
entrada del menú: la ruta, la emisión del token del tablero y la base lo vuelven a verificar.

**Empresa activa: no aplica.** Rentabilidad compara **todas** las empresas de la organización al mismo
tiempo (tarjetas por empresa y consolidado, comparativo e historia); no filtra por la empresa de la barra
superior. El recorte por tienda se hace dentro de **Por producto**, con el filtro de canal. Cambiar la
empresa de la barra superior **no altera** los tableros de **Comparativo** ni de **Historia**.

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

### Comparativo (F-REN-06, MSF-127)

Compara **el mismo producto en cada empresa** de la organización, para detectar dónde se gana de más o de
menos por un producto que se vende en varias tiendas.

- Una fila por producto con el **margen % de cada empresa** lado a lado, la **diferencia** entre la mejor y
  la peor (en puntos porcentuales) y el nombre de la **mejor** y la **peor** empresa. El contador dice
  «N productos».
- **Solo entran los productos con margen calculado en 2 o más empresas.** Un producto que tiene margen en una
  sola empresa no tiene con qué compararse y sigue solamente en **Por producto**.
- Filtros **Buscar producto o SKU** y **Orden por diferencia** («Mayor diferencia primero» —el que viene por
  defecto— o «Menor diferencia primero»).
- Sin coincidencias, o una organización sin ningún producto comparable, se muestra el estado vacío con el
  motivo de negocio: «No hay productos con margen en dos o más empresas. Cambiá el filtro o la búsqueda.»
- El comparativo usa los **valores de hoy**: mismo precio, costo y cotización que **Por producto**. Para ver
  cómo se movió el margen en el tiempo está la pestaña **Historia**.

### Historia (F-REN-07, MSF-127)

Permite elegir un producto y reconstruir **cómo evolucionó su margen**, con la cotización del dólar de cada
fecha y el costo que regía ese día, para entender si el margen cambió por el dólar o por un cambio de costo.

- Un **selector de producto** (una sola opción a la vez) y, con el producto elegido:
  - una **serie** con el margen % de cada empresa a lo largo de las fechas;
  - una **tabla de apoyo** con **Fecha**, **Empresa**, **Cotización**, **Costo**, **Neto**, **Margen** y
    **Margen %**.
- Las **fechas de la serie** son dos cosas: cada cambio de costo y cada carga de cotización del dólar. Así el
  margen se reconstruye tanto cuando se mueve el dólar como cuando cambia el costo.
- El **costo de cada fecha** es el último costo registrado hasta esa fecha; la **cotización** es la carga más
  cercana en el tiempo (a igual distancia, la anterior).
- Un producto **en pesos** no se mueve con el dólar: su serie queda plana salvo que cambie el costo. Un
  producto **en dólares** sí se mueve con la cotización más cercana a cada fecha.
- Sin historia suficiente (falta un costo registrado o una cotización del dólar cargada) se muestra el estado
  vacío con el motivo de negocio: «Sin historia para este producto».
- Los **importes del historial** (costo, cotización, margen) solo los ve quien tiene la sección
  `rentabilidad`: no aparecen ni en la tabla, ni en el tablero, ni en Actividad para los demás roles.

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

### Cómo se calcula la Historia (F-REN-07)

- **El costo de cada fecha** sale de una **historia de costos propia**, no de Actividad. Cada alta o cambio
  real de costo (desde el catálogo, desde un proveedor o desde un ingreso de mercadería) deja una fila con su
  fecha; guardar el mismo costo no deja fila.
- **El precio es el neto de la tienda vigente hoy**, en su moneda: la épica no reconstruye precios de lista
  históricos. Lo que se reconstruye es el costo y la cotización de cada fecha.
- **La cotización de cada fecha** es la carga más cercana en el tiempo (a igual distancia, la anterior).
- **El margen de cada fecha** = neto en pesos con esa cotización − costo en pesos con esa cotización.
- **Sin fila** en una fecha si no hay costo registrado hasta esa fecha, si el neto no es positivo o si (en un
  producto en USD) no hay cotización. Un producto en pesos sin cotizaciones cargadas conserva su historia
  (con la cotización vacía).
- **Antes de la fecha en que arrancó la historia de costos no hay margen histórico**: el punto de partida es
  el costo vigente cuando se creó la tabla.

## Límites de esta entrega

- **Sin Mercado Libre.** La pestaña «Por publicación de ML», su comisión y su tarjeta no existen todavía;
  llegan con la épica de Mercado Libre (Etapa 2). Por eso no hay comisión distinta de 0. Los tableros de
  **Comparativo** y **Historia** tampoco tienen columnas ni series de cuentas de Mercado Libre.
- **No incluye impuestos, envíos ni otros costos.** La pantalla lo aclara: es una estimación con los datos
  disponibles.
- **No pondera por stock ni por ventas reales.** Hoy usa una unidad de cada producto; la ponderación real
  queda para MSF-192.
- **No hay costos sin producto ni margen sin costo.** Un producto sin costo cargado no aparece.
- **La historia empieza cuando arrancó la historia de costos.** Antes de esa fecha no hay costo registrado, así
  que no hay margen histórico que mostrar.
- **No se reconstruyen precios de lista históricos.** El precio que se convierte con la cotización de cada
  fecha es el neto de la tienda vigente hoy.
- **El comparativo muestra los valores de hoy**, no los de cada fecha: para eso está **Historia**.
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
   tiene la sección. Con MSF-127 esto también protege la **historia de costos**.
3. ¿El consolidado debe ponderar por stock o por ventas reales en vez de una unidad por producto?
4. El Roadmap a diciembre manda «Rentabilidad y reportes avanzados» a enero; el documento del componente la
   deja P0 en el Hito 4. La decisión de producto sigue pendiente.
5. El token filtra por **organización**, no por las empresas acotadas de una persona. Si Administración
   tuviera empresas restringidas, esta entrega no lo refleja.
6. Los eventos de Actividad dependen de F-AUD-01, que no está cargada como historia en Jira; se construyen
   contra el contrato existente de `private.insertar_actividad`.
7. Los márgenes de ejemplo de los escenarios de MSF-127 (40 % contra 33,3 %) son **ilustrativos**: hay que
   validarlos con el cliente (decisión de Nicolás, AGE-1102, 24/10).

## Estado

- **MSF-120** (spec `rentabilidad-margen`): Resumen y Por producto, implementados en la rama de la épica
  (commits `0aab690`, `730d42d` y `1cf16a9`), pendiente de merge a `main`.
- **MSF-127** (spec `rentabilidad-comparativos-e-historia`, rama
  `epic/MSF-127-inicio-rentabilidad-y-reportes-rentabili`): **Comparativo** (F-REN-06 / MSF-261: commits
  `28f5c82c`, `ac5d548e`, `087ec27b`, `4bd94e07`, `af1459e2`) e **Historia** (F-REN-07 / MSF-280: commits
  `fb03665f`, `a7916e28`, `9e41f6e2`, `64df8502`), más el cierre (MSF-569: `ec852933`). Pendiente de merge a
  `main` en este repositorio.

Los tableros de Superset están versionados como YAML y se importan de forma idempotente; ver el detalle
técnico.

## Pendientes

| Qué falta | Por qué | Dueño |
|---|---|---|
| Validar con el cliente los márgenes de ejemplo de los escenarios | Son ilustrativos (AGE-1102) | Producto |
| Capturas a 320/768/1440 px y revisión visual de la pestaña **Comparativo** | `pantallas:capturar` toma un solo viewport y la pestaña no está en el prototipo | **MSF-570** (seguimiento de F-REN-06) |
| Verificar en un Superset real la importación de los dos tableros y el selector de producto de **Historia** | El tablero no se probó contra un Superset real | Cierre de MSF-127 |
| Ejecutar el E2E de tres roles (que ya cubre Comparativo e Historia) con el stack local | Está escrito, no ejecutado (falta Docker en el entorno) | **MSF-569** / cierre de MSF-127 |
| Columnas y series de cuentas de Mercado Libre en los tableros | Son de la épica de Mercado Libre (Etapa 2) | Mercado Libre |
| Ponderar el consolidado por stock o ventas reales | Hoy pondera una unidad por producto | **MSF-192** |

## Para seguir

- **[Rentabilidad: datos, RPC y tableros](../tecnico/rentabilidad.md)** — modelo, contrato `analitica.*`,
  historia de costos, RPC, permisos, importación de tableros y reversión.
- **[Capacidades](capacidades.md)** — el resto de los módulos del producto.
- **[Permisos por rol](../permisos-por-rol.md)** — la matriz de la sección `rentabilidad`.
- **[Catálogo](../catalogo.md)** — de dónde salen el precio de lista y el costo del producto.
