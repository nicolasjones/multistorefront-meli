---
owner: producto
sources:
  - specs
---

# Precios y dólar (MSF-116)

**Épica:** MSF-116 · **Historias:** F-PRE-02 (carga diaria), F-PRE-03 (vista previa y recálculo),
F-PRE-04 (historial) y F-PRE-05 (aviso). **Spec:** `specs/20261023-120000-dolar-y-recalculo/`
(rama de la épica, pendiente de merge a `main`). Detalle técnico:
[Dólar y recálculo](../tecnico/dolar-y-recalculo.md).

Esta página cubre **la cotización del dólar** con la que se calculan los precios de los productos en
dólares. Las reglas de precio por empresa, el IVA y las escalas vienen de **MSF-114** (`precios-e-iva`,
también en rama); esta épica no las cambia: cambia **qué cotización usan**.

## Qué resuelve

- El administrador **carga a mano el dólar del día**, una vez por día, y ve antes de confirmar **qué
  precios van a cambiar** en cada empresa.
- Al confirmar, los precios en dólares de **todas las empresas se recalculan juntos**: ninguna puede
  quedar con un valor distinto de otra.
- Queda un **historial de cargas que no se puede editar ni borrar**, con quién cargó cada valor, la
  variación y cuántos precios se recalcularon.
- Si hoy no se cargó el dólar, el sistema **avisa** en la pantalla de Cotización y en la portada.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Administrador** | Carga el dólar del día, ve la vista previa, confirma el recálculo o lo descarta, y consulta el historial. |
| **Administración** | Hoy la matriz de permisos le da **edición** en «Cotización del dólar» (el Jira dice «solo el administrador»); se ajusta desde Roles, sin tocar código. |
| **Roles con lectura** | Ven la cotización vigente, el historial y el aviso, sin botones de carga. |
| **Resto de los roles** | No ven la pantalla ni el aviso; la base rechaza la consulta igual. |

## Cómo se usa

1. **Abrir la pantalla:** *Administración → Cotización del dólar* (`/cotizacion`). La tarjeta
   **Vigente** muestra el valor, «Última carga: <fecha> por <quién>», «Productos con precio en USD» y el
   indicador **Al día** / **Sin cargar hoy**.
2. **Cargar:** el botón **Cargar cotización** (solo con edición) abre el diálogo **Cargar dólar del día**.
   El campo «Dólar del día (pesos por dólar)» acepta `1490`, `1490,50` o `1.490,5`; muestra «Anterior» y
   la **Variación**. Un valor vacío, cero, negativo o no numérico no deja avanzar. Una variación mayor al
   **15 %** muestra «Variación inusual» (solo avisa, no bloquea).
3. **Queda pendiente:** al continuar, la cotización no cambia ningún precio y **vence a las 24 horas**.
   Volver a cargar reemplaza la pendiente.
4. **Ver el impacto:** «Qué va a cambiar» muestra un mosaico por empresa («N precios · productos en USD
   visibles») y una muestra de productos con «<Empresa> hoy» y «Nuevo». El pie aclara el redondeo al
   **$ 10 más cercano**.
5. **Confirmar:** **Aplicar y recalcular** aplica el valor a todas las empresas y avisa «Cotización
   aplicada · N precios recalculados». Si la variación no llega al umbral, el botón dice **Registrar
   cotización**, se avisa «Sin recálculo» y los precios no cambian.
6. **Cancelar** descarta la cotización pendiente y no deja cambios (supuesto a confirmar, ver *Límites*).
7. **Historial:** «Historial de cargas» lista *Fecha*, *Valor*, *Variación*, *Cargó* y *Precios*
   («N precios» o «Sin cambios (< 1 %)»), de la más nueva a la más vieja y paginado.

## Reglas de negocio que respeta

- **Una cotización para toda la organización**, no por empresa: la empresa activa de la barra superior no
  cambia el valor ni la pantalla.
- **Los precios no se guardan en pesos:** se calculan al leer con la cotización aplicada. «Recalcular»
  es cambiar esa cotización en **una sola transacción**; por eso todas las empresas cambian juntas.
- **Hasta confirmar un valor nuevo, rigen los precios del último conocido.**
- **Umbral fijo de 1 %:** con una variación de 1 % o más se recalcula; con menos, la cotización **se
  registra** en el historial pero los precios siguen igual. Justo 1 % recalcula. El umbral se mide contra
  la **cotización vigente** (no contra la última aplicada): es una decisión abierta.
- **El redondeo es $ 10**, el alcance es «una para todo el sistema» y el aviso está siempre activo: en el
  lanzamiento son valores fijos.
- **«Precios recalculados»** cuenta productos activos en dólares × empresas activas.
- **«Hoy» es el día calendario de Buenos Aires**, todos los días (sin calendario de feriados). Un dólar
  **pendiente sin confirmar no cuenta** como cargado.
- **Un dólar vencido** (más de 24 h sin confirmar) se trata como inexistente al consultar; confirmarlo da
  un error claro y no aplica nada.

## Empresa activa

**No aplica.** La cotización es de la organización, no de una empresa: cambiar de empresa en la barra
superior no altera la pantalla, el historial ni el aviso. Hay un test que lo cubre.

## Límites y fuera de alcance

- **Configuración (F-PRE-06, Etapa 2):** elegir «una por empresa», cambiar el umbral, el redondeo o
  apagar el aviso. En esta entrega esos valores son fijos.
- **Mercado Libre (Etapa 2):** las publicaciones de ML no aparecen en la vista previa ni en el historial
  todavía.
- **Historial importado del panel anterior (MSF-275):** es otra pantalla y otra tabla; no se mezcla con
  el historial nuevo de cargas.
- **Sin carga automática ni worker:** el dólar lo carga una persona; el vencimiento de la pendiente se
  resuelve al consultar.
- **Decisiones abiertas** (spec, *Decisiones abiertas*): si el umbral debe medirse contra la cotización
  aplicada; si «Cancelar» debe descartar la cotización; si el aviso corre fines de semana y feriados; y
  si la carga es solo del Administrador (hoy la matriz también da edición a Administración).
- El registro de actividad de los eventos `cotizacion.*` y `recalculo.*` usa el registro existente; la
  épica que lo formaliza no está cargada en Jira.

## Permisos

La sección es **`cotizacion_dolar`** de la matriz de permisos:

| Nivel | Puede |
|---|---|
| `edicion` | Ver, cargar, previsualizar, confirmar y descartar. |
| `lectura` | Ver la cotización, el historial y el aviso. |
| `ninguno` | Nada: sin menú, la ruta no abre y la consulta directa falla. |

Detalle de la matriz: [Permisos por rol](../permisos-por-rol.md).

## Estado

Implementado en la rama de la épica (MSF-246, MSF-267, MSF-286, MSF-305 y el cierre MSF-547; merge
`872f09a`, PR #304), **pendiente de merge a `main`**. Tiene pgTAP, Vitest y un E2E escrito que se corre
contra Supabase local. Cómo está construido: [Dólar y recálculo](../tecnico/dolar-y-recalculo.md).

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
