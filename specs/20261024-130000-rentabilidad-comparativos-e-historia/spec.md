# Feature Specification: Inicio, rentabilidad y reportes · Rentabilidad comparativos e historia

**Épica**: MSF-127 · **Spec**: `rentabilidad-comparativos-e-historia` · **Hito**: Etapa 2 (desde enero de 2027; primer bloque, junto con reportes e inicio) · **Prioridad**: P1 · **Alcance (Jira)**: etapa-2 · **Horas aprox.**: 18
**Alcance de entrega**: `refine`, `supabase`, `superset` (sin `kestra` ni `workers`: el cálculo es SQL y los tableros los sirve Superset, igual que MSF-120).
**Fuente**: especificación de Nicolás cargada en la épica (Jira) y artefactos del producto. Esta spec **traduce**; no agrega alcance. Se apoya en lo ya entregado por MSF-120 (`rentabilidad-margen`).

## Objetivo

Al terminar, el administrador compara el margen del mismo producto entre empresas y reconstruye cómo evolucionó su margen con la cotización de cada fecha.

## Modelo y supuestos

- **Bloqueada por MSF-120**: la vista base `analitica.margen_producto_canal`, el umbral de margen bajo, el rol de lectura de Superset, `reportes.seccion`, la pantalla `/rentabilidad` y el importador de tableros ya existen (se reutilizan, no se recrean). Por esa cadena llegan MSF-116 (historial de cotizaciones, `dominio.cotizaciones`, F-PRE-04) y MSF-114 (precios).
- **Canales = tiendas de cada empresa.** Hasta que exista Mercado Libre, comparar canales es comparar las tiendas de las empresas; las columnas de cuentas de Mercado Libre las suma la épica de Mercado Libre.
- **Costo histórico (supuesto de la épica)**: se reconstruye con los cambios de costo registrados en Actividad (F-AUD-01), contra el contrato de eventos `producto.costo_modificado`. La épica deja abierta la pregunta «¿se reconstruye desde Actividad o conviene una historia de costos propia desde el lanzamiento?» (ver *Decisiones abiertas* 1).
- **Verificación previa pedida por la épica — resultado (estado real del repo)**: **no se cumple hoy.** El cambio de costo se registra como `producto.precio_actualizado` con detalle «Cambió el costo de <producto>» **sin importes, por diseño** (`supabase/migrations/20261022121200_precios_actividad_producto.sql`; `docs/actividad.md`: la Actividad la ve quien no tiene `rentabilidad`), y `registro_actividad.detalle` es texto (≤ 500). No existe el tipo `producto.costo_modificado` ni valor anterior/nuevo estructurado. F-REN-07 queda por eso con una **compuerta de entrada** (FR-009) y una decisión pendiente de Nicolás; F-REN-06 no depende de esto.
- **Precio usado en la historia**: el neto de la tienda **vigente hoy** (en su moneda), convertido con la cotización de cada fecha; la épica no pide reconstruir historia de precios de lista. **A confirmar** (*Decisiones abiertas* 2).
- Los supuestos de MSF-120 siguen vigentes: margen sobre el **neto sin IVA**, costo sin IVA, comisión de tienda 0, umbral de margen bajo de la organización (10 % por defecto).

### Esquema de datos (Constitución, Principio VII)

