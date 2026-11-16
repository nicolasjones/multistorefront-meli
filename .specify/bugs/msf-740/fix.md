# Bug Fix: la tienda pública hereda la regla de inactividad de sesión del panel

- **Slug**: msf-740
- **Fixed**: 2026-11-16
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

MSF-740 pedía **decidir** si la tienda pública tiene su propia regla de inactividad de sesión. La decisión ya
estaba escrita en el tracker y el código era el que se apartaba de ella: el alcance aprobado de MSF-673 dice
textualmente «instalar el seguimiento de inactividad (`seguirActividad`) solo cuando el host NO es de tienda
pública», y la nota de aprendizaje del tracker afirma que «una sesión de cliente de la tienda no vence por
inactividad». MSF-700 lo implementó a medias (la tienda heredaba la ventana de 12 h: cerraba la sesión local y
volvía a `/`, sin avisar, y en bucle de recargas).

**Decisión aplicada: opción (c) — la tienda pública NO tiene regla propia.** La sesión de un cliente con cuenta
web termina solo por salida explícita («Salir» de la tienda, cierre local) o por el tope de 30 días del servidor
(`[auth.sessions] timebox = 720h`). El visitante anónimo no ve cierre de sesión ni redirección, y la tienda
nunca manda a `/login` (no lo tiene: su ingreso es `/ingresar`).

Las opciones con regla propia (12 h con redirección a `/ingresar`, otra ventana, «mantener sesión») serían una
decisión de producto **nueva** y, si la ventana fuera por tienda, funcionalidad nueva (spec de Spec Kit con DER
y RLS): quedan documentadas como el camino a seguir, no implementadas.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/lib/arranqueSesion.ts` | added | La regla, en un módulo verificable: en un host de tienda **no** se instala el control de inactividad; en el panel, 12 h sin actividad → `authProvider.logout` (cierre global) → `/login`. El módulo devuelve el aviso para dejar de escuchar (lo usa el test). |
| `apps/web/src/main.tsx` | modified | El arranque delega la decisión (`instalarVencimientoDeSesion(esTiendaPublica)`) y desaparece la rama de tienda (cierre local + `assign('/')`). Se fueron los imports de `seguirActividad`, `authProvider` y `salirCliente`, que quedaron sin uso. |
| `apps/web/src/lib/arranqueSesion.test.ts` | added | Vitest de las dos ramas (4 casos). Detecta el cambio de regla: si la tienda vuelve a instalar el control, fallan. |
| `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` | modified | El caso afirmaba el destino `/` de la tienda (MSF-700). Ahora afirma que el visitante que vuelve tras 13 h **no** sale de la página, que no hay pedido a `/auth/v1/logout` (ni local ni global) y que no aparece el 404 de `/login` (se conservan las garantías de MSF-673). Rótulo `[MSF-740:MSF-740]`. |
| `docs/tiendas-online.md`, `docs/acceso-ingreso.md`, `docs/e2e-app.md` | modified | La regla vigente de la tienda (no hay) y el recorrido E2E. |
| `specs/20270323-100000-deuda-tecnica-lote-1-seguridad-tienda/spec.md` | modified | Decisión D-11 (la regla de la tienda) y el punto de «Fuera de alcance / seguimientos» (la variante con regla propia). |
| `.specify/bugs/msf-740/assessment.md` | updated | La evaluación del bug: la decisión, su fuente en el tracker y el código aplicado. |
| `.specify/bugs/msf-740/test.md` | updated | Qué se validó y con qué evidencia. |

Sin migraciones: no hay cambios de esquema, RPC ni datos. Sin cambios en el panel (FR-009 / S4 intacto).

## Estado antes → después

| | Antes (MSF-700) | Después (MSF-740) |
|---|---|---|
| Regla de inactividad en la tienda | heredada del panel (12 h) | ninguna: la sesión termina por salida explícita o por el tope de 30 días del servidor |
| Visitante anónimo tras 12 h | cierre local sin efecto + recarga a `/` (y cada clic repetía la recarga) | nada: sigue en la página en la que estaba |
| Cliente con sesión tras 12 h | sesión local cerrada en silencio y vuelta a `/` | conserva la sesión (la corta el «Salir» de la tienda) |
| Marca `sesion:ultima-actividad` en la tienda | se escribía en cada clic | no se escribe (el control no está instalado) |
| Panel | 12 h → cierre global → `/login` | igual (sin cambios) |

## Decisiones

- **Opción (c)**: no es una decisión nueva del desarrollador, es la que ya estaba escrita en el tracker (alcance
  aprobado de MSF-673 + la nota de aprendizaje + la descripción de este ítem). Implementar (a), (b) o (d) sí
  habría inventado el comportamiento de sesión de los clientes, que el CTO reservó para Nicolás.
- **Riesgo aceptado**: en un equipo compartido la sesión de un cliente de la tienda sigue viva hasta que se
  cierra la pestaña (la sesión de la tienda vive en `sessionStorage`: su ingreso no ofrece «Mantener la sesión»,
  que solo existe en el panel) o hasta el tope de 30 días del servidor. Mitigaciones: la cuenta web no da acceso
  al panel (no hay fila en `usuarios_organizacion`), el cierre de la tienda es local y hay «Salir» en el
  encabezado, y el panel conserva sus 12 h.
- **Sin «Mantener la sesión» en la tienda**: el prototipo del ingreso de la tienda no muestra la casilla (el del
  panel sí) y el prototipo manda la UI: agregarla sería una pantalla nueva, con su spec.
- **Sin ventana por tienda**: exigiría columna en `dominio.tiendas`, RLS, lectura por `publico.tienda_por_dominio`
  y pgTAP → deja de ser un fix y pasa a ser funcionalidad con spec de Spec Kit.

## Tests Added or Updated

- `apps/web/src/lib/arranqueSesion.test.ts` (nuevo, 4 casos): en la tienda, tras 12 h, el clic no cierra la
  sesión ni navega y no se escribe la marca de actividad; en el panel, tras 12 h, el clic cierra la sesión y
  vuelve a `/login`, y la actividad reciente renueva la marca.
- `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` (actualizado): el visitante que vuelve tras 13 h no sale de la
  página, no hay cierre de sesión (ni local ni global) y no aparece el 404 de `/login`.

## Follow-ups

- **Si el producto quiere una regla propia para la tienda** (otra ventana, redirección a `/ingresar`, casilla
  «Mantener la sesión»): es funcionalidad nueva → spec de Spec Kit con `## Modelo de datos (DER)`, RLS y
  documentación; si la ventana fuera por tienda, también una pantalla de configuración. Dueño: MSF-515 (la
  épica de deuda donde quedó re-parentado el `seguimiento`).
- **Trazabilidad en el tracker**: dejar la decisión escrita en MSF-740/MSF-515 y corregir la nota de
  aprendizaje que hoy dice lo contrario («una sesión de cliente de la tienda no vence por inactividad»): con este
  cambio vuelve a ser cierto.
- **Dueño**: MSF-740 / MSF-515 (la épica de deuda donde quedó re-parentado el `seguimiento`: un `seguimiento` de
  review nunca cuelga de la épica origen). MSF-237 / F-CLI-06 queda como la historia de la cuenta web del
  cliente, no como dueña de esta decisión.
- **Tareas de la épica**: `specs/20270323-100000-deuda-tecnica-lote-1-seguridad-tienda/tasks.md` no tiene ninguna
  tarea de MSF-740 (la decisión y el arreglo quedan en este PR y en D-11 de la spec de la épica).
