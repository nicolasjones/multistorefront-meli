---
owner: tecnico
sources:
  - specs/20261114-100000-analitica-avanzada-y-resumen-por-correo
  - supabase/migrations
  - apps/web/src
---

# Revisión de seguridad integral: analítica avanzada y resumen por correo (MSF-265)

Alcance: spec `specs/20261114-100000-analitica-avanzada-y-resumen-por-correo/` (F-REP-07 y F-REP-08), migraciones `20270324100000`–`20270324100300`, Edge Function `enviar-resumen-semanal`, flow `resumen-semanal`, galería y tableros. Metodología: lectura de cada objeto nuevo contra `CLAUDE.md`, la constitución (Principios I, III, VII, VIII), `docs/aislamiento-por-organizacion.md` y las skills `authz-security`, `crypto-secrets` e `infra-security`; las pruebas se corrieron a mano en la base de dev dentro de `begin … rollback`.

## Resultado

Sin hallazgos críticos ni altos abiertos. Dos observaciones de bajo riesgo documentadas (ver «Riesgos residuales»).

## 1. RLS y esquemas (Principio VII, Principio I)

| Objeto | Esquema | Control | Evidencia |
|---|---|---|---|
| `public.resumen_semanal_config` | `public` (plataforma) | RLS activada, **sin políticas** ni privilegios para `anon`/`authenticated`/`public`; solo funciones `security definer` | pgTAP `resumen_semanal.test.sql` (tests 1–4) |
| `public.resumen_semanal_envios` | `public` (plataforma) | Ídem | Ídem |
| Vistas `analitica.ventas_empresa_categoria`, `analitica.margen_real_categoria` | `analitica` | `revoke all` de `public`/`anon`/`authenticated`; `select` solo a `superset_analitica`; no `security_invoker` (el aislamiento lo fuerza el token) | pgTAP `analitica_tableros_avanzados.test.sql` (tests 13–15) |
| Las dos tablas nuevas en la exportación total | — | Excluidas en `private.exclusiones_exportacion_total()` (no son dato de negocio) | pgTAP `exportacion_total` verde con las migraciones |

`analitica` no contiene tablas; `rls_en_toda_tabla` (public + dominio) verde.

## 2. Grants y `anon` (CLAUDE.md)

- `anon` no ejecuta ninguna función nueva ni tiene privilegios sobre tablas o vistas nuevas (pgTAP `resumen_semanal.test.sql` y `privilegios_anon_endurecidos` verde con las migraciones aplicadas).
- RPC del barrido (`organizaciones_con_resumen_semanal_pendiente`, `generar_resumen_semanal`, `cerrar_resumen_semanal`): `revoke … from public, anon, authenticated` y `grant … to service_role`. `authenticated` no las ejecuta.
- RPC de la app (`configurar_resumen_semanal`, `estado_resumen_semanal`): `revoke … from public, anon` + `grant … to authenticated`, y **además** exigen `private.puede_escribir()` (administrador de la organización de la sesión, o superadmin con organización activa) con `42501` en otro caso.
- Funciones `private.*`: `revoke … from public, anon, authenticated`; ninguna se concede a la app.
- Los tres disparadores de asignación de tableros no son invocables fuera de un trigger y además se les quita el `execute`.

## 3. `security definer` y `search_path`

Las 12 funciones nuevas (9 del resumen —5 en `public` y 4 en `private`— y 3 disparadores) son `security definer` con `set search_path = ''` y referencias calificadas; un pgTAP lo verifica por catálogo (`proconfig`). La organización de las RPC de la app sale de la sesión (`private.organizacion_id()`), nunca de un parámetro; la del barrido llega por argumento porque quien llama es `service_role`.

## 4. Secretos