| Objeto | Esquema | Historia | Justificación | RLS / acceso |
|--------|---------|----------|---------------|--------------|
| Vista `analitica.margen_comparativo_producto` (**nueva**) | `analitica` (solo vistas, sin tablas) | F-REN-06 | Contrato de lectura para Superset; no almacena datos. Cada fila lleva `organizacion_id`. | Sin acceso para `anon`/`authenticated`; `select` solo al rol de Superset de MSF-120; aislamiento por la cláusula `rls` del guest token |
| Vista `analitica.margen_historico_producto_canal` y función de apoyo `analitica.costo_en_fecha` (**nuevas**) | `analitica` | F-REN-07 | Margen por producto × tienda × cotización de cada fecha; solo lectura derivada. | Ídem |
| Tablas | — | — | **Ninguna tabla nueva.** Si Nicolás decide la *historia de costos propia* (*Decisiones abiertas* 1), esa tabla (`dominio.producto_costos_historial`, naturaleza: dato de negocio del producto → `dominio`, RLS por organización y sección `rentabilidad`) **se agrega con una migración aditiva propia de F-REN-07 y re-verifica el Principio VII**; hoy no se asume. | — |
| Reportes `Comparativo` e `Historia` en `public.reportes` (filas, con `seccion = 'rentabilidad'`) | `public` (plataforma; tabla de la spec 007) | F-REN-06 / F-REN-07 | Registro idempotente por el importador; no cambia el esquema. | RLS vigente de `reportes` |

La prueba pgTAP `rls_en_toda_tabla` recorre `public` + `dominio` y debe seguir verde. Reversión de cada migración: ver `plan.md` (todas aditivas).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Comparativo entre canales y empresas (F-REN-06, P1, talla M)

Como administrador quiero ver el margen del mismo producto lado a lado en cada empresa (tienda), con la diferencia entre la mejor y la peor, para detectar dónde se gana de más o de menos por el mismo producto.

**Escenarios**:
1. **Dado** un producto con margen calculado en dos empresas (neto $ 10.000 / costo $ 6.000 en una; neto $ 9.000 / costo $ 6.000 en otra), **cuando** abro «Comparativo», **entonces** veo una fila del producto con el margen % de cada empresa (40 % y 33,3 %), la diferencia en puntos porcentuales (6,7 pp) y cuál empresa tiene el mejor y el peor margen.
2. **Dado** un producto con margen en una sola empresa, **entonces** no aparece en el comparativo (no hay con qué compararlo); sigue en «Por producto».
3. **Dado** un producto sin costo, sin neto positivo o sin cotización en una empresa, **entonces** esa empresa no cuenta para el producto (misma regla de MSF-120: sin fila, no se inventa margen).
4. **Dado** una empresa nueva (o una tienda que pasa a activa), **entonces** aparece sola como columna/serie del comparativo.
5. **Dado** el buscador «Buscar producto o SKU», **entonces** filtra por nombre o SKU; **dado** el orden por diferencia, **entonces** alterna «Mayor diferencia primero» / «Menor diferencia primero».
6. **Dado** filtros sin coincidencias o una organización sin ningún producto comparable, **entonces** veo el estado vacío del patrón compartido.
7. **Dado** dos organizaciones, **cuando** A abre el tablero, **entonces** el token lleva `organizacion_id = '<A>'` y ninguna fila de B aparece.
8. **Dado** un usuario sin `lectura` en `rentabilidad`, **entonces** ve `AccesoRestringido` y no se pide token; **dado** un fallo del tablero, **entonces** error con `Reintentar`.
9. **Dado** que la organización no tiene Mercado Libre activo, **entonces** no hay columnas ni series de Mercado Libre.

### User Story 2 - Rentabilidad con la cotización de cada fecha (F-REN-07, P1, talla M)

Como administrador quiero elegir un producto y ver cómo evolucionó su margen en cada empresa con la cotización del dólar de cada fecha y el costo que regía en ese momento, para entender si el margen cambió por el dólar o por un cambio de costo.

