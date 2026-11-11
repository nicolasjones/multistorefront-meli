# Feature Specification: Clientes y proveedores · Cuentas y compras a proveedores

**Feature Branch**: `epic/MSF-450-clientes-y-proveedores-cuentas-y-compras`

**Componente**: Clientes y proveedores

**Jira Epic**: MSF-450 — Clientes y proveedores · Cuentas y compras a proveedores (spec `cuentas-y-compras-a-proveedores`)

**Historias previstas**: F-CLI-19 (L), F-CLI-20 (L), F-CLI-21 (L), F-PRV-09 (L), todas P3.

**Created**: 2026-10-29

**Status**: Completa como registro documental. La épica es un conjunto de ideas condicionadas a validar demanda y declara que «los requisitos se redactan cuando pasen a un hito». No hay requisitos de comportamiento que traducir; esta spec los registra sin inventarlos. Las preguntas abiertas quedaron decididas por Nicolás (ver *Decisiones*).

**Delivery scope**: ninguno por ahora. Cuando una historia pase a un hito, su alcance (`refine`, `supabase`, `workers`…) se declara en su propia spec. Esta rama solo entrega documentación (`specs/`, `docs/`).

**Prioridad / Hito**: P3 · Backlog · horas sin estimar · fuera de diciembre.

**Input**: Epic MSF-450. Objetivo: «Ideas condicionadas a validar demanda: cuenta corriente de clientes y compras a proveedores.»

## Regla de fuentes (literal de la épica)

1. Comportamiento y datos: mandan los requisitos y escenarios de esta historia.
2. Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es referencia visual, no hace falta que quede extremadamente idéntico; los flujos (si hay) aclaran estados y acciones.
3. Cómo se construye (componentes, estilos y patrones): mandan el template y el system design del producto (épica Plataforma · Sistema de diseño). No copiar el HTML ni el CSS del prototipo: reproducir lo que muestra con los componentes del template y los tokens del sistema de diseño.
4. El prototipo muestra más que esta historia: implementar solo lo que piden los requisitos de esta historia; otras secciones, botones o diálogos son de otras historias.
5. Si algo no se puede igualar con el template / el sistema de diseño: usar lo más cercano, sin inventar, y anotar la diferencia en la descripción del PR.
6. Si el prototipo y los requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y dejar la contradicción anotada en el PR.

## Historias previstas y dependencias (de la épica)

| ID | Nombre | Prioridad | Talla | Dependencia citada por la épica |
|---|---|---|---|---|
| F-CLI-19 | Cuenta corriente y saldo del cliente | P3 | L | Depende de cómo Ventas maneje cobros y el estado Deuda. |
| F-CLI-20 | Historial y favoritos en la cuenta web | P3 | L | Se apoya en la cuenta web (`cuenta-web-del-cliente`, MSF-237). |
| F-CLI-21 | Listas de precios por cliente | P3 | L | Se relaciona con F-PRE-14 de Precios. |
| F-PRV-09 | Órdenes de compra a proveedores | P3 | L | Se apoya en el listado de reposición de Stock. |

**Bloqueada por**: sin bloqueos declarados; se acuerdan con el cliente cuando una historia pase a un hito. **Bloquea a**: ninguna épica.

**Estado de las dependencias en esta rama** (verificado en `specs/` y `docs/`; no es alcance nuevo):

| Dependencia | Estado en el repo |
|---|---|
| Cuenta web del cliente (`specs/20261024-051500-cuenta-web-del-cliente`) | Spec presente; declara F-CLI-20 **fuera de su alcance** (historial de compras, favoritos y datos personales editables). |
| Ventas · cobros y conciliación (`specs/20261024-150000-ventas-cobros-y-conciliacion`, `docs/ventas-cobros-y-conciliacion.md`) | Presente; es la referencia de cómo Ventas maneja cobros (insumo de F-CLI-19). |
| Stock · avisos de reposición (`docs/stock-avisos-reposicion.md`) | Presente; es la referencia del «listado de reposición» (insumo de F-PRV-09). |
| Proveedores y productos / ingreso de mercadería (`docs/proveedores.md`) | Presente; no contiene órdenes de compra. |
| F-PRE-14 (listas de precios mayoristas, Precios, P3) | No presente en el repo; sin spec. |

