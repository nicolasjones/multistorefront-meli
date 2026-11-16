-- MSF-176 · Tienda compra y cuentas, historia B2, M-4 de la revisión de código: el MISMO conjunto de caracteres bloqueados en la lista de pedido (B1) que en el presupuesto
-- (B2) y en el front (`tiendaPedido.ts`): a los de control, separadores de línea y marcas de dirección que ya se rechazaban se suman U+061C y los ceros de ancho
-- (U+200B a U+200D, U+2060 y U+FEFF). Redefine `publico.enviar_lista_pedido` (misma firma, mismos grants) sobre el cuerpo vigente de `20270321100400`, cambiando SOLO las
-- dos constantes de caracteres prohibidos.
--
-- Esquemas (Principio VII): sin tablas. Migración aditiva. Reversión (migración posterior): restaurar el cuerpo de `20270321100400_enviar_lista_pedido.sql`.

CREATE OR REPLACE FUNCTION publico.enviar_lista_pedido(host text, nombre text, contacto text, nota text, items jsonb, clave_envio uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  -- Caracteres que se rechazan: de control, separadores de línea Unicode y marcas de dirección del texto.
  c_prohibidos_linea constant text := '[\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
  c_prohibidos_nota constant text := '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
  v_empresa uuid;
  v_items jsonb;
  v_cuenta record;
  v_cliente record;
  v_nombre text;
  v_contacto text;
  v_nota text;
  v_campos text[] := '{}';
  v_pendientes jsonb;
  v_registro jsonb;
  v_candidato text;
  v_limite jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or clave_envio is null or not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'error');
  end if;

  -- Cupo de LLAMADAS (S1, amenaza 1.1): se consume ANTES de validar ni de evaluar el catálogo, así también cuentan las llamadas `invalido` (uuids bien
  -- formados al azar con una clave nueva por pedido): sin esto un atacante pagaba la evaluación del catálogo efectivo sin límite. Cupo propio
  -- (`envio|` + visitante, por minuto); es independiente del cupo de 5 ENVÍOS por hora, que sigue siendo `registrar_envio_tienda`.
  v_limite := private.registrar_pedido_publico('envio|' || private.visitante_publico(host), private.limite_llamadas_envio_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Con cuenta activa y habilitada en ESTA tienda: sus datos y su cliente. Cualquier otro caso es un visitante.
  select * into v_cuenta from private.cuenta_de_tienda(host);

  v_nota := nullif(btrim(replace(coalesce(nota, ''), E'\r\n', E'\n')), '');
  if v_cuenta.cuenta_cliente_id is not null then
    select c.nombre, c.correo, c.telefono, c.celular
      into v_cliente
      from public.clientes c
     where c.id = v_cuenta.cliente_id and c.organizacion_id = v_cuenta.organizacion_id;
    -- Los datos de la ficha pasan por las MISMAS reglas que los de un visitante (S2): del nombre se sacan los caracteres de control, separadores
    -- de línea y marcas de dirección; como contacto se usa el primero de correo, teléfono y celular con formato válido y sin esos caracteres.
    v_nombre := btrim(regexp_replace(regexp_replace(coalesce(v_cliente.nombre, ''), c_prohibidos_linea, ' ', 'g'), '[[:space:]]+', ' ', 'g'));
    v_nombre := left(v_nombre, 100);
    v_contacto := null;
    foreach v_candidato in array array[v_cliente.correo, v_cliente.telefono, v_cliente.celular] loop
      v_candidato := btrim(coalesce(v_candidato, ''));
      if v_candidato <> '' and v_candidato !~ c_prohibidos_linea
         and not ('contacto' = any (private.validar_contacto_tienda('x', v_candidato, 'x'))) then
        v_contacto := v_candidato;
        exit;
      end if;
    end loop;
    -- Una ficha sin nombre o sin ningún contacto válido no se puede responder: error genérico (la cuenta web exige correo, D-25).
    if v_nombre = '' or v_contacto is null then
      return jsonb_build_object('estado', 'error');
    end if;
  else
    v_nombre := btrim(coalesce(nombre, ''));
    v_contacto := btrim(coalesce(contacto, ''));
    v_campos := array_remove(private.validar_contacto_tienda(v_nombre, v_contacto, 'x'), 'mensaje');
    if v_nombre ~ c_prohibidos_linea and not ('nombre' = any (v_campos)) then
      v_campos := array_append(v_campos, 'nombre');
    end if;
    if v_contacto ~ c_prohibidos_linea and not ('contacto' = any (v_campos)) then
      v_campos := array_append(v_campos, 'contacto');
    end if;
  end if;
  if v_nota is not null and (length(v_nota) > 500 or v_nota ~ c_prohibidos_nota) then
    v_campos := array_append(v_campos, 'nota');
  end if;

  v_items := private.validar_items_pedido(items);
  if v_items is null then
    v_campos := array_append(v_campos, 'items');
  end if;
  if cardinality(v_campos) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', to_jsonb(v_campos));
  end if;

  -- Un reintento de una clave ya registrada (corte de red) es siempre `ok` y no crea nada, aunque entre tanto un producto se haya
  -- ocultado. (La comprobación definitiva y atómica la hace `registrar_envio_tienda`, más abajo.)
  if exists (select 1 from dominio.tienda_envios t where t.empresa_id = v_empresa and t.clave_envio = clave_envio) then
    return jsonb_build_object('estado', 'ok');
  end if;

  -- Cada producto debe ser visible en ESTA tienda; si alguno no lo es, la lista entera se rechaza (la pantalla ya los avisó al
  -- revalidar). Inexistente, ajeno, oculto o inactivo: indistinguibles.
  with visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo(v_empresa) x
     where x.efectivo
       and x.producto_id in (select (e.valor ->> 'producto_id')::uuid from jsonb_array_elements(v_items) e(valor))
  )
  select coalesce(jsonb_agg(to_jsonb((e.valor ->> 'producto_id')::uuid) order by e.ord), '[]'::jsonb)
    into v_pendientes
    from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
   where (e.valor ->> 'producto_id')::uuid not in (select v.producto_id from visibles v);
  if jsonb_array_length(v_pendientes) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'), 'no_disponibles', v_pendientes);
  end if;

  -- Sub-transacción: si la entrega falla se revierte también el registro del envío (no se gasta cupo).
  begin
    v_registro := private.registrar_envio_tienda(v_empresa, 'pedido', clave_envio);
    if v_registro ->> 'estado' = 'limite' then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
    end if;
    if v_registro ->> 'estado' = 'nuevo' then
      perform private.crear_consulta_pedido(v_empresa, v_nombre, v_contacto, v_nota, v_cuenta.cliente_id, v_items, v_cuenta.tipo);
    end if;
  exception when others then
    -- Rastro en el servidor (log de Postgres) solo con sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'enviar_lista_pedido falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
  return jsonb_build_object('estado', 'ok');
exception when others then
  raise warning 'enviar_lista_pedido falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;
