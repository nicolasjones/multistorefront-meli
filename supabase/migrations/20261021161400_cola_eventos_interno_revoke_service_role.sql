-- MSF-249 (revisión PR #154): las *_interno son SECURITY DEFINER sin guarda de rol; si existieran
-- default privileges hacia service_role en `private`, ese rol las ejecutaría sin pasar por la guarda
-- de kestra_orquestacion. Se revoca explícitamente (aditiva: solo quita privilegios).
-- Reversión: grant execute on function private.reclamar_eventos_interno(text, integer, integer, integer),
-- private.resolver_evento_interno(uuid, integer, text, text, integer, integer) to service_role;
revoke execute on function private.reclamar_eventos_interno(text, integer, integer, integer) from service_role;
revoke execute on function private.resolver_evento_interno(uuid, integer, text, text, integer, integer) from service_role;
