---
owner: tecnico
sources:
  - specs/20261105-100000-cotizacion-sugerida-y-mayoristas
  - supabase/functions/cotizacion-sugerida
  - apps/web/src/components/cotizacion/DialogoCargarDolar.tsx
  - apps/web/src/hooks/useCotizacionSugerida.ts
  - apps/web/src/lib/cotizacion.ts
  - package.json
---

# Cotización sugerida y mayoristas (MSF-373)

**Épica:** MSF-373 — Precios y dólar · Cotización sugerida y mayoristas · **Spec:**
`specs/20261105-100000-cotizacion-sugerida-y-mayoristas/` (`spec.md`, `plan.md`, `tasks.md`), **parcial —
NEEDS_INFO** · **Rama de la épica:** `epic/MSF-373-precios-y-dolar-cotizacion-sugerida-y-ma` (PR #835, despliegue
a DEV) · **Cierre:**
PR #833 (merge `fa61db9f`, integrado en `dokploy`; en `main` llega con la próxima promoción — las citas de
este documento salen de `dokploy`) · **Alcance de entrega:** `refine` + `supabase` para F-PRE-13; F-PRE-14
sin alcance.

La épica tenía dos historias independientes. **Solo se construyó F-PRE-13 (cotización sugerida desde una
fuente pública)**: la Edge Function `cotizacion-sugerida` y la sugerencia dentro del diálogo «Cargar dólar
del día» de MSF-116. **F-PRE-14 (listas de precios mayoristas) quedó en Backlog**, sin requisitos, porque
choca con F-PRE-15 (escalas por tipo de cliente) y con el modelo comercial mayorista, todavía sin definir.
Manual: [Cargar la cotización del dólar](../producto/precios-dolar.md) y
[Precios, escalas e IVA](../producto/precios-e-iva.md).

La spec nació **NEEDS_INFO**: la propia épica dice que «los requisitos se redactan cuando la épica pase a un
hito». Para no frenar la entrega, F-PRE-13 se resolvió con una **decisión provisoria** de la Pregunta 1
(DolarApi, dólar oficial venta) y F-PRE-14 quedó reservado (`FR-003`).

La documentación que escribió la implementación quedó en `docs/precios.md`, una página que **ya no está en
`main`** (el manual se reorganizó en `docs/producto/` y `docs/tecnico/`). Lo equivalente de esta épica quedó en
el manual ([Cargar la cotización del dólar](../producto/precios-dolar.md)) y en esta página.

## Qué se construyó: F-PRE-13

Al abrir **Administración → Cotización del dólar → Cargar cotización**, el diálogo «Cargar dólar del día»
muestra, debajo del campo, la leyenda:

> «Sugerida: $ 1.405,50 por USD · DolarApi (dólar oficial, venta) · actualizada el 10/11/2026» ·
> **Usar este valor**

**Usar este valor solo completa el campo** con el valor sugerido (coma decimal). No lo carga, no lo
confirma y no toca precios: la carga, la vista previa y la confirmación siguen siendo las de
[MSF-116](dolar-y-recalculo.md). Si la fuente no responde, el diálogo muestra «No pudimos consultar la
cotización sugerida. Cargá el valor a mano.» y la carga manual funciona igual (`FR-002`).

### Edge Function `cotizacion-sugerida`

Archivos: `supabase/functions/cotizacion-sugerida/index.ts` (cableado real) y
`supabase/functions/cotizacion-sugerida/handler.ts` (lógica con dependencias inyectadas).

