# Bug Assessment: El rol Técnico no puede operar en Service técnico

- **Slug**: rol-tecnico-sin-tiendas
- **Ticket**: MSF-597 (BUG-315)

## Causa

`usuarios_empresas_rol_por_empresa` (CHECK) y `private.validar_asignaciones` solo admitían cinco roles; sin
`tecnico` no hay fila en `usuarios_empresas` y `private.empresas_accesibles()` no devuelve ninguna tienda, por lo
que `crear_reparacion`, `cambiar_estado_reparacion`… responden 42501 «No tenés acceso a esa tienda».

## Remediación

Migración aditiva que amplía el CHECK y la validación con `tecnico`; el selector de Usuarios lo ofrece.
Fuera de alcance: permisos de `mostrador` en Service (no confirmado como defecto).
