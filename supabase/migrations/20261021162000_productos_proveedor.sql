-- F-PRV-03 (MSF-367, épica MSF-205): cada producto guarda su proveedor y el código que
-- el proveedor le da.
-- Esquema (Principio VII): `dominio.productos` y `dominio.proveedores` siguen en
-- `dominio` (entidades del negocio); esta migración solo agrega columnas.
--
-- FK compuesta (proveedor_id, organizacion_id): un producto no puede apuntar a un
-- proveedor de otra organización. Un proveedor desactivado conserva sus productos:
-- la validación «proveedor activo» solo corre cuando `proveedor_id` cambia.
--
-- Migración aditiva. Reversión (migración posterior, exportar antes los datos; primero
-- restaurar las RPC de 20261021162200 a las firmas de 20261017120200/20261017120400):
--   drop trigger productos_proveedor_valido on dominio.productos;
--   drop function private.validar_proveedor_producto();
--   alter table dominio.productos drop column codigo_proveedor, drop column proveedor_id;

alter table dominio.productos
  add column proveedor_id uuid,
  add column codigo_proveedor text check (length(codigo_proveedor) <= 80),
  add constraint productos_proveedor_fk
    foreign key (proveedor_id, organizacion_id)
    references dominio.proveedores (id, organizacion_id) on delete restrict,
  add constraint productos_codigo_requiere_proveedor
    check (codigo_proveedor is null or proveedor_id is not null);

comment on column dominio.productos.proveedor_id is
  'Proveedor que abastece el producto (opcional). Un solo proveedor por producto en esta épica.';
comment on column dominio.productos.codigo_proveedor is
  'Código con el que el proveedor identifica el producto; solo con proveedor asignado.';

create index IF NOT EXISTS productos_org_proveedor_idx on dominio.productos (organizacion_id, proveedor_id);

-- Normaliza el código y exige proveedor activo solo ante una asignación nueva.
-- `security definer`: el Operador (sin `select` sobre proveedores) también guarda productos.
create or replace function private.validar_proveedor_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.codigo_proveedor := nullif(btrim(new.codigo_proveedor), '');
  if new.proveedor_id is null then
    -- Quitar el proveedor limpia el código (US3-2) — SOLO al editar un producto que TENÍA proveedor. Nunca en
    -- INSERT: un código sin proveedor debe RECHAZARSE por `productos_codigo_requiere_proveedor` (AC-2/FR-013);
    -- limpiarlo acá hacía que el CHECK no se evaluara y el error se perdiera en silencio (MSF-367, database rojo).
    if tg_op = 'UPDATE' and old.proveedor_id is not null then
      new.codigo_proveedor := null;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' or new.proveedor_id is distinct from old.proveedor_id then
    if not exists (
      select 1 from dominio.proveedores p
       where p.id = new.proveedor_id
         and p.organizacion_id = new.organizacion_id
         and p.activo
    ) then
      raise exception 'El proveedor no existe o está desactivado' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_proveedor_producto() from public, anon, authenticated;

create trigger productos_proveedor_valido
  before insert or update on dominio.productos
  for each row execute function private.validar_proveedor_producto();

-- Grants por columna (FR-013): se agregan a los existentes; `organizacion_id` sigue
-- fijado por la RPC con la sesión.
grant insert (proveedor_id, codigo_proveedor) on dominio.productos to authenticated;
grant update (proveedor_id, codigo_proveedor) on dominio.productos to authenticated;