| Aspecto | Implementación |
|---|---|
| Método | Solo `POST`; `OPTIONS` responde el preflight; cualquier otro método, `405`. |
| Autenticación | Exige sesión (`getUser` con el JWT del llamador) y nivel **`edicion`** en la sección `cotizacion_dolar`, resuelto con `permisos_actuales()`. Sin sesión, token inválido o nivel distinto: `403` y **no consulta la fuente**. Si no puede resolver el permiso: `502`. |
| Fuente | `https://dolarapi.com/v1/dolares/oficial`, en la constante `FUENTE_URL`; `FUENTE_NOMBRE = "DolarApi (dólar oficial, venta)"`. |
| Tiempo máximo | 5 s (`TIEMPO_MAXIMO_MS`), con `AbortSignal.timeout` y `redirect: 'error'`. |
| Validación | Acepta solo `venta` numérica, finita, `> 0` y `< 1.000.000` (`VALOR_MAXIMO`); redondea a dos decimales. `fechaActualizacion` es opcional: si no es una fecha ISO válida, viaja `null`. Fuente caída o respuesta inválida: `502` con mensaje que invita a cargar a mano. |
| Seguridad | Sin `service-role`, sin secretos y sin escribir en la base. La URL es una constante y el navegador no manda nada que llegue a la consulta: no hay SSRF. Usa solo la clave anónima con el JWT de quien llama (manda RLS). |
| Respuesta | `200 { valor, fuente, fecha }` con el valor redondeado y la fecha normalizada a ISO, o `null`. |

La función **no guarda nada**: se consulta cada vez que se abre el diálogo. Por eso la épica **no usa
worker ni Kestra** ni agrega una tabla de caché.

**Sin contrato `openapi/`:** el plan de la spec lo pedía para toda Edge Function, pero la implementación no
lo agregó (desvío de T001, anotado en `tasks.md`): la función no es una API pública —no recibe parámetros y
solo la invoca el propio panel—, así que el contrato quedó en esta página y en `docs/tecnico/api.md`. Si
alguna vez se expone fuera del panel, hay que declarar `openapi/cotizacion-sugerida.json`.

### Frontend

| Pieza | Archivo | Qué hace |
|---|---|---|
| Hook de la sugerencia | `apps/web/src/hooks/useCotizacionSugerida.ts` | Pide la sugerencia **una vez** cuando el diálogo está abierto y todavía no hay una carga pendiente (`abierto && !carga`). Estados: `cargando`, `lista`, `no_disponible`. Si falla, queda `no_disponible`: nunca bloquea ni lanza. |
| Guarda de forma | `apps/web/src/lib/cotizacion.ts` | `esCotizacionSugerida` valida `{ valor > 0, fuente texto, fecha texto o null }`; `textoDeCotizacionSugerida` convierte el número al formato del campo (coma decimal). |
| Sugerencia en el diálogo | `apps/web/src/components/cotizacion/DialogoCargarDolar.tsx` | Componente `SugerenciaDelDia`: «Buscando la cotización sugerida…», la leyenda con el valor/fuente/fecha y **Usar este valor**, o el aviso de fuente caída. |

La sugerencia **no depende de la empresa activa**: la Edge Function no recibe empresa y el valor es el
mismo dólar oficial para todo el negocio. Lo que sí depende de la configuración de MSF-352 es **con qué
valor se carga y a quién aplica** (`sistema` o `por empresa`), no la sugerencia. Hay pruebas del hook y
del diálogo; **no** hay una prueba específica de «cambio de empresa» porque no hay nada que reencuadrar
(anotado como desvío en `tasks.md`, T003).

### Datos (Principio VII)

**Sin cambios de esquema.** No hay tabla, columna, migración, RPC ni policy nueva: la sugerencia es una
lectura efímera de una fuente pública y no se persiste. Por eso **no hay DER que actualizar** en
[Datos y DER](datos.md). La única migración relevante sigue siendo la de MSF-116
(`supabase/migrations/2026102314*.sql`) para la carga y la confirmación del dólar.

### Operación y despliegue

- **Función nueva:** en desarrollo, el runtime de Supabase no la registra hasta recrear el stack; si no,
  el navegador recibe `Function not found`. Hay que reiniciar el entorno local (`pnpm dev:supabase`) o
  redesplegar la función.
