-- Convergencia (spec 003, T029): US3/AC1 exige que crear un cliente no
-- requiera indicar la organización explícitamente. La pantalla de Refine
-- (apps/web/src/pages/clientes/create.tsx) solo envía { nombre } — sin un
-- default, el insert fallaba contra RLS (organizacion_id llegaba null).
--
-- Este default es, de acá en más, parte del "molde" que promete SC-003:
-- cualquier tabla nueva que copie columna + policy de clientes también
-- debería copiar este default para funcionar de punta a punta sin que el
-- frontend tenga que resolver la organización por su cuenta.
alter table clientes
  alter column organizacion_id set default private.organizacion_id();
