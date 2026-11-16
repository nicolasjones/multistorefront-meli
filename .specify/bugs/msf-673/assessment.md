# Bug Assessment: Tienda pública cierra sesión y redirige a /login (404) tras >12 h

- **Slug**: msf-673
- **Created**: 2026-11-01
- **Source**: pasted text (MSF-673, It's a Plan)
- **Verdict**: valid
- **Severity**: high

## Report (summarized)

[Bug] Tienda pública: el primer clic de un visitante que vuelve tras más de 12 h lo manda a `/login` (404) y le cierra la sesión.

## Symptom

En una tienda online (host que no es del panel), un visitante que ya había hecho clic/teclear y vuelve pasadas más de 12 h, al primer clic es redirigido a `/login` (que en la tienda no existe → 404) y se ejecuta un `logout`. Esperado: la tienda pública no tiene sesión ni vencimiento por inactividad; el clic debe funcionar normalmente.

## Reproduction

1. Abrir `https://<dominio-tienda>/` (host fuera de `VITE_PANEL_HOSTS`) y hacer un clic (se escribe `sesion:ultima-actividad` en localStorage del dominio de la tienda).
2. Esperar >12 h (o fijar esa clave a `Date.now() - 13h`) y volver a la pestaña / recargar.
3. Hacer el primer clic o pulsar una tecla → `window.location.assign('/login')` → 404 de la tienda.

## Suspected Code Paths

- `apps/web/src/main.tsx:16-20` — `seguirActividad(...)` se instala incondicionalmente, ANTES de decidir `esTiendaPublica` (líneas ~27-28). El callback `alVencer` hace `authProvider.logout()` y `assign('/login')`.
- `apps/web/src/lib/vencimientoSesion.ts:31-47` — `seguirActividad` escribe la marca en cada `pointerdown`/`keydown` (también en la tienda, sin sesión alguna) y en el siguiente evento tras 12 h `sesionVencidaPorInactividad` devuelve true → `alVencer`.
- `apps/web/src/lib/vencimientoSesion.ts:18-21` — la lógica de vencimiento no sabe si existe sesión.
- `apps/web/src/lib/tienda.ts:35` — `esHostDeTienda`, disponible para decidir.

## Root Cause Hypothesis

El vencimiento por inactividad (spec 20261012-140000, FR-009) es del panel, pero `main.tsx` lo registra para todos los hosts. En el host de una tienda el visitante no tiene sesión, pero el listener igualmente guarda la marca de actividad en cada clic; al volver tras >12 h el primer evento la ve vencida y dispara el logout + redirección a `/login`, ruta inexistente en el front público (404). Confianza: alta (lectura directa del código; no ejecutado).

## Proposed Remediation

**Preferred**: en `main.tsx` calcular `host`/`esTiendaPublica` antes y registrar `seguirActividad` solo cuando `!esTiendaPublica`. Así la tienda no escribe la marca ni dispara logout.

**Alternativas**:
- Condicionar `alVencer` a que exista sesión real (`supabase.auth.getSession()`) — más robusto si el panel y una tienda compartieran origen, pero asíncrono y no evita escribir la marca en la tienda.
- Mover la decisión a `seguirActividad` (parámetro `habilitado`) — mismo efecto, más superficie.

Adicional (opcional, mismo cambio): como las claves `sesion:*` pueden haber quedado en localStorage de visitantes existentes, con el fix de no registrar el listener ya no se leen; no hace falta migración.

**Files likely to change**:
- `apps/web/src/main.tsx`
- `apps/web/src/lib/vencimientoSesion.test.ts` (o un test nuevo del arranque)
- `docs/tiendas-online.md` (documentar que la tienda pública no usa vencimiento de sesión; exigido por `pnpm docs:check`)

**Tests to add or update**:
- Extraer el arranque a una función testeable y probar que con host de tienda no se llama `seguirActividad` ni se escribe `sesion:ultima-actividad`, y que con host del panel sí.
- Regresión: marca de hace 13 h + host de tienda + `pointerdown` → no `logout` ni `assign('/login')`.

## Risks & Considerations

- No debilitar el vencimiento del panel (FR-009): el comportamiento con host del panel debe quedar idéntico.
- Si `VITE_PANEL_HOSTS` está vacío, `esHostDeTienda` devuelve false y el bug no aplica (panel por defecto).
- Aprendizaje relacionado (low): falta guarda `cerrando` ya existe en `main.tsx`; no cambia.

## Open Questions

- [NEEDS CLARIFICATION: ¿el visitante llega a tener sesión de Supabase en la tienda (p. ej. checkout con login)? Si sí, definir si debe vencer sin redirigir a `/login`.]
