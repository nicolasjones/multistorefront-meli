-- F-TDA-19 (MSF-247, épica MSF-149): estado «pausada» de la tienda para «Volvemos pronto» con identidad.
--
-- Esquemas (Principio VII): solo una función de lectura anónima en `publico` (sin tablas nuevas).
-- Aditiva. Reversión: drop function publico.estado_tienda_por_dominio(text);
--
-- D1: una tienda DESACTIVADA (`dominio.empresas.activa = false`) muestra su marca (nombre, colores,
-- tipografías y logo: datos ya públicos de la tienda). Host desconocido, inválido o empresa activa
-- devuelven `null`, así que el dominio desconocido sigue sin revelar nada. Lista blanca: nunca
-- organización, contacto, datos fiscales ni catálogo.

create or replace function publico.estado_tienda_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'estado', 'pausada',
    'nombre', e.nombre,
    'color_primario', coalesce(i.color_primario, '#222222'),
    'color_primario_oscuro', coalesce(i.color_primario_oscuro, '#000000'),
    'color_acento', coalesce(i.color_acento, '#222222'),
    'color_fondo', coalesce(i.color_fondo, '#FFFFFF'),
    'tipografia_titulos', coalesce(i.tipografia_titulos, 'system-ui'),
    'tipografia_texto', coalesce(i.tipografia_texto, 'system-ui'),
    'logo_ruta', i.logo_ruta
  )
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  left join dominio.tienda_identidad i on i.empresa_id = t.empresa_id
  where t.dominio = private.normalizar_host(host)
    and not e.activa;
$$;

revoke execute on function publico.estado_tienda_por_dominio(text) from public, anon;
grant execute on function publico.estado_tienda_por_dominio(text) to anon, authenticated;

comment on function publico.estado_tienda_por_dominio(text) is
  'F-TDA-19 (D1): marca pública (lista blanca) de una tienda cuya empresa está desactivada, para «Volvemos pronto». null si el host es desconocido, inválido o la empresa está activa.';
