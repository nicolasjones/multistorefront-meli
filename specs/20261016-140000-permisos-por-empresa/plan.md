# Implementation Plan: Permisos por empresa (MSF-121)

**Spec**: `specs/20261016-140000-permisos-por-empresa/spec.md`

## Summary

Se agrega el rol por empresa sobre el contrato de F-ROL-01 sin romperlo: dos tablas de plataforma (`usuarios_empresas`, `usuario_empresa_activa`), helpers `private`, una nueva versión de `private.nivel_seccion`/`puede_accion` y, sobre eso, el selector de empresa activa y la asignación desde Usuarios. Tres historias, tres migraciones independientes.

## Technical Context

- Refine (`apps/web`) + Supabase self-hosted (sin Cloud). Delivery scope: `refine`, `supabase`.
- Reutiliza: `private.nivel_seccion`/`puede_accion` (`20261013130002`), `PermisosPanelProvider`, `useNivelSeccion`, `accessControlProvider` + `invalidarCachePermisos()`, `ContextoPanel`, `components/navegacion/{EncabezadoPanel,SelectorEmpresa}.tsx`, `pages/usuarios/list.tsx`, `DialogoInvitarUsuario`, registro de actividad (`private.registrar_actividad`), `dominio.empresas`.

## Constitution Check

- I Aislamiento: RLS por organización en ambas tablas; pgTAP con 2 organizaciones × 2 empresas. ✔
- II Spec primero; permisos, fallos y auditoría declarados. ✔
- VI Panel: el selector va en la barra superior (ya existente); estados de carga/vacío/error/éxito del patrón compartido; teclado y 320/768/1440 px; sin identificadores técnicos visibles. ✔
- VII Esquemas: `usuarios_empresas` y `usuario_empresa_activa` en `public` (acceso transversal); `dominio.empresas` solo referenciada. **Re-verificar en tareas, implementación y PR.** ✔
- Migraciones aditivas; `anon` sin privilegios en tablas nuevas; RPC con `revoke … from public, anon` + `grant … to authenticated` (el pgTAP de `anon` debe seguir verde). ✔
- VIII Documentación en el mismo cambio. ✔

## Diseño

**Resolución (`private.nivel_seccion`, reemplazo con `create or replace`):**
1. Superadmin con organización activa → `edicion` (sin cambio).
2. Rol de organización `administrador` → matriz de siempre.
3. Sección en `{productos, categorias, stock, clientes, proveedores, cotizacion_dolar}` y usuario con asignaciones → máximo (`edicion` > `lectura` > `ninguno`) de `permisos_rol` por cada rol asignado.
4. Sección en `{ventas, consultas, reportes}` y usuario con asignaciones → nivel del rol en la empresa activa válida; sin activa válida → `ninguno`.
5. Cualquier otro caso (sección no listada, o sin asignaciones) → rol de organización, como hoy.
Las listas de secciones compartidas/por empresa viven en una función `private` única (fuente única para SQL y para el panel vía `permisos_actuales()`).

**Tablas:**
- `public.usuarios_empresas(user_id, empresa_id, organizacion_id, rol_id)`, PK `(user_id, empresa_id)`, `check (rol_id in (…cinco…))`, trigger que valida empresa y usuario en la misma organización.
- `public.usuario_empresa_activa(user_id pk, empresa_id, updated_at)`.
- Ambas: RLS, sin `grant` a `anon`, sin escritura directa para `authenticated`.

**RPC** (`security definer`, `search_path = ''`, organización y actor desde la sesión): `cambiar_empresa_activa` (F-ROL-06), `asignar_empresas_usuario` (F-ROL-07). Ambas registran su evento con `private.registrar_actividad` en la misma transacción; los tipos nuevos se suman a `ETIQUETA_TIPO_ACTIVIDAD`.

**Panel:** `SelectorEmpresaActiva` en `EncabezadoPanel` (nuevo componente; el `SelectorEmpresa` por ruta de F-EMP-05 no se toca). Al cambiar: RPC → `invalidarCachePermisos()` → recarga de `PermisosPanelProvider`. Confirmación con el patrón de cambios sin guardar del panel. Usuarios: diálogos Invitar/Editar con empresas y rol por empresa; seis roles en Editar.

**Límite con F-EMP-05:** F-EMP-05 navega entre pantallas de empresa por ruta y no cambia la activa; F-ROL-06 cambia la activa persistida. Conviven en la barra superior; la disposición exacta se resuelve al implementar F-ROL-06 contra `AdminHeader.dc.html`.

## Migraciones (aditivas, una por historia, sin encadenarse)

| Historia | Archivo | Contenido |
|----------|---------|-----------|
| F-ROL-04 | `20261016140100_roles_por_empresa.sql` | tablas, helpers, nuevo `nivel_seccion`/`puede_accion` |
| F-ROL-06 | `20261016150100_cambiar_empresa_activa.sql` | RPC + evento |
| F-ROL-07 | `20261016160100_asignar_empresas_usuario.sql` | RPC + evento + asignaciones en invitación |

> Renombre (integración con la épica de clientes, MSF-180): estas tres migraciones usaban
> `20261016140000`, `20261016150000` y `20261016160000`, versiones ya ocupadas por
> `clientes_buscar`, `clientes_exportar` y `clientes_habilitar_pg_trgm` (desplegadas en DEV).
> Se movieron a `...140100`, `...150100` y `...160100` para que cada versión sea única.

**Reversión (documentada, no se ejecuta en el mismo PR):** `drop function public.asignar_empresas_usuario…; drop function public.cambiar_empresa_activa…;` y, para F-ROL-04, restaurar `nivel_seccion`/`puede_accion` a su definición de `20261013130002`, luego `drop` de los helpers y de ambas tablas. Mientras no haya filas en `usuarios_empresas` el comportamiento es idéntico al actual.

## Pruebas

- pgTAP: `roles_por_empresa.test.sql` (SC-001: 2 organizaciones, 2 empresas, Operador/Consulta; tablas de prueba representativas de Ventas, Consultas y Productos creadas en el test con políticas sobre `nivel_seccion`), RPC de F-ROL-06 y F-ROL-07 (rechazos, atomicidad, evento), regresión de `permisos_por_rol` y de `anon`.
- Vitest: selector, confirmación con cambios sin guardar, diálogos de Usuarios, `accessControlProvider` tras cambio de empresa.
- E2E (cierre, SC-002): asignar, cambiar de empresa, comprobar botones de edición.

## Documentación

`docs/permisos-por-rol.md` (resolución por empresa), `docs/empresa-activa.md` (selector y límite con F-EMP-05), `docs/usuarios-y-empresas.md` (asignación), `docs/actividad.md` (eventos nuevos), `docs/roadmap-template.md` al cierre (manual), `pnpm docs:check`.

## Riesgos

- Reemplaza la resolución de permisos de toda la plataforma: la regresión de `permisos_por_rol` y de aislamiento es obligatoria; revisión de seguridad (`authz-security`) del diff.
- Rendimiento: `nivel_seccion` se evalúa por consulta (`(select …)`); medir con EXPLAIN en la tabla de prueba.
- Clientes: su RLS de escritura sigue en `puede_escribir()` (límite ya documentado); no se migra aquí.
