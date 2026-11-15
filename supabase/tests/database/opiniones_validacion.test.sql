-- MSF-467 · Opiniones de productos, Fase 1 «Base» (T002). RF-OPI-5, D9, CA-OPI-6.
-- Casos borde de `private.validar_texto_opinion` y `private.nombre_publico_cliente`.
begin;

select plan(33);

create function pg_temp.ok_(p_punt int, p_txt text) returns boolean language sql as
  $$ select (private.validar_texto_opinion(p_punt, p_txt)->>'ok')::boolean $$;

select is(pg_temp.ok_(5, 'Excelente producto, llegó bien'), true, 'caso válido');
select is(pg_temp.ok_(1, repeat('a', 10)), true, 'puntuación 1 y 10 caracteres exactos');
select is(pg_temp.ok_(5, repeat('a', 1000)), true, '1.000 caracteres exactos');
select is(pg_temp.ok_(5, repeat('a', 9)), false, '9 caracteres: inválido');
select is(pg_temp.ok_(5, repeat('a', 1001)), false, '1.001 caracteres: inválido');
select is(pg_temp.ok_(5, '   ' || repeat('a', 9) || '   '), false, 'el recorte cuenta: 9 útiles con espacios no alcanzan');
select is(private.validar_texto_opinion(5, '  ' || repeat('a', 10) || '  ')->>'comentario', repeat('a', 10), 'devuelve el comentario recortado');
select is(pg_temp.ok_(0, 'Comentario suficientemente largo'), false, 'puntuación 0');
select is(pg_temp.ok_(6, 'Comentario suficientemente largo'), false, 'puntuación 6');
select is(pg_temp.ok_(null, 'Comentario suficientemente largo'), false, 'puntuación nula');
select is(pg_temp.ok_(5, null), false, 'comentario nulo');
select is(private.validar_texto_opinion(0, 'corto')->'campos', '["puntuacion","comentario"]'::jsonb, 'lista ambos campos erróneos');
select is(private.validar_texto_opinion(3, 'corto')->'campos', '["comentario"]'::jsonb, 'lista solo el comentario');
select is(private.validar_texto_opinion(9, 'Comentario suficientemente largo')->'campos', '["puntuacion"]'::jsonb, 'lista solo la puntuación');
select is(pg_temp.ok_(5, 'Mirá http://ejemplo.com ahora mismo'), false, 'http con esquema');
select is(pg_temp.ok_(5, 'Mirá HTTPS://ejemplo.com ahora'), false, 'https en mayúsculas');
select is(pg_temp.ok_(5, 'Visitá www.ejemplo para más info'), false, 'www.');
select is(pg_temp.ok_(5, 'Comprá en ejemplo.com que sale menos'), false, 'dominio suelto .com');
select is(pg_temp.ok_(5, 'Comprá en ejemplo.com.ar que sale menos'), false, 'dominio suelto .com.ar');
select is(pg_temp.ok_(5, 'Comprá en tienda.shop que sale menos'), false, 'dominio suelto .shop');
select is(pg_temp.ok_(5, 'Muy bueno. Llegó rápido y funciona.'), true, 'puntos de oración no son enlaces');
select is(pg_temp.ok_(5, E'Dos líneas\nde comentario válido'), false, 'salto de línea (control)');
select is(pg_temp.ok_(5, 'Texto con tab' || chr(9) || 'dentro ok'), false, 'tabulación (control)');
select is(pg_temp.ok_(5, 'Texto con nul' || chr(7) || ' dentro ok'), false, 'campana (control)');
select is(pg_temp.ok_(5, 'Texto RTL ' || chr(8238) || 'invertido ok'), false, 'marca de dirección U+202E');
select is(pg_temp.ok_(5, 'Texto con separador' || chr(8232) || ' de línea'), false, 'separador de línea U+2028');
select is(pg_temp.ok_(5, 'Texto con ancho' || chr(8203) || 'cero oculto'), false, 'ancho cero U+200B');
select is(pg_temp.ok_(5, 'Me encantó 😀😀 llegó perfecto'), true, 'emojis permitidos');
select is(pg_temp.ok_(5, '<script>alert(1)</script> ok'), true, 'HTML se guarda literal (se muestra como texto)');

select is(private.nombre_publico_cliente('Valeria Sánchez'), 'Valeria', 'solo el nombre de pila');
select is(private.nombre_publico_cliente('   '), 'Cliente', 'vacío -> Cliente');
select is(private.nombre_publico_cliente(null), 'Cliente', 'nulo -> Cliente');
select is(private.nombre_publico_cliente(repeat('a', 50) || ' Pérez'), repeat('a', 30), 'hasta 30 caracteres');

select * from finish();
rollback;
