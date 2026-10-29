---
owner: producto
sources:
  - specs
---

# Migración inicial de datos

**Épica:** MSF-142 · **Historias:** F-MIG-01 (clientes), F-MIG-02 (proveedores y vínculos con
productos), F-MIG-03 (archivo de ingresos) y F-MIG-04 (ensayo, conciliación y plan de corte).

Al terminar, los clientes y proveedores del panel actual quedan cargados como **datos vivos** y
conciliados contra el origen, el historial de ingresos de mercadería queda como **archivo consultable
de solo lectura**, y existe un **procedimiento ensayado** para repetir la carga el día del corte.

## Qué resuelve

El negocio venía operando en un panel anterior. Esta entrega trae al sistema nuevo los **maestros**
que hacen falta para empezar a operar sin volver a tipearlos, y deja el historial que no se va a
modificar en un archivo de consulta:

- **Clientes** de la base completa, con su identificador del panel anterior para no duplicarlos.
- **Proveedores** (unos 135) y el **vínculo de cada producto del catálogo con su proveedor**.
- **Historial de ingresos de mercadería** del panel anterior, para consultarlo sin mezclarlo con el
  stock vivo.
- Un **informe de conciliación** por cada carga y un **plan de corte** probado con datos inventados.

No se cargan a tablas vivas comprobantes, ventas, presupuestos ni cotizaciones del dólar anteriores:
eso lo arma la épica de Ventas y despacho como archivo histórico.

## Para quién

| Quién | Qué hace |
|---|---|
| **Administrador de la organización** | Ejecuta las cuatro cargas con el asistente y lee cada informe de conciliación. Es el único rol que puede importar y consultar las cargas. |
| **Persona de negocio que aprueba el corte** | Valida el informe final y decide continuar o volver atrás. *(Nombre a confirmar por Nicolás.)* |
| **Depósito / quien consulta Stock** | Consulta la pestaña **Archivo anterior al sistema** con permiso de lectura o edición en Stock. No puede editarlo ni borrarlo. |

El resto de los roles no ve el asistente ni los informes: la base también lo impone, no solo la
pantalla.

## Qué incluye

### Asistente de importación

Una pantalla por entidad, en cuatro pasos:

1. **Subir** un archivo **CSV UTF-8** (se muestra el nombre y «N filas · UTF-8»). También se puede
   descargar la **plantilla CSV** con las columnas esperadas.
2. **Mapear** las columnas del archivo a los campos del sistema. El **identificador del panel actual**
   es obligatorio: es la clave que evita duplicados.
3. **Vista previa** con totales (nuevas / a actualizar / con error) y el detalle de cada fila
   inválida con su número y motivo. Las filas con error no se importan; las válidas sí.
4. **Importar** en lotes y mostrar el resultado: nuevos, actualizados y con error.

Un archivo `.xlsx` no se lee directamente: se guarda como CSV UTF-8 antes de subirlo.

### Las cuatro cargas

| Carga | Ruta | Qué hace |
|---|---|---|
| **Clientes** | `/migracion/importar/clientes` | Crea o actualiza clientes por el identificador del panel anterior y los habilita en las tiendas como cualquier alta. El **Número** del cliente lo asigna el sistema, no se mapea. |
| **Proveedores** | `/migracion/importar/proveedores` | Crea o actualiza proveedores por su identificador externo, con las mismas validaciones de CUIT del alta. |
| **Vínculos proveedor ↔ producto** | `/migracion/importar/vinculos-proveedor-producto` | Fija el proveedor y el código de proveedor de cada producto del catálogo. No crea productos ni proveedores. |
| **Ingresos anteriores** | `/migracion/importar/ingresos_archivo` | Carga el historial de ingresos en el archivo de solo consulta. **No modifica el stock.** |

Cada carga deja registro de la ejecución, del archivo, del actor y del resultado por fila. Volver a
aplicar el mismo archivo **actualiza**, no duplica; un reintento tras un corte completa lo pendiente.

### Informe de conciliación

Después de aplicar, y de nuevo cuando se quiera, el informe muestra:

- filas del archivo contra filas cargadas (nuevas, actualizadas, con error y omitidas);
- una **diferencia calculada por el sistema**, que debe ser 0;
- la verificación contra la tabla destino (que lo aplicado esté realmente ahí);
- el estado **conciliado** solo si la carga terminó aplicada y las dos diferencias son 0;
- hasta 200 filas con error y su motivo.

Se consulta al final del asistente y en **Informes de conciliación** (`/migracion/informes` y
`/migracion/informes/:carga`).

### Archivo anterior al sistema

Segunda pestaña de **Stock › Ingreso de mercadería**: una tabla de solo consulta con Fecha, Producto,
Cantidad, Proveedor y Operador, paginada en el servidor. El producto, el proveedor y el operador son
**texto** del panel anterior: los ~19 operadores históricos no son usuarios del sistema.

