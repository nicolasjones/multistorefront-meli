-- MSF-164 · revisión independiente (Code/Security, hallazgo 6): tope defensivo de páginas por empresa.
--
-- `public.guardar_pagina_tienda` (20270212200001) no limitaba cuántas páginas podía crear una empresa, y
-- `publico.paginas_por_dominio` es público y sin paginar: el pie de la tienda las lista todas. Se agrega un
-- tope de 50 páginas por empresa SOLO al crear (editar una página existente nunca se bloquea). El mensaje es
-- claro y el código es 22023 (sin `hint` de campo: la gestión lo muestra como aviso general).
--
-- Esquemas (Principio VII, re-verificado): no hay tablas nuevas; es la misma RPC de la app en `public`
-- (SECURITY DEFINER, `set search_path = ''`, ejecutable solo por authenticated).
--
-- Migración aditiva (`create or replace` de la misma firma, sin tocar la migración original). Reversión:
-- volver a aplicar la definición de 20270212200001 en una migración posterior (sin el bloque del tope);
-- el tope no deja datos que migrar.

create or replace function public.guardar_pagina_tienda(
  p_empresa_id uuid,
  p_pagina_id uuid,
  p_titulo text,
  p_contenido text,
  p_visible boolean
)
returns dominio.tienda_paginas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_contenido text := btrim(coalesce(p_contenido, ''));
  v_base text;
  v_slug text;
  v_n int := 1;
  v_fila dominio.tienda_paginas;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar las páginas de la tienda' using errcode = '42501';
  end if;

  perform 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe o no pertenece a tu organización' using errcode = '42501';
  end if;

  if v_titulo = '' then
    raise exception 'El título es obligatorio' using errcode = '22023', hint = 'titulo';
  end if;
  if char_length(v_titulo) > 80 then
    raise exception 'El título no puede superar los 80 caracteres' using errcode = '22023', hint = 'titulo';
  end if;
  if char_length(v_contenido) > 10000 then
    raise exception 'El contenido no puede superar los 10000 caracteres' using errcode = '22023', hint = 'contenido';
  end if;

  if p_pagina_id is null then
    -- Serializa las altas de la misma empresa: el slug elegido no choca con otra alta simultánea y el tope
    -- se cuenta sin carrera.
    perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text, 0));
    if (select count(*) from dominio.tienda_paginas p where p.empresa_id = p_empresa_id) >= 50 then
      raise exception 'La empresa ya tiene el máximo de 50 páginas. Eliminá alguna para crear otra' using errcode = '22023';
    end if;
    v_base := private.slug_pagina_tienda(v_titulo);
    v_slug := v_base;
    while exists (select 1 from dominio.tienda_paginas p where p.empresa_id = p_empresa_id and p.slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;
    insert into dominio.tienda_paginas (organizacion_id, empresa_id, titulo, slug, contenido, visible)
    values (v_org, p_empresa_id, v_titulo, v_slug, v_contenido, coalesce(p_visible, false))
    returning * into v_fila;
  else
    update dominio.tienda_paginas p
       set titulo = v_titulo,
           contenido = v_contenido,
           visible = coalesce(p_visible, p.visible)
     where p.id = p_pagina_id and p.empresa_id = p_empresa_id and p.organizacion_id = v_org
    returning * into v_fila;
    if not found then
      raise exception 'La página no existe' using errcode = '22023', hint = 'pagina';
    end if;
  end if;
  return v_fila;
end;
$$;

comment on function public.guardar_pagina_tienda(uuid, uuid, text, text, boolean) is
  'MSF-306 + MSF-164: crea (pagina null) o edita una página de la tienda. Solo con edición en Empresas; valida organización y límites (hint = campo); el slug se genera al crear y no cambia. Tope de 50 páginas por empresa al crear (22023).';

revoke execute on function public.guardar_pagina_tienda(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.guardar_pagina_tienda(uuid, uuid, text, text, boolean) to authenticated;