- **Salida a internet:** el servidor que ejecuta la Edge Function necesita resolver y alcanzar
  `dolarapi.com`. Si la red lo bloquea, la sugerencia cae en `no_disponible` y la carga manual sigue.
- **Cambiar la fuente o el tipo de dólar** (blue, MEP, otra fuente) es cambiar `FUENTE_URL` y
  `FUENTE_NOMBRE` en el código y volver a desplegar: no hay configuración desde la pantalla.
- **Prueba de la función:** `pnpm test:edge:cotizacion-sugerida` (script agregado en `package.json`, que
  además entra en `pnpm test:web`).

## Qué no se construyó: F-PRE-14 (listas mayoristas)

**No hay código, requisitos, pantalla, migración ni RPC.** La épica solo dice «existe una lista de precios
para revendedores» y deja abiertas la definición de «revendedor» y la relación con clientes registrados y
la cuenta web del cliente (MSF-180 y MSF-237). `FR-003` quedó **reservado**.

El conflicto de fondo está sin resolver: **F-PRE-14 choca con F-PRE-15** (escalas por tipo de cliente,
P0, ya implementada en [Precios e IVA](precios-e-iva.md), spec `20261022-120000-precios-e-iva`).

Lo que existe hoy para mayoristas:

| Pieza | Dónde | Qué hace |
|---|---|---|
| Escalas de precio del producto | `dominio.producto_precios_escala`, migración `20261022150000_producto_precios_escala.sql` | Precios sin IVA para x5, x10 y x50; x1 es el precio de lista. |
| Cálculo por escala | `private.precio_para`, migración `20261022150100_precio_para.sql` | Resuelve la escala pedida y cae al precio de lista si no tiene precio. |
| Tipo de cliente | `public.clientes.tipo` (`minorista` / `mayorista`), migración `20261016130300_clientes_tipo_y_consumidor_final.sql` | La ficha del cliente define el tipo. |
| Contrato de escala | `public.escala_de_cliente`, misma migración | Devuelve `x1` para minorista y `por_cantidad` para mayorista. Es una **regla provisoria**. |
| Pantalla del prototipo | `design/pantallas/TiposCliente.dc.html` | «Administración · Tipos de cliente (escalas de precio)», de **F-PRE-15 (MSF-114)**. No es de esta épica. |

En resumen: el precio del revendedor **se arma con el tipo de cliente y las escalas por cantidad de cada
producto**, no con una «lista de precios» separada. Si el negocio necesita listas propias por revendedor,
eso es exactamente lo que F-PRE-14 tendría que definir y hoy no está definido.

## Desvíos de la implementación

Anotados en `tasks.md` de la spec (rama de la épica) y con su evidencia en el commit `c8337d74`:

| Tarea | Desvío | Por qué |
|---|---|---|
| T001 | Sin `openapi/cotizacion-sugerida.json` | La función no es API pública: no recibe parámetros y solo la invoca el panel. El contrato quedó en esta página y en [API y RPC](api.md). |
| T002 | La sugerencia **no tiene diseño visual propio** | No figura en el prototipo (`Cotizacion.dc.html`): se usó lo más cercano del sistema de diseño (texto `xs` y botón de texto, regla de fuentes 5). |
| T003 | **Sin** prueba de «cambio de empresa» | La sugerencia no depende de la empresa: la función no recibe empresa y el valor es el mismo para toda la organización. |

## Decisiones abiertas (de la spec, sin resolver)

| # | Pregunta | Estado |
|---|---|---|
| 1 | Fuente y tipo de dólar (oficial, blue, MEP…) | **Resuelta de forma provisoria:** DolarApi, dólar oficial venta. Confirmar con el cliente. |
| 2 | ¿F-PRE-14 sigue siendo necesaria o se cancela/redefine frente a F-PRE-15? | Abierta. |
| 3 | Modelo comercial mayorista: qué es un revendedor, quién ve la lista y cómo se arma | Abierta. |
| 4 | Hito y horas (M + L ≈ 24 h por talla) | Abierta. |
| 5 | Orden con MSF-116 | Resuelta: MSF-116 ya está en `dokploy` y F-PRE-13 se apoyó en ella. |