## Supuestos (de la épica)

- Son ideas condicionadas a validar demanda: los requisitos se redactan cuando pasen a un hito.
- F-CLI-20 acota a historial y favoritos lo que los documentos generales llamaban F-CON-07 y F-TDA-27 (cuentas de clientes, P3).
- Horas: sin estimar.

## A revisar (de la épica; decisiones abiertas, no se resuelven acá)

1. **F-CLI-21 vs. F-PRE-14.** Las listas de precios mayoristas (F-PRE-14, P3) chocan con que el tipo de cliente defina la escala en P0. El documento lo deja como pregunta abierta 1: si el tipo de cliente fija la escala de precios o si la escala depende de la cantidad.
2. **F-CLI-20 = F-CON-07 = F-TDA-27.** Tiendas online deja las cuentas en P3 (F-TDA-27); el roadmap manda hasta que se defina.
3. **Sin pantallas ni horas.** El documento exige pantalla antes de cargar a Jira; se cargaron igual por pedido, con aviso en cada historia.

## Requisitos funcionales

Solo se registra lo que la épica da. Ningún requisito de comportamiento de negocio (cálculo de saldo, estados de la orden de compra, estructura de listas) se inventa: queda para la spec de cada historia cuando pase a un hito.

- **FR-001** (F-CLI-19): La idea «Cuenta corriente y saldo del cliente» queda registrada como P3/Backlog, con su dependencia de cobros y estado Deuda de Ventas. Sin requisitos de comportamiento hasta que pase a un hito. **Verificación** (comando `grep -E "F-CLI-19.*P3.*Backlog" docs/cuentas-y-compras-a-proveedores.md && grep -c "requisitos de comportamiento" docs/cuentas-y-compras-a-proveedores.md`): el registro documental lista F-CLI-19 como P3/Backlog/L con la dependencia de cobros y estado Deuda, sin requisitos de comportamiento; además `pnpm docs:check`.
- **FR-002** (F-CLI-20): La idea «Historial y favoritos en la cuenta web» queda registrada como P3/Backlog, acotada a historial y favoritos, apoyada en `cuenta-web-del-cliente`. Sin requisitos de comportamiento hasta que pase a un hito. **Verificación** (comando `grep -E "F-CLI-20.*P3.*Backlog" docs/cuentas-y-compras-a-proveedores.md && grep -q "cuenta-web-del-cliente" docs/cuentas-y-compras-a-proveedores.md`): figura P3/Backlog/L acotada a historial y favoritos y apoyada en `cuenta-web-del-cliente`; además `pnpm docs:check`.
- **FR-003** (F-CLI-21): La idea «Listas de precios por cliente» queda registrada como P3/Backlog, con la pregunta abierta 1 sin resolver (ver *A revisar*). Sin requisitos de comportamiento hasta que pase a un hito. **Verificación** (comando `grep -E "F-CLI-21.*P3.*Backlog" docs/cuentas-y-compras-a-proveedores.md && grep -q "F-PRE-14" docs/cuentas-y-compras-a-proveedores.md && grep -qi "pregunta abierta 1" docs/cuentas-y-compras-a-proveedores.md`): figura P3/Backlog/L con la pregunta abierta 1 sin resolver y la relación con F-PRE-14; además `pnpm docs:check`.
- **FR-004** (F-PRV-09): La idea «Órdenes de compra a proveedores» queda registrada como P3/Backlog, apoyada en el listado de reposición de Stock. Sin requisitos de comportamiento hasta que pase a un hito. **Verificación** (comando `grep -E "F-PRV-09.*P3.*Backlog" docs/cuentas-y-compras-a-proveedores.md && grep -qi "reposici" docs/cuentas-y-compras-a-proveedores.md`): figura P3/Backlog/L apoyada en el listado de reposición de Stock; además `pnpm docs:check`.
- **FR-005** (Cierre): La documentación del repo refleja el estado de estas cuatro ideas (backlog, dependencias, preguntas abiertas) y el roadmap exploratorio queda actualizado al cerrar. **Verificación** (comando `test -f docs/cuentas-y-compras-a-proveedores.md && grep -n "MSF-450" docs/roadmap-template.md && pnpm docs:check`): existe el documento y la fila de MSF-450 del roadmap indica Backlog con link a la spec.

