# Bug Fix: la tienda pública no define su propia regla de inactividad de sesión (hereda la del panel)

- **Slug**: msf-740
- **Fixed**: 2026-11-14 (sin cambios de código: la historia queda bloqueada a la espera de la decisión de producto)
- **Assessment**: ./assessment.md
- **Status**: not-applied

## Summary

MSF-740 no pide un arreglo: pide **decidir** si la tienda pública tiene su propia regla de inactividad de sesión. La
decisión es de producto (preguntas 1 y 2 del CTO, sin respuesta a la fecha) y las tres opciones cambian el
comportamiento observable de la sesión de los clientes, así que elegir una sin respuesta sería inventar alcance. Por
eso **no se tocó código**: la historia queda `Blocked` y este informe deja la decisión escrita, con la evidencia del
recorrido vigente y el costo exacto de cada opción.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/main.tsx` | sin cambios | El control de vencimiento se instala para todo host; la rama de tienda (líneas 34–42) cierra la sesión local y vuelve a `/`. Queda así hasta que Nicolás decida. |
| `apps/web/src/lib/vencimientoSesion.ts` | sin cambios | Ventana única de 12 h (`INACTIVIDAD_MAXIMA_MS`, línea 4) compartida con el panel. |
| `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` | sin cambios | Fija el comportamiento vigente (destino `/`, sin `/login`, sin revocación global). |
| `docs/tiendas-online.md`, `docs/acceso-ingreso.md` | sin cambios | Documentan el comportamiento vigente; se actualizan con la decisión, no antes. |
| `.specify/bugs/msf-740/assessment.md` | added | Evaluación del bug (síntoma, reproducción, causa, alternativas). |
| `.specify/bugs/msf-740/fix.md` | added | Este informe: la decisión pendiente, con opciones, costos y evidencia. |
| `.specify/bugs/msf-740/test.md` | added | No hay nada que validar: no se aplicó ningún cambio. |

## Estado vigente (evidencia)

| Dato | Dónde |
|---|---|
| El control de vencimiento corre en **todo** host | `apps/web/src/main.tsx:34` |
| En host de tienda: cierre **local** (`salirCliente`) + vuelta a `/` | `apps/web/src/main.tsx:37-39` |
| Ventana de 12 h, constante única compartida con el panel | `apps/web/src/lib/vencimientoSesion.ts:4` |
| La marca `sesion:ultima-actividad` se escribe en cada clic, **aunque no haya sesión** | `apps/web/src/lib/vencimientoSesion.ts:10-12` y `:31-42` |
| Solo `esHostDeTienda` separa panel de tienda | `apps/web/src/lib/tienda.ts:35` |
| El cierre de la tienda es local (`signOut({ scope: 'local' })`) | `apps/web/src/lib/tiendaCuenta.ts:34-38` y `:75-77` |
| El ingreso de la tienda **no** ofrece «Mantener la sesión» | `apps/web/src/pages/tienda-publica/rutas/ingresar.tsx` (no tiene la casilla) |
| La preferencia «mantener sesión» solo la fija el ingreso del panel | `apps/web/src/lib/supabase.ts:54-72` |
| El E2E fija el comportamiento vigente | `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` |
| La documentación describe el comportamiento vigente | `docs/tiendas-online.md:155-158`, `docs/acceso-ingreso.md:160` |

Consecuencias observables (las mismas del `assessment.md`): el visitante anónimo, que nunca tuvo sesión, ve un
cierre de sesión local fallido (`console.error` en `apps/web/src/lib/tiendaCuenta.ts:37`) y una navegación dura a `/`
al volver tras 12 h; el cliente con sesión abierta pierde su sesión local **sin aviso** y no tiene «mantener
sesión» para evitarlo.

## La decisión que falta

CTO, 2026-11-14: «🔒 BLOQUEADO — esto no es un bug para aprobar: es una decisión de producto para Nicolás» y «Si no
hay respuesta: la tarea queda en `Blocked`, no se abre spec ni se implementa nada — no se asume ningún
comportamiento nuevo sobre la sesión de clientes».

**Pregunta 1 — ¿La tienda pública necesita su propia regla de expiración por inactividad?**

- **(a) Sí, igual que el panel**: 12 h, redirección propia a `/ingresar` (no a `/login`).
- **(b) Sí, pero con otro criterio**: indicar las horas y si lleva «mantener sesión».
- **(c) No**: la sesión del cliente termina solo por salida explícita o por el tope de 30 días del servidor
  (`[auth.sessions] timebox = 720h`).

**Pregunta 2 — Si (a) o (b): ¿la tienda muestra la opción «mantener sesión» en su login, como el panel?**

- **(a) Sí** · **(b) No**

## Costo de cada opción (para decidir con los números a la vista)

| Opción | Cambios | ¿Migración? |
|---|---|---|
| (a) 12 h + `/ingresar` | `main.tsx` (destino de la rama de tienda), `vencimientoSesion.ts` (constante propia de la tienda si se separa del panel), E2E (destino `/ingresar` y ausencia de `/login`), `docs/tiendas-online.md`, `docs/acceso-ingreso.md` | No |
| (b) criterio propio | lo de (a) + la casilla «mantener sesión» en `ingresar.tsx` y `lib/supabase.ts` (`setMantenerSesion`) + E2E | No, **salvo** que la ventana sea por tienda: eso exige columna en `dominio.tiendas`, RLS, lectura por `publico.tienda_por_dominio` y pgTAP → deja de ser un fix y pasa a ser funcionalidad con spec de Spec Kit |
| (c) sin regla propia | `main.tsx` (no instalar `seguirActividad` en host de tienda), `vencimientoSesion.ts` (no escribir la marca en la tienda), E2E (cambiar la aserción de destino `/`), `docs/tiendas-online.md`, `docs/acceso-ingreso.md` y corregir la nota de `data/aprendizaje/MSF.jsonl` | No |

En las tres opciones el panel no cambia: FR-009 / S4 de `specs/20261012-140000-acceso-y-organizacion/spec.md` sigue
siendo 12 h con `/login`. Ninguna opción cambia el tope de 30 días del servidor.

## Recomendación (NO aplicada)

La de `assessment.md`: **(c) con el daño colateral corregido** — la tienda hereda la ventana de 12 h pero solo la
aplica si hay sesión de cliente; el visitante anónimo no ve ni cierre de sesión ni redirección, y el cliente con
sesión conserva el cierre local y la vuelta a `/`. Es la lectura más cercana a la decisión de MSF-673 ya APROBADA
(«instalar `seguirActividad` solo cuando el host NO es de tienda pública») y no cambia el esquema ni la
configuración. **Queda a decisión de Nicolás**: implementarla sin respuesta sería asumir un comportamiento de sesión
no aprobado.

## Deviations from Assessment

- No se aplicó la remediación propuesta (ni la preferida ni las alternativas): `assessment.md` deja la regla de la
  tienda como `[NEEDS CLARIFICATION]` y el CTO dejó la historia bloqueada. `assessment.md` no se modificó.

## Follow-ups

- **Desbloqueo**: responder las dos preguntas de «La decisión que falta». Con la respuesta, la implementación es un
  cambio acotado (no hace falta migración salvo que la ventana sea por tienda) y este `test.md` se completa con la
  reproducción y los tests.
- **Trazabilidad en el tracker**: dejar la decisión registrada en MSF-740/MSF-515 (la épica donde quedó re-parentado
  el `seguimiento`) y corregir la nota de aprendizaje que afirma que «una sesión de cliente de la tienda no vence por
  inactividad» (hoy sí vence a nivel local, a las 12 h, por MSF-700).
- **Dueño**: MSF-237 / F-CLI-06 (cuenta web del cliente), según `.specify/bugs/msf-673/fix.md`.
- **Tareas de la épica**: `specs/20270323-100000-deuda-tecnica-lote-1-seguridad-tienda/tasks.md` no tiene ninguna
  tarea de MSF-740; la decisión debería quedar como tarea del lote siguiente cuando se responda.