## Guía de prueba

### Prerrequisitos

- **Local:** `pnpm dev:supabase` con las Edge Functions levantadas y la web servida
  (`pnpm dev:refine:host`). Recreá el stack si la función es nueva; si no, el navegador recibe
  `Function not found`.
- **Salida a internet:** el runtime de Supabase local necesita llegar a `dolarapi.com`. Sin salida, el
  camino de fuente caída es el que se puede probar.
- **Persona:** un usuario con **edición** en la sección **Cotización del dólar** (hoy, el Administrador).
  Un usuario de solo lectura sirve para comprobar el `403`.
- **Datos:** no hace falta sembrar nada; la pantalla muestra la cotización vigente que ya tenga la
  organización.

### Pasos (a mano)

1. Entrá como Administrador y abrí **Administración → Cotización del dólar**. **Se ve** la tarjeta
   **Vigente** y el botón **Cargar cotización** (o **Cargar ahora** en el aviso).
2. Hacé clic en **Cargar cotización**. **Se ve** el diálogo «Cargar dólar del día» y, debajo del campo,
   primero «Buscando la cotización sugerida…» y luego una de estas dos cosas:
   - **Con fuente disponible:** «Sugerida: $ … por USD · DolarApi (dólar oficial, venta) · actualizada el
     …» y el botón **Usar este valor**.
   - **Sin fuente:** «No pudimos consultar la cotización sugerida. Cargá el valor a mano.»
3. Con la sugerencia visible, hacé clic en **Usar este valor**. **Se ve** que el campo
   **Dólar del día (pesos por dólar)** se completa con el valor (coma decimal) y que la **Variación** contra
   el valor anterior se actualiza. **No** se cargó nada todavía.
4. Cambiá el valor a mano por otro (por ejemplo, 1.490) y seguí el flujo normal: **Cargar dólar** →
   **Qué va a cambiar** → **Aplicar y recalcular**. **Se ve** que la sugerencia no alteró la carga ni la
   confirmación: es la misma de [Cargar la cotización del día](../producto/precios-dolar.md).
5. Cerrá el diálogo con **Cancelar** y volvé a abrirlo. **Se ve** que la sugerencia se consulta de nuevo
   (no quedó guardada) y que el campo arranca vacío.
6. Con un usuario **sin** edición del dólar, abrí la pantalla e intentá cargar. **Se ve** que la base
   rechaza la carga («Tu rol no puede cargar la cotización del dólar.») y que la Edge Function responde
   `403`: no se consulta la fuente.
7. Cortá la salida a internet del runtime (o apuntá `FUENTE_URL` a un host inalcanzable en un entorno de
   prueba) y abrí el diálogo. **Se ve** el aviso de fuente caída y la carga manual sigue funcionando.

### Resultado esperado

- **Given** un administrador con edición del dólar y la fuente disponible, **When** abre «Cargar dólar del
  día», **Then** ve el valor sugerido con su fuente y fecha.
- **Given** la sugerencia visible, **When** hace clic en **Usar este valor**, **Then** el campo se completa
  y no se carga, confirma ni recalcula nada.
- **Given** la fuente caída, **When** abre el diálogo, **Then** ve el aviso y puede cargar el valor a mano
  como siempre.
- **Given** un usuario sin edición del dólar, **When** invoca la función, **Then** recibe `403` y la fuente
  no se consulta.
- **Given** una respuesta de la fuente inválida (sin `venta` numérica o fuera de rango), **Then** la función
  responde `502` y el diálogo cae en «cargá el valor a mano».

### Cómo automatizarlo