**Escenarios**:
1. **Dado** un producto cuyo costo cambió y una serie de cotizaciones confirmadas, **cuando** abro «Historia» y elijo el producto, **entonces** veo, por cada fecha de cotización y empresa: cotización de la fecha, costo vigente ese día (en pesos con esa cotización), neto (en pesos con esa cotización), margen y margen %.
2. **Dado** un cambio de costo registrado entre dos cotizaciones, **entonces** el costo usado cambia a partir de la fecha del cambio (el costo de una fecha es el último registrado hasta ella).
3. **Dado** una fecha anterior al primer costo registrado para el producto, **entonces** esa fecha no tiene margen (no se inventa un costo).
4. **Dado** un producto en ARS, **entonces** la cotización no altera su margen (la serie queda plana salvo cambios de costo); **dado** uno en USD, el margen se mueve con la cotización de cada fecha.
5. **Dado** un producto sin historia suficiente (sin cotizaciones o sin costo reconstruible), **entonces** estado vacío del patrón compartido con el motivo en lenguaje de negocio, sin detalle técnico.
6. **Dado** dos organizaciones, **entonces** el historial de A nunca incluye cotizaciones, costos ni productos de B (cláusula `rls` por `organizacion_id`).
7. **Dado** un usuario sin `lectura` en `rentabilidad`, **entonces** `AccesoRestringido` sin pedir token; **dado** un fallo del tablero, error con `Reintentar`.
8. **Dado** que los importes de costo y margen **solo** los ve quien tiene `rentabilidad`, **entonces** reconstruir el historial no expone costos a roles sin esa sección (ni en Actividad ni en el tablero).
9. **Dado** la compuerta de F-REN-07 (FR-009) sin cumplirse, **entonces** la historia **no se implementa**: se trae la decisión de Nicolás (*Decisiones abiertas* 1) en lugar de inventar la fuente.

### Edge Cases

- Cotización confirmada el mismo día que un cambio de costo → el costo vigente de esa fecha es el último registrado **hasta el instante de la carga** (`cotizaciones.cargada_en`).
- Producto dado de baja o empresa pausada → fuera de ambas vistas (mismo criterio activo/activa de MSF-120).
- Varias cargas de cotización el mismo día → una fila por carga (el historial es append-only).
- Neto ≤ 0 en una fecha → sin margen para esa fecha (evita división por cero).
- Dos productos con el mismo SKU en organizaciones distintas → nunca se mezclan.
- Superset caído con el administrador logueado → estado de error con reintento; el resto de la app sigue.

## Flujos

### F1 · Comparativo de un producto entre empresas

```mermaid
flowchart TD
  A["analitica.margen_producto_canal<br/>(producto × tienda con margen)"] --> B{"¿El producto tiene margen<br/>en 2 o más empresas?"}
  B -- "No" --> X["No entra al comparativo<br/>(sigue en «Por producto»)"]
  B -- "Sí" --> C["Margen % de cada empresa"]
  C --> D["Diferencia = mejor margen % − peor margen % (pp)"]
  D --> E["Mejor y peor empresa del producto"]
  E --> F["Tablero «Comparativo»: orden, buscador, estado vacío"]
```

Dueños: base y regla de comparabilidad FR-001, FR-002; diferencia y mejor/peor FR-003; tablero, orden y buscador FR-004; vacío FR-004. Pasos sin dueño: ninguno. **Fuera de alcance**: columnas de cuentas de Mercado Libre (épica de Mercado Libre).

### F2 · Reconstrucción del margen con la cotización de cada fecha

```mermaid
flowchart TD
  A["dominio.cotizaciones<br/>(cada carga confirmada: fecha y valor)"] --> B["Para cada fecha de cotización"]
  C["Cambios de costo registrados<br/>(producto.costo_modificado, valor anterior y nuevo)"] --> D{"¿Hay un costo registrado<br/>hasta esa fecha?"}
  B --> D
  D -- "No" --> X["Sin margen en esa fecha"]
  D -- "Sí" --> E["Costo vigente de la fecha<br/>(último registrado hasta ella)"]
  E --> F["Costo y neto en pesos con la cotización de la fecha"]
  F --> G["Margen = neto − costo − comisión (0)"]
  G --> H["Margen % = margen ÷ neto"]
  H --> I["Tablero «Historia»: producto elegido, serie por empresa"]
```

Dueños: compuerta de la fuente del costo FR-009; costo en fecha FR-010; cotización por fecha y margen FR-011; sin costo/sin historia FR-012; tablero FR-013. Pasos sin dueño: ninguno. **Fuera de alcance**: reconstruir precios de lista históricos (supuesto de la épica, *Decisiones abiertas* 2).

