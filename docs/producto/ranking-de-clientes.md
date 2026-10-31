---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Clientes · ranking de clientes (MSF-126)

**Épica:** MSF-126 — Clientes y proveedores · Ranking de clientes · **Historias:** F-CLI-08 «Ranking de
clientes por facturación», F-CLI-09 «Exportar el ranking a Excel», F-CLI-10 «Historial de compras en la
ficha del cliente». **Spec:** `specs/20261018-100000-ranking-de-clientes/` (rama
`epic/MSF-126-clientes-y-proveedores-ranking-de-client`, commit `b7602d26`). Detalle técnico:
[Ranking de clientes (técnico)](../tecnico/ranking-de-clientes.md).

> **Estado (verificado contra `main` al 2026-10-30):** la épica está **especificada, no implementada en
> este árbol**. Existe la spec con `plan.md` y `tasks.md`, pero las 20 tareas (T001–T020) figuran `[ ]` y no
> hay migraciones (`ranking_clientes`, `compras_de_cliente`, `dominio.comprobantes_venta`), componentes ni
> tests de la épica en `supabase/` ni `apps/web/`. Esta página describe **lo que la épica entrega según la
> spec**; la guía «Cómo probarlo» aplica cuando se mergee. TODO (dueño: quien cierre la épica): confirmar el
> estado real y actualizar esta nota al merge.

## Qué resuelve

Para el **administrador** (y cualquier rol con la sección Clientes en lectura o edición):

- **Ver qué clientes facturan más** en un rango de fechas, en una solapa «Ranking por facturación» dentro
  de Clientes.
- **Exportar el ranking a Excel** (`.xlsx`) con todas las filas, no solo la página visible.
- **Revisar las compras de un cliente** desde su ficha: total facturado del año y últimos comprobantes.

## Cómo funciona (según la spec)

- **Facturación** = suma de las **facturas no anuladas** del cliente en el rango; los presupuestos y los
  comprobantes anulados no suman ni cuentan en «Comprobantes». El criterio exacto de estados (por ejemplo
  si «Deuda» cuenta) **lo fija Ventas**; provisoriamente es «factura no anulada».
- **Base sin IVA** por defecto (coherente con el margen), con la opción **Ver con IVA**.
- **Rango:** Desde / Hasta inclusivos, por defecto «Este mes». Atajos: **Este mes, Mes anterior, Últimos 90
  días, Año en curso** (el doc manda sobre los atajos del prototipo). Máximo 5 años.
- **Filtros:** tipo de cliente (Todos / Minorista / Mayorista) e interruptor **Consumidor final** (arranca
  desactivado: excluido).
- **Tabla:** #, Cliente (enlaza a la ficha), Tipo, Comprobantes, Facturado, Participación (porcentaje del
  total filtrado, con barra). Orden por facturado descendente; desempate por nombre y número. 25 por página.
- **Estados:** vacío «Sin facturación en el período», error con «Reintentar», carga.
- **Excel:** botón «Exportar a Excel», visible solo con la acción `exportar` sobre Clientes (por defecto no
  la tienen Mostrador, Depósito y Consulta); progreso, cancelación, hoja «Ranking de clientes», período y
  base indicados; las celdas que empiezan con `=`, `+`, `-` o `@` se neutralizan.
- **Ficha:** sección «Compras» con «Resumen comercial» (**total facturado del año en curso**, no «12 meses»
  como dibuja el prototipo) y «Últimos comprobantes» (número, fecha, estado, total; 10 por página). Un
  cliente sin compras muestra «Este cliente todavía no tiene compras.» y `$ 0`.
- **Empresa activa: no aplica.** Los clientes son de la organización y compartidos entre sus empresas
  (spec MSF-180); el ranking y las compras se acotan por organización, no por empresa, y la pantalla no
  ofrece «Todas mis empresas». TODO (dueño: producto): confirmar con Ventas si el ranking debe filtrar por
  empresa cuando los comprobantes lo permitan.

## Límites y fuera de alcance

- **Ranking avanzado de clientes** (comparar períodos, producto/categoría/provincia, inactivos): MSF-171, ver
  [Ranking avanzado](ranking-avanzado-de-clientes.md); esta épica lo bloquea.
- **El mismo ranking en «Ventas · Reportes»** (con filtro Tienda y desglose por tienda): no se construye
  aquí; la entrada oficial es Clientes. Ver [Ventas · reportes](ventas-reportes.md), que ya documenta
  la copia de ese tablero y su solapamiento con esta épica.
- **Emisión, listado, estados y anulación de comprobantes:** MSF-159 y MSF-177; esta épica **solo lee**.
- En la ficha, fuera de alcance: «Saldo deudor», «Nuevo comprobante», «Último», contador de comprobantes y
  el enlace de cada número al comprobante (son de Ventas).