| Recorrido | Rótulo | Prueba |
|---|---|---|
| Función: valor, redondeo, fecha ausente, sin sesión, sin edición, permiso no resoluble, fuente caída, respuesta inválida, método y preflight | `[MSF-373:T001]` | `supabase/functions/cotizacion-sugerida/handler.test.ts` (9 pruebas, `node --test`; script `test:edge:cotizacion-sugerida`) |
| Diálogo: muestra la sugerencia, «Usar este valor» solo completa el campo, fuente caída y carga manual, estado «buscando» | `[MSF-373:T002]` `[MSF-373:T003]` | `apps/web/src/components/cotizacion/DialogoCargarDolar.test.tsx` (bloque «cotización sugerida (F-PRE-13)») |
| Hook: `lista`, `no_disponible` con error/dato inválido/excepción, y que no consulte si está deshabilitado | `[MSF-373:T003]` | `apps/web/src/hooks/useCotizacionSugerida.test.tsx` |
| Documentación y roadmap | `[MSF-373:T004]` | Esta página y la fila del roadmap |

**Pendiente de automatizar:** no hay E2E de la sugerencia. Un recorrido E2E que abra el diálogo, compruebe
la leyenda y use **Usar este valor** se rotularía `[MSF-373:T003]`, pero hoy no existe. **Sin video.**

## Seguridad

Pasó revisión independiente de QA y de Código + Seguridad (según el mensaje del commit `c8337d74`). Los
puntos que sostienen el diseño:

- **Sin `service-role` ni secretos:** la función usa la clave anónima con el JWT de quien llama y respeta
  RLS/permisos.
- **URL fija:** la fuente es una constante del servidor; el navegador no manda URLs ni parámetros a la
  consulta, así que no hay SSRF.
- **Validación estricta:** solo `POST`, respuesta con `venta` numérica en rango y fecha opcional válida;
  cualquier otra cosa es `502`.
- **Sin escritura:** no crea filas, no toca precios y no requiere RLS nueva.

## Reversión

No hay migración. La reversión es de código: quitar la Edge Function `supabase/functions/cotizacion-sugerida`
(y su script `test:edge:cotizacion-sugerida`), el hook `useCotizacionSugerida`, la leyenda `SugerenciaDelDia`
del diálogo y sus pruebas. A nivel de épica, el cierre es un merge commit: `git revert -m 1 <hash>` deshace
la entrega completa.

## Pendientes y deudas (con dueño)

- **TODO (dueño: responsable de la épica):** confirmar con el cliente la Pregunta 1 (DolarApi, dólar oficial
  venta) y definir si F-PRE-14 sigue siendo necesaria o se cancela/redefine frente a F-PRE-15 (Preguntas 2
  y 3).
- **TODO (dueño: Documentador):** capturar el diálogo «Cargar dólar del día» con la sugerencia en
  `docs/producto/img/precios-dolar/`. La herramienta del manual (`pnpm docs:capturas`,
  `apps/web/e2e/capturas/`) **no existe en este repo**; lo más cercano es
  `pnpm --filter @platform/web pantallas:capturar`, que renderiza el prototipo, y la sugerencia **no figura**
  en el prototipo. Hasta entonces la página de producto describe el comportamiento **sin imágenes nuevas**:
  no se inventó ninguna.
- **TODO (dueño: quien implemente la prueba):** E2E de la sugerencia, rotulada `[MSF-373:T003]`, pendiente de
  automatizar.

## Ver también

- [Dólar y recálculo](dolar-y-recalculo.md) — la carga, la vista previa y la confirmación que la sugerencia
  solo alimenta.
- [Configuración del dólar y precio propio](configuracion-dolar-y-precio-propio.md) — alcance (sistema o
  empresa), umbral, redondeo y aviso.
- [Precios e IVA](precios-e-iva.md) — escalas por cantidad y tipo de cliente, el mecanismo que hoy cubre al
  mayorista.
- [Clientes](clientes.md) — el tipo minorista/mayorista.
- Manual: [Cargar la cotización del dólar](../producto/precios-dolar.md) y
  [Precios, escalas e IVA](../producto/precios-e-iva.md).
