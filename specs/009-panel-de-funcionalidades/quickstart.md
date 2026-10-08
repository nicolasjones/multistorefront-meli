# Quickstart: validar el panel de funcionalidades por organización

## Prerrequisitos

- `pnpm dev:supabase` corriendo, migraciones de esta spec aplicadas.
- Dos organizaciones creadas (quickstart de la spec 003), cada una con un
  administrador.
- Como esta spec no registra ninguna funcionalidad de negocio real (el
  catálogo arranca vacío — Assumptions de spec.md), este quickstart
  registra una **funcionalidad de prueba** vía SQL, exactamente como lo
  haría la migración de una funcionalidad real:
  ```sql
  select registrar_feature('feature-de-prueba', 'Feature de prueba', 'Solo para validar el mecanismo — no es una funcionalidad real.');
  ```
  Es descartable: solo existe en la base local usada para este quickstart,
  no se commitea ni se lleva a staging/producción.

## 1. Catálogo vacío, antes de registrar nada (FR-013)

1. Como superadmin, ir a Funcionalidades → Administrar, con el catálogo
   todavía sin ninguna fila.

**Resultado esperado**: mensaje explícito indicando que no hay
funcionalidades registradas — nunca una tabla vacía sin contexto.

## 2. Registrar y ver la funcionalidad de prueba (FR-001, FR-004)

1. Ejecutar el `registrar_feature` de Prerrequisitos.
2. Refrescar Funcionalidades → Administrar.

**Resultado esperado**: `feature-de-prueba` aparece en la grilla, como
columna, con todas las organizaciones existentes en fila y ningún
interruptor habilitado todavía.

## 3. Habilitar y deshabilitar por organización (US1, FR-002, FR-003)

1. Habilitar `feature-de-prueba` para la organización X desde la grilla.
2. Confirmar que la organización Y sigue sin cambios.
3. Deshabilitarla para X.

**Resultado esperado**: al habilitarla, solo X queda marcada; al
deshabilitarla, X vuelve a verse igual que antes de habilitarla — sin
ningún estado intermedio visible.

## 4. Repetir una habilitación ya vigente (FR-012)

1. Habilitar `feature-de-prueba` para X.
2. Habilitarla de nuevo para X, sin deshabilitarla antes.
3. Consultar `eventos_features` filtrando por `feature_id = 'feature-de-prueba'` y `organizacion_id` de X.

**Resultado esperado**: una sola fila con `accion = 'habilitada'` para esa
combinación — el segundo intento no duplica el evento.

## 5. Un administrador de organización no puede tocar esto (FR-010)

1. Iniciar sesión como administrador de X (no superadmin).
2. Intentar llamar `habilitar_feature`/`deshabilitar_feature` directo
   (por ejemplo, desde la consola del navegador con el cliente de
   Supabase ya autenticado).

**Resultado esperado**: error de permiso (`42501`), sin cambios en
`organizaciones_features`.

## 6. El helper de habilitación responde aislado por organización (US2, FR-006, FR-007)

Con `feature-de-prueba` habilitada solo para X:

1. Como alguien de X, ejecutar `select tiene_feature_publica('feature-de-prueba')`.
2. Como alguien de Y (sin habilitar), la misma consulta.
3. Con una organización Z recién creada, sin ninguna habilitación
   registrada, la misma consulta para cualquier `feature_id` del catálogo.

**Resultado esperado**: `true` para X, `false` para Y y para Z — nunca
`true` por defecto (FR-003).

## 7. El superadmin resuelve según su organización activa (FR-009)

1. Como superadmin, entrar a la organización X (spec 004) y ejecutar
   `select tiene_feature_publica('feature-de-prueba')`.
2. Salir y entrar a Y, repetir la consulta.

**Resultado esperado**: el resultado cambia según la organización activa
en cada momento — nunca queda "pegado" a la primera que se consultó.

## 8. El catálogo no se expone completo a quien no tiene acceso (FR-008)

1. Como alguien de Y (sin `feature-de-prueba` habilitada), consultar
   `select * from features`.

**Resultado esperado**: cero filas — ni siquiera ve que
`feature-de-prueba` existe. Como superadmin, la misma consulta sí la
devuelve.

## 9. Eliminar una organización se lleva sus habilitaciones (FR-011)

1. Con `feature-de-prueba` habilitada para una organización de prueba,
   eliminar esa organización (quickstart de la spec 003).
2. Consultar `organizaciones_features` filtrando por esa `organizacion_id`.

**Resultado esperado**: cero filas — la habilitación desapareció con la
organización, sin afectar `features` ni las habilitaciones de otras
organizaciones.