### F3 · Acceso a los tableros (igual que MSF-120)

```mermaid
sequenceDiagram
  actor U as Administrador
  participant P as /rentabilidad (pestaña)
  participant F as emitir-acceso-reporte
  participant S as Superset
  U->>P: abre «Comparativo» o «Historia»
  alt sin lectura en rentabilidad
    P-->>U: AccesoRestringido (no se pide token)
  else con lectura
    P->>F: pide token del reporte (seccion = rentabilidad)
    alt 403 o falla
      F-->>P: error
      P-->>U: error con «Reintentar»
    else
      F-->>P: guest token con rls organizacion_id
      P->>S: monta el tablero
      S-->>U: datos de su organización
    end
  end
```

Dueños: restricción por sección y token FR-007 (reutiliza MSF-120); acceso restringido y error FR-006 (Comparativo) y FR-014 (Historia). Pasos sin dueño: ninguno.

## Requirements *(mandatory)*

### Funcionales — F-REN-06 (US1)

- **FR-001**: Existe la vista `analitica.margen_comparativo_producto`, derivada de `analitica.margen_producto_canal`, con una fila por producto × empresa **solo para productos con margen calculado en 2 o más empresas**, con columnas `organizacion_id`, `producto_id`, `producto_nombre`, `sku`, `empresa_id`, `empresa_nombre`, `precio_neto`, `costo`, `margen`, `margen_pct`, `estado` y `empresas_comparadas`. Declarada en `contracts/analitica-comparativos-historia.md`. **Verificación**: `pnpm test:db` → `supabase/tests/database/rentabilidad_comparativo.test.sql` (columnas, filas, producto de una sola empresa excluido, sin costo/neto/cotización → sin fila).
- **FR-002**: La comparación respeta la regla de MSF-120 (neto sin IVA, costo con `private.a_pesos`, comisión 0) sin duplicar fórmulas: toda cifra sale de `analitica.margen_producto_canal`; no existen filas de Mercado Libre. **Verificación**: `pnpm test:db` → `rentabilidad_comparativo.test.sql` (valores iguales a los de la vista base) y revisión `grep -ri mercado infra/superset/dashboards/rentabilidad` sin resultados nuevos.
- **FR-003**: Por producto, la vista expone `margen_pct_mejor`, `margen_pct_peor`, `diferencia_pp` (mejor − peor, en puntos porcentuales), `empresa_mejor` y `empresa_peor`. **Verificación**: `pnpm test:db` → `rentabilidad_comparativo.test.sql` (caso 40 % vs 33,3 % → 6,7 pp; empate de empresas con criterio estable por nombre).
- **FR-004**: El tablero «Comparativo» muestra una fila por producto con SKU, el margen % de cada empresa, la diferencia (pp) y mejor/peor empresa; ofrece buscador «Buscar producto o SKU» y orden «Mayor diferencia primero» / «Menor diferencia primero»; sin coincidencias u organización sin productos comparables muestra el estado vacío compartido. **Verificación**: Vitest de la pestaña (vacío, error) y `pnpm test:db` → `rentabilidad_comparativo.test.sql` (orden y filtros del dataset).
- **FR-005**: Datasets y tablero «Comparativo» se exportan a YAML bajo `infra/superset/dashboards/rentabilidad/` y se importan con `infra/superset/importar-dashboards.mjs`; el registro como `reportes` con `seccion = 'rentabilidad'` es idempotente. **Verificación**: `pnpm test:superset:importar-dashboards`.
- **FR-006**: La pantalla `/rentabilidad` suma la pestaña `Comparativo` (embebe el tablero con `ReporteEmbebido`), usa los patrones compartidos de carga, vacío y error con `Reintentar` (repite token y montaje), muestra `AccesoRestringido` sin `lectura` en `rentabilidad` sin pedir token ni siquiera ante 403, funciona con teclado y lector de pantalla a 320/768/1440 px, y no ofrece Mercado Libre. **Verificación**: `pnpm --filter @platform/web test` → `pages/rentabilidad/*.test.tsx` (pestaña, `ReporteEmbebido`, vacío, error/reintento, acceso restringido, sin ML, teclado/lector) y `pnpm --filter @platform/web pantallas:capturar` a 320/768/1440 px.
- **SC-001**: pgTAP de la vista: comparabilidad (≥ 2 empresas), diferencia pp, mejor/peor, exclusiones, `anon`/`authenticated` sin acceso a `analitica`, rol de Superset solo `select`, `rls_en_toda_tabla` verde. **Verificación**: `pnpm test:db` (ejecuta `rentabilidad_comparativo.test.sql` y `rls_en_toda_tabla`).
- **SC-002**: Aislamiento entre dos organizaciones en la vista del comparativo y token rechazado (403) para roles sin `rentabilidad`. **Verificación**: `pnpm test:db` → `rentabilidad_comparativo_aislamiento.test.sql`.
- **SC-003**: Vitest de la pestaña «Comparativo» completo, incluido que el cambio de empresa de la barra superior no altera el tablero. **Verificación**: `pnpm --filter @platform/web test` (suite de la pestaña).

