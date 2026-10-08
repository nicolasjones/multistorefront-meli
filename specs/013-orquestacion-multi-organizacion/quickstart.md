# Quickstart: validar la orquestación multi-organización

Prueba controlada con un único "servidor de organización" simulado
localmente (un contenedor Docker aparte con un daemon SSH, alcanzable
desde el Kestra local) — no requiere una organización ni un servidor real.

## Prerrequisitos

- `pnpm dev:supabase` y `pnpm dev:kestra` corriendo.
- La migración de esta spec aplicada (`supabase/migrations/<timestamp>_orquestacion_multi_organizacion.sql`).
- Los flows de `infra/kestra/flows/` aplicados vía la API/CLI de Kestra. Antes de importar `plantilla-generico.yml`, renderizarlo con `infra/kestra/renderizar-flow.mjs`, tomando `KESTRA_ORQUESTACION_CONCURRENCIA` del entorno (Kestra 1.3.35 exige un entero literal en `concurrencyLimit`).
- Un contenedor de prueba con `sshd` expuesto, jugando el rol de "servidor de organización" (documentado en el paso 1).

## Pasos

1. **Levantar un servidor de organización de prueba**: un contenedor Docker con `sshd` y el propio Docker-in-Docker (o el socket montado) para poder correr `docker run` remotamente. Anotar host/puerto/usuario.

2. **Aprovisionar la organización de prueba**: llamar a `public.aprovisionar_servidor_organizacion(...)` (contrato en `contracts/gestion-conexiones-y-servidores.md`) con los datos del paso 1. Confirmar que devuelve la credencial del rol de base una sola vez, y que `servidores_organizacion` tiene la fila nueva.

3. **Crear una conexión de prueba**: llamar a `public.crear_conexion(...)` para esa organización con un `sistema_externo` ficticio y una credencial de negocio cualquiera. Confirmar que un miembro sin rol de administrador no puede verla (RLS) — solo el administrador/superadmin.

4. **Disparar el flow genérico**: ejecutarlo con al menos dos organizaciones de prueba (crear una segunda igual que en el paso 1-3) y confirmar:
   - Ambas ejecuciones corren superpuestas en el tiempo (log de Kestra), no una después de la otra (FR-004).
   - Si se crean más organizaciones que el tope de `KESTRA_ORQUESTACION_CONCURRENCIA`, las que excedan el tope esperan turno dentro del mismo flow, sin bloquear el resto (R6).

5. **Forzar una falla de credencial**: usar una credencial de negocio inválida a propósito. Confirmar:
   - Después de los reintentos configurados, `conexiones.estado` pasa a `credencial_invalida`.
   - Aparece una fila nueva en `alertas` con `tipo = credencial`.
   - (Si el canal de notificación está configurado en el entorno de prueba) el administrador de esa organización y quien opera la plataforma reciben el aviso.

6. **Corregir la credencial y re-ejecutar**: confirmar que `conexiones.estado` vuelve a `activa` solo, sin ninguna acción manual adicional más que corregir la credencial (FR-013).

7. **Forzar una falla técnica genérica** (por ejemplo, apagar el contenedor "servidor de organización" antes de la ejecución): confirmar que se alerta únicamente a quien opera la plataforma, no al administrador de la organización (FR-012), y que el estado de la conexión no cambia (no es una falla de credencial).

8. **Excepción con flow dedicado**: insertar una fila en `excepciones_flow_generico` para una de las organizaciones de prueba y ese conector. Re-ejecutar el flow genérico y confirmar que esa organización queda excluida (FR-005).

9. **RLS con pgTAP**: correr `pnpm test` (o el subconjunto de pgTAP de esta spec) y confirmar que un miembro sin rol de administrador no puede leer `conexiones` ni `servidores_organizacion` de su organización, y que no puede leer ninguna fila de otra organización.

## Ejecución registrada (2026-09-15)

Se ejecutaron los pasos 1-4 y 9 con dos servidores SSH+DIND efímeros
(`spec013-ssh-x`/`spec013-ssh-y`) y dos organizaciones de prueba. El flow
`platform.orquestacion.plantilla-generico`, revisión 4, terminó en `SUCCESS`
con ambas tareas `despacho_ssh` y `marcar_conexion_activa` en `SUCCESS`; la
consulta previa y los dos despachos se ejecutaron superpuestos. `pnpm test`
quedó en verde (53 pruebas web y 269 pruebas pgTAP). El subflow
`platform.alertas.alertas` registró una alerta `tecnica` de prueba y quedó en
`WARNING` porque el webhook local no estaba atendiendo.

El paso 7 (falla técnica) quedó verificado: tras los tres reintentos, el flow
registró una alerta `tecnica` y conservó la conexión en estado `activa`. Para
los pasos 5-6, el handler JDBC usa `errorLogs()` en contexto Worker y la
función SQL `private.procesar_falla_orquestacion` fue verificada con el marcador
`CREDENCIAL_INVALIDA:`: cambió el estado a `credencial_invalida` y registró la
alerta `credencial`. El worker real debe emitir ese marcador según el contrato
de la spec 012. El paso 8 se verificó por la consulta de exclusión
y el contrato de RLS, sin dejar una fila persistente en
la fixture efímera. Los contenedores y filas de prueba se eliminan al terminar
la validación.

## Resultado esperado

Las 5 historias de usuario de `spec.md` quedan verificables de punta a
punta con infraestructura de prueba efímera (contenedores locales), sin
necesidad de un VPS real ni de una organización real.

## Qué NO valida este quickstart

- Un servidor de organización real en un VPS — la prueba usa un contenedor
  local jugando ese papel.
- El contenido de un conector real (normalización, fixtures) — eso es
  responsabilidad de cada spec de producto futura, siguiendo la convención
  de `workers/README.md`.
- La rotación de una credencial SSH/DB de un servidor ya aprovisionado —
  fuera de alcance de esta spec (ver `contracts/gestion-conexiones-y-servidores.md`).
