# Feature Specification: Tiendas online · Tienda compra y cuentas

**Feature Branch**: `epic/MSF-176-tiendas-online-tienda-compra-y-cuentas`

**Componente**: Tiendas online

**Jira Epic**: MSF-176 — Tiendas online · Tienda compra y cuentas (spec `tienda-compra-y-cuentas`)

**Historias previstas**: F-TDA-26 (Carrito y compra online, P3, XL) y F-TDA-27 (Cuentas de clientes y favoritos, P3, L).

**Created**: 2026-10-24

**Status**: **Parcial — NEEDS_INFO.** La épica no trae requisitos redactados («se redactan cuando la épica pase a un hito») ni pantallas en el prototipo, y declara que F-TDA-26 está fuera del alcance acordado. Esta spec traduce **solo** lo que la épica dice; todo lo demás queda como pregunta en *Preguntas abiertas*. No se inventan requisitos de negocio.

**Delivery scope**: a confirmar con las respuestas. Previsible: `refine` (front público de la tienda) y `supabase` (migraciones). Sin `kestra`, `superset` ni `workers` mientras no se decida lo contrario (p. ej. conciliación de pagos).

**Prioridad / Hito**: P3 · Backlog (a definir con el cliente) · horas a estimar al pasar a un hito · alcance «fuera».

**Input**: Epic MSF-176. Objetivo: «Al terminar, la tienda podría permitir comprar y pagar en línea y registrar cuentas de clientes con favoritos, si el cliente lo decide.»

## Regla de fuentes (literal de la épica)

1. Comportamiento y datos: mandan los requisitos y escenarios de esta historia.
2. Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es referencia visual, no hace falta que quede extremadamente idéntico; los flujos (si hay) aclaran estados y acciones.
3. Cómo se construye (componentes, estilos y patrones): mandan el template y el system design del producto (épica Plataforma · Sistema de diseño). No copiar el HTML ni el CSS del prototipo: reproducir lo que muestra con los componentes del template y los tokens del sistema de diseño.
4. El prototipo muestra más que esta historia: implementar solo lo que piden los requisitos de esta historia; otras secciones, botones o diálogos son de otras historias.
5. Si algo no se puede igualar con el template / el sistema de diseño: usar lo más cercano, sin inventar, y anotar la diferencia en la descripción del PR.
6. Si el prototipo y los requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y dejar la contradicción anotada en el PR.

## Dependencias