### Funcionales — F-REN-07 (US2)

- **FR-007**: Los tableros nuevos reutilizan sin cambios la restricción por sección y el guest token de MSF-120 (`emitir-acceso-reporte`, `reportes.seccion = 'rentabilidad'`, cláusula `rls` por `organizacion_id`); no se modifica la firma de nada existente. **Verificación**: `pnpm test:db` → `rentabilidad_historia_aislamiento.test.sql` y `node --test supabase/functions/emitir-acceso-reporte/handler.test.ts`.
- **FR-008**: Los importes de costo y margen del historial solo son visibles con `rentabilidad` ≥ `lectura`; reconstruirlos no agrega costos ni importes a Actividad ni a ninguna vista legible por `authenticated`. **Verificación**: `pnpm test:db` → `rentabilidad_historia_aislamiento.test.sql` (roles sin la sección y `anon` sin acceso).
- **FR-009**: **Compuerta de la fuente del costo histórico.** Antes de construir la reconstrucción se confirma con Plataforma (F-AUD-01) que cada cambio de costo queda registrado con valor anterior y nuevo bajo el tipo `producto.costo_modificado` y que esos valores solo son legibles con `rentabilidad`. Resultado hoy: **no se cumple** (ver *Modelo y supuestos*). Si no se cumple, la implementación de FR-010…FR-013 **se detiene** y se trae la decisión de Nicolás (*Decisiones abiertas* 1); no se inventa la fuente. **Verificación**: Informe de la verificación en el PR con la consulta/prueba que lo demuestra (pgTAP de contrato del evento cuando exista).
- **FR-010**: Existe `analitica.costo_en_fecha(producto_id, organizacion_id, fecha)`, que devuelve el costo vigente de un producto en una fecha = el último costo registrado hasta ella según la fuente confirmada en FR-009, o `null` si no hay ninguno. **Verificación**: `pnpm test:db` → `rentabilidad_historia.test.sql` (cambio de costo entre dos fechas; fecha anterior al primer registro → `null`).
- **FR-011**: Existe la vista `analitica.margen_historico_producto_canal` con una fila por producto × empresa × carga de `dominio.cotizaciones`, con columnas `organizacion_id`, `empresa_id`, `empresa_nombre`, `producto_id`, `producto_nombre`, `sku`, `fecha`, `cotizacion`, `precio_neto`, `costo`, `margen`, `margen_pct`: neto y costo convertidos a pesos con la cotización de **esa** fecha, `margen = neto − costo − comisión (0)`, `margen_pct = margen / neto`. Declarada en el contrato. **Verificación**: `pnpm test:db` → `rentabilidad_historia.test.sql` (producto en USD se mueve con la cotización; en ARS queda plano salvo cambio de costo; varias cargas el mismo día = varias filas).
- **FR-012**: Sin costo reconstruible para la fecha, sin neto positivo o sin cotización de la fecha, esa fecha **no tiene fila**; un producto sin historia suficiente muestra el estado vacío compartido con un motivo de negocio. **Verificación**: `pnpm test:db` → `rentabilidad_historia.test.sql` (exclusiones) y Vitest (vacío).
- **FR-013**: El tablero «Historia» permite elegir un producto y muestra, por empresa, la evolución del margen % por fecha de cotización y la tabla de apoyo (fecha, cotización, costo, neto, margen, margen %); se exporta a YAML bajo `infra/superset/dashboards/rentabilidad/` y se importa/registra de forma idempotente con `seccion = 'rentabilidad'`. **Verificación**: `pnpm test:superset:importar-dashboards` y Vitest de la pestaña.
- **FR-014**: La pantalla `/rentabilidad` suma la pestaña `Historia` (embebe el tablero con `ReporteEmbebido`) con los mismos estados, acceso restringido, accesibilidad y responsividad que FR-006, y sin Mercado Libre. **Verificación**: `pnpm --filter @platform/web test` → `pages/rentabilidad/*.test.tsx` y `pnpm --filter @platform/web pantallas:capturar`.
- **SC-004**: pgTAP de la reconstrucción: costo en fecha, cotización por fecha, exclusiones, `rls_en_toda_tabla` verde, `anon`/`authenticated` sin acceso a `analitica`. **Verificación**: `pnpm test:db` (ejecuta `rentabilidad_historia.test.sql` y `rls_en_toda_tabla`).
- **SC-005**: Aislamiento entre dos organizaciones y secreto de costos para roles sin `rentabilidad`. **Verificación**: `pnpm test:db` → `rentabilidad_historia_aislamiento.test.sql`.
- **SC-006**: Vitest de la pestaña «Historia»: elección de producto, vacío, error con reintento, acceso restringido, teclado/lector, cambio de empresa que no altera el tablero. **Verificación**: `pnpm --filter @platform/web test`.

