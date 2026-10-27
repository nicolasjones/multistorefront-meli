# Feature Specification: Ventas y despacho · Ventas backlog

**Feature Branch**: `epic/MSF-208-ventas-y-despacho-ventas-backlog`

**Jira Epic**: MSF-208 — Ventas y despacho · Ventas backlog (spec `ventas-backlog`)

**Created**: 2026-10-27

**Status**: Ready (backlog) — la especificación viene completa desde It's a Plan. No hay alcance implementable en esta entrega: F-VTA-34 y F-VTA-35 son historias **previstas** (condicionales), sin requisitos, sin pantallas, sin horas y sin hito; se especifican en su propia spec cuando entren a un hito.

**Delivery scope**: `—` (sin `refine`, `supabase`, `kestra`, `superset` ni `workers` en esta entrega).

**Prioridad / Hito**: P3 · Hito Backlog (sin fecha) · horas «A estimar» · alcance fuera de diciembre.

**Dependencias**:
- Bloqueada por: ninguna (a definir con el cliente). Sin links Blocks hasta que las historias pasen a un hito y tengan requisitos.
- Relacionada con (sin bloqueo): F-TDA-26 (MSF-334, Tiendas online · Carrito y compra online), de la que F-VTA-35 dependería cuando se priorice.
- Bloquea a: ninguna épica.

**Input**: Epic MSF-208. Objetivo: «Ideas condicionadas: facturación electrónica ARCA, pedidos desde la tienda online y otras (F-VTA-34 y F-VTA-35).»

**Regla de fuentes** (literal de la épica, aplicable a cada historia cuando se especifique):
1. Comportamiento y datos: mandan los requisitos y escenarios de esta historia.
2. Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es referencia visual, no hace falta que quede extremadamente idéntico; los flujos (si hay) aclaran estados y acciones.
3. Cómo se construye (componentes, estilos y patrones): mandan el template y el system design del producto (épica Plataforma · Sistema de diseño). No copiar el HTML ni el CSS del prototipo: reproducir lo que muestra con los componentes del template y los tokens del sistema de diseño.
4. El prototipo muestra más que esta historia: implementar solo lo que piden los requisitos de esta historia; otras secciones, botones o diálogos son de otras historias.
5. Si algo no se puede igualar con el template / el sistema de diseño: usar lo más cercano, sin inventar, y anotar la diferencia en la descripción del PR.
6. Si el prototipo y los requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y dejar la contradicción anotada en el PR.

## Historias previstas (sin requisitos en esta entrega)

| ID | Nombre | Prioridad | Talla |
|---|---|---|---|
| F-VTA-34 | Facturación electrónica ARCA | P3 | XL |
| F-VTA-35 | Pedidos desde la tienda online | P3 | L |

Ninguna de las dos tiene requisitos, pantallas, horas ni hito: **se redactan cuando pasen a un hito**. Esta spec no define su alcance ni sus criterios; solo las declara como previstas.

## Modelo y supuestos

No hay modelo de datos en esta entrega: no se crea ni se altera ninguna tabla, columna, RPC ni ruta.

Supuestos (literales de la épica):

- Los comprobantes de la plataforma son internos y llevan la leyenda «Documento no válido como factura»; la facturación fiscal se resuelve fuera de la plataforma hasta que se haga F-VTA-34.
- Los requisitos de ambas historias se redactan cuando pasen a un hito.
- Sin horas: las define el cliente cuando decida priorizarlas.

### Esquema de datos (Constitución, Principio VII)

No aplica. No se crea ni se altera ninguna tabla en esta entrega; por lo tanto no hay esquema que declarar ni RLS que exigir. La verificación de esquema se re-aplicará en la spec de cada historia futura (F-VTA-34, F-VTA-35) cuando entren a un hito.

## Flujos

Sin flujos. La épica no describe estados, secuencias ni procesos; no hay máquina de estados, secuencia ni proceso que transcribir a Mermaid. Cada historia futura (F-VTA-34, F-VTA-35) traerá sus propios flujos cuando se especifique.

## Pantallas del prototipo

Sin pantallas dibujadas. F-VTA-34 y F-VTA-35 se dibujan cuando entren a un hito. Prototipo de referencia: San Javucho y Mundo JC - Plataforma (página «Panel administrativo»). No hay `.dc.html` de esta épica para inventariar.

## User Scenarios & Testing *(mandatory)*

Sin historias de usuario implementables: no hay criterios de aceptación ni escenarios en esta entrega. Las dos historias previstas se detallarán con sus escenarios cuando entren a un hito.

## Requirements *(mandatory)*

Sin requisitos. No hay FR ni SC en esta entrega: los requisitos de F-VTA-34 y F-VTA-35 se redactan cuando pasen a un hito.

## Decisiones abiertas (provisorias; no bloquean)

1. **F-VTA-34 (facturación ARCA) es la historia F-VEN-05** del componente Consultas y ventas; se divide al planificar.
2. **F-VTA-35 reemplaza a F-VEN-04** del componente Consultas y ventas.
3. **Sin horas ni requisitos**: los define el cliente cuando decida priorizarlas.

## Matriz pantalla↔criterios

Sin pantallas: la épica declara «Sin pantallas dibujadas» y no trae ningún `.dc.html`. No hay ítems de inventario (columnas, campos, botones, tabs, diálogos) que mapear a FR/SC ni que declarar fuera de alcance.

**Empresa activa**: no aplica — no hay pantalla, pop-up ni diálogo que lea o escriba datos de una empresa en esta entrega.

## Contratos

No aplica. No se crea ni se cambia ninguna RPC ni endpoint en esta entrega. Los contratos se declararán en la spec de cada historia futura.

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira | Historia | US | FR / SC | Tareas |
|------|----------|----|---------|--------|
| MSF-208 (épica) | — (backlog, sin historias en entrega) | — | — | — |

Las dos historias previstas (F-VTA-34, F-VTA-35) se trazan en sus propias specs cuando entren a un hito.
