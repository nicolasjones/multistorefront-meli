# Quickstart: validar el mapeo de identificadores externos de clientes

Prueba controlada con datos ficticios (un cliente de prueba y un
identificador inventado) — no depende de ningún sistema externo real, ya
que esta spec es plataforma pura sin integración puntual.

## Prerrequisitos

- `pnpm dev:supabase` corriendo.
- La migración de esta spec aplicada
  (`supabase/migrations/<timestamp>_mapeo_identificadores_clientes.sql`).
- Al menos una organización con dos usuarios (uno administrador, uno
  miembro) y un cliente creado — reutilizar los fixtures de la spec 003
  (`specs/003-fundacion-multitenant/quickstart.md`) si ya existen en el
  entorno de prueba.

## Pasos

1. **Vincular un identificador**: como administrador de la organización,
   llamar a `public.vincular_identificador_externo(cliente_id, 'sistema-prueba',
   'ext-001')` (contrato en `contracts/mapeo-identificadores-externos.md`).
   Confirmar que devuelve la fila creada.

2. **Re-vincular el mismo par al mismo cliente**: repetir la llamada del
   paso 1 con los mismos tres argumentos. Confirmar que no falla y que
   `clientes_identificadores_externos` sigue teniendo una sola fila para
   ese par (FR-004).

3. **Intentar vincular el mismo identificador a otro cliente**: crear un
   segundo cliente en la misma organización y llamar a
   `public.vincular_identificador_externo(otro_cliente_id, 'sistema-prueba',
   'ext-001')`. Confirmar que falla (FR-002, FR-010) y que la fila del
   paso 1 no cambió.

4. **Consultar en ambos sentidos**: `select` sobre
   `clientes_identificadores_externos` filtrando por `cliente_id` (debe
   aparecer `ext-001`) y filtrando por `sistema`/`identificador_externo`
   (debe resolver al cliente del paso 1) — FR-005, FR-006.

5. **Verificar el aislamiento por organización**: como usuario de una
   organización distinta, repetir la consulta del paso 4 sobre el mismo
   `cliente_id`/identificador. Confirmar que no devuelve ninguna fila
   (FR-008, SC-003).

6. **Desvincular**: llamar a
   `public.desvincular_identificador_externo(id)` con el `id` del vínculo
   del paso 1. Confirmar que ya no aparece en la consulta del paso 4, y que
   `sistema`/`identificador_externo` vuelven a estar disponibles (repetir
   el paso 1 con esos mismos valores en otro cliente debe funcionar).

7. **Verificar la eliminación en cascada**: crear un vínculo nuevo, eliminar
   el cliente al que pertenece, y confirmar que el vínculo desaparece solo
   (FR-010, SC-004) sin necesidad de desvincularlo antes.

8. **RLS y funciones con pgTAP**: correr `pnpm test` (o el subconjunto de
   pgTAP de esta spec,
   `supabase/tests/database/mapeo_identificadores_clientes.test.sql`) y
   confirmar que un miembro sin rol de administrador puede leer pero no
   puede vincular ni desvincular, y que ningún usuario puede ver ni
   modificar vínculos de clientes de otra organización.

## Ejecución registrada (2026-09-30)

Se ejecutaron los pasos 1-7 a mano contra la base local (`supabase/migrations/20260930140000_mapeo_identificadores_clientes.sql` aplicada), simulando cada rol con `set_config('request.jwt.claims', ...)` + `set local role authenticated` dentro de una única transacción con `rollback` final (sin dejar datos de prueba en la base):

- Paso 1: `vincular_identificador_externo` creó el vínculo y devolvió la fila.
- Paso 2: la re-vinculación del mismo par al mismo cliente devolvió la misma fila (mismo `id`) sin duplicar — 1 sola fila para ese par.
- Paso 3: vincular el mismo par a otro cliente falló con el mensaje `El identificador externo ya está vinculado a otro cliente`; el vínculo original conservó su `cliente_id`.
- Paso 4: un miembro sin rol de administrador listó el vínculo por `cliente_id` y lo resolvió por `sistema`/`identificador_externo`.
- Paso 5: un administrador de otra organización obtuvo 0 filas para el mismo `cliente_id` (aislamiento).
- Paso 6: `desvincular_identificador_externo` eliminó el vínculo (count pasó a 0) y el mismo par se vinculó sin problema a otro cliente de la misma organización.
- Paso 7: eliminar el cliente propietario del vínculo lo eliminó en cascada (count 0) sin desvincularlo antes.

El paso 8 (pgTAP) corrió por separado: `supabase test db --local supabase/tests/database/mapeo_identificadores_clientes.test.sql` → `21/21` pruebas en verde (incluye los mismos casos de arriba más el rechazo por permiso, por cliente inexistente y por sistema/identificador vacíos). La corrida completa de `pnpm test` en la máquina de desarrollo mostró además 5 archivos de pgTAP de otra spec en curso (`catalogo-sistemas-externos`) fallando por una migración suya ya aplicada a la base local compartida pero no presente en esta rama (agrega una FK de `conexiones.sistema_externo` a una tabla `sistemas_externos` nueva) — no relacionado con esta spec; `pnpm lint`, `pnpm build`, `pnpm infra:config` y el resto de `pnpm test` (adopción de plantilla, `apps/web`, y el archivo pgTAP de esta spec) terminaron en verde.