| Dependencia | Relación | Estado en esta rama |
|---|---|---|
| MSF-167 · Tienda catálogo y ficha | **Bloqueada por** (ficha y catálogo sobre los que se agrega el carrito) | Presente: mergeada (PR #317), spec `20261023-120000-tienda-catalogo-y-ficha`. |
| MSF-154 · Clientes pedidos y facturación (F-CON-07 requiere la compra online F-TDA-26) | **Esta épica la bloquea** (el vínculo estaba invertido y se corrigió) | Fuera de esta spec. |
| MSF-237 · Cuenta web del cliente (F-CLI-05) | Relacionada, **sin bloqueo**; F-TDA-27 se solapa parcialmente | Ver P3. |

## Supuestos (de la épica)

- Los requisitos se redactan cuando la épica pase a un hito.
- Hoy las tiendas no cobran en línea: se consulta por WhatsApp o formulario y se coordina fuera del sistema.

## Preguntas abiertas (bloquean implementar; máx. 5)

- **P1 · ¿Se encara F-TDA-26?** La épica dice que está fuera del alcance acordado («no hay checkout, pagos ni envíos») y que, si se encara, requiere **specs separadas** de carrito, pagos, envíos, facturación y pedidos. ¿Hay decisión del cliente de pasar la épica a un hito? ¿Cuáles de esas cinco piezas entran en esta spec y cuáles van en specs aparte?
- **P2 · Pago en línea:** ¿qué pasarela o medio de pago se usa, y se reutilizan las «Cuentas de cobro» existentes? Sin esto no se puede declarar el pago ni el estado del pedido.
- **P3 · F-TDA-27 vs MSF-237 (F-CLI-05):** la épica sugiere acotar a **favoritos e historial (F-CLI-20)**. ¿Se confirma ese recorte (el registro/ingreso lo cubre la cuenta web de MSF-237)?
- **P4 · Alcance de la cuenta:** ¿una cuenta por tienda o una sola entre las tiendas de la organización? («si el cliente lo decide» se lee como que la cuenta es **opcional** y se puede comprar sin cuenta; ¿se confirma?)
- **P5 · Envíos, facturación y pedidos:** al no haber checkout hoy, ¿qué se pide del pedido en esta épica (¿solo registrarlo para que MSF-154 lo tome, F-CON-07?) y qué se deja afuera?

## Modelo y esquema de datos (Constitución, Principio VII)

**Sin definir**: la épica no declara tablas. Cuando se respondan las preguntas, cada tabla nueva o alterada se ubica por su naturaleza (cuentas y sesión de cliente = plataforma → `public`; carrito, favoritos, pedidos = dominio del producto → `dominio`), con RLS por organización, migración **aditiva** con reversión y un pgTAP. No se crea ninguna tabla en esta versión de la spec. Las RPC que deba llamar la app llevan `grant execute … to authenticated` explícito y `revoke … from public, anon`; la tienda pública anónima solo usa funciones de `publico`.

## User Scenarios & Testing *(mandatory)*

### US1 — Carrito y compra online (F-TDA-26, P3, XL)

El visitante agrega productos de la tienda a un carrito, y compra y paga en línea. **El detalle (checkout, pagos, envíos, pedido) depende de P1, P2 y P5.**

1. **Given** una ficha o catálogo de la tienda (MSF-167), **When** el visitante decide comprar, **Then** puede hacerlo y pagar en línea (único criterio dado por la épica; los escenarios finos se redactan al responder P1/P2/P5).

### US2 — Cuentas de clientes y favoritos (F-TDA-27, P3, L)

El cliente puede registrar una cuenta y guardar favoritos, **si lo decide** (la cuenta no es obligatoria para navegar). El detalle depende de P3 y P4.

1. **Given** un visitante en la tienda, **When** elige registrarse, **Then** tiene una cuenta y puede marcar productos como favoritos (único criterio dado; el resto se redacta al responder P3/P4).

## Requirements *(mandatory)*

Solo los que la épica sostiene literalmente en su objetivo. No hay más hasta responder las preguntas.

- **FR-001** (F-TDA-26): La tienda DEBE permitir comprar y pagar en línea. *(Detalle bloqueado por P1, P2, P5.)*
  **Verificación**: Vitest `apps/web/src/pages/tienda-publica/compra/Compra.test.tsx` (`pnpm --filter @platform/web test`) + E2E `apps/web/e2e/tienda-compra.e2e.ts` (`pnpm test:e2e`); se crean en T002.
- **FR-002** (F-TDA-27): La tienda DEBE permitir registrar cuentas de clientes con favoritos. *(Detalle bloqueado por P3, P4.)*
  **Verificación**: Vitest `apps/web/src/pages/tienda-publica/cuenta/Favoritos.test.tsx` (`pnpm --filter @platform/web test`) + pgTAP `supabase/tests/database/favoritos_rls.sql` (`pnpm test:db`); se crean en T011.
- **FR-003** (F-TDA-27): La cuenta DEBE ser opcional: «si el cliente lo decide». *(Interpretación a confirmar en P4.)*
  **Verificación**: Vitest `apps/web/src/pages/tienda-publica/cuenta/CuentaOpcional.test.tsx` (navegar y comprar sin sesión sigue funcionando; `pnpm --filter @platform/web test`); se crea en T011.
- **FR-004** (transversal): La tienda pública sigue sin exponer datos internos (costos, existencias exactas, proveedor), como en MSF-167.
  **Verificación**: Vitest `apps/web/src/pages/tienda-publica/compra/Compra.test.tsx` y `apps/web/src/pages/tienda-publica/cuenta/Favoritos.test.tsx` (la respuesta no trae costos/existencias/proveedor) + pgTAP `supabase/tests/database/*.sql` (`anon` solo ejecuta funciones de `publico`; `pnpm test:db`); revisión final en T022.

## Success Criteria *(mandatory)*

- **SC-001** (F-TDA-26): Un visitante completa una compra con pago en línea. *(Se afina con P1/P2.)*
  **Verificación**: E2E `apps/web/e2e/tienda-compra.e2e.ts` con las dos tiendas del seed (`pnpm test:e2e`); se crea en T002.
- **SC-002** (F-TDA-27): Un cliente registra una cuenta y guarda un favorito. *(Se afina con P3/P4.)*
  **Verificación**: E2E `apps/web/e2e/tienda-cuenta-favoritos.e2e.ts` (`pnpm test:e2e`); se crea en T011.
- **SC-003** (cierre): Documentación y gates del repo verdes (`pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`, `pnpm lint`, `pnpm build`, `pnpm test`).
  **Verificación**: esos mismos comandos, ejecutados en T022 y en el CI del PR.

## Matriz pantalla↔criterios

La épica **no tiene pantallas dibujadas en el prototipo** («se dibujan cuando la épica entre en una etapa»). Se verificó en `design/pantallas/`: no existe ningún `.dc.html` de carrito, checkout, cuenta de cliente ni favoritos de la tienda, así que no hay inventario (`pnpm prototipo:inventario`) que mapear. Las pantallas se arman con los componentes del template y el sistema de diseño (regla de fuentes 3), sin copiar HTML/CSS. Las pantallas de tienda ya existentes (`MJC_*`, `SJ_*`) pertenecen a MSF-167 y no se tocan.

| Ítem | Dueño | Nota |
|---|---|---|
| Carrito, checkout, pago, confirmación de pedido | FR-001 / SC-001 | Sin prototipo: se define tras P1/P2/P5. |
| Registro/ingreso, favoritos, historial | FR-002, FR-003 / SC-002 | Sin prototipo: se define tras P3/P4. |
| Botón «Agregar al carrito» y corazón de favorito sobre catálogo/ficha de MSF-167 | **Fuera de alcance por ahora** | Los prototipos `MJC_/SJ_` de catálogo y ficha no los muestran; no se agregan hasta tener diseño. |

### Empresa activa (Principio VIII)

| Elemento | Decisión | Motivo |
|---|---|---|
| Empresa activa de la barra superior | **No aplica** | Es el front público anónimo: no hay barra superior ni selector. La tienda se resuelve por el `Host` y no mezcla empresas (como MSF-167). Si se agrega una pantalla del panel (p. ej. pedidos recibidos), esa pantalla deberá declarar la empresa activa; hoy no se pide ninguna. |

## Flujos

La épica **no describe flujos** (ni estados, secuencias ni procesos; no hay imagen, `.mmd`, `.drawio` ni `.puml` adjuntos). No se inventan estados de pedido ni pasos de checkout. Cuando se respondan P1/P2/P5 se agregan aquí: `stateDiagram-v2` del pedido/pago, `sequenceDiagram` del cobro y `flowchart` del recorrido de compra, cada paso con su FR/SC.

## Fuera de alcance

- Envíos, facturación y pedidos como especificaciones propias: la épica los nombra como specs separadas si se encara F-TDA-26 (P1).
- El registro/ingreso de cuenta, si se confirma que lo cubre MSF-237 (P3).
- Los botones de carrito/favorito sobre las pantallas de MSF-167 (sin prototipo).

## Documentación y trazabilidad

Cambia `docs/tiendas-online.md` en el cierre (SC-003). El roadmap `docs/roadmap-template.md` se actualiza a mano al mergear.
