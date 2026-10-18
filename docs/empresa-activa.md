# Empresa activa (F-ROL-06)

Selector de la barra superior para elegir con qué empresa trabaja el usuario.
Spec: `specs/20261016-140000-permisos-por-empresa/` (épica MSF-121, historia F-ROL-06).

## Qué se ve

- Botón **Empresa activa: <nombre>** en el encabezado del panel, junto al selector de F-EMP-05.
- Al abrirlo: solo las empresas a las que el usuario accede (el Administrador, todas las de su
  organización), con la activa marcada y su rol en cada una. El **superadmin** ve las de su
  organización activa (no tiene membresía propia).
- Con **una sola** empresa es una etiqueta fija, sin menú. Sin empresas accesibles no se muestra.
- Estados: cargando (indicador), error de carga (botón «Reintentar empresas»), error al cambiar
  (aviso `role="alert"`). Funciona con teclado; el botón se achica con el ancho (320/768/1440 px).
- Con cambios sin guardar en la pantalla, elegir otra empresa abre un diálogo «¿Cambiar de empresa?»
  (**Seguir acá** / **Cambiar igual**). Cancelar no cambia nada.

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
   escribe ni registra.
3. El panel llama `invalidarCachePermisos()` y recarga `PermisosPanelProvider` (`recargar()`): los
   botones de edición pasan a reflejar el rol de la nueva empresa (secciones por empresa de F-ROL-04).

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

Sin tablas nuevas. Migración aditiva `20261016150100_cambiar_empresa_activa.sql` (renombrada desde `20261016150000` al integrar la épica de clientes; funciones en `public`). Migración posterior `20261017120000_cambiar_empresa_activa_serializada.sql`: lock advisory por usuario para que dos primeras elecciones concurrentes no dupliquen el evento. Migración `20261018160000_selector_empresas_superadmin.sql`: `create or replace private.empresas_accesibles()` con la rama del superadmin (reversión: recrearla como en `20261016140100_roles_por_empresa.sql`).
Reversión: `drop function public.empresas_para_selector(); drop function public.cambiar_empresa_activa(uuid);`.
Prueba: `supabase/tests/database/cambiar_empresa_activa.test.sql` y `supabase/tests/database/selector_empresas_superadmin.test.sql`.
