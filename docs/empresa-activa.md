# Empresa activa (F-ROL-06)

Selector de la barra superior para elegir con qué empresa trabaja el usuario.
Spec: `specs/20261016-140000-permisos-por-empresa/` (épica MSF-121, historia F-ROL-06).

## Qué se ve

- Botón **Empresa activa: <nombre>** en el encabezado del panel, junto al selector de F-EMP-05.
- Al abrirlo: **«Todas mis empresas»** (vista combinada, sin empresa activa) y las empresas a las que
  el usuario accede (el Administrador, todas las de su organización), con la activa marcada y su rol
  en cada una. El **superadmin** ve las de su organización activa (no tiene membresía propia).
- **«Todas mis empresas»** es la opción marcada cuando no hay empresa activa; su rol se muestra como
  «Varios». Al elegirla, las pantallas que filtran por la empresa activa muestran todas y las
  secciones por empresa usan el **mejor rol** entre las empresas del usuario: no se ocultan secciones
  del menú ni se pierden acciones.
- Con **una sola** empresa el selector es una etiqueta fija (no ofrece «Todas»). Sin empresas
  accesibles no se muestra.
- Estados: cargando (indicador), error de carga (botón «Reintentar empresas»), error al cambiar
  (aviso `role="alert"`). Funciona con teclado; el botón se achica con el ancho (320/768/1440 px).
- Con cambios sin guardar en la pantalla, elegir otra empresa o «Todas» abre un diálogo «¿Cambiar de
  empresa?» (**Seguir acá** / **Cambiar igual**). Cancelar no cambia nada.
- Al cambiar de empresa, el **menú lateral no parpadea**: sigue visible con lo último cargado mientras
  se recargan los permisos (sólo se vacía en la carga inicial o al cambiar de usuario/organización).
- **Las pantallas con filtro por tienda siguen la empresa activa:** al cambiarla en la barra superior,
  el filtro de la pantalla (Clientes, Actividad) pasa a esa empresa. El control de la pantalla —`FiltroEmpresa`,
  con píldoras— puede fijar otra tienda o «Todas» sin cambiar la activa persistida; al volver a cambiar la
  activa en la barra, la pantalla la sigue (`hooks/useFiltroPorEmpresaActiva.ts`, F-ROL-06/F-CLI-11).
  El cambio se propaga por `lib/empresaActivaRevision.ts`: el selector emite la señal y
  `useEmpresasAccesibles` la escucha, así la pantalla reacciona sin remontarse.

## Qué ve cada rol en la barra superior

- **Superadmin**: la etiqueta de la **organización** activa (`SelectorEmpresa`, F-EMP-05) y, además,
  sus empresas en «Empresa activa» (F-ROL-06). Puede activar/entrar a las empresas de esa organización.
- **Administrador de la organización**: sus empresas en «Empresa activa» (todas las activas de su
  organización). Fuera de una pantalla de empresa **no** ve la etiqueta de organización.
- **Miembro**: solo las empresas que tiene asignadas. Igual que el Administrador, no ve la etiqueta de
  organización fuera de una pantalla de empresa.
- Nadie ve empresas de otra organización.

## Cómo funciona

1. `public.empresas_para_selector()` devuelve las empresas accesibles (`private.empresas_accesibles()`),
   cuál es la activa válida y el rol en cada una (`private.rol_en_empresa`). `private.empresas_accesibles()`
   incluye la rama del superadmin: las empresas activas de su organización activa
   (`20261018160000_selector_empresas_superadmin.sql`); el Administrador ve todas las de su organización
   y un miembro las asignadas, sin cambios respecto de `20261016140100`.
2. `public.cambiar_empresa_activa(p_empresa_id)` valida el acceso (42501 si la empresa es ajena, de otra
   organización, inexistente o el usuario está suspendido), hace upsert en `public.usuario_empresa_activa`
   y registra `usuario.empresa_activa_cambiada` en la misma transacción. Elegir la que ya es la activa no
   escribe ni registra. `public.usar_todas_las_empresas()` hace lo propio para la vista combinada: borra
   la fila (sin empresa activa) y registra el evento; es idempotente.
3. `private.roles_de_referencia(p_seccion)` resuelve las secciones **por empresa** (ventas, consultas,
   reportes) con el rol de la empresa activa o, sin activa, con el **mejor rol** entre las empresas
   activas del usuario (`20261018170000_empresa_activa_todas.sql`). Las compartidas (productos,
   categorías, stock, clientes, proveedores, cotización) siempre usan el mejor rol entre sus empresas.
4. El panel llama `invalidarCachePermisos()` y recarga `PermisosPanelProvider` (`recargar()`): los
   botones de edición pasan a reflejar el rol de la nueva empresa (secciones por empresa de F-ROL-04).
   El menú lateral no se vacía durante esa recarga: `SiderPanel` sólo lo oculta en la carga inicial o al
   cambiar de usuario/organización.

La empresa activa **persiste en base** (no en la URL ni en `localStorage`): al volver a entrar, o desde
otro dispositivo, se conserva. Ambas RPC: `revoke … from public, anon` + `grant … to authenticated`.
La tabla no tiene escritura directa para `authenticated`; esta RPC es el único camino.

## Límite con F-EMP-05

| | `SelectorEmpresa` (F-EMP-05) | `SelectorEmpresaActiva` (F-ROL-06) |
|---|---|---|
| Qué cambia | la empresa de la **ruta** (`/empresas/edit/:id`) | la empresa **activa persistida** |
| Persistencia | URL | `usuario_empresa_activa` |
| Afecta permisos | no | sí (secciones por empresa: ventas, consultas, reportes) |

Conviven en `EncabezadoPanel`; F-ROL-06 no modifica el comportamiento del selector por ruta (FR-013).

## Esquemas y reversión

Sin tablas nuevas. Migración aditiva `20261016150100_cambiar_empresa_activa.sql` (renombrada desde `20261016150000` al integrar la épica de clientes; funciones en `public`). Migración posterior `20261017120000_cambiar_empresa_activa_serializada.sql`: lock advisory por usuario para que dos primeras elecciones concurrentes no dupliquen el evento. Migración `20261018160000_selector_empresas_superadmin.sql`: `create or replace private.empresas_accesibles()` con la rama del superadmin (reversión: recrearla como en `20261016140100_roles_por_empresa.sql`). Migración `20261018170000_empresa_activa_todas.sql`: `create or replace private.roles_de_referencia()` (sin activa = mejor rol) y `public.usar_todas_las_empresas()` (reversión: recrear `roles_de_referencia` como en `20261016140100` y `drop function public.usar_todas_las_empresas()`).
Reversión: `drop function public.usar_todas_las_empresas(); drop function public.empresas_para_selector(); drop function public.cambiar_empresa_activa(uuid);`.
Prueba: `supabase/tests/database/cambiar_empresa_activa.test.sql`, `supabase/tests/database/selector_empresas_superadmin.test.sql` y `supabase/tests/database/empresa_activa_todas.test.sql`.
