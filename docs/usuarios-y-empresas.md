# Usuarios y empresas (F-ROL-07)

Un Administrador define, desde **Usuarios**, en qué empresas trabaja una persona y con qué rol en cada
una. Spec: `specs/20261016-140000-permisos-por-empresa/` (épica MSF-121, historia F-ROL-07). La
resolución de permisos por empresa está en `docs/permisos-por-rol.md`; el selector, en `docs/empresa-activa.md`.

## Qué se ve

- **Lista de Usuarios**: columna **Empresas** con una etiqueta «Tienda: Rol» por asignación. Un
  Administrador figura como «Todas las empresas»; quien no tiene asignaciones, «Sin asignar» (rige su
  rol de organización).
- **Editar usuario**: el selector de **Rol** ofrece los seis roles (Administrador y los cinco por empresa).
  Debajo, un casillero por empresa con su selector «Rol en <empresa>». Elegir **Administrador** reemplaza
  la lista por el aviso «accede a todas las empresas» y, al guardar, quita sus asignaciones previas.
- **Invitar usuario**: la misma lista de empresas y roles; con rol Administrador no se pide ni se envía.
  Si no se pueden cargar las empresas se avisa y se puede invitar igual (se asignan después desde Editar).
- Guardar con el rol sin cambios y solo asignaciones distintas llama únicamente a la asignación.

## Cómo funciona

1. `public.asignar_empresas_usuario(p_target_user_id, p_asignaciones jsonb)`: solo quien gestiona
   membresías (Administrador) de la organización activa. **Reemplazo atómico** de las filas de
   `public.usuarios_empresas` del usuario (`[{"empresa_id": uuid, "rol_id": text}]`); si algo falla no
   cambia nada. Errores: `42501` sin permiso o empresa de otra organización; `22023` formato, rol
   (`administrador`/`miembro` no valen por empresa), empresa repetida o destino Administrador; `P0002`
   usuario fuera de la organización. Si el usuario no tiene empresa activa válida, la primera (por
   nombre) queda como activa. Quitar todas devuelve al usuario a su rol de organización. Registra
   `usuario.empresas_asignadas` (`docs/actividad.md`).
2. **Invitación**: la edge function `invitar-miembro` acepta `asignaciones` y llama
   `public.guardar_asignaciones_invitacion` tras `registrar_invitacion` (valida igual; si falla compensa
   la invitación). Se guardan en `invitaciones_organizacion.asignaciones` y `aceptar_invitacion()` las
   aplica al crear la membresía.
3. `public.listar_empresas_usuarios()` alimenta la columna de la lista; solo para quien gestiona membresías.

Robustez (devolución PR #101): el lote admite hasta 200 asignaciones y la invitación guarda el jsonb
normalizado `{empresa_id, rol_id}`; `asignar_empresas_usuario` toma el lock antes de leer el rol destino;
`aceptar_invitacion()` ignora las empresas borradas o movidas entre invitar y aceptar; en la pantalla,
«Editar» queda deshabilitado (y la columna avisa) si las asignaciones no cargaron, para no reemplazar a ciegas.

`usuarios_empresas` no tiene escritura directa para `authenticated`: estas RPC son el único camino.
Todas: `revoke … from public, anon` + `grant … to authenticated` (los helpers `private.*` no se exponen).

## Esquemas y reversión

Sin tablas nuevas (Principio VII): `usuarios_empresas` y `usuario_empresa_activa` siguen en `public`,
`dominio.empresas` solo se lee; la migración `20261016160000_asignar_empresas_usuario.sql` agrega la
columna `invitaciones_organizacion.asignaciones` (aditiva). Reversión documentada en el encabezado de la migración.
