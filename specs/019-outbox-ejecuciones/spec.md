# Especificación: Despacho confiable de ejecuciones

**Rama**: `019-outbox-ejecuciones`  
**Creada**: 2026-09-23  
**Estado**: Implementada
**Alcance de entrega**: `supabase`, `kestra`, `workers`

## Escenarios de usuario y pruebas

### Historia 1 - Una solicitud no se pierde (Prioridad: P1)

Como persona que inicia una automatización habilitada, necesito que su solicitud quede pendiente de forma confiable aunque el orquestador no esté disponible en ese instante, para poder seguir su estado y no tener que dispararla otra vez.

**Prueba independiente**: registrar una ejecución mientras el orquestador está inaccesible, restaurarlo y comprobar que se procesa una sola vez.

**Criterios de aceptación**:

1. Dada una solicitud válida, cuando se registra, entonces la ejecución y su orden de despacho quedan persistidas juntas.
2. Dada una orden pendiente y el orquestador recuperado, cuando la reclama, entonces ninguna otra instancia puede procesarla en paralelo.

---

### Historia 2 - Una falla se recupera sin duplicar efectos (Prioridad: P2)

Como operador, necesito que una falla de despacho sea visible y recuperable con reintentos acotados, sin duplicar el trabajo ni ocultar el error.

**Prueba independiente**: provocar una falla transitoria de despacho y verificar el historial de intentos, el siguiente reintento y una única ejecución efectiva.

**Criterios de aceptación**:

1. Dada una falla transitoria, cuando el límite de reintentos aún no se alcanza, entonces la orden vuelve a estar disponible con su historial conservado.
2. Dado que se alcanza el límite, cuando no hay recuperación posible, entonces la ejecución queda en estado terminal con un motivo útil y auditable.

---

### Historia 3 - Los futuros conectores respetan la frontera (Prioridad: P3)

Como mantenedor de un producto derivado, necesito un contrato reutilizable para despachar trabajos externos sin implementar efectos de red desde la base de datos.

**Prueba independiente**: registrar una capacidad de ejemplo y verificar que su orden puede ser reclamada mediante el mismo contrato sin depender de un webhook en un trigger.

**Criterios de aceptación**:

1. Dado un nuevo conector, cuando crea una ejecución, entonces usa el contrato común sin almacenar secretos de despacho en el navegador ni en registros.
2. Dada una migración nueva, cuando se valida, entonces no introduce llamadas HTTP salientes desde triggers ni funciones de transacción.

### Casos límite

- El orquestador cae después de reclamar una orden y antes de confirmar inicio.
- Dos instancias intentan reclamar la misma orden.
- Un worker termina después de expirar un reclamo anterior.
- La orden corresponde a una capacidad deshabilitada antes de ser procesada.

## Requisitos

### Requisitos funcionales

- **FR-001**: El sistema DEBE persistir la solicitud de ejecución y su orden de despacho en una única operación atómica.
- **FR-002**: El sistema DEBE permitir reclamar una orden pendiente de forma exclusiva, con vencimiento recuperable.
- **FR-003**: El sistema DEBE registrar intentos, transiciones, actor técnico y motivo de falla sanitizado.
- **FR-004**: El sistema DEBE impedir que una orden origine efectos duplicados cuando se reintenta o se recupera un reclamo vencido.
- **FR-005**: El sistema DEBE mantener aisladas las órdenes, ejecuciones y evidencias por organización.
- **FR-006**: El sistema NO DEBE realizar solicitudes HTTP ni otros efectos externos desde triggers o funciones SQL transaccionales.
- **FR-007**: El contrato DEBE poder ser adoptado por productos derivados sin incluir conceptos de un conector o dominio específico.

### Entidades clave

- **Ejecución**: solicitud auditable de una capacidad para una organización.
- **Orden de despacho**: registro durable asociado a una ejecución, con estado, intento, reclamo y vencimiento.
- **Intento de despacho**: evidencia de cada reclamo, resultado o recuperación.

## Criterios de éxito

- **SC-001**: El 100% de las solicitudes aceptadas conserva una ejecución y una orden recuperable aun durante una indisponibilidad del orquestador.
- **SC-002**: Una orden concurrente produce como máximo un procesamiento efectivo por intento válido.
- **SC-003**: Una falla transitoria queda visible y puede recuperarse sin intervención manual fuera del límite configurado.
- **SC-004**: Un producto derivado puede adoptar el contrato sin crear un trigger que haga llamadas externas.

## Supuestos y límites

- Kestra conserva la coordinación de trabajos largos; no se convierte en backend transaccional.
- Los workers siguen ejecutando el trabajo externo y registrando su resultado.
- Esta spec no migra conectores contables existentes: esa adopción pertenece a una spec del producto derivado.
- Esta spec no agrega una API Node ni una cola externa.
