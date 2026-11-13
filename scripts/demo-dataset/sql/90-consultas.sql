-- Consultas de clientes e intereses de WhatsApp del dataset demo (paso SQL final, no vía API).
-- Por qué SQL: la única entrada pública (`publico.enviar_consulta_contacto` / `registrar_consulta_whatsapp`) fija
-- created_at = now() y limita a 5 envíos por hora por visitante y empresa (anti-abuso por diseño), así que por la API
-- no se puede armar una bandeja con ~35 consultas repartidas en 60 días. El módulo 07 ya probó el camino público real
-- con unas pocas; acá se completa insertando directo en dominio.consultas / consultas_avisos / intereses_whatsapp con
-- fechas, estados, responsables y notas variados. Idempotente (ids determinísticos + ON CONFLICT DO NOTHING).
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/90-consultas.sql
-- Solo para bases demo. Todos los datos de personas son ficticios.
\set ON_ERROR_STOP on
select id as org_id from public.organizaciones where nombre = :'org' \gset
\if :{?org_id}
begin;
select set_config('demo.org', :'org_id', true);
-- Se desactivan triggers de usuario SOLO en esta transacción: el aviso por correo del alta (consultas_encolar_aviso)
-- dispararía avisos con fecha de hoy; los avisos se insertan abajo con el estado y la fecha que correspondan.
-- La normalización de texto de `normalizar_consulta` se hace a mano (btrim).
set local session_replication_role = replica;