### Funcionales — Cierre

- **FR-015**: `docs/rentabilidad.md` (comparativo, historia, contrato de las vistas nuevas, fuente del costo histórico y su decisión, reversión), `docs/operar-superset.md` y `docs/roadmap-template.md` actualizados; `pnpm docs:check` verde. **Verificación**: `pnpm docs:check`.
- **FR-016**: Revisión de seguridad de la superficie nueva (esquema `analitica` cerrado, rol de Superset solo `select`, token por sección, secreto de costos) y re-verificación de esquemas contra el Principio VII. **Verificación**: informe con `authz-security` e `infra-security` en el PR, más `pnpm test:db` (`rls_en_toda_tabla`, `anon` sin RPC ejecutables).
- **SC-007**: E2E de **ambos tableros** (Administrador ve; Administración lee; Operador/Consulta ven acceso restringido). **Verificación**: `pnpm test:e2e -- rentabilidad`.
- **SC-008**: `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`, `rls_en_toda_tabla`, `pnpm prototipo:check` y `pnpm matriz:check` verdes. **Verificación**: `pnpm lint && pnpm build && pnpm infra:config && pnpm test && pnpm prototipo:check && pnpm matriz:check`.

## Decisiones abiertas

1. **Fuente del costo histórico (pregunta de la épica).** Hoy Actividad **no** guarda importes de costo (por diseño, para que no los vea quien no tiene `rentabilidad`). Opciones: (a) que Plataforma emita `producto.costo_modificado` con valores anterior/nuevo legibles solo con `rentabilidad`; (b) una **historia de costos propia** (`dominio.producto_costos_historial`, aditiva, RLS por organización y `rentabilidad`) desde el lanzamiento. Recomendación: (b), porque no mezcla importes sensibles en un texto de Actividad visible a otra sección y no depende de F-AUD-01. Esta spec sigue la **premisa de la épica (a)** y deja la compuerta FR-009; (b) cambia el esquema de datos y requiere el OK de Nicolás.
2. **Precio en la historia.** Se usa el neto vigente hoy convertido con la cotización de cada fecha; reconstruir también el precio de lista de cada fecha no está pedido. Confirmar.
3. **Comparabilidad.** Solo entran productos con margen en 2 o más empresas. Confirmar que no se quiere ver también los de una sola.
4. **Datos de prueba.** Los márgenes de ejemplo de los escenarios son ilustrativos (a validar con el cliente).

