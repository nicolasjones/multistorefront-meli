# Bug Fix: la tienda pública manda al visitante a `/login` (404) y le cierra la sesión tras 12 h

- **Slug**: msf-673
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El control de vencimiento de sesión por inactividad (12 h) es del panel, pero `main.tsx` lo
instalaba en todos los hosts: en una tienda, el primer clic de un visitante que volvía al día
siguiente veía la marca vencida y disparaba `logout` + `window.location.assign('/login')`, ruta
que la tienda no tiene (su ingreso es `/ingresar`) → «No encontramos esta página». Ahora el arranque
decide **por el host**: en un host de tienda no se registra la marca de actividad ni se cierra la
sesión; en el panel el comportamiento queda idéntico.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/lib/arranque.ts` | added | `instalarVencimientoDeSesion(host, alVencer)`: resuelve el host con `esHostDeTienda` y delega la política. Módulo propio para no crear un ciclo de imports (`vencimientoSesion` → `tienda` → `supabase` → `vencimientoSesion` dejaría `CLAVE_MANTENER_SESION` en TDZ al cargar). |
| `apps/web/src/main.tsx` | modified | Calcula el host antes de instalar el control y llama a `instalarVencimientoDeSesion(host, …, panel)`: `hostsDelPanel()` se resuelve una sola vez y el mismo conjunto de hosts decide si el host es de tienda y si se instala el control. La guarda `cerrando` (evita varios `signOut` concurrentes) queda igual. |
| `apps/web/src/lib/vencimientoSesion.ts` | modified | Nueva `seguirActividadDelPanel(esTiendaPublica, alVencer)`: en tienda no instala el control (ni escribe la marca); en el panel, `seguirActividad` como antes. |
| `apps/web/src/lib/vencimientoSesion.test.ts` | modified | Tests `[MSF-673]` de la política: en tienda no avisa ni renueva la marca; en el panel sigue venciendo. |
| `apps/web/src/lib/arranque.test.ts` | added | Tests `[MSF-673]` del **cableado** (lo que pedía la evaluación): host de tienda → no hay control, no se avisa y la marca no se toca; host del panel → avisa una sola vez tras 13 h; con actividad reciente renueva sin avisar. |
| `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` | added | E2E `[MSF-673:MSF-673]` con el fixture de evidencia (video 1920×1080): adelanta la marca 13 h, hace el primer clic y comprueba que no hay navegación a `/login`, ni 404 de la tienda, ni pedido de logout a Auth. |
| `docs/tiendas-online.md` | modified | Documenta que el vencimiento por inactividad es solo del panel y qué pruebas lo cubren. |
| `docs/acceso-ingreso.md` | modified | Aclara que las 12 h (cliente) y los 30 días (servidor) rigen solo en el panel y qué pasa con la cuenta web del cliente en la tienda. |
| `docs/e2e-app.md` | modified | Agrega el recorrido nuevo a la tabla de cobertura E2E. |

## Diff Highlights

```ts
// apps/web/src/lib/arranque.ts
export function instalarVencimientoDeSesion(host: string, alVencer?: () => void, panel = hostsDelPanel()) {
  return seguirActividadDelPanel(esHostDeTienda(host, panel), alVencer)
}
```

```ts
// apps/web/src/main.tsx
const host = window.location.host
const panel = hostsDelPanel()
const esTiendaPublica = esHostDeTienda(host, panel)

