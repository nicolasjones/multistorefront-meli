-- MSF-841 (tramo A, punto 1): tipografías «Bricolage Grotesque» y «DM Sans» en la lista cerrada de la tienda.
--
-- El prototipo de las tiendas (MJC_*, SJ_*) usa esas dos familias. La lista cerrada vive en tres lugares
-- de la base: los checks de `dominio.tienda_identidad` y el validador compartido
-- `private.validar_tienda_identidad` (lo usan el borrador y la RPC de guardado). Las migraciones anteriores
-- no se editan: acá se reemplazan los checks y el validador.
--
-- Esquemas (Principio VII): `dominio.tienda_identidad` ya vive en `dominio`; el validador en `private`.
-- Migración aditiva en datos (la lista se amplía; ningún valor existente deja de ser válido).
-- Reversión: volver a aplicar los checks y el validador de 20261023100100 / 20270205110100 (con la lista
-- de siete familias) tras llevar a `system-ui` las identidades que usen las dos nuevas.

alter table dominio.tienda_identidad drop constraint if exists tienda_identidad_tipografia_titulos_lista;
alter table dominio.tienda_identidad add constraint tienda_identidad_tipografia_titulos_lista check (tipografia_titulos in (
  'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans',
  'Bricolage Grotesque', 'DM Sans'
));
alter table dominio.tienda_identidad drop constraint if exists tienda_identidad_tipografia_texto_lista;
alter table dominio.tienda_identidad add constraint tienda_identidad_tipografia_texto_lista check (tipografia_texto in (
  'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans',
  'Bricolage Grotesque', 'DM Sans'
));

create or replace function private.validar_tienda_identidad(p_org uuid, p_empresa uuid, p_datos jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_primario text := upper(btrim(coalesce(p_datos->>'color_primario', '')));
  v_oscuro text := upper(btrim(coalesce(p_datos->>'color_primario_oscuro', '')));
  v_acento text := upper(btrim(coalesce(p_datos->>'color_acento', '')));
  v_fondo text := upper(btrim(coalesce(p_datos->>'color_fondo', '')));
  v_titulos text := p_datos->>'tipografia_titulos';
  v_texto text := p_datos->>'tipografia_texto';
  v_logo text := p_datos->>'logo_ruta';
  v_banner text := p_datos->>'banner_ruta';
  v_banner_movil text := p_datos->>'banner_movil_ruta';
  v_prefijo text;
  v_ruta text;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos de la identidad tienen un formato inválido' using errcode = '22023';
  end if;
  if v_primario !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color primario debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_oscuro !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color primario oscuro debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_acento !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color de acento debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_fondo !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color de fondo debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_titulos is null or v_titulos not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans',
       'Bricolage Grotesque', 'DM Sans') then
    raise exception 'La tipografía de los títulos no está en la lista' using errcode = '22023';
  end if;
  if v_texto is null or v_texto not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans',
       'Bricolage Grotesque', 'DM Sans') then
    raise exception 'La tipografía del texto no está en la lista' using errcode = '22023';
  end if;

  v_prefijo := p_org::text || '/' || p_empresa::text || '/';
  foreach v_ruta in array array[v_logo, v_banner, v_banner_movil] loop
    if v_ruta is not null and (left(v_ruta, length(v_prefijo)) <> v_prefijo or substr(v_ruta, length(v_prefijo) + 1) !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*$' or length(v_ruta) > 200) then
      raise exception 'La imagen debe estar en la carpeta de la empresa' using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object(
    'color_primario', v_primario,
    'color_primario_oscuro', v_oscuro,
    'color_acento', v_acento,
    'color_fondo', v_fondo,
    'tipografia_titulos', v_titulos,
    'tipografia_texto', v_texto,
    'logo_ruta', v_logo,
    'banner_ruta', v_banner,
    'banner_movil_ruta', v_banner_movil
  );
end;
$$;

revoke execute on function private.validar_tienda_identidad(uuid, uuid, jsonb) from public, anon, authenticated;
