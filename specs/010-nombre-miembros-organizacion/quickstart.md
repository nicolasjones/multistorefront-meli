# Quickstart: Nombre visible entre miembros de una organización

## Prerrequisitos

- `pnpm dev:supabase` corriendo (stack local de Supabase).
- La pantalla de miembros es exclusiva de quien administra membresías
  (Clarifications de spec 010) — la cuenta que la abre debe ser
  administradora de su organización (o superadmin con esa organización
  activa).
- Dos cuentas de la **misma** organización A: una administradora con
  nombre/apellido cargados en su perfil (spec 008) — es quien abre la
  pantalla —, otra (administradora o no) sin nombre/apellido completado —
  aparece como fila con el fallback.
- Una tercera cuenta administradora de una organización **distinta** (B),
  con nombre/apellido cargados.

## Validación de base de datos (pgTAP)

```bash
pnpm test
```

Ejecuta `supabase/tests/database/nombre_miembros_organizacion.test.sql`
(nuevo) junto con el resto de la suite. Debe seguir pasando también
`perfil_usuario.test.sql` sin modificaciones — confirma que la policy
self-only de `perfiles_usuario` no se tocó.

Casos que el test nuevo debe cubrir (ver `contracts/listar-miembros-organizacion.md`):

1. Un administrador de la organización A, al llamar
   `listar_miembros_organizacion()`, recibe la fila de un compañero de A
   con `nombre`/`apellido` cargados.
2. Ese mismo llamador no recibe ninguna fila de la organización B.
3. Un compañero sin perfil completado aparece igual en el resultado, con
   `nombre`/`apellido` en `null` (no ausente de la lista).
4. Tras remover a una persona de la organización (`remover_miembro`, spec
   005), esa persona deja de aparecer en el resultado para esa
   organización.
5. `select nombre, apellido from perfiles_usuario` directo (sin pasar por
   la función) sigue devolviendo solo la fila propia para un miembro que
   consulta el perfil de un compañero — confirma que la policy base no
   cambió.
6. Un superadmin con esta organización activa (spec 003/004) recibe el
   mismo listado que un administrador de esa organización (FR-006).
7. Un miembro no-administrador de A que llama `listar_miembros_organizacion()`
   directamente (sin pasar por la pantalla) recibe conjunto vacío — el
   chequeo de rol vive en la función, no solo en el frontend.

## Validación manual end-to-end

1. Iniciar sesión como la administradora de la organización A (perfil
   completo).
2. Desde el menú lateral, hacer clic en "Miembros" y confirmar que abre la
   pantalla.
3. Confirmar que la fila de la compañera sin perfil completo muestra el
   texto explícito de dato incompleto (nunca vacío ni su UUID) — nunca el
   `user_id` crudo en ninguna fila.
4. Iniciar sesión como la persona sin perfil completo de A (si no es
   administradora, confirmar que el ítem "Miembros" no aparece en su menú
   — comportamiento ya existente de spec 005, sin cambios en esta spec).
5. Iniciar sesión como la administradora de la organización B y confirmar
   que `/miembros` de B no lista a nadie de la organización A ni muestra
   su nombre por ningún medio.

## Validación frontend (Vitest)

```bash
pnpm --filter @platform/web test -- miembros/list
```

`apps/web/src/pages/miembros/list.test.tsx` (actualizado) debe cubrir:
mapeo de nombre/apellido desde la RPC nueva, texto de fallback cuando
faltan, y que la columna "Usuario" ya no imprime el `user_id` crudo.
