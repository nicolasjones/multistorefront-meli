# Contrato: Orquestación de flows de Kestra

Qué debe cumplir cualquier flow genérico o dedicado que use esta
arquitectura — la plantilla real vive en `infra/kestra/flows/`.

## Flow genérico (uno por tipo de conector)

1. **Universo de organizaciones**: recorre todas las organizaciones con una
   conexión `activa` a ese sistema externo (`conexiones.estado = 'activa'`
   y `conexiones.sistema_externo = <este conector>`) **excepto** las que
   tengan una fila en `excepciones_flow_generico` para este `conector_id`
   (FR-005).
2. **Paralelismo**: el recorrido usa una tarea paralela con tope de
   concurrencia tomado de `KESTRA_ORQUESTACION_CONCURRENCIA` (R6) — nunca
   secuencial, nunca ilimitado.
3. **Despacho**: cada organización dispara una tarea SSH (R1) contra
   `servidores_organizacion.host` de esa organización, usando la
   credencial de `private.obtener_credencial_servidor()` y la credencial
   de negocio de `private.obtener_credencial_conexion()` para el conector.
4. **Reintentos**: la tarea SSH lleva `retry` (R7) — 3 intentos con backoff
   antes de que una falla llegue al bloque `errors:`.
5. **Éxito**: llama a `private.marcar_conexion_activa(conexion_id)`.
6. **Falla de credencial** (detectable por el código de salida/mensaje que
   el worker devuelve — contrato de worker, spec 012): llama a
   `private.marcar_conexion_credencial_invalida(conexion_id, motivo)` y
   dispara el subflow de alertas (`orquestacion-kestra.md` → ver
   `alertas.md`) con `tipo = credencial`.
7. **Falla técnica genérica** (agotados los reintentos, no es de
   credencial): dispara el subflow de alertas con `tipo = tecnica`, sin
   tocar `conexiones.estado`.

## Gestión de excepciones

El alta o baja de una fila de `excepciones_flow_generico` se opera por un
superadmin directamente en Supabase Studio (o SQL administrativo), no desde
una pantalla de Refine. Es una decisión de operación de plataforma y no hay
un caso de uso que justifique esa UI en esta spec (Principio V). Las políticas
RLS mantienen la escritura fuera del alcance de usuarios `authenticated` no
superadmin.

## Flow dedicado (excepción por organización)

Mismo contrato que el genérico (puntos 4-7), pero:
- Atiende una sola organización, la fila correspondiente ya existe en
  `excepciones_flow_generico` para este `conector_id` (FR-005 — evita que
  el genérico la procese también).
- Puede tener pasos adicionales antes/después del despacho SSH, propios
  del comportamiento particular que justificó la excepción (fuera del
  alcance de esta spec definir cuáles).

## Convención de nombres (FR-003)

- Genérico: `<producto>.<conector>` (por ejemplo, `contable.conciliacion`).
- Dedicado: `<producto>.<conector>.<organizacion-slug>` — el sufijo deja
  explícito, con solo mirar el nombre del flow en la UI de Kestra, que es
  una excepción y de qué organización.

## Fuera del contrato (a propósito)

- Qué hace el worker una vez que Kestra le pasó el trabajo — eso es el
  contrato de worker (spec 012), no de este documento.
- El nombre real de un conector o producto concreto — eso lo define cada
  implementación puntual, no esta spec (FR-007 de la spec 012 aplica igual
  acá por analogía: sin dominio de negocio en el template).