- `RESUMEN_SEMANAL_TOKEN` (función) y `SECRET_RESUMEN_SEMANAL_TOKEN` (Kestra, base64) solo por entorno; en Git solo `change-me-local` en los `.env.example`. El flow usa `{{ secret('RESUMEN_SEMANAL_TOKEN') }}` y no escribe ningún valor (`validar-resumen-semanal.test.mjs`).
- La función compara el token en tiempo constante (`timingSafeEqual`), falla cerrada sin token configurado (503) y no hace de relay: los destinatarios los resuelve la base.
- La clave de servicio vive solo en la función; el navegador nunca la ve. El SMTP usa los `SMTP_*` existentes.
- Los errores que van a la tabla son un texto fijo; el detalle del SMTP (host, IP, correo) se sanea y solo va a los registros de la función. El registro del correo no incluye direcciones.
- Contraseña de la base de Superset: sigue enmascarada (`XXXXXXXXXX`) en los YAML nuevos y por entorno al importar (`analitica-avanzada.test.mjs` verifica que no viaja).

## 5. Aislamiento del embebido (F-REP-07)

- La regla de la spec 007 se mantiene: el administrador **no entra a Superset ni edita**; no se creó ninguna excepción, ningún rol de Superset nuevo ni permisos de edición.
- El guest token lo emite el servidor con la organización que resuelve `resolver_organizacion_reporte` **como el usuario** (nunca la que mande el cliente) y, por `filtro_empresa = true`, solo las empresas accesibles; sin empresas resolubles no hay token (falla cerrada). La Edge Function no cambió.
- Las vistas nuevas exponen `organizacion_id` y `empresa_id` en cada fila; pgTAP prueba que ninguna fila de una organización trae la empresa de otra.
- Los filtros que preselecciona la pantalla (`native_filters`) se arman con constantes y el nombre de la tienda escapado en rison; **no son un control de acceso**: manipularlos solo reduce lo visible.
- El tablero de margen exige la sección `rentabilidad` (`resolver_organizacion_reporte` devuelve null sin ella → 403 → «Acceso restringido»). **La galería es «solo administradores» únicamente en la pantalla** (`usePuedeEscribir`); el servidor exige la **sección** del tablero, no el rol, igual que con todos los demás reportes. Quien tiene la sección y el reporte asignado podría pedir el token por fuera de la pantalla, pero ese token sigue acotado a su organización y a sus empresas accesibles: no hay fuga de aislamiento ni escalada. Desvío declarado; exigir el rol en el servidor cambiaría el contrato de la spec 007.
- La asignación automática a todas las organizaciones no da acceso a datos ajenos: asignar es visibilidad del reporte, el acceso a las filas lo decide el token. **Acoplamiento por prefijo**: cualquier reporte registrado con el nombre «Analítica · …» se asigna a todas las organizaciones; registrar reportes solo puede el superadmin (o el importador server-side con la clave de servicio), así que el riesgo es de nombre, no de acceso.

## 6. Contenido del correo

Solo agregados de la organización del destinatario (totales, conteos, nombres de producto en alerta). Un pgTAP busca nombres de clientes, arrobas y productos de otra organización en el contenido y no los encuentra. El correo es texto plano: no hay HTML que inyectar; los nombres de tienda y producto pasan por `lineaSegura` (sin saltos de línea ni caracteres de control, para no inyectar cabeceras).

## 7. Auditoría (Principio III)

Pausar y reanudar dejan evento en `registro_actividad` (actor, organización, hora) solo ante un cambio real. Cada resumen deja estado, intentos, timestamps y error en `resumen_semanal_envios`.

## Riesgos residuales

0. **Cuerpo del pedido acotado**: la función lee el cuerpo con un tope de 64 KB y solo después de validar el token (`413` si se pasa; `403` sin token).
1. **Entrega «al menos una vez»**: si el correo sale y la base no cierra el resumen, el reintento puede duplicarlo; queda en los registros. Aceptado (igual que MSF-394/405).
2. **Nada se validó contra sistemas reales** (MSF-949): ni Superset (importación y render), ni Kestra (cron con zona horaria y secreto base64), ni SMTP, ni el recorrido de punta a punta; la Edge Function nueva no se registra en dev hasta recrear el stack.
3. **Destinatarios**: no se excluye a baneados ni a correos sin confirmar (mismo criterio que el resumen de reposición) y los administradores de una organización comparten un único mensaje, así que se ven las direcciones entre sí.
4. **Una pausa con el correo ya en camino**: el resumen se deja terminar y, si salió, queda `enviado`; los de semanas anteriores sin enviar se cierran como `vencido`.
