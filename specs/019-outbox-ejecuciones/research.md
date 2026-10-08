# Investigación: despacho durable

## Outbox transaccional

**Decisión**: persistir ejecución y orden de despacho juntas.

**Motivo**: un HTTP fire-and-forget puede dejar una ejecución sin entrega
conocida. La orden durable se recupera al volver el orquestador.

**Descartado**: reintento HTTP desde trigger, cola externa y servidor Node
intermedio; no garantizan mejor consistencia sin agregar infraestructura.

## Reclamo exclusivo

**Decisión**: Kestra reclama una orden de forma exclusiva, con vencimiento.

**Motivo**: evita despachos duplicados y recupera caídas tras el reclamo.

## Frontera template/producto

**Decisión**: el template ofrece RPC y payload mínimo; el producto elige flow,
worker y conector. La primera adopción cubre disparos manuales, no schedules.
