---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Clientes · ranking avanzado de clientes (MSF-171)

**Épica:** MSF-171 — Clientes y proveedores · Ranking avanzado de clientes · **Historias:** F-CLI-14 «Comparar el
ranking entre dos períodos» (MSF-384), F-CLI-15 «Ranking por producto, categoría y provincia» (MSF-391),
F-CLI-16 «Clientes inactivos» (MSF-400). **Spec:** `specs/20261028-100000-ranking-avanzado-de-clientes/`.
Detalle técnico: [Ranking avanzado (técnico)](../tecnico/ranking-avanzado-de-clientes.md). Base que mejora:
[Ranking de clientes (MSF-126)](ranking-de-clientes.md).

> **Estado (verificado en git al 2026-10-31):** las tres historias están implementadas y mergeadas a la rama de la
> épica `epic/MSF-171-clientes-y-proveedores-ranking-avanzado-` (PR #541 F-CLI-16, #543 F-CLI-14, #544 F-CLI-15).
> **Todavía no están en `main`**: el PR de la épica a `main` sigue abierto y las tareas de cierre T019–T021 de
> `tasks.md` figuran `[ ]` en esa rama. La guía «Cómo probarlo» aplica cuando se mergee. TODO (dueño: quien cierre la
> épica): confirmar el merge y quitar esta nota.

## Qué resuelve

Para el **administrador** (y cualquier rol con la sección Clientes en lectura o edición), dentro de Clientes:

- **Comparar dos períodos:** ver, por cliente, lo facturado en cada período y la variación en pesos y en porcentaje,
  para saber quién creció y quién cayó.
- **Filtrar el ranking por Producto, Categoría y Provincia:** saber quién compra qué y dónde.
- **Detectar clientes inactivos:** una solapa nueva con los clientes que dejaron de comprar hace más de N días, para
  contactarlos o recuperarlos.

## Cómo funciona

- **Misma base que el ranking básico (MSF-126):** mismo criterio de «facturado» (facturas no anuladas; las notas de
  crédito restan importe pero no cuentan como comprobante), base sin IVA con opción **Ver con IVA**, filtros de Tipo de
  cliente y Consumidor final, y tienda de la empresa activa. El ranking básico **no cambia**: con las opciones nuevas
  apagadas se ve y se comporta igual.
- **Comparar con otro período (F-CLI-14):** interruptor en la solapa «Ranking por facturación». Al activarlo aparecen
  Desde/Hasta de comparación, precargados con el **período anterior de igual duración**. La tabla agrega las columnas
  del período de comparación y la variación; un cliente que compró en un solo período aparece con 0 en el otro, y la
  variación porcentual sobre base 0 se muestra «—». Orden: lo facturado en el período aplicado; 25 por página. Se
  permiten períodos superpuestos o idénticos (variación 0).
- **Producto, Categoría y Provincia (F-CLI-15):** tres filtros opcionales y combinables entre sí y con los anteriores.
  Con Producto o Categoría, «Facturado» es la suma de **esas líneas** de factura, no del comprobante entero; una
  categoría raíz incluye sus subcategorías; Producto y Categoría se intersecan. Provincia compara sin distinguir
  mayúsculas ni tildes; un cliente sin provincia no coincide con ninguna. La participación se recalcula sobre el
  subconjunto. Las opciones se cargan al entrar a los filtros.
- **Clientes inactivos (F-CLI-16):** solapa «Clientes inactivos» junto a «Listado» y «Ranking por facturación». Campo
  **Días sin comprar** (por defecto 90; entero de 1 a 3650; atajos 30, 60, 90 y 180) y **Aplicar**. Es inactivo el
  cliente con al menos una factura que cuenta y cuya **última compra** es anterior a *hoy menos N días*. Un cliente
  **sin compras** o **archivado** nunca aparece. Columnas: Cliente (enlaza a la ficha), Tipo, Última compra, Días sin
  comprar, Comprobantes y Facturado histórico (neto sin IVA). Orden: última compra más antigua primero; 25 por página.
- **Estados:** vacío («Sin facturación en los períodos» / «Ningún cliente dejó de comprar en ese plazo.»), error con
  «Reintentar» y carga, como el ranking básico.
- **Empresa activa:** la barra superior acota las tres vistas a esa tienda (o a todas); al cambiarla se vuelve a la
  página 1, se recargan las consultas y no quedan filas de la empresa anterior. En F-CLI-15 se descartan Producto,
  Categoría y Provincia elegidos.
- **Quién lo ve:** sección Clientes en `lectura` o `edicion`; con `ninguno` no aparece la solapa ni se puede consultar.

## Límites y fuera de alcance

- **Sin pantalla dibujada en el prototipo:** se implementó con los componentes del template tomando como base la solapa
  de ranking (`Clientes.dc.html`); no hay diseño final para estas vistas.
- **Consultas propias, no Superset:** la épica dejaba abierto Superset embebido (spec 007) o consultas propias; la spec
  eligió consultas propias (RPC). TODO (dueño: Nicolás Jones): confirmar la decisión.
- **Rentabilidad (Superset, Etapa 2):** la épica no nombra una concreta; no se construye aquí. TODO (dueño: producto):
  confirmar a qué épica se refiere (ver [Rentabilidad](rentabilidad.md)).
- **Combinación:** la comparación y los filtros de Producto/Categoría/Provincia **no se combinan** (al activar la
  comparación los filtros no se ofrecen).
- **Sin Excel** para la comparación, los filtros de dimensión ni los inactivos: «Exportar a Excel» se oculta mientras
  haya un filtro de dimensión activo y el Excel sigue siendo el del ranking completo (MSF-126).
- **Enviar la lista de inactivos a una campaña:** es de MSF-155 ([Correo masivo](correo-masivo-a-clientes.md)); no se
  construye aquí.
- **Decisión de la spec sobre «Sin compras»:** un cliente que nunca compró no es «inactivo» (no «dejó» de comprar),
  aunque el criterio de aceptación del issue lo listaba.

## Cómo probarlo

> Aplica cuando la épica esté mergeada a `main` (ver *Estado*); hasta entonces solo en la rama de la épica.

### Prerrequisitos

- **Rol:** Administrador (o cualquier rol con Clientes en lectura/edición).
- **Datos:** clientes minoristas, mayoristas y Consumidor final, con facturas de ejemplo en al menos dos meses, líneas
  de dos productos de categorías distintas, clientes de dos provincias, y clientes con última compra hace unos 20, 100
  y 400 días; uno sin compras y uno archivado. Se cargan con el seed local o fixtures; **nunca** en producción.
- **URL:** local (`pnpm dev:supabase` + app) o DEV, `/clientes`.

### Pasos

1. Entrá a `/clientes`. **Ves** tres solapas: «Listado», «Ranking por facturación» y «Clientes inactivos».
2. En «Ranking por facturación» aplicá «Este mes» y activá **Comparar con otro período**. **Ves** Desde/Hasta de
   comparación con el mes anterior precargado y, tras «Aplicar», columnas del período de comparación y variación.
3. Buscá un cliente que compró solo en uno de los períodos. **Ves** 0 en el otro período y «—» como porcentaje si la
   base es 0.
4. Poné el Hasta de comparación anterior a su Desde. **Ves** el error junto al campo y no se consulta.
5. Apagá la comparación. **Ves** el ranking básico idéntico al de MSF-126.
6. Elegí un **Producto** y aplicá. **Ves** solo clientes que lo compraron, con lo facturado de ese producto y la
   participación sumando 100 %.
7. Quitá el producto y elegí una **Categoría raíz**. **Ves** que incluye las ventas de sus subcategorías.
8. Elegí una **Provincia** (probá con otra escritura de mayúsculas/tildes). **Ves** solo clientes de esa provincia.
9. Combiná Producto con una Categoría a la que no pertenece. **Ves** «Sin facturación en el período».
10. Cambiá la empresa activa en la barra superior. **Ves** que se descartan Producto/Categoría/Provincia, vuelve la
    página 1 y no quedan filas de la empresa anterior.
11. Abrí «Clientes inactivos». **Ves** «Días sin comprar» en 90; pulsá «Aplicar». **Ves** los clientes de ~100 y ~400
    días, del más antiguo al más reciente; no aparecen el de ~20 días, el sin compras ni el archivado.
12. Poné 30 con el atajo y un valor inválido (0 o vacío). **Ves** que 30 incluye a más clientes y que el inválido
    muestra error junto al campo sin consultar.
13. Con un plazo de 3650 días. **Ves** «Ningún cliente dejó de comprar en ese plazo.»
14. Pulsá el nombre de un cliente inactivo. **Ves** su ficha.
15. Ingresá con un usuario con Clientes en «ninguno». **Ves** que no aparecen las solapas.

### Resultado esperado

- **Given** facturas en dos meses, **When** el administrador compara «Este mes» con el anterior, **Then** ve por
  cliente ambos importes y la variación, con 0 donde no compró y «—» sobre base 0.
- **Given** ventas de dos productos a clientes de dos provincias, **When** filtra por producto, categoría o provincia,
  **Then** ve solo los clientes que corresponden y, para producto/categoría, el facturado de esas líneas.
- **Given** clientes con última compra hace 20, 100 y 400 días, **When** aplica 90 días, **Then** ve los de 100 y 400
  días, del más antiguo al más reciente, y nunca a quien no compró.

### Cómo automatizarlo

**Todavía no existe ningún E2E de la épica** (queda **pendiente de automatizar**). La cobertura actual es pgTAP y
Vitest (ver la página técnica). Rótulos propuestos para `apps/web/e2e/` (los números de tarea de cierre se asignan al
abrir el seguimiento; los `T0yy` son tentativos):

| Recorrido | Rótulo |
|---|---|
| Comparar períodos, variación y base 0 | `[MSF-171:T006]` |
| Filtros de producto, categoría y provincia, y cambio de empresa | `[MSF-171:T012]` |
| Clientes inactivos: umbral, exclusiones y acceso | `[MSF-171:T018]` |

## Diferencias con el prototipo

No hay pantalla dibujada para estas vistas (la épica la deja para Etapa 2); el diseño sale del sistema de diseño y de
la solapa de ranking. Nada del prototipo se contradice.
