-- MSF-467 · Opiniones de productos, Fase 1 «Base» (T002). RF-OPI-5, D9, CA-OPI-6.
-- Casos borde de `private.validar_texto_opinion` y `private.nombre_publico_cliente`.
begin;

select plan(99);

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
-- Punto pegado + palabra corta: frases legítimas que NO son enlaces
select is(pg_temp.ok_(5, 'Anda bien.No se calienta nada'), true, 'sin falso positivo: «bien.No»');
select is(pg_temp.ok_(5, 'Muy bueno.me gustó muchísimo'), true, 'sin falso positivo: «bueno.me gustó»');
select is(pg_temp.ok_(5, 'Lo uso a diario.es genial para todo'), true, 'sin falso positivo: «diario.es genial»');
select is(pg_temp.ok_(5, 'Me encantó, sí.No sé qué más decir'), true, 'sin falso positivo: «sí.No sé»');
select is(pg_temp.ok_(5, 'Excelente producto.Llegó rápido y bien'), true, 'sin falso positivo: «producto.Llegó»');
select is(pg_temp.ok_(5, 'Todo ok.Excelente atención de verdad'), true, 'sin falso positivo: «ok.Excelente»');
select is(pg_temp.ok_(5, 'Quedó perfecto.todo funciona muy bien'), true, 'sin falso positivo: «perfecto.todo»');
select is(pg_temp.ok_(5, 'Es muy útil.Se lo recomiendo a todos'), true, 'sin falso positivo: «útil.Se lo»');
-- Enlaces reales con TLD de país o acortador
select is(pg_temp.ok_(5, 'Escribime a t.me/x cuando quieras'), false, 't.me/x');
select is(pg_temp.ok_(5, 'Escribime a wa.me/549 cuando quieras'), false, 'wa.me/549');
select is(pg_temp.ok_(5, 'Mirá bit.ly/a que sale menos'), false, 'bit.ly/a');
select is(pg_temp.ok_(5, 'Mirá youtu.be/z que está bueno'), false, 'youtu.be/z');
select is(pg_temp.ok_(5, 'Comprá en ejemplo.com.ar hoy mismo'), false, 'ejemplo.com.ar');
select is(pg_temp.ok_(5, 'Comprá en mi-tienda.es, hoy mismo'), false, 'mi-tienda.es');
select is(pg_temp.ok_(5, 'Comprá en mitienda.es.'), false, 'mitienda.es al final de frase');
select is(pg_temp.ok_(5, 'Comprá en x.mx hoy mismo'), false, 'x.mx');
select is(pg_temp.ok_(5, 'Comprá en ejemplo.cl/ofertas hoy'), false, 'ejemplo.cl/ofertas');
select is(pg_temp.ok_(5, 'Comprá en mitienda3.me, no te lo pierdas'), false, 'dominio con dígito .me seguido de coma');
-- Puntos de otras escrituras se normalizan
select is(pg_temp.ok_(5, 'Comprá en ejemplo' || chr(12290) || 'com hoy mismo'), false, 'punto ideográfico U+3002');
select is(pg_temp.ok_(5, 'Comprá en ejemplo' || chr(65294) || 'com hoy mismo'), false, 'punto de ancho completo U+FF0E');
select is(pg_temp.ok_(5, 'Comprá en ejemplo' || chr(65377) || 'com hoy mismo'), false, 'punto de media anchura U+FF61');
select is(pg_temp.ok_(5, 'Comprá en ejemplo[.]com hoy mismo'), true, 'ejemplo[.]com NO se detecta (limitación conocida)');
select is(pg_temp.ok_(5, 'Comprá en ejemplo(.)com hoy mismo'), true, 'ejemplo(.)com NO se detecta (limitación conocida)');
select is(pg_temp.ok_(5, 'Comprá en ejemplo.' || chr(1089) || 'om hoy mismo'), true, 'homógrafos cirílicos NO se detectan (limitación conocida)');
select is(private.texto_opinion_no_permitido('Producto. Top calidad'), false, 'texto_opinion_no_permitido: frase legítima');
select is(private.texto_opinion_no_permitido('visitá ejemplo.com ya'), true, 'texto_opinion_no_permitido: enlace');

