-- MSF-467 · Opiniones de productos, Fase 1 «Base» (T002). RF-OPI-5, D9, CA-OPI-6.
-- Casos borde de `private.validar_texto_opinion` y `private.nombre_publico_cliente`.
begin;

select plan(48);

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

select is(pg_temp.ok_(5, 'Excelente producto. Top calidad total'), true, 'sin falso positivo: «. Top» tras cierre de frase');
select is(pg_temp.ok_(5, 'Llegó rápido. Online todo bien, gracias'), true, 'sin falso positivo: «. Online» tras cierre de frase');
select is(pg_temp.ok_(5, 'Buen vendedor. Store ordenada y rápida'), true, 'sin falso positivo: «. Store»');
select is(pg_temp.ok_(5, 'Muy buena atención. Link de pago funcionó. Info clara'), true, 'sin falso positivo: «. Link» e «. Info»');
select is(pg_temp.ok_(5, 'Llegó bien. Club de fans feliz. Dev rápido. App fácil. Net ok'), true, 'sin falso positivo: Club, Dev, App, Net');
select is(pg_temp.ok_(5, 'Compré en 3 cuotas . com tarjeta y salió bien'), true, 'espacios alrededor del punto no forman un dominio');
select is(pg_temp.ok_(5, 'Mirá ejemplo.top que sale menos'), false, 'dominio real .top');
select is(pg_temp.ok_(5, 'Entrá a mitienda.online ya mismo'), false, 'dominio real .online');
select is(pg_temp.ok_(5, 'Visitá mi-sitio.store para ofertas'), false, 'dominio real .store con guion');
select is(pg_temp.ok_(5, 'Escribime a promo.link, gracias'), false, 'dominio real .link seguido de coma');
select is(pg_temp.ok_(5, 'Todo en ejemplo.com/ofertas hoy'), false, 'dominio con ruta');
select is(pg_temp.ok_(5, 'Mirá www . ejemplo y listo ya'), false, 'www con espacios sigue rechazado');
select is(pg_temp.ok_(5, 'Mirá http ://ejemplo ahora mismo'), false, 'http con espacio antes de los dos puntos sigue rechazado');
select is(private.texto_opinion_no_permitido('Producto. Top calidad'), false, 'texto_opinion_no_permitido: frase legítima');
select is(private.texto_opinion_no_permitido('visitá ejemplo.com ya'), true, 'texto_opinion_no_permitido: enlace');

select is(private.nombre_publico_cliente('Valeria Sánchez'), 'Valeria', 'solo el nombre de pila');
select is(private.nombre_publico_cliente('   '), 'Cliente', 'vacío -> Cliente');
select is(private.nombre_publico_cliente(null), 'Cliente', 'nulo -> Cliente');
select is(private.nombre_publico_cliente(repeat('a', 50) || ' Pérez'), repeat('a', 30), 'hasta 30 caracteres');

select * from finish();
rollback;