El archivo es de la **organización**, no de una empresa. No mueve stock, no crea movimientos y no se
mezcla con los ingresos vivos. El stock inicial entra por la carga inicial de Stock (F-STK-07).

### Ensayo y plan de corte

- El ensayo corre la carga completa **dos veces** con datos inventados, en el orden del corte, y
  verifica que la segunda corrida no duplica nada y que las cuatro cargas quedan conciliadas.
- El plan de corte define prerrequisitos, responsables, orden de carga, criterios de aceptación y
  vuelta atrás.
- Los **datos reales se manejan solo en producción**. En el repo, en los tests y en el PR solo hay
  datos inventados.

## Empresa activa

**No aplica filtrado por empresa.** Clientes, proveedores, vínculos e ingresos del panel anterior son
datos de la **organización**; el panel anterior no tenía empresas. La pantalla lo declara y cambiar la
empresa de la barra superior **no cambia el destino ni mezcla el lote en curso**. La pestaña del
archivo tampoco recarga datos de otra empresa. Hay un test que cambia de empresa durante el asistente.

## El día del corte

### Antes

1. Catálogo de productos cargado (los vínculos necesitan los SKU).
2. Stock inicial cargado por Stock (F-STK-07, hoy P1): el archivo de ingresos **no** reemplaza esa
   carga.
3. Exportación del panel actual a CSV UTF-8: clientes (confirmado), **proveedores, vínculos e
   ingresos (a confirmar por Nicolás)**. Un Excel se guarda como CSV.
4. Ensayo en verde: dos corridas, `conciliado = true` y sin duplicados.
5. Copia de seguridad de producción tomada y verificada.
6. Un usuario con rol **Administrador** en la organización destino.

### Orden de carga

1. Clientes.
2. Proveedores.
3. Vínculos proveedor ↔ producto.
4. Archivo de ingresos.

Después de cada paso: subir → mapear → revisar la vista previa → importar → **leer el informe de
conciliación** → recién entonces pasar al siguiente. Si un paso falla a medias, se reintenta la misma
carga: lo ya cargado no se duplica.

### Criterios de aceptación

- Las cuatro cargas con estado **aplicada** y **conciliado**.
- `diferencia = 0` y `destino.diferencia = 0` en cada informe.
- Las filas con error están explicadas y revisadas por negocio; las que no se pueden cargar quedan en
  una lista de corrección posterior.
- Los conteos de clientes, proveedores y líneas del archivo coinciden con el origen menos los errores
  aceptados.
- El stock no cambió por efecto de la carga.

### Vuelta atrás

- **Antes de cargar:** nada que revertir.
- **Una carga con datos malos:** el registro de filas dice qué se creó; se desactivan o corrigen por
  el circuito normal de cada pantalla. El archivo de ingresos se corrige con un CSV corregido y se
  reimporta (actualiza, no duplica).
- **Corte entero:** restaurar la copia de seguridad previa.
- Las migraciones son aditivas: su reversión no borra los datos ya cargados.

## Límites y fuera de alcance

- **Solo maestros:** clientes y proveedores. Productos, categorías y stock inicial se migran en
  Catálogo y Stock.
- **No se cargan** comprobantes, ventas, presupuestos ni cotizaciones del dólar anteriores.
- **No se crean usuarios** para los operadores históricos: se guardan como texto en el archivo.
- **No se crean cuentas web** de clientes ni se envían invitaciones durante la migración.
- **No se lee `.xlsx`**: el contrato es CSV UTF-8 (decisión D2 de la spec).
- **El archivo no modifica stock** ni se mezcla con los ingresos vivos.
- **El Número del cliente no se migra**: lo asigna el sistema; la identidad es el identificador
  externo (decisión D4).
- **Un identificador de cliente repetido en otra organización** se rechaza con un mensaje genérico:
  la unicidad del mapeo es global por sistema (detalle técnico).
- **No hay pantalla dibujada** de «Migración · importación de datos» ni de la pestaña del archivo: se
  construyeron con los componentes del sistema de diseño, como autoriza la regla de fuentes.

## Pendientes

| Pendiente | Dueño |
|---|---|
| Confirmar que el panel actual exporta **proveedores, vínculos e ingresos** a CSV/Excel (FR-024/FR-035). | Nicolás |
| Confirmar el nombre de la persona de negocio que aprueba el corte. | Nicolás |
| Stock inicial por F-STK-07 (hoy P1); sin él, la carga real no está completa. | Producto / Stock |
| Reflejar en el Roadmap las ~36 h de F-MIG-01 a F-MIG-04. | Roadmap |

## Estado de la entrega

Implementado en la rama de la épica (spec `20261023-120000-migracion-inicial-de-datos`): F-MIG-01
MSF-299, F-MIG-02 MSF-313, F-MIG-03 MSF-330 y F-MIG-04 MSF-343. Pendiente de merge a `main` en este
repositorio.

Detalle técnico: [Migración inicial de datos: modelo, RPC y operación](../tecnico/migracion-inicial-de-datos.md).
