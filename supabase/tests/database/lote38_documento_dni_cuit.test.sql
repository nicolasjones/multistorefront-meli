-- Lote 38: DNI/CUIT validados en el servidor. Clientes: DNI de 7-8 dígitos o CUIT de 11 con dígito verificador (vacío ok),
-- solo al insertar o cuando cambia el campo (un valor viejo inválido no bloquea editar otras columnas). Empresas: CUIT con
-- dígito verificador. Importación: la fila inválida se rechaza con su motivo.
begin;

select plan(19);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre) values ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A');

-- Cliente: válidos.
select lives_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'A', '12345678')$$, 'DNI de 8 dígitos');
select lives_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'B', '1234567')$$, 'DNI de 7 dígitos');
select lives_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'C', '20-12345678-6')$$, 'CUIT válido con guiones');
select lives_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'D', '12.345.679')$$, 'DNI con puntos');
select lives_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'E', null)$$, 'documento nulo permitido');
select lives_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'F', '   ')$$, 'documento vacío permitido');

-- Cliente: inválidos.
select throws_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'X', '123456')$$, '23514', null, 'DNI de 6 dígitos rechazado');
select throws_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'X', '123456789')$$, '23514', null, '9 dígitos rechazado');
select throws_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'X', '20-12345678-9')$$, '23514', null, 'CUIT con dígito verificador malo rechazado');
select throws_ok($$insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'X', 'AB1234567')$$, '23514', null, 'letras rechazadas');

-- Edición: cambiar el documento a uno inválido se rechaza; cambiar otra columna de una fila vieja inválida no.
select throws_ok($$update dominio.clientes set documento = '99' where nombre = 'A'$$, '23514', null, 'editar el documento a uno inválido se rechaza');
alter table dominio.clientes disable trigger clientes_validar_documento;
insert into dominio.clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'Viejo', 'PASAPORTE-X');
alter table dominio.clientes enable trigger clientes_validar_documento;
select lives_ok($$update dominio.clientes set localidad = 'Salta' where nombre = 'Viejo'$$, 'una fila vieja inválida sigue editable en otras columnas');
select throws_ok($$update dominio.clientes set documento = 'OTRO' where nombre = 'Viejo'$$, '23514', null, 'pero al tocar el documento se valida');

-- Importación.
select is(private.validar_fila_cliente_migracion('{"id_externo":"1","nombre":"Z","documento":"12345"}'::jsonb),
  'El DNI/CUIT no es válido: debe ser un DNI de 7 u 8 dígitos o un CUIT de 11 dígitos con dígito verificador', 'la importación rechaza un documento inválido');
select is(private.validar_fila_cliente_migracion('{"id_externo":"1","nombre":"Z","documento":"20123456786"}'::jsonb), null, 'la importación acepta un CUIT válido');
select is(private.validar_fila_cliente_migracion('{"id_externo":"1","nombre":"Z"}'::jsonb), null, 'la importación acepta sin documento');

-- Empresas.
select lives_ok($$update dominio.empresas set cuit = '30712345671' where id = 'e1000000-0000-0000-0000-00000000000a'$$, 'CUIT de empresa válido (30-71234567-1)');
select throws_ok($$update dominio.empresas set cuit = '30712345678' where id = 'e1000000-0000-0000-0000-00000000000a'$$, '23514', 'El CUIT no es válido: revisá el dígito verificador', 'CUIT de empresa con dígito verificador malo rechazado');
select lives_ok($$update dominio.empresas set cuit = null where id = 'e1000000-0000-0000-0000-00000000000a'$$, 'CUIT de empresa nulo permitido');

select * from finish();
rollback;