- **Decisiones abiertas** (valor provisorio entre paréntesis): entrada oficial (Clientes), Consumidor final
  (excluido), total sin/con IVA (sin IVA + opción), criterio de estados (lo fija Ventas), quién lo ve
  (lectura o edición en Clientes). TODO (dueño: Nicolás Jones): confirmarlas.

## Cómo probarlo

> Aplica cuando la épica esté mergeada; hoy no hay pantalla que probar (ver *Estado*).

### Prerrequisitos

- **Rol:** Administrador (o cualquier rol con Clientes en lectura/edición; para exportar, con la acción
  `exportar`).
- **Datos:** clientes de ejemplo (minoristas, mayoristas y Consumidor final) con facturas, presupuestos y
  comprobantes anulados en dos meses, cargados con el seed local (tarea T005 de la spec). Sin Ventas
  emitiendo, los datos salen del seed; **nunca** se cargan en producción.
- **URL:** local (`pnpm dev:supabase` + app) o DEV, `/clientes` y `/clientes/show/:id`.

### Pasos

1. Entrá a `/clientes`. **Ves** dos solapas: «Listado» y «Ranking por facturación».
2. Abrí «Ranking por facturación». **Ves** Desde/Hasta con «Este mes», el botón «Aplicar», los atajos y la
   tabla #, Cliente, Tipo, Comprobantes, Facturado, Participación.
3. Pulsá «Aplicar». **Ves** solo clientes con facturas del mes, de mayor a menor facturado; las anuladas y
   los presupuestos no suman; la participación suma 100 %.
4. Elegí «Mes anterior» y luego «Últimos 90 días». **Ves** que las fechas se completan y el ranking cambia.
5. Poné Hasta anterior a Desde. **Ves** el error en el campo y no se consulta.
6. Filtrá por «Mayorista» y activá «Consumidor final». **Ves** que el ranking y la participación se
   recalculan sobre ese subconjunto.
7. Activá «Ver con IVA». **Ves** que Facturado y Participación pasan a la base con IVA y que el rótulo lo
   indica.
8. Elegí un rango sin facturas. **Ves** «Sin facturación en el período».
9. Pulsá «Exportar a Excel». **Ves** progreso y «Exportación lista»; el `.xlsx` abre con todas las filas y
   los mismos totales que la pantalla.
10. Ingresá con un rol sin la acción `exportar`. **Ves** el ranking pero no el botón.
11. Pulsá un nombre de cliente. **Ves** su ficha con «Compras»: «Resumen comercial» (total del año) y
    «Últimos comprobantes» (más reciente primero, paginado).
12. Abrí un cliente sin compras. **Ves** «Este cliente todavía no tiene compras.» y `$ 0`.
13. Ingresá con un usuario con Clientes en «ninguno». **Ves** que no aparece la solapa.

### Resultado esperado

- **Given** facturas de ejemplo en dos meses, **When** el administrador aplica «Este mes», **Then** ve solo
  los clientes del mes ordenados por facturación, sin anuladas ni presupuestos, y la participación suma 100 %.
- **Given** un ranking aplicado, **When** exporta, **Then** el Excel trae todas las filas con los mismos
  números que la pantalla.
- **Given** la ficha de un cliente, **When** la abre, **Then** ve el total facturado del año y sus
  comprobantes; si no compró, ve el vacío y `$ 0`.

### Cómo automatizarlo

**Todavía no existe ningún E2E de la épica** (queda **pendiente de automatizar**). Cobertura prevista por
la spec: pgTAP (T003, T004, T013) y Vitest (T008, T010, T011, T016). Rótulos propuestos para el E2E
(`apps/web/e2e/`; los números de tarea de cierre se asignan al abrir el seguimiento):

| Recorrido | Rótulo |
|---|---|
| Solapa, período, filtros, con/sin IVA y vacío | `[MSF-126:T007]` |
| Exportar a Excel y paridad con la pantalla | `[MSF-126:T011]` |
| Compras en la ficha (total del año, vacío) | `[MSF-126:T015]` |
| Acceso: sección `ninguno` sin solapa y sin lectura directa | `[MSF-126:T018]` |

## Diferencias con el prototipo

| Prototipo (`Clientes.dc.html`, `ClienteFicha.dc.html`) | Spec |
|---|---|
| Atajos Hoy, 7 días, Este mes, Mes anterior | Este mes, Mes anterior, Últimos 90 días, Año en curso |
| Sin filtro por tipo ni interruptor de Consumidor final | Ambos (manda el doc) |
| «Facturado en 12 meses» | Total facturado del año |
| Ranking también en Ventas · Reportes | Solo en Clientes |
