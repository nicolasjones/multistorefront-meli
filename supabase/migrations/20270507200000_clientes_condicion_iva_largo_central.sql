-- MSF-594 / deuda del lote 35 (hallazgo menor de la revisión de #1124): el límite de 60 caracteres de
-- `dominio.clientes.condicion_iva` estaba duplicado: el check `clientes_condicion_iva_largo_ck` de la tabla
-- (`20261211120050`) y la validación de `private.validar_fila_cliente_migracion` (importación).
--
-- Se centraliza el valor en `private.largo_maximo_condicion_iva()` y la validación de la importación lo lee de ahí.
-- El check de la tabla no se toca (la migración ya aplicada no se reescribe y cambiarlo exigiría revalidar la
-- tabla): la divergencia entre ambos la detecta el test pgTAP `clientes_condicion_iva_carga`, que compara el límite
-- del check con el de la función.
--
-- Parte de la definición VIGENTE de `private.validar_fila_cliente_migracion` (`20270507170000`); solo cambia la
-- fila de `condicion_iva` del `values`. Conserva `stable`, `set search_path = ''` y el revoke.
--
-- Migración aditiva. Reversión (migración posterior): volver a crear `private.validar_fila_cliente_migracion`
-- con `('condicion_iva', 'La condición de IVA', 60)` (la de `20270507170000`) y
-- `drop function if exists private.largo_maximo_condicion_iva();`.

create or replace function private.largo_maximo_condicion_iva()
returns integer
language sql
immutable
set search_path = ''
as $$ select 60 $$;

revoke execute on function private.largo_maximo_condicion_iva() from public, anon, authenticated;

create or replace function private.validar_fila_cliente_migracion(p_fila jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campo record;
  v_correo text := nullif(btrim(p_fila ->> 'correo'), '');
  v_tipo text := nullif(lower(btrim(p_fila ->> 'tipo')), '');
begin
  if nullif(btrim(p_fila ->> 'id_externo'), '') is null then
    return 'Falta el identificador del panel actual';
  end if;
  if char_length(btrim(p_fila ->> 'id_externo')) > 200 then
    return 'El identificador del panel actual supera 200 caracteres';
  end if;
  if nullif(btrim(p_fila ->> 'nombre'), '') is null then
    return 'Falta el nombre o la razón social';
  end if;
  for v_campo in
    select * from (values
      ('nombre', 'El nombre', 200),
      ('documento', 'El DNI/CUIT', 40),
      ('correo', 'El correo', 200),
      ('telefono', 'El teléfono', 60),
      ('celular', 'El celular', 60),
      ('direccion', 'La dirección', 200),
      ('codigo_postal', 'El CP', 20),
      ('localidad', 'La localidad', 120),
      ('provincia', 'La provincia', 120),
      ('expreso_preferido', 'El expreso preferido', 120),
      ('condicion_iva', 'La condición de IVA', private.largo_maximo_condicion_iva())
    ) as t (campo, etiqueta, maximo)
  loop
    if char_length(btrim(coalesce(p_fila ->> v_campo.campo, ''))) > v_campo.maximo then
      return format('%s supera %s caracteres', v_campo.etiqueta, v_campo.maximo);
    end if;
  end loop;
  if v_correo is not null and v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return 'El correo no tiene un formato válido';
  end if;
  if v_tipo is not null and v_tipo not in ('minorista', 'mayorista') then
    return 'El tipo de cliente debe ser minorista o mayorista';
  end if;
  return null;
end;
$$;


revoke execute on function private.validar_fila_cliente_migracion(jsonb) from public, anon, authenticated;
