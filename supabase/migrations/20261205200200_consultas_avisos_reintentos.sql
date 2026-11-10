-- MSF-207 (devolución del Revisor, PR #299): dos huecos de la cola de avisos de consultas.
--   * Un aviso que quedó `pendiente` con el tope de intentos cumplido (el proceso murió en el último
--     intento) se cierra como `fallido` con un error útil, en vez de perderse en silencio.
--   * `sin_destinatario` deja de ser terminal: si la empresa carga el correo después, el barrido
--     lo retoma y se avisa.
--
-- Esquema: sin tablas nuevas; solo se reemplazan dos RPC existentes (mismas firmas y permisos,
-- solo service_role). Migración aditiva. Reversión: volver a las definiciones de
-- 20261024200100_consultas_avisos.sql (create or replace de ambas funciones).

create or replace function public.avisos_consulta_pendientes(p_tope integer default 5, p_limite integer default 50)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.consulta_id
  from dominio.consultas_avisos a
  where (
      -- Pendientes sin tocar o fallidos bajo el tope; la reserva de 2 minutos es la espera del reintento.
      (a.estado in ('pendiente', 'fallido')
        and a.intentos < greatest(coalesce(p_tope, 5), 1)
        and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes'))
      -- Tomados en el último intento cuyo proceso murió: `tomar` los cierra como fallidos.
      or (a.estado = 'pendiente'
        and a.intentos >= greatest(coalesce(p_tope, 5), 1)
        and a.updated_at <= now() - interval '2 minutes')
      -- Sin destinatario que ahora sí lo tienen.
      or (a.estado = 'sin_destinatario'
        and private.correo_avisos_consulta(a.empresa_id) is not null)
    )
  order by a.created_at
  limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

create or replace function public.tomar_aviso_consulta(p_consulta_id uuid, p_tope integer default 5)
returns table (
  resultado text,
  destinatario text,
  empresa_nombre text,
  origen text,
  nombre text,
  contacto text,
  mensaje text,
  producto_nombre text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_aviso dominio.consultas_avisos%rowtype;
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_destino text;
begin
  select * into v_aviso from dominio.consultas_avisos a where a.consulta_id = p_consulta_id for update;
  if not found then
    return query select 'no_existe'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  if v_aviso.estado = 'enviado' then
    return query select 'ya_enviado'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  if v_aviso.intentos >= v_tope then
    -- Último intento todavía en curso: no se toca.
    if v_aviso.estado = 'pendiente' and v_aviso.updated_at > now() - interval '2 minutes' then
      return query select 'en_proceso'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
      return;
    end if;
    -- Último intento sin cierre (el proceso murió): queda fallido y visible, no perdido.
    if v_aviso.estado = 'pendiente' then
      update dominio.consultas_avisos
         set estado = 'fallido',
             ultimo_error = 'Se agotaron los intentos de envío sin que el último llegara a cerrarse',
             updated_at = now()
       where consulta_id = p_consulta_id;
    end if;
    return query select 'agotado'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  -- Reservado por otra invocación que todavía puede estar enviando.
  if v_aviso.estado = 'pendiente' and v_aviso.intentos > 0 and v_aviso.updated_at > now() - interval '2 minutes' then
    return query select 'en_proceso'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- `sin_destinatario` se reevalúa: la empresa pudo cargar el correo después.
  v_destino := private.correo_avisos_consulta(v_aviso.empresa_id);
  if v_destino is null then
    update dominio.consultas_avisos
       set estado = 'sin_destinatario', ultimo_error = null, updated_at = now()
     where consulta_id = p_consulta_id;
    return query select 'sin_destinatario'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  update dominio.consultas_avisos
     set estado = 'pendiente', intentos = intentos + 1, updated_at = now()
   where consulta_id = p_consulta_id;

  return query
    select 'enviar'::text, v_destino, e.nombre, c.origen, c.nombre, c.contacto, c.mensaje, p.nombre
      from dominio.consultas c
      join dominio.empresas e on e.id = c.empresa_id
      left join dominio.productos p on p.id = c.producto_id
     where c.id = p_consulta_id;
end;
$$;