let cerrando = false
instalarVencimientoDeSesion(
  host,
  () => {
    if (cerrando) return
    cerrando = true
    void authProvider.logout?.({}).finally(() => window.location.assign('/login'))
  },
  panel,
)
```

## Tests Added or Updated

- `apps/web/src/lib/arranque.test.ts::[MSF-673] en un host de tienda no registra actividad ni avisa del vencimiento`
- `apps/web/src/lib/arranque.test.ts::[MSF-673] en un host del panel avisa del vencimiento tras más de 12 h`
- `apps/web/src/lib/arranque.test.ts::[MSF-673] en un host del panel con actividad reciente renueva la marca sin avisar`
- `apps/web/src/lib/vencimientoSesion.test.ts::[MSF-673] en una tienda pública no registra marca ni avisa aunque hayan pasado >12 h`
- `apps/web/src/lib/vencimientoSesion.test.ts::[MSF-673] en el panel sigue venciendo la sesión tras >12 h`
- `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts::[MSF-673:MSF-673] en la tienda, tras más de 12 h sin actividad el primer clic no manda a /login ni cierra la sesión`

## Local Verification

- `pnpm --filter @platform/web exec vitest run src/lib/arranque.test.ts src/lib/vencimientoSesion.test.ts src/lib/tienda.test.ts` → **30 tests OK** (3 archivos).
- `VITE_PANEL_HOSTS=localhost,127.0.0.1 pnpm --filter @platform/web build` (`tsc -b && vite build`) → **OK**, sin errores de tipos.
- `pnpm lint` (oxlint) → **0 errores** (los avisos de `set-state-in-effect` son preexistentes en archivos que este cambio no toca; oxlint sobre los archivos de este cambio no reporta nada).
- E2E: `WEB_PORT=4399 pnpm --filter @platform/web exec playwright test e2e/tienda-sesion-vencimiento.e2e.ts` → **1 passed** contra `vite preview` con `VITE_PANEL_HOSTS=localhost,127.0.0.1`.
- E2E como prueba de regresión: reintroduciendo el defecto (`main.tsx` vuelve a llamar `seguirActividad` en todos los hosts) el mismo test **falla** (`redirigio` = `true`: el clic navega a `/login`); con el arreglo pasa.
- E2E sin `VITE_PANEL_HOSTS` en el build → **1 skipped** (el host no se sirve como tienda y el caso no aplica): el test no da falso rojo en un build sin la variable.

## Deviations from Assessment

- **Archivos**: la evaluación preveía `main.tsx`, `vencimientoSesion.test.ts` (o un test nuevo del
  arranque) y `docs/tiendas-online.md`. Se agregaron `apps/web/src/lib/arranque.ts` y su test
  (la evaluación pedía «extraer el arranque a una función testeable»: la decisión por host no podía
  vivir en `vencimientoSesion.ts` sin crear el ciclo de imports descrito arriba), el E2E (el síntoma
  es de pantalla: redirección a una 404) y `docs/acceso-ingreso.md` + `docs/e2e-app.md` (la regla
  de las 12 h se documenta en la guía de acceso y el recorrido nuevo en la cobertura E2E).
- **Pregunta abierta de la evaluación** («¿el visitante llega a tener sesión de Supabase en la
  tienda?»): sí — la cuenta web del cliente (F-CLI-06, MSF-428) ingresa con el mismo Auth en el
  dominio de la tienda (`lib/tiendaCuenta.ts`). Con este arreglo esa sesión **no** la cierra la regla
  de inactividad del panel: queda vigente hasta que el cliente sale o hasta el tope de 30 días del
  servidor. Es el comportamiento que corresponde al alcance de este bug (la tienda no tiene
  `/login`); queda anotado como seguimiento abajo, con dueño, por si el producto quiere una regla
  propia para la tienda.

## Follow-ups

- **Tarea `seguimiento` MSF-740 en It's a Plan** (creada; dueño: épica MSF-237 / F-CLI-06,
  cuenta web del cliente): decidir si la tienda quiere su propia regla de inactividad. Si la quiere,
  necesita su propio camino (redirección a `/ingresar`, no a `/login`) y su propio criterio
  (12 h, «mantener sesión», cierre de sesión propio de la tienda). Hasta ese momento, en la tienda
  la sesión solo termina por salida explícita o por el tope de 30 días del servidor.
- El cierre de sesión del panel sigue yendo a `/login`: en el panel esa ruta existe
  (`apps/web/src/App.tsx`), así que no se toca.
