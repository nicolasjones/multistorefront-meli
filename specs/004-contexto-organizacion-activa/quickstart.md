# Quickstart: validar el contexto de organización activa

## Prerrequisitos

- `pnpm dev:supabase` corriendo, migraciones de la spec 003 **y** de esta
  spec aplicadas.
- Tu propio usuario como superadmin (ya cubierto por la spec 003).
- Al menos dos organizaciones creadas (ver quickstart de la spec 003,
  pasos 2 y 5).

## 1. Sin organización activa, menú reducido (US1, SC-001/SC-002)

1. Iniciar sesión como superadmin sin haber entrado a ninguna
   organización (o después de "Salir", ver paso 3).
2. Confirmar que el menú solo muestra "Organizaciones" — "Clientes" no
   aparece.
3. Navegar manualmente a `/clientes` por la URL.

**Resultado esperado**: redirige a `/organizaciones`, nunca muestra una
lista vacía.

## 2. Con organización activa, indicador visible (US2, SC-003)

1. Entrar a una organización desde el listado ("Ingresar").
2. Ir a "Clientes".

**Resultado esperado**: la pantalla es accesible (comportamiento ya
existente de la spec 003) y muestra, de forma permanente, el nombre de la
organización activa.

## 3. Salir del contexto activo (US2, FR-005/FR-006)

1. Con una organización activa, usar la acción "Salir" del indicador.
2. Repetir el paso 1 de la sección anterior (menú reducido).
3. Consultar `superadmin_entradas` filtrando por tu `user_id`.

**Resultado esperado**: vuelve al estado sin organización activa (Historia
1); la última fila de `superadmin_entradas` tiene `accion = 'salida'` para
la organización de la que saliste.

## 4. Cambiar de organización sin salir explícitamente (Edge Case, FR-007)

1. Entrar a la organización A.
2. Sin salir, entrar directamente a la organización B (acción "Ingresar"
   desde el listado).
3. Consultar `superadmin_entradas` ordenado por `id` descendente (no por
   `entrado_en`: ambas filas usan `clock_timestamp()` y quedan muy cerca
   en el tiempo, pero `id` es la garantía determinística de orden de
   inserción).

**Resultado esperado**: el contexto activo pasa a ser B (sin datos
mezclados de A); aparecen dos filas nuevas — `salida` de A y `entrada` a
B, en ese orden.

## 5. No-op al salir sin organización activa (Clarifications Q1)

```powershell
pnpm test:db
```

**Resultado esperado**: el caso pgTAP de "salir sin organización activa"
pasa — no lanza error, no agrega filas a `superadmin_entradas`.
