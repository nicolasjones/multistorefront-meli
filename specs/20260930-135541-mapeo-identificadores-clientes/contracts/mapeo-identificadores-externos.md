# Contrato: Mapeo de identificadores externos de clientes

Interfaz que cualquier consumidor autenticado (Refine de un producto
derivado, un worker, o cualquier integración futura) usa contra
Supabase/PostgREST para vincular, consultar y desvincular identificadores
externos de un cliente. Todo pasa por RLS + las funciones `SECURITY
DEFINER` de `data-model.md` — nunca por `insert`/`update`/`delete` directo
del cliente sobre la tabla.

1. **Vincular un identificador externo a un cliente** —
   `public.vincular_identificador_externo(cliente_id, sistema,
   identificador_externo)`.
   - **Quién**: administrador de la organización dueña del cliente, o
     superadmin con esa organización activa (FR-009).
   - **Qué hace**: crea el vínculo. Si el mismo par (sistema,
     identificador_externo) ya está vinculado al mismo cliente, no hace
     nada y no falla (FR-004). Si ya está vinculado a otro cliente, falla
     sin modificar el vínculo original (FR-002, FR-010).
   - **Falla si**: el cliente no existe (`P0002`); quien llama no tiene
     permiso sobre esa organización (`42501`); el identificador ya
     pertenece a otro cliente (`23505`); `sistema` o
     `identificador_externo` están vacíos o son solo espacios (FR-011).

2. **Ver los identificadores externos de un cliente** — `select` sobre
   `clientes_identificadores_externos` filtrando por `cliente_id` (FR-005).
   - **Quién**: cualquier miembro de la organización dueña del cliente
     (lectura, sin restricción de rol — mismo criterio que el resto de
     tablas de negocio de esta plataforma).

3. **Resolver el cliente a partir de un sistema + identificador** —
   `select` sobre `clientes_identificadores_externos` filtrando por
   `sistema` e `identificador_externo` (FR-006). Devuelve a lo sumo una
   fila, por el `unique` de la tabla.
   - **Quién**: igual que (2).

4. **Desvincular un identificador externo** —
   `public.desvincular_identificador_externo(id)`.
   - **Quién**: administrador de la organización dueña del cliente, o
     superadmin con esa organización activa (FR-009).
   - **Qué hace**: elimina el vínculo. Si el vínculo ya no existe, es un
     no-op (FR-007).
   - **Falla si**: quien llama no tiene permiso sobre la organización dueña
     del vínculo (`42501`).

## Fuera del contrato (a propósito)

- Cualquier UI en Refine para gestionar estos vínculos a mano — delivery
  scope de esta spec es `supabase` únicamente (Assumptions de `spec.md`).
- Un catálogo de sistemas externos y su FK desde `sistema` — spec separada
  (`catalogo-sistemas-externos`), esta pieza no depende de ella (Decisión 3
  de `research.md`).
- Cualquier lógica de negocio puntual sobre cuándo/con qué valor crear estos
  vínculos (sincronización con un sistema externo específico) — es
  responsabilidad de cada producto derivado (Assumptions de `spec.md`).
- Cualquier endpoint público (sin sesión de Supabase Auth) — todo lo de
  arriba requiere autenticación, igual que el resto del template.