-- Acortadores y TLD de país: se rechazan
select is(pg_temp.ok_(5, 'Escribime a t.me/vendedor ahora'), false, 't.me/');
select is(pg_temp.ok_(5, 'Escribime a wa.me/5491112345678 ahora'), false, 'wa.me/');
select is(pg_temp.ok_(5, 'Mirá bit.ly/abc123 que sale menos'), false, 'bit.ly/');
select is(pg_temp.ok_(5, 'Mirá youtu.be/xyz123 que está bueno'), false, 'youtu.be/');
select is(pg_temp.ok_(5, 'Mirá tinyurl.com/abc que sale menos'), false, 'tinyurl.com/');
select is(pg_temp.ok_(5, 'Comprá en mitienda.ar que sale menos'), false, 'TLD de país .ar');
select is(pg_temp.ok_(5, 'Comprá en mitienda.com.ar que sale menos'), false, '.com.ar');
select is(pg_temp.ok_(5, 'Comprá en mitienda.es o mitienda.mx hoy'), false, '.es y .mx');
select is(pg_temp.ok_(5, 'Comprá en mitienda.cl, mitienda.uy o mitienda.br'), false, '.cl .uy .br');
select is(pg_temp.ok_(5, 'Comprá en mitienda.co o mitienda.me hoy'), false, '.co y .me');
select is(pg_temp.ok_(5, 'Comprá en mitienda.ar'), false, 'dominio al final del texto');
select is(pg_temp.ok_(5, 'Visitá mitienda.xyzabc/oferta hoy mismo'), false, 'cualquier TLD seguido de barra');
-- Frases normales: se aceptan
select is(pg_temp.ok_(5, 'Pedí el 10. Es ok. Muy bueno todo'), true, 'sin falso positivo: número, punto y espacio');
select is(pg_temp.ok_(5, 'Compré en Mar. Me llegó bien, gracias'), true, 'sin falso positivo: «Mar. Me»');
select is(pg_temp.ok_(5, 'Llegó el 3.5 de calificación, genial'), true, 'decimales no son dominio');
select is(pg_temp.ok_(5, 'Usan http y https para pagar, está bien'), true, '«http» sola, sin dos puntos, se acepta a propósito');
select is(pg_temp.ok_(5, 'Compra segura, ejemplo punto com no es enlace'), true, 'la ofuscación «punto com» NO se detecta (limitación conocida)');
select is(pg_temp.ok_(5, 'Calidad / precio excelente, recomiendo y/o comprar'), true, 'barras sueltas sin dominio');
-- Rendimiento con entradas hostiles de 50.000 caracteres: tiempo lineal (la comprobación va sobre el texto completo)
create function pg_temp.ms(p_txt text) returns numeric language plpgsql as $$
declare t0 timestamptz := clock_timestamp();
begin
  perform private.texto_opinion_no_permitido(p_txt);
  return extract(epoch from clock_timestamp() - t0) * 1000;
end $$;
select cmp_ok(pg_temp.ms(repeat('a', 50000)), '<', 1000::numeric, '50.000 letras: < 1 s');
select cmp_ok(pg_temp.ms(repeat('a.', 25000)), '<', 1000::numeric, '50.000 caracteres «a.a.a.»: < 1 s');
select cmp_ok(pg_temp.ms(repeat('a-', 25000) || ' fin'), '<', 1000::numeric, '50.000 caracteres «a-a-»: < 1 s');
select cmp_ok(pg_temp.ms(repeat('http ', 10000)), '<', 1000::numeric, '50.000 caracteres «http »: < 1 s');
select cmp_ok(pg_temp.ms(repeat('ab.', 16000) || ' x'), '<', 1000::numeric, '48.000 caracteres «ab.ab.»: < 1 s');
select cmp_ok(pg_temp.ms(repeat(' ', 50000) || '.com'), '<', 1000::numeric, '50.000 espacios y «.com»: < 1 s');
select cmp_ok(pg_temp.ms(repeat('Bien.No ', 25000)), '<', 1000::numeric, '200.000 caracteres «Bien.No »: < 1 s');
select cmp_ok(pg_temp.ms(repeat('mi-tienda.', 20000)), '<', 1000::numeric, '200.000 caracteres «mi-tienda.»: < 1 s');
select cmp_ok(pg_temp.ms(repeat('a', 200000)), '<', 1000::numeric, '200.000 letras: < 1 s');

select is(private.nombre_publico_cliente('Valeria Sánchez'), 'Valeria', 'solo el nombre de pila');
select is(private.nombre_publico_cliente('   '), 'Cliente', 'vacío -> Cliente');
select is(private.nombre_publico_cliente(null), 'Cliente', 'nulo -> Cliente');
select is(private.nombre_publico_cliente(repeat('a', 50) || ' Pérez'), repeat('a', 30), 'hasta 30 caracteres');

select * from finish();
rollback;