create temp table _c (rn int generated always as identity, emp text, via text, nombre text, contacto text, mensaje text, sku text) on commit drop;
insert into _c (emp, via, nombre, contacto, mensaje, sku) values
 -- San Javucho (de la más vieja a la más nueva)
 ('San Javucho','form','Matías Rinaldi','matias.rinaldi@mail.demo','¿Tienen stock del lector óptico de PS4 KEM-490? Es para una Slim, me lo pasaron como "no anda la lectora".',null),
 ('San Javucho','form','Julieta Cardozo','+54 9 11 5555-3101','Hola, ¿hacen envíos a Salta? Quiero comprar un DualSense blanco y no sé cuánto sale por correo.',null),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'JOY-DSENSE-BL'),
 ('San Javucho','form','Gaming Zone Quilmes','compras@gamingzone.demo','Buenas tardes, necesitamos precio por mayor de joysticks DualShock 4 (30 unidades) y cables HDMI 2.1. Somos un local de alquiler de consolas.',null),
 ('San Javucho','form','Federico Almada','fede.almada@mail.demo','Presupuesto de reparación de una PS5 con el puerto HDMI roto. Se me cayó el cable y quedó flojo. ¿Cuánto tiempo demora?',null),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'REP-PS4-LECTOR'),
 ('San Javucho','form','Camila Bustos','+54 9 11 5555-3102','¿El SSD de 1TB para PS5 viene con disipador? ¿Tiene garantía?',null),
 ('San Javucho','form','Lucas Benavídez','lucas.benavidez@mail.demo','Tengo una Switch Lite con el joystick izquierdo con drift. ¿Cambian la palanca en el momento?',null),
 ('San Javucho','form','Tecno Sur Videojuegos','+54 9 11 5555-3103','Hola, soy de un local en Bahía Blanca. ¿Tienen lista mayorista de repuestos de PS4? Queremos empezar a comprar de forma regular.',null),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'CON-PS5-LEC'),
 ('San Javucho','form','Agustina Leiva','agus.leiva@mail.demo','¿Cuándo vuelve a haber stock de la Xbox Series X? Quiero que me avisen.',null),
 ('San Javucho','form','Nahuel Ibarra','+54 9 11 5555-3104','Consulta: ¿venden la fuente original de PS4 o solo genérica? La mía hace un zumbido.',null),
 ('San Javucho','form','Rocío Maidana','rocio.maidana@mail.demo','Compré un kit de destornilladores la semana pasada y me faltó el bit tri-wing. ¿Pueden mandármelo?',null),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'ALM-SSD-1TB-PS5'),
 ('San Javucho','form','Gonzalo Peralta','+54 9 11 5555-3105','Mi PS4 Slim se apaga a los 10 minutos. ¿Es el ventilador o la pasta térmica? ¿Cuánto sale la limpieza completa?',null),
 ('San Javucho','form','Distribuidora El Faro','ventas@elfaro.demo','Necesitamos cotización por mayor de microSD 128GB y 256GB, 100 unidades. Factura A.',null),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'HER-SOLD-60W'),
 ('San Javucho','form','Brenda Quiroga','brenda.quiroga@mail.demo','¿Aceptan transferencia con descuento? Quiero llevar la PS5 Slim con lectora.',null),
 ('San Javucho','form','Santiago Ferreyra','+54 9 11 5555-3106','¿Tienen la batería del DualSense? Mi joystick dura una hora y media.',null),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'JOY-PROCON-NSW'),
 ('San Javucho','form','Emiliano Ortega','emi.ortega@mail.demo','Hola, ¿tienen soldador de 60W y estaño para empezar a reparar joysticks? Soy principiante, ¿qué me recomiendan?',null),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'REP-DSENSE-STICK'),
 ('San Javucho','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'CON-PS4-SLIM'),
 -- Mundo JC
 ('Mundo JC','form','Valentina Roldán','valen.roldan@mail.demo','Hola, ¿tienen la PS5 Slim digital? ¿Se puede retirar en el local de Obispo Trejo?',null),
 ('Mundo JC','form','Ezequiel Cabrera','+54 351 555-4401','¿Hacen envíos a Jujuy? Quiero un Pro Controller de Switch y una microSD de 256GB.',null),
 ('Mundo JC','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'CON-XBS-S'),
 ('Mundo JC','form','Kiosco Gamer Villa María','+54 9 353 555-4402','Precio por mayor de auriculares gamer y cables HDMI. Tenemos kiosco de cartuchos y queremos sumar accesorios.',null),
 ('Mundo JC','form','Antonella Ledesma','anto.ledesma@mail.demo','¿La plancha de pelo cerámica tiene garantía? ¿Qué temperatura máxima alcanza?',null),
 ('Mundo JC','form','Maximiliano Vera','maxi.vera@mail.demo','¿Cuánto sale el envío de una Switch Lite a Río Cuarto? ¿Llega en dos días?',null),
 ('Mundo JC','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'JOY-DSENSE-NG'),
 ('Mundo JC','form','Florencia Acosta','+54 9 351 555-4403','¿Tienen cargador de 20W con cable para iPhone? Pregunto también si ofrecen cuotas.',null),
 ('Mundo JC','form','Iván Sosa','ivan.sosa@mail.demo','Quiero comprar tres joysticks DualSense para regalo. ¿Hay descuento llevando tres?',null),
 ('Mundo JC','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'BEL-PLANCHA'),
 ('Mundo JC','form','Daniela Gómez','+54 351 555-4404','Consulta por Belleza: ¿tienen el secador de 2200 W en stock? Lo necesito para el sábado.',null),
 ('Mundo JC','form','Cristian Paz','cris.paz@mail.demo','¿Hacen service de Xbox Series S? Se tilda en el logo de inicio.',null),
 ('Mundo JC','wa','Visitante de WhatsApp','visitante@sin-datos.invalid',null,'AUD-HEADSET-BT'),
 ('Mundo JC','form','Lorena Funes','+54 9 351 555-4405','¿Cuándo llega la PlayStation 5 Pro? ¿Se puede señar?',null);

-- Posición relativa (0 = la más vieja, 1 = la más nueva) dentro de cada empresa y fecha repartida en ~58 días.
-- La hora del día se desparrama con aritmética determinística para que no queden todas a la misma hora.
create temp table _k on commit drop as
select c.*, e.id as empresa_id,
       (c.rn - min(c.rn) over (partition by c.emp))::numeric / nullif(count(*) over (partition by c.emp) - 1, 0) as pos,
       md5(:'org_id' || '|consulta|' || c.rn)::uuid as id
  from _c c join dominio.empresas e on e.organizacion_id = :'org_id'::uuid and e.nombre = c.emp;

-- Responsables posibles por empresa (usuarios demo con acceso a Consultas): por correo del usuario demo.
create temp table _resp (emp text, user_id uuid, correo text) on commit drop;
insert into _resp (emp, user_id, correo)
select x.emp, a.id, a.email::text
  from (values ('San Javucho','admin'),('San Javucho','operador'),('San Javucho','mostrador'),('San Javucho','administracion'),
               ('Mundo JC','admin'),('Mundo JC','operador'),('Mundo JC','administracion')) x(emp, clave)
  join auth.users a on a.email = x.clave || :'sufijo' || '@demo.msf.test';

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje, producto_id, estado, responsable_id, nota_interna, created_at, updated_at)
select k.id, :'org_id'::uuid, k.empresa_id,
       case k.via when 'wa' then 'whatsapp' else 'formulario' end,
       k.nombre, k.contacto, k.mensaje, p.id,
       s.estado,
       case when s.estado <> 'nueva' or k.rn % 3 = 0 then r.user_id end,
       case when s.estado = 'resuelta' then (array['Respondido por correo. Consulta cerrada.','Compró por transferencia, se despachó con guía.','Pasó por el local y se resolvió en el mostrador.','Se le explicó el costo de envío, no avanzó. Cerrada.','Reparación aceptada, ingresó a service.'])[1 + k.rn % 5]
            when s.estado = 'en_curso' and k.rn % 4 <> 0 then (array['Le escribí por WhatsApp, quedó en confirmar el modelo.','Pedí precio actualizado al proveedor, le respondo mañana.','Esperando que mande foto del daño para cotizar.','Se le pasó presupuesto, a la espera de respuesta.'])[1 + k.rn % 4]
            when s.estado = 'nueva' and k.rn % 9 = 0 then 'Para atender primero: cliente mayorista.' end,
       f.creada,
       case when s.estado = 'nueva' and k.rn % 3 <> 0 then f.creada else f.creada + (interval '1 hour' * (2 + k.rn % 30)) end
  from _k k
  cross join lateral (select case when k.pos < 0.40 then 'resuelta' when k.pos < 0.68 then 'en_curso' else 'nueva' end as estado) s
  cross join lateral (select date_trunc('day', now()) - ((58 - round(57 * k.pos))::int * interval '1 day')
                             + interval '1 hour' * (9 + (k.rn * 5) % 10) + interval '1 minute' * ((k.rn * 13) % 60) as creada) f
  left join dominio.productos p on p.organizacion_id = :'org_id'::uuid and p.sku = k.sku
  left join lateral (select user_id from _resp r where r.emp = k.emp order by md5(r.correo || k.rn) limit 1) r on true
on conflict (id) do nothing;

-- Avisos por correo (cola histórica `consultas_avisos`). Se dejan en los cuatro estados como los dejaría el barrido:
-- enviado (casi todos), fallido (tope de 5 intentos con error útil), pendiente (las más nuevas, aún sin barrer) y
-- sin_destinatario (algunas de Mundo JC, que no tiene correo de avisos propio en la demo).
insert into dominio.consultas_avisos (consulta_id, organizacion_id, empresa_id, estado, intentos, ultimo_error, enviado_en, created_at, updated_at)
select k.id, :'org_id'::uuid, k.empresa_id, a.estado,
       case a.estado when 'enviado' then 1 when 'fallido' then 5 else 0 end,
       case a.estado when 'fallido' then 'No se pudo enviar el correo: tiempo de espera agotado al conectar con el servidor SMTP.' end,
       case a.estado when 'enviado' then c.created_at + interval '1 minute' end,
       c.created_at, c.created_at + interval '1 minute'
  from _k k
  join dominio.consultas c on c.id = k.id
  cross join lateral (select case
      when k.pos >= 0.93 then 'pendiente'
      when k.emp = 'Mundo JC' and k.rn % 6 = 0 then 'sin_destinatario'
      when k.rn % 11 = 0 then 'fallido'
      else 'enviado' end as estado) a
on conflict (consulta_id) do nothing;

-- Actividad del panel (registro_actividad) de lo que hizo el equipo: la deja la RPC `actualizar_consulta` al atender.
-- Solo para las consultas que insertó este paso y todavía no tienen su rastro (idempotente por detalle + fecha).
do $$
declare r record; v_id uuid;
begin
  for r in
    select c.id, c.empresa_id, c.estado, c.responsable_id, c.updated_at, e.nombre as empresa
      from dominio.consultas c join dominio.empresas e on e.id = c.empresa_id
     where c.organizacion_id = current_setting('demo.org')::uuid and c.estado <> 'nueva' and c.responsable_id is not null
       and c.id in (select id from _k)
       and not exists (select 1 from public.registro_actividad a where a.organizacion_id = c.organizacion_id
                        and a.tipo = 'consulta.estado_cambiado' and a.creado_en = c.updated_at)
  loop
    v_id := private.insertar_actividad(current_setting('demo.org')::uuid, r.responsable_id, 'consulta.estado_cambiado',
      format('Cambió el estado de una consulta de «%s» a «%s»', r.empresa, case r.estado when 'en_curso' then 'En curso' else 'Resuelta' end), r.empresa_id);
    update public.registro_actividad set creado_en = r.updated_at where id = v_id;
  end loop;
end $$;

-- Interés por «Consultar por WhatsApp»: un registro por toque, sin datos personales, repartidos en 60 días.
-- [empresa, sku, toques]; más toques en los productos estrella.
create temp table _i (emp text, sku text, veces int) on commit drop;
insert into _i values
 ('San Javucho','CON-PS5-LEC',14),('San Javucho','JOY-DSENSE-BL',11),('San Javucho','REP-PS5-LECTOR',8),('San Javucho','ALM-SSD-1TB-PS5',7),
 ('San Javucho','CON-NSW-OLED',6),('San Javucho','REP-PS4-LECTOR',5),('San Javucho','JOY-DS4-NG',4),('San Javucho','HER-KIT-24',3),('San Javucho','AUD-HEADSET-BT',2),
 ('Mundo JC','CON-PS5-DIG',9),('Mundo JC','CON-XBS-S',6),('Mundo JC','JOY-DSENSE-NG',5),('Mundo JC','BEL-PLANCHA',4),('Mundo JC','CON-NSW-LITE',3),('Mundo JC','CEL-POWER-10K',1);
insert into dominio.intereses_whatsapp (id, organizacion_id, empresa_id, producto_id, created_at)
select md5(:'org_id' || '|interes|' || i.emp || i.sku || g)::uuid, :'org_id'::uuid, e.id, p.id,
       now() - interval '1 day' * ((g * 37 + length(i.sku) * 11) % 59) - interval '1 second' * ((g * 5311) % 80000)
  from _i i
  join dominio.empresas e on e.organizacion_id = :'org_id'::uuid and e.nombre = i.emp
  join dominio.productos p on p.organizacion_id = :'org_id'::uuid and p.sku = i.sku
  cross join lateral generate_series(1, i.veces) g
on conflict (id) do nothing;

commit;

select e.nombre as empresa, c.origen, c.estado, count(*) from dominio.consultas c join dominio.empresas e on e.id = c.empresa_id
 where c.organizacion_id = :'org_id'::uuid group by 1, 2, 3 order by 1, 2, 3;
\else
\echo 'No existe la organización: se omite 90-consultas.sql'
\endif
