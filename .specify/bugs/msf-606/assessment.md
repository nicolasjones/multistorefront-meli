# Evaluación: MSF-606 (BUG-324) — el rol Técnico no se puede invitar ni asignar por empresa

- Síntoma confirmado leyendo el código: el rol `tecnico` (F-SVC-05, `20261020130100`) solo se podía asignar con «Editar usuario» (`cambiar_rol_miembro` acepta cualquier rol existente).
- Causa: la lista de roles quedó en seis/cinco en cuatro puertas: `ROLES_INVITABLES` (diálogo Invitar), `ROLES_POR_EMPRESA` (selector «Rol en <empresa>»), `ROLES` de la Edge Function `invitar-miembro`, y en la base `registrar_invitacion`, `private.validar_asignaciones` y el CHECK `usuarios_empresas_rol_por_empresa`.
- Remediación: agregar `tecnico` a las seis listas. Migración aditiva (amplía un CHECK y dos funciones). No se toca `guardar_matriz_permisos` (la matriz del Técnico sigue fija) ni lo de BUG-315 (permisos de Service).
