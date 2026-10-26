---
owner: producto
sources:
  - specs
---

# Precios e IVA (MSF-114)

**Épica:** MSF-114 · **Historias:** F-PRE-01 (precio y costo), F-PRE-07 (regla de precio por empresa),
F-PRE-12 (IVA por categoría y precio final) y F-PRE-15 (escalas de precio). **Spec:**
`specs/20261022-120000-precios-e-iva/` · **Rama:**
`epic/MSF-114-precios-y-dolar-precios-e-iva` (PR #281; merge `e04772c4`), pendiente de merge a `main`.
Detalle técnico: [Precios e IVA (técnico)](../tecnico/precios-e-iva.md).

Esta página cubre **las reglas de precio** del producto: qué se carga, cómo se calcula lo que ve el
cliente y quién lo puede cambiar. La **cotización del dólar** con la que se convierten los precios en
dólares es de otra épica: [Precios y dólar (MSF-116)](precios-dolar.md).

## Qué resuelve

- Cada producto tiene **moneda** (pesos o dólares), **precio de lista sin IVA** y **costo**, y la ficha
  muestra el precio en pesos y el margen estimado.
- Cada **empresa (tienda)** calcula su propio precio **neto** desde el precio central: o el mismo, o
  con un ajuste en porcentaje, redondeado a los $ 10 más cercanos.
- El **IVA** se asigna por **categoría** y cada producto puede tener el suyo; cada empresa decide si el
  cliente ve los precios **con IVA incluido** o **sin IVA**.
- Los **precios por escala** (x1, x5, x10, x50) se cargan en la ficha del producto y son el precio que
  usan Ventas y la tienda online según el tipo de cliente.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Administrador** | Carga el precio y el costo de los productos, el IVA de las categorías, y la regla de precio y el interruptor de IVA de cada empresa. |
| **Administración** | Hoy la matriz de permisos le da **edición** en «Empresas» (y en «Categorías» y «Productos»); se ajusta desde Roles, sin tocar código. |
| **Roles con lectura** | Ven los precios y el IVA; los que además tienen **Rentabilidad** ven el costo y el margen. |
| **Resto de los roles** | No ven el costo ni el margen, y la base rechaza la consulta. |

## Cómo se usa

### 1. Cargar el precio y el costo de un producto

En **Catálogo → Productos**, el alta y la edición suman el bloque **«Precio y costo»**:

- **Moneda**: *Peso argentino (ARS)* o *Dólar (USD)*.
- **Precio de lista (sin IVA)**: obligatorio y mayor a cero; la ayuda dice «El precio de lista se carga
  sin IVA».
- **Precio en pesos**: campo de lectura. Con un producto en dólares muestra el valor convertido con la
  cotización vigente y el aviso «Con dólar $ 1.465 (vie 25/09)». **Sin cotización cargada** muestra
  «Cargá la cotización» y no inventa un precio.
- **Costo**: solo con la sección **Rentabilidad**. Con un producto en dólares, el hint muestra el costo ya
  convertido: «costo $ 17.580 · con dólar $ 1.465».
- **Margen estimado (escala x1)**: el margen sobre el precio sin IVA, con la nota «Margen = Precio −
  Costo − Comisión del canal. El precio es central para todas las stores.» Sin la sección Rentabilidad no
  se ve ni el costo ni el margen.

El botón **Cotización →** aparece deshabilitado: la pantalla de carga del dólar es de
[MSF-116](precios-dolar.md).

### 2. Poner el IVA de una categoría

En **Catálogo → Categorías**, la grilla suma la columna **IVA** y el diálogo Nueva/Editar suma el campo
**IVA de la categoría**, con la nota «Opciones: 21 %, 10,5 %, Exento. Cada producto puede tener el suyo.».
Las categorías que ya existían quedan en 21 %; las nuevas nacen en 21 % hasta que se elija otra.

En la ficha del producto, el campo **IVA** ofrece «Heredar de la categoría (21 %)» o una alícuota propia,
y muestra el ejemplo calculado: «Con IVA 21 %: $ 35.315 (IVA $ 6.129)».

### 3. Definir el precio de una empresa

En la ficha de una **empresa**, la pestaña **«Precios y moneda»** (una empresa por pantalla) tiene:

- **Precio de venta de <Empresa>**: **Base** («Igual al central» o «Central con ajuste»),
  **Ajuste sobre el precio central** en % (negativo baja, positivo sube) y **Redondeo** «Al $ 10 más
  cercano».
- **Precios que ve el cliente**: «Sin IVA» o «Con IVA incluido». Es la decisión de **esa** empresa: con
  dos empresas con interruptores distintos, el mismo producto se ve distinto en cada una.
- **Moneda y cotización**: «Moneda de la tienda: ARS · Peso argentino», «Cotización que usa: La general
  del sistema» y el dólar vigente con su fecha.
- **Así quedan los precios**: una muestra de productos con la columna **Central** y la columna
  **<Empresa> · Sin IVA** / **<Empresa> · Con IVA incluido**. La tabla se actualiza con el ajuste
  **sin guardar**, para ver el efecto antes de confirmar.
- **Guardar** deja el aviso «Precios de la empresa guardados».

### 4. Cargar los precios por escala

En la ficha del producto, el bloque **«Precios por escala · sin IVA»** muestra las cuatro escalas del
prototipo: **x1 · 1 a 4 u.**, **x5 · 5 a 9 u.**, **x10 · 10 a 49 u.** y **x50 · 50 u. o más**, con el
margen de cada una. El pie aclara «x1 es el precio de lista. Una escala sin precio usa el de lista», y
el texto de arriba «Minorista usa x1 · cada tipo de cliente usa su escala».

## Reglas de negocio que respeta

- El **precio de lista y el costo se cargan sin IVA**, y el **margen se calcula sobre el precio neto** (sin
  IVA). Cambiar el interruptor de IVA **no** cambia el margen.
- **No se guarda ningún precio en pesos**: el precio central, el neto y el final se **calculan al leer**.
  Por eso cambiar el dólar (MSF-116) no deja ningún precio desactualizado.
- La **cotización es de la organización**, no de una empresa: todas las tiendas convierten con el mismo
  valor.
- El **redondeo** del precio de venta de la empresa es «Al $ 10 más cercano».
- El **IVA** es el del producto si tiene, si no el de su categoría. «Exento» hace que el precio final sea
  el mismo que el neto.
- El precio de una **escala sin precio cargado** es el precio de lista; una escala que no existe (por
  ejemplo x7) da un error claro, no un precio inventado.
- Cada cambio de precio, de IVA, de escala o de regla de empresa queda en **Actividad**:
  `producto.precio_actualizado` y `empresa.regla_precio_actualizada`.

## Empresa activa

**No aplica** al producto ni a las categorías: el precio central y el IVA son de la **organización**, no de
una empresa. La empresa activa de la barra superior no cambia esos datos.

La pestaña **«Precios y moneda»** es de **una empresa concreta por ruta**: abrir otra empresa (con el
botón «Cambiar a <otra empresa> ↔») recarga todas las consultas y reinicia el formulario, así que nunca
muestra los datos de la empresa anterior.

## Límites y fuera de alcance

- **Precio propio por empresa** (un precio que reemplaza al calculado): es **MSF-352**. La pantalla lo
  avisa, pero no lo resuelve.
- **Carga y recálculo masivo del dólar**: es **MSF-116**; esta entrega solo tiene el precio en dólares
  usando la cotización inicial.
- **Mercado Libre (Etapa 2):** los precios no se envían a las publicaciones.
- **Administración de alícuotas:** no hay pantalla para crear alícuotas; se ofrecen 21 %, 10,5 % y
  Exento. El 27 % aparece cuando exista esa administración.
- **Escala automática por cantidad:** la escala la define el **tipo de cliente**, no la cantidad de la
  línea. La selección por cantidad la define Ventas (F-VTA-06).
- **Descuento adicional** y **Condición de pago** de la pantalla Tipos de cliente: no están en ninguna
  historia de esta épica.
- **Decisiones abiertas** (spec, *Decisiones abiertas*): el valor inicial del interruptor de IVA de cada
  empresa (arranca en «Sin IVA») y si el Operador puede ver el costo (hoy no: hace falta la sección
  Rentabilidad).

## Permisos

| Acción | Sección |
|---|---|
| Ver precios y escalas | `productos` ≥ lectura |
| Cargar precio de lista, costo, escalas e IVA del producto | `productos` = edición |
| Ver y editar el IVA de una categoría | `categorias` = edición |
| Ver y editar la regla de precio y el interruptor de IVA de una empresa | `empresas` = edición |
| Cargar la cotización inicial del dólar | `empresas` = edición |
| Ver costo y margen | `rentabilidad` ≥ lectura (cargar el costo: `rentabilidad` = edición) |

Detalle de la matriz: [Permisos por rol](../permisos-por-rol.md).

## Estado

Implementado en la rama de la épica (PR #281; merge `e04772c4`) con sus cuatro historias y el cierre,
**pendiente de merge a `main`**.

**Pendiente de integración (dueño: quien integra la épica a `main`; sin seguimiento en Jira todavía).**
La copia integrada en el lote a STG (`release/stg-lote`, commit `70184343`) trae la base de datos, la
pestaña «Precios y moneda» de la empresa y los componentes nuevos, pero **no** el cableado en las
pantallas de Catálogo que ya existían: el formulario de producto sigue sin los bloques «Precio y costo»,
«Precios por escala» e «IVA», y la pantalla Categorías sigue sin la columna ni el campo de IVA. Hasta
reconectar esos archivos, la base y la pestaña de empresa funcionan pero las pantallas de producto y
categorías no exponen los campos nuevos. Cómo está construido:
[Precios e IVA (técnico)](../tecnico/precios-e-iva.md).
