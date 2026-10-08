# Adoptar el kit de panel operable en un producto derivado

Guía de proceso para traer la capacidad de la spec 018 a un producto que ya
reorganizó su propio panel — el caso más probable, ya que esta spec nació de
generalizar exactamente esa situación real. Contratos técnicos:
`specs/018-kit-panel-operable/contracts/{navegacion-panel,identidades-presentacion}.md`.

## 0. Prerrequisitos

El producto conserva `ThemedLayout` de `@refinedev/mui`, el patrón de
`resources`/`Routes` de `App.tsx` sin modificar, y las tablas/funciones de
las specs 003-009 (`organizaciones`, `perfiles_usuario`, `private.is_superadmin()`,
`private.organizacion_id()`, `private.rol_id()`, `private.puede_escribir()`)
que `contexto_panel_actual()` reutiliza sin redefinirlas.

## 1. Comparar antes de migrar

En el fork, relevar antes de mergear `git merge upstream/main`:

- ¿`App.tsx` ya usa `SiderConSeccionesSuperadmin` (el filtrado plano por
  recurso) o ya migró a un sider propio? El primero es el caso esperado —
  esta spec lo reemplaza. Si el fork ya migró a otra cosa, **no** hay
  reemplazo automático: comparar mecanismos a mano.
- ¿El fork ya tiene su propia navegación por secciones/audiencia con otro
  nombre (`destinosPanel.ts` es el nombre de esta spec, pero la idea —
  tipos `DestinoPanel`/`SeccionPanel`/`AudienciaDestino` + función
  `destinoVisible` — puede existir ya con otro nombre de archivo)? Si sí,
  el trabajo real es unificar ambos mecanismos, no simplemente copiar.
- ¿El fork ya tiene un `Principio VI` (o equivalente) en su
  `.specify/memory/constitution.md`? Si el texto coincide (nació de la
  misma convergencia que generalizó esta spec), el merge debería resolver
  limpio solo porque el contenido quedó idéntico de los dos lados — no
  asumirlo, confirmarlo línea por línea igual.
- ¿El fork ya tiene una migración propia que resuelve lo mismo que
  `contexto_panel_actual()` (mismo propósito, otro nombre de función o de
  archivo)? Los nombres de archivo de migración no chocan nunca a nivel de
  Git (son timestamps distintos), pero tener dos funciones que hacen lo
  mismo es redundante — evaluar retirar la propia en favor de la de esta
  spec.

## 2. Migrar

1. Estos archivos deberían traerse **sin conflicto** si el fork no los
   tenía todavía: `apps/web/src/context/ContextoPanel.tsx` (+ test),
   `apps/web/src/hooks/useContextoPanel.ts`,
   `apps/web/src/components/estados/EstadosPagina.tsx` (+ test),
   `apps/web/src/components/pagina/{EncabezadoPagina,ContenidoAdaptable,ContenedorSeccion,ContextoOrganizacionActiva}.tsx`
   (+ tests), `apps/web/src/components/identidad/IdentidadVisible.tsx`
   (+ test), `apps/web/src/test/fixtures/panel.ts`.
2. Aplicar la migración `contexto_panel_operativo.sql` tal cual (aditiva,
   no toca tablas ni policies existentes).
3. `pnpm test` completo, incluido `supabase/tests/database/panel_operativo.test.sql`.

## 3. Reglas de reconciliación (las que sí requieren trabajo manual)

- **`apps/web/src/App.tsx`**: conflicto casi seguro — el fork ya tiene sus
  propios `resources`/`Routes`/rutas de negocio en el mismo archivo que
  esta spec toca para enchufar `SiderPanel`/`EncabezadoPanel`/
  `ContextoPanelProvider`. Resolución: conservar los `resources`/`Routes`
  propios del fork, aplicar solo el cambio de `Sider`/`Header` del
  `ThemedLayout` y el `Provider` envolviendo `<Routes>`.
- **`apps/web/src/components/navegacion/destinosPanel.ts`**: portar los
  TIPOS (`AudienciaDestino`, `DestinoPanel`, `SeccionPanel`) y la función
  `destinoVisible` tal cual — son el mecanismo. El array `SECCIONES_PANEL`
  de esta spec tiene los recursos del template (`organizaciones`,
  `servidores`, `clientes`, `conexiones`, `ejecuciones`, `analítica`,
  `miembros`, `ia`); **no sirve para ningún fork real** — cada producto
  escribe el suyo con sus propios recursos y etiquetas de negocio, es
  trabajo de autoría, no de merge.
- **`apps/web/src/components/SiderConSeccionesSuperadmin.tsx`** (si el
  fork todavía lo tiene): retirarlo una vez que `App.tsx` ya no lo
  importe. No lo borra el merge solo.
- **`apps/web/src/components/identidad/actorEjecucion.ts`** (si el fork ya
  tiene esto): esta spec deliberadamente NO incluye este archivo ni
  `resolver_actores_ejecucion` — están acoplados al diseño de
  `ejecuciones`/`ejecuciones_worker` de cada producto (ver
  `docs/adoptar-ciclo-ejecuciones.md`), no al kit de panel. Si el fork ya
  adoptó `ejecuciones_worker` (spec 016), migrar `actorEjecucion.ts` a
  leer de ahí es trabajo aparte, no de esta adopción.

## 4. Mapeo de este producto

_(Completar al adoptar: qué tenía este fork de distinto y cómo se
resolvió cada conflicto real.)_

- Sider/navegación propia antes de esta spec: —
- Recursos reales de `SECCIONES_PANEL` (Operación/Configuración/Plataforma/Cuenta): —
- ¿Ya tenía un Principio de constitución equivalente? Texto y versión: —
- ¿Ya tenía una función equivalente a `contexto_panel_actual()`? Nombre y decisión: —
- Estado de `actorEjecucion.ts`/`resolver_actores_ejecucion` en este fork: —