## Verificación por requisito

Cada FR/SC lleva su verificación inline. NFR: accesibilidad y responsividad en FR-006/FR-014; rendimiento: las vistas se calculan al leer y los tableros cargan bajo demanda (`ReporteEmbebido`).

## Matriz pantalla↔criterios

La épica declara que **no tiene pantallas dibujadas en el prototipo** («se dibujan al entrar en la etapa»). Se revisó el inventario existente (`design/pantallas/Rentabilidad*.inventory.json`, `pnpm prototipo:check` al día): la pantalla `/rentabilidad` y sus pestañas son de MSF-120. La épica pide **menos** que el prototipo: lo que no pide no es deuda. Se implementa con los componentes del template y los tokens del sistema de diseño (regla de fuentes 3 y 4).

| Ítem | Destino | Criterio |
|---|---|---|
| Pestaña `Comparativo` (nueva; **no está en el prototipo**) con tabla producto × empresa, diferencia (pp), mejor/peor, buscador «Buscar producto o SKU» y orden por diferencia | En alcance, con los componentes del template | US1, FR-004, FR-006 |
| Pestaña `Historia` (nueva; **no está en el prototipo**) con selector de producto, serie por empresa y tabla de apoyo | En alcance, con los componentes del template | US2, FR-013, FR-014 |
| Pestañas existentes `Resumen`, `Por producto` | Ya entregadas por MSF-120; no se tocan | — |
| Pestaña / botón `Por publicación de ML`, botón `Editar comisión`, diálogo «Comisión estimada de Mercado Libre» (campo `Comisión sobre el precio`, `Cancelar`, `Guardar`) | Fuera de alcance: comisión y publicaciones de Mercado Libre son de la épica de Mercado Libre (Etapa 2) | FR-002 |
| Columnas de la tabla de Rentabilidad (`Producto`, `Canal`, `Precio`, `Costo`, `Comisión`, `Margen`, `Margen %`, `Estado`), campo «Buscar producto o SKU» del prototipo | Ya entregados por MSF-120 en «Por producto»; aquí se reutiliza la misma convención en las tablas de apoyo de ambos tableros | FR-004, FR-013 |
| Estados que el prototipo no dibuja: vacío, error con `Reintentar`, acceso restringido | En alcance | US1-6/8, US2-5/7, FR-006, FR-014 |
| Filtro de empresas / `FiltroEmpresa` / `SelectorEmpresas` | No aplica: el comparativo muestra **todas** las empresas lado a lado (es su objetivo) y no hay selección de empresas en formularios; no se agregan `Chip` ni `Select` propios | US1, FR-004 |
| Fila **Empresa activa** | No aplica: ambos tableros comparan todas las empresas de la organización y el prototipo no muestra selector ni texto de empresa para esta funcionalidad; el test comprueba que el cambio de empresa de la barra superior **no altera** el tablero ni deja datos de otra organización | SC-003, SC-006 |

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira | Historia | FR / SC | Tareas |
|------|----------|---------|--------|
| F-REN-06 | US1 Comparativo entre canales y empresas | FR-001…006, SC-001…003 | T001–T009 |
| F-REN-07 | US2 Rentabilidad con la cotización de cada fecha | FR-007…014, SC-004…006 | T010–T021 |
| Tarea de cierre (label `cierre`) | Docs, seguridad, E2E y roadmap | FR-015, FR-016, SC-007, SC-008 | T022–T025 |