## Escenarios de verificación

- **FR-001** — *Given* la spec de MSF-450, *When* se revisa la entrada de F-CLI-19, *Then* figura P3/Backlog/L con la dependencia de cobros y estado Deuda de Ventas y sin requisitos de comportamiento.
- **FR-002** — *Given* la spec, *When* se revisa F-CLI-20, *Then* figura P3/Backlog/L acotada a historial y favoritos y apoyada en `cuenta-web-del-cliente`.
- **FR-003** — *Given* la spec, *When* se revisa F-CLI-21, *Then* figura P3/Backlog/L con la pregunta abierta 1 sin resolver y la relación con F-PRE-14.
- **FR-004** — *Given* la spec, *When* se revisa F-PRV-09, *Then* figura P3/Backlog/L apoyada en el listado de reposición de Stock.
- **FR-005** — *Given* el merge del PR, *When* se revisan `docs/` y `docs/roadmap-template.md`, *Then* existe `docs/cuentas-y-compras-a-proveedores.md` y la fila de MSF-450 indica Backlog con link a la spec.

## Criterios de éxito

- **SC-001**: Esta spec no agrega migraciones, tablas, RPC, rutas, pantallas ni workers: el merge no cambia comportamiento del producto (`pnpm lint`, `pnpm build`, `pnpm test` sin diferencias de comportamiento). **Verificación** (comando `git diff --name-only origin/main...HEAD | grep -vE '^(specs|docs)/' ; pnpm lint && pnpm build && pnpm test`): el diff solo toca `specs/` y `docs/` (la primera salida vacía) y lint, build y tests pasan sin cambios de comportamiento.
- **SC-002**: Cada una de las cuatro historias figura con prioridad, talla y dependencia exactas de la épica, sin requisitos añadidos (revisión contra la tabla de arriba). **Verificación** (comando `grep -cE "F-(CLI-19|CLI-20|CLI-21|PRV-09).*P3.*L" docs/cuentas-y-compras-a-proveedores.md` = 4): las cuatro filas coinciden con la tabla de la épica; además `git diff origin/main...HEAD --stat -- specs docs` sin requisitos nuevos.
- **SC-003**: `pnpm docs:check`, `pnpm matriz:check` y `pnpm prototipo:check` pasan. **Verificación** (comandos `pnpm docs:check`, `pnpm matriz:check` y `pnpm prototipo:check`): los tres terminan con código 0.

## Esquemas de datos (Principio VII)

Esta spec **no crea ni altera tablas**. No hay esquema que declarar; no se consultó el grafo por tablas porque no se propone ninguna. Cuando una historia pase a un hito, su spec declarará `public` o `dominio` por la naturaleza de cada tabla (cuenta corriente, órdenes de compra y listas de precios son dominio del producto → `dominio` salvo que se justifique otra cosa), con RLS por organización y migración aditiva.

## Matriz pantalla↔criterios

La épica declara «Esta épica no tiene pantallas… se dibujan cuando pasen a un hito». Las dos pantallas relacionadas ya existen en `design/pantallas/` y pertenecen a otras épicas; el subconjunto que pide esta épica es **vacío**, así que lo que muestran no es deuda ni divergencia. Inventarios generados por `pnpm prototipo:inventario` (`ClienteFicha.inventory.json`, `ProveedorFicha.inventory.json`).

### Clientes · Ficha (`ClienteFicha.dc.html`)

