# Feature Specification: Blindaje de secretos en la orquestación

**Feature Branch**: `014-blindaje-secretos-kestra`

**Created**: 2026-09-15

**Status**: Draft

**Delivery scope**: `supabase` | `kestra` | `workers`

**Input**: User description: "Evitar que credenciales descifradas de organizaciones queden persistidas en outputs, logs o historial de Kestra durante las ejecuciones de workers."

## Clarifications

### Session 2026-09-15

- Q: ¿Qué valores deben redactarse si aparecen en logs o errores de una ejecución? → A: Credencial entregada y variantes URL/Base64 comunes.
- Q: ¿La entrega debe también sanear ejecuciones históricas de Kestra que ya pudieran contener secretos? → A: Solo ejecuciones futuras y reintentos nuevos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ejecutar una integración sin persistir secretos (Priority: P1)

Una persona operadora necesita ejecutar una integración de una organización sin que la credencial descifrada quede disponible en el historial operativo de la plataforma.

**Why this priority**: Una filtración en outputs o logs puede exponer credenciales de varias organizaciones y comprometer sistemas externos.

**Independent Test**: Ejecutar una integración de prueba con una credencial centinela y revisar outputs, logs, errores e historial asociados a la ejecución; la credencial no debe aparecer en ninguno.

**Acceptance Scenarios**:

1. **Given** una conexión autorizada con una credencial válida, **When** se ejecuta su integración, **Then** el worker recibe el secreto solo durante el tiempo necesario para autenticarse y la ejecución conserva únicamente referencias no sensibles.
2. **Given** una ejecución exitosa o fallida, **When** una persona consulta su historial, **Then** no puede encontrar la credencial en outputs, logs, mensajes de error ni metadatos de la ejecución.
3. **Given** una ejecución concurrente de varias organizaciones, **When** una organización falla, **Then** el diagnóstico de esa ejecución no revela secretos de esa organización ni de las demás.

---

### User Story 2 - Mantener el diagnóstico operativo útil (Priority: P2)

Quien opera la plataforma necesita diagnosticar fallas sin acceder a credenciales ni perder la información necesaria para distinguir fallas técnicas de fallas de autenticación.

**Why this priority**: Ocultar secretos no debe convertir los fallos en imposibles de investigar o corregir.

**Independent Test**: Provocar una falla técnica y una falla de autenticación con datos de prueba y comprobar que el historial conserva contexto, clasificación, organización, conexión y causa sanitizada, sin incluir el secreto.

**Acceptance Scenarios**:

1. **Given** una falla técnica, **When** se revisa la ejecución, **Then** se puede identificar la organización, conexión, tarea y causa sanitizada sin ver la credencial.
2. **Given** una falla de autenticación, **When** se revisa la ejecución, **Then** se clasifica como credencial inválida y se conserva el contexto necesario para alertar al administrador correspondiente, sin registrar el valor secreto.
3. **Given** un mensaje de error que contiene accidentalmente una credencial, **When** se registra o muestra el diagnóstico, **Then** el valor sensible se redacta antes de quedar persistido.

## Edge Cases

- ¿Qué ocurre si una tarea falla antes de entregar el secreto al worker? La ejecución debe registrar una causa sanitizada y no crear un output sensible.
- ¿Qué ocurre si el worker escribe la credencial en stdout o stderr? El canal de ejecución debe impedir su persistencia o redactarla antes de almacenarla.
- ¿Qué ocurre si una ejecución se reintenta? Cada intento debe conservar el mismo tratamiento de redacción y no duplicar secretos.
- ¿Qué ocurre si una persona tiene acceso de superadmin al historial? El acceso ampliado no debe permitir recuperar el valor descifrado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE entregar una credencial descifrada a una integración únicamente durante la ejecución autorizada que la necesita.
- **FR-002**: El sistema NO DEBE persistir credenciales descifradas en outputs, logs, errores, metadatos ni archivos temporales de una ejecución.
- **FR-003**: El sistema DEBE conservar referencias no sensibles suficientes para identificar organización, conexión, tarea, intento y estado de la ejecución.
- **FR-004**: El sistema DEBE redactar la credencial entregada a la ejecución y sus variantes URL y Base64 comunes si aparecen en mensajes de error, stdout o stderr, antes de persistirlos o mostrarlos.
- **FR-005**: El sistema DEBE mantener la clasificación entre falla técnica y falla de autenticación sin almacenar la credencial involucrada.
- **FR-006**: El acceso de superadmin u operador al historial DEBE permitir diagnóstico, pero NO DEBE permitir recuperar una credencial descifrada.
- **FR-007**: Los reintentos de una integración DEBEN aplicar las mismas reglas de entrega efímera y redacción en cada intento.
- **FR-008**: Las pruebas automatizadas DEBEN demostrar la ausencia de una credencial centinela en outputs, logs, errores, metadatos y archivos temporales de una ejecución.

### Key Entities

- **Ejecución de integración**: registro operativo de una ejecución, sus intentos, estado, organización, conexión, tarea y diagnóstico sanitizado.
- **Credencial de conexión**: secreto protegido asociado a una conexión de una organización; su valor descifrado no forma parte del historial operativo.
- **Diagnóstico sanitizado**: contexto técnico útil para operar una integración sin valores sensibles.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En el conjunto de pruebas de seguridad, el valor de una credencial centinela aparece cero veces en outputs, logs, errores, metadatos y archivos temporales persistidos.
- **SC-002**: El 100% de las ejecuciones de prueba conserva organización, conexión, tarea, intento, estado y causa sanitizada sin revelar el secreto.
- **SC-003**: Una persona operadora puede distinguir una falla técnica de una falla de autenticación usando únicamente el diagnóstico sanitizado.
- **SC-004**: Una ejecución reintentada mantiene cero apariciones del secreto centinela en todos sus intentos.

## Assumptions

- La identidad, el control de acceso de organizaciones y el almacenamiento cifrado de credenciales existentes se reutilizan.
- Las credenciales reales no se usarán en las pruebas; se emplearán valores centinela no productivos.
- La primera entrega cubre ejecuciones de workers orquestadas por el template; otros procesos no relacionados quedan fuera.
- La primera entrega previene exposiciones en ejecuciones nuevas y sus reintentos; el saneamiento del historial existente queda fuera de alcance.
- La observabilidad conserva contexto operativo no sensible y puede ocultar o resumir detalles de proveedores externos.
