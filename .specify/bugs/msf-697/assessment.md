# Bug Assessment: un fallo de `permisos_actuales` deja todas las secciones en «Acceso restringido» sin reintento

- **Slug**: msf-697 (provisto por el usuario, `slug=msf-697`)
- **Created**: 2026-11-01
- **Source**: pasted text — «[Bug] Si falla `permisos_actuales`, todas las secciones muestran «Acceso restringido / tu rol no incluye…» sin reintento (It's a Plan MSF-697)». Sin URL: no hay enlace que consultar, así que no aplica la URL Trust Policy.
- **Verdict**: valid (el comportamiento está groundingado en el código: el fallo de la RPC se guarda como «sin permisos» y no hay ninguna vía de reintento)
- **Severity**: high

## Report (verbatim or summarized)

> [Bug] Si falla `permisos_actuales`, todas las secciones muestran «Acceso restringido / tu rol no incluye…» sin reintento (It's a Plan MSF-697) slug=msf-697

Sin pasos de reproducción ni evidencia adjunta: es un reporte de comportamiento con el nombre de la RPC y el mensaje exacto de la pantalla.

## Symptom

Cuando la RPC `public.permisos_actuales()` falla (blip de red, error de PostgREST, timeout, token vencido en vuelo), el panel trata ese fallo como si el usuario no tuviera **ningún** permiso: todas las secciones protegidas por `RequiereAccesoSeccion` renderizan la pantalla «Acceso restringido» con el texto «Tu rol (Operador) no incluye <Sección>. Pedile acceso a un administrador.» y los destinos de menú de todas las secciones desaparecen del Sider. Lo esperado: distinguir «no tengo permiso» de «no pude consultarlo», avisar del fallo de carga y ofrecer reintento; hoy no hay reintento: el estado fallido queda guardado hasta que la persona recarga la página (o cambia de empresa activa).

## Reproduction

1. Iniciar sesión en el panel con un usuario con permisos en varias secciones (por ejemplo Operador con acceso a Clientes, Ventas y Stock).
2. Provocar un fallo de `public.permisos_actuales()` — por ejemplo, cortar la red durante la carga inicial del panel o apuntar la app a una instancia con el schema cache desactualizado (la RPC devuelve `PGRST202`).
   [NEEDS CLARIFICATION: no hay pasos exactos del reporte; el disparador concreto en producción (deploy con schema cache stale, timeout, offline, token vencido) está sin confirmar.]
3. Navegar a `/clientes`, `/ventas` o `/stock`: en vez de la sección, aparece «Acceso restringido — Tu rol (Operador) no incluye Clientes. Pedile acceso a un administrador.».
4. Mirar el menú lateral: los destinos de las secciones con permiso desaparecen (mismo array vacío de permisos).
5. Esperar y recargar la navegación: el estado sigue denegado. La única recuperación es recargar la página completa o cambiar de empresa activa (eso sí dispara `recargar()`).

## Suspected Code Paths

- `apps/web/src/context/PermisosPanel.tsx:43-48` — **origen del bug**: el `catch` de `obtenerPermisosActuales()` hace `setEstado({ clave, permisos: [] })`. Un array vacío de permisos es indistinguible de «no tiene permiso en ninguna sección», y como `estado.clave === clave` sigue siendo cierto, el `useEffect` (deps `[clave, version]`, línea 35) no vuelve a ejecutarse: no hay reintento. El estado fallido queda vigente toda la sesión.
- `apps/web/src/context/PermisosPanel.tsx:58-61` — el valor de contexto expone `permisos` e `isLoading`, pero **no** expone ningún `error`/`hayError`: los consumidores no pueden diferenciar «aún no lo sé» de «lo sé y es ninguno».
- `apps/web/src/hooks/useNivelSeccion.ts:12` — `nivelDe(valor.permisos, seccion)` sobre `[]` devuelve `'ninguno'`, que es exactamente el valor de «sin acceso».
- `apps/web/src/components/RequiereAccesoSeccion.tsx:27` — `denegado = !cargando && nivel !== 'lectura' && nivel !== 'edicion' && isSuperadmin === false`; con `nivel === 'ninguno'` renderiza `AccesoRestringido` (línea 64) con el rol real leído de `usuarios_organizacion` (líneas 37-51): de ahí el mensaje engañoso «Tu rol (Operador) no incluye …» y el ofrecimiento de «Solicitar acceso» a un usuario que probablemente sí tiene acceso.
- `apps/web/src/components/navegacion/destinosPanel.ts:251` — `destinoVisible` resuelve `nivelDe(permisos, destino.seccionPermiso) !== 'ninguno'`; con `permisos: []` todos los destinos con `seccionPermiso` desaparecen y el Sider queda sin las secciones afectadas (mismoarray que el panel).
- `apps/web/src/providers/accessControlProvider.ts:83-87` — `can` captura el mismo error y devuelve `{ can: false }` (deny-by-default, correcto para autorización) sin diferenciar el motivo; combinado con el Sider, el efecto es «bloqueo total» de la UI para un fallo transitorio.
- `apps/web/src/lib/permisos.ts:91-109` — `obtenerPermisosActualesCacheado` **sí** invalida la caché ante un fallo («Los fallos no se cachean», línea 91 y `promesa.catch` en 103-107): la intención del código ya es que un fallo es transitorio y se reintenta. Pero `PermisosPanelProvider` llama a `obtenerPermisosActuales()` (línea 40), que **no** pasa por la caché, y convierte el fallo en `permisos: []` permanente.
- `apps/web/src/pages/acceso-restringido/AccesoRestringido.tsx:46-74` — la pantalla no distingue el origen del bloqueo: solo ofrece «Solicitar acceso» y «Volver al inicio»; no hay botón de reintento de la carga de permisos (el componente `EstadoError` con `reintentar` ya existe: `apps/web/src/components/estados/EstadosPagina.tsx:24-26`).
- `apps/web/src/context/PermisosPanel.test.tsx:61-68` — el test «si la consulta falla deniega (ninguno) y deja traza» **fija el comportamiento defectuoso**: cualquier corrección debe cambiar esta expectativa.
- `supabase/migrations/20261013130002_roles_basicos_permisos.sql:276-290` — `public.permisos_actuales()` es `stable security definer` y resuelve, por cada una de las 16 secciones, `private.nivel_seccion` + 3 × `private.puede_accion`: son 64 llamadas a funciones `security definer` por RPC. Es una consulta pesada y, si la función se recrea en un deploy (la migración la redefine con `create or replace`), PostgREST puede responder `PGRST202` hasta que refresca el schema cache → disparador plausible del fallo transitorio [NEEDS CLARIFICATION: sin log del incidente no se puede confirmar el disparador real].
- `docs/permisos-por-rol.md:221` — la documentación fija «un nivel nulo tras cargar se trata como denegado», pero no dice qué debe verse cuando el fallo fue de la consulta: ese hueco es el que se propone cubrir.

## Root Cause Hypothesis

El panel de permisos no tiene un tercer estado: distingue «cargando» y «sin permisos», pero no «no se pudo consultar». En el `catch` de la carga (`apps/web/src/context/PermisosPanel.tsx:43-48`) el error se convierte en `permisos: []`, y `[]` es la representación válida de «el usuario no tiene acceso a ninguna sección». A partir de ahí, los tres consumidores (guard de rutas, filtro del menú y `accessControlProvider.can`) derivan la misma decisión —denegar— de un dato que en realidad significa «no sé», y el `useEffect` no se re-dispara porque ni `clave` ni `version` cambian: no hay reintento automático ni manual. El mensaje que el usuario ve es además falso: el rol mostrado sale de `usuarios_organizacion` (una consulta que sí funciona), así que el panel afirma «tu rol (Operador) no incluye Ventas» cuando la causa real es un fallo de red, y empuja a la persona a pedir un acceso que probablemente ya tiene. Confianza: **alta** (el comportamiento está directamente en el código); lo no confirmado es el disparador concreto del fallo en producción.

## Proposed Remediation

**Preferred**: separar el estado «error de carga» del estado «sin permiso» y ofrecer reintento, sin tocar la lógica de autorización (RLS sigue siendo la autoridad y el guard sigue fallando cerrado).

1. `PermisosPanelProvider` (`apps/web/src/context/PermisosPanel.tsx`): en el `catch`, no guardar `permisos: []` como si fuera una respuesta válida. Agregar al valor de contexto un `error: Error | null` (o `hayError: boolean` + mensaje) y conservar el último `permisos` conocido (o `null` si nunca se cargó) **marcado como no confiable**. Con `permisos: null` e `isLoading: false`, `useNivelSeccion` devuelve `nivel: null` (el guard lo trata como denegado) y `destinoVisible` hace early-return `true` (el Sider mostraría TODO): por eso el error es un campo propio y los consumidores lo miran antes de decidir.
2. Reintento: `recargar()` ya existe y bumpea `version`, lo que vuelve a disparar el `useEffect`. Basta con exponerlo en la superficie de error. Opcionalmente, reintento automático con backoff corto (2-3 intentos) para fallos de red en `PermisosPanelProvider` —complementa el «los fallos no se cachean» ya presente en `obtenerPermisosActualesCacheado`.
3. `RequiereAccesoSeccion` (`apps/web/src/components/RequiereAccesoSeccion.tsx`): cuando el estado de permisos es «error» (no «denegado»), renderizar `EstadoError` con `reintentar` (componente compartido ya disponible) en vez de `AccesoRestringido`, con un texto del tipo «No pudimos verificar tus permisos. Reintentá.»; **no** ofrecer «Solicitar acceso» mientras no se sepa el nivel real. Un denegado real (`nivel === 'ninguno'` sin error) sigue mostrando la pantalla de acceso restringido como hoy.
4. `SiderPanel` (`apps/web/src/components/navegacion/SiderPanel.tsx`): con error de permisos, mostrar un estado de error con reintento en lugar de un Sider vacío sin explicación.
5. Mantener la traza `console.error` e incluye el código del error de Supabase/PostgREST (p. ej. `PGRST202`) para poder distinguir «deploy» de «red» en los logs.

**Alternatives**:
- *Bandera `error` en el contexto sin tocar `permisos`*: diff más chico y sin riesgo de romper la semántica de `isLoading`, pero el Sider seguiría quedándose vacío sin explicación si no se lo trata (o sea, hay que tocarlo igual); además mezcla «vacío por error» con «vacío real» para los consumidores que no miren la bandera.
- *Reintentar dentro de `obtenerPermisosActuales()` (`apps/web/src/lib/permisos.ts`)*: centraliza el reintento y cubre también a `accessControlProvider`, pero deja el error invisible para la UI (la UI seguiría viendo `[]` si el reintento se agota) y alarga la espera de la denegación; sirve como complemento, no como sustituto del estado de error.
- *Recargar la página automáticamente*: no es una opción (pierde el contexto de trabajo y no es controlable).

**Files likely to change**:
- `apps/web/src/context/PermisosPanel.tsx`
- `apps/web/src/components/RequiereAccesoSeccion.tsx`
- `apps/web/src/components/navegacion/SiderPanel.tsx`
- `apps/web/src/hooks/useNivelSeccion.ts` (y `usePuedeAccion.ts`) para propagar el error a quien lo necesite
- `apps/web/src/pages/acceso-restringido/AccesoRestringido.tsx` (solo si se decide differentiated el copy de «sin permiso» vs «sin acceso por empresa activa»)
- `apps/web/src/context/PermisosPanel.test.tsx`, `apps/web/src/components/RequiereAccesoSeccion.test.tsx`, `apps/web/src/components/navegacion/SiderPanel.test.tsx`
- `docs/permisos-por-rol.md` (y `specs/20261013-120000-usuarios-y-roles/spec.md` si se toca FR-008: documentar el comportamiento ante fallo de la consulta)

**Tests to add or update**:
- `PermisosPanelProvider`: si `obtenerPermisosActuales` rechaza → el contexto expone el error, **no** «denegar»; tras `recargar()` la RPC se vuelve a pedir y, si ahora responde, los permisos vuelven a estar disponibles (recuperación efectiva).
- `PermisosPanelProvider`: la traza se mantiene (`console.error`) con el mensaje del error.
- `RequiereAccesoSeccion`: con error de permisos muestra el estado de error con «Reintentar» y **no** muestra «Acceso restringido» ni «Solicitar acceso»; al pulsar «Reintentar» se vuelve a consultar y, con permisos válidos, se monta la sección.
- Regresión: con `nivel === 'ninguno'` **sin** error sigue apareciendo «Acceso restringido», el rol real y «Solicitar acceso» (lo que ya fija `RequiereAccesoSeccion.test.tsx:48-60`).
- `SiderPanel`: con error de permisos muestra el estado de error con reintento en vez de un menú vacío.
- `obtenerPermisosActualesCacheado`: ya está cubierto («no cachea los fallos», `apps/web/src/lib/permisos.test.ts:64-70`); extenderlo si el reintento se centraliza en `lib/permisos.ts`.
- Actualizar el test existente «si la consulta falla deniega (ninguno) y deja traza» (`apps/web/src/context/PermisosPanel.test.tsx:61-68`): hoy fija el comportamiento defectuoso.
- E2E opcional (no corre en el CI público): `apps/web/e2e/permisos-por-empresa.e2e.ts` ya espera la respuesta de `/rpc/permisos_actuales`; se puede add un caso con la RPC fallando y comprobar que aparece el reintento.

## Risks & Considerations

- **Autorización**: el cambio es de UX/estado, no de seguridad. La decisión de *fall closed* (sin permiso conocido → no se abre la sección) debe conservarse: si la carga de permisos falló, la sección no se monta; lo que cambia es **qué se ve** y que exista reintento. RLS, `private.nivel_seccion` y `private.puede_accion` no se tocan.
- **Riesgo de regresión en `isLoading`**: representar el error con `permisos: null` sin campo `error` haría que el guard muestre «Acceso restringido» y que el Sider muestre todas las secciones. Por eso el error debe ser un campo propio.
- **Semántica de `permisos: []`**: `destinoVisible` y `nivelDe` tratan `[]` como «sin acceso»; hay que revisar todos los consumidores de `usePermisosPanel()` (`SiderPanel`, `useNivelSeccion`, `usePuedeAccion`, `useEmpresaActiva`) para que ninguno interprete el error como «sin permisos» con efectos silenciosos (p. ej. ocultar botones de edición en vez de bloquear la pantalla).
- **Caché de `accessControlProvider.can`**: react-query cachea el resultado de `can`; tras un reintento hay que invalidar (`invalidate({ resource: 'access', invalidates: ['all'] })`, como ya hace `useEmpresaActiva`) para que el menú y las rutas se recalculen.
- **Ruido para los administradores**: mientras el estado sea «error», no se debe permitir «Solicitar acceso» (F-ROL-05), para no generar pedidos de acceso falsos de personas que sí tienen permisos.
- **Sin cambios de API ni de base de datos**: la firma de `permisos_actuales()` no cambia y no hace falta migración. La documentación es obligatoria (`pnpm docs:check`); si se toca el comportamiento de FR-008, la spec de usuarios-y-roles debe actualizarse (`pnpm matriz:check`).
- **Observabilidad**: conservar el `console.error` e incluir el código del error (`PGRST202` vs red) para diagnosticar el disparador real.

## Open Questions

- [NEEDS CLARIFICATION: ¿qué dispara el fallo en producción? ¿Hay un `console.error` / log del incidente con el mensaje exacto (PGRST202 por schema cache en un deploy, timeout, red, token vencido)? De eso depende si alcanza con reintento manual o hace falta backoff.]
- [NEEDS CLARIFICATION: ¿el reintento debe ser automático (con backoff y límite) o solo manual («Reintentar»)? ¿Debe reintentar solo el panel o también `accessControlProvider.can`?]
- [NEEDS CLARIFICATION: ¿el Sider debe mostrar un error con reintento o puede seguir vacío hasta que la consulta funcione?]
- [NEEDS CLARIFICATION: ¿hoy hay pedidos de acceso «Solicitar acceso» creados por personas que sí tenían permiso (ruido para los administradores)? Si los hay, hay que limpiarlos o al menos distinguirlos.]
- [NEEDS CLARIFICATION: ¿el comportamiento debe ser el mismo cuando la RPC falla por un permiso insuficiente real (la RPC es `security definer` y devuelve datos filtrados) o ante un error de infraestructura? La propuesta los separa; conviene confirmar que no hay un tercer caso (p. ej. usuario sin membresía, que legítimamente devuelve secciones en `ninguno`).