| Ítem del inventario | Destino | Motivo |
|---|---|---|
| Campos: Número, DNI / CUIT, Nombre o razón social, Correo, Teléfono, Celular, Dirección, CP, Localidad, Provincia, Expreso preferido, Correo de acceso | Fuera de alcance | Datos del cliente ya entregados por Clientes (alta y búsqueda) y cuenta web; esta épica no los modifica. |
| Botones «Clientes», «Etiqueta», «Guardar cambios», «Configurar tipos de cliente →», «Incluir en el correo masivo», «Imprimir etiqueta de envío» | Fuera de alcance | Ficha existente de otras épicas. |
| Botón «Nuevo comprobante» y lista de comprobantes (`0003-00001251`, `0003-00001230`, `0003-00001204`, `0003-00001177`) | Fuera de alcance | Pertenecen a Ventas. Si F-CLI-19 muestra saldo en la ficha, su spec lo dibuja y mapea. |
| Tablas / pestañas / diálogos | Sin ítems | El inventario está vacío. |

### Proveedores · Ficha (`ProveedorFicha.dc.html`)

| Ítem del inventario | Destino | Motivo |
|---|---|---|
| Tabla Producto / Código del proveedor / Costo / Último ingreso / acciones | Fuera de alcance | Entregada por Proveedores y productos; F-PRV-09 podrá apoyarse en ella cuando pase a un hito. |
| Campos de la ficha y del diálogo «Editar proveedor» (Razón social, CUIT, Persona de contacto, Teléfono, Correo, Dirección, Condición de pago, Moneda, Plazo de entrega, Compra mínima, Observaciones) | Fuera de alcance | Ficha existente; la épica no pide cambios. |
| Diálogo «Enviar correo a proveedor» (Para, Asunto, Mensaje) y diálogo «Eliminar proveedor» | Fuera de alcance | Entregados por otras épicas. |
| Botones «Proveedores», «Enviar correo», «Editar», «Eliminar», «Ingresar mercadería», «Ver producto», «Cancelar», «Guardar proveedor», «Eliminar proveedor» | Fuera de alcance | Ídem; «Ingresar mercadería» es de Stock/Proveedores. |

### Empresa activa (Principio VIII)

| Ítem | Destino | Motivo |
|---|---|---|
| Empresa activa (selector de la barra superior) | **No aplica** | Esta spec no agrega ni cambia pantallas, pop-ups ni diálogos que lean o escriban datos de una empresa. Cada historia declarará su comportamiento ante el selector cuando se dibuje su pantalla. |

## Flujos

La épica **no trae flujos** (no hay estados, secuencias ni procesos descritos) y no se inventan. Lo único que describe es el ciclo de vida de la propia idea, transcrito de «los requisitos se redactan cuando pasen a un hito»:

```mermaid
stateDiagram-v2
  [*] --> IdeaEnBacklog
  IdeaEnBacklog --> DemandaValidada: se valida demanda con el cliente
  DemandaValidada --> PasaAHito: se asigna a un hito
  PasaAHito --> RequisitosRedactados: se redactan requisitos y pantallas (spec propia)
  RequisitosRedactados --> [*]
```

| Estado / transición | Dueño |
|---|---|
| IdeaEnBacklog | FR-001…FR-004 |
| Validación de demanda, paso a hito, redacción de requisitos | Fuera de alcance de esta spec (decisión de Nicolás; ver *Preguntas*). |

## Fuera de alcance (explícito)

- Todo comportamiento de negocio de las cuatro historias (saldo, historial, favoritos, listas de precios, órdenes de compra): sin requisitos hasta pasar a un hito.
- Resolver la pregunta abierta 1 (tipo de cliente vs. cantidad) y el conflicto con F-PRE-14 / F-TDA-27.
- Dibujar pantallas nuevas.
- Migraciones, RPC, workers, Kestra y Superset.

## Decisiones (respuestas de Nicolás: «decidí vos»)

1. **Hito:** ninguna de las cuatro historias pasa a un hito ahora; la épica se cierra solo como registro documental. Las tareas de las historias quedan abiertas a propósito (instrucción expresa de Nicolás) hasta que la demanda se valide.
2. **F-CLI-21 (escala de precios):** sin resolver; se decide cuando la historia pase a un hito, junto con F-PRE-14.
3. **F-CLI-19 (fuente de saldo):** se define con la spec de la historia, a partir de Ventas · cobros y conciliación.
4. **F-PRV-09 (origen de la orden):** se define con la spec de la historia, a partir del listado de reposición de Stock.
5. **F-CLI-20 (prioridad):** rige P3 (roadmap), igual que F-TDA-27.
