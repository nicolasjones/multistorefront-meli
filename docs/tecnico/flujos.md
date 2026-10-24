---
owner: tecnico
sources:
  - specs
---

# Flujos

Los flujos importantes se documentan con **Mermaid** (inline) y, cuando aporta, con un **artefacto Archify** interactivo.

## Importación del historial (MSF-275)

- **[Dataflow interactivo](../diagrams/msf-275-dataflow.html)** — export del panel → Storage → worker → `historial_*` → consulta.
- **[Estados de la ejecución](../diagrams/msf-275-lifecycle.html)** — solicitada → en curso → exitosa/fallida, con la regla todo-o-nada.

```mermaid
flowchart LR
  A[Export CSV/Excel] --> B[Storage] --> C[Worker] --> D[historial_*] --> E[Pantalla /historial]
```

## Cambio de estado y entrega (MSF-303)

- **[Secuencia interactiva](../diagrams/msf-303-sequence.html)** — técnico → UI → RPC → `reparaciones` + `reparacion_historial` + evento.

- **Alta y edición (MSF-283)**: `crear_reparacion` valida tienda, cliente, modelo activo y técnico, asigna el próximo número de la empresa, el primer estado activo por `orden` y el ingreso de hoy (hora de Argentina), y escribe el evento `alta` y la actividad `reparacion.creada`. Edición con bloqueo optimista por `updated_at`.
- **Reglas**: cualquier estado activo se puede elegir desde otro (también hacia atrás); un estado que `cierra` solo con la entrega (diálogo de fecha y quién entregó); tras entregar o anular no hay más cambios.

## Consultas (MSF-122)

Alta pública → consulta `nueva` + aviso encolado → barrido de Kestra → correo → bandeja → atención manual.
Los tres estados son fijos y las transiciones son manuales; asignar o anotar no cambia el estado.

```mermaid
stateDiagram-v2
  [*] --> Nueva : crear_consulta_publica (formulario o WhatsApp)
  Nueva --> EnCurso : una persona la marca «En curso»
  EnCurso --> Resuelta : una persona la marca «Resuelta»
  Nueva --> Resuelta : una persona la marca «Resuelta»
  Resuelta --> Nueva : reabrir
  Resuelta --> EnCurso : reabrir
  EnCurso --> Nueva : volver a «Nueva»
```

```mermaid
flowchart LR
  T["Tienda (MSF-212)"] --> RPC["publico.crear_consulta_publica"]
  RPC --> C["dominio.consultas"]
  C --> A["dominio.consultas_avisos"]
  A --> K["Kestra avisos-consultas (cada minuto)"]
  K --> F["Edge Function enviar-aviso-consulta"]
  F --> M["SMTP / Mailpit"]
  C --> P["Bandeja /consultas"]
```

Detalle: [Consultas: modelo, RPC y aviso](consultas.md). Dueños: FR-002 (alta), FR-003 (edición y
actividad), FR-005…FR-008 (bandeja y empresa activa), FR-011…FR-013 (cola, envío y enlace).

## Dólar y recálculo (MSF-116)

Cargar → pendiente (24 h) → vista previa por empresa → confirmar (recalcula si la variación llega al 1 %)
o descartar. No hay worker: el vencimiento se resuelve al consultar y el recálculo es una transacción.

```mermaid
stateDiagram-v2
  [*] --> Pendiente : cargar_cotizacion (edición)
  Pendiente --> Pendiente : volver a cargar (reemplaza)
  Pendiente --> Descartada : descartar_cotizacion (Cancelar)
  Pendiente --> Vencida : pasan 24 h (se resuelve al consultar)
  Pendiente --> ConfirmadaConRecalculo : variación >= 1 %
  Pendiente --> ConfirmadaSinRecalculo : variación < 1 %
  ConfirmadaConRecalculo --> [*] : historial inmutable
  ConfirmadaSinRecalculo --> [*] : historial inmutable
  Descartada --> [*]
  Vencida --> [*]
```

```mermaid
sequenceDiagram
  actor Adm as Administrador
  participant UI as Diálogo «Cargar dólar del día»
  participant DB as Postgres (RPC)
  Adm->>UI: escribe 1050 (vigente 1000)
  UI->>DB: cargar_cotizacion(1050)
  DB-->>UI: pendiente + anterior + variación (+5 %)
  UI->>DB: previsualizar_cotizacion()
  DB-->>UI: empresas + muestra (hoy / nuevo)
  alt confirma
    Adm->>UI: Aplicar y recalcular
    UI->>DB: confirmar_cotizacion()
    Note over DB: una transacción: historial + aplicada + eventos
    DB-->>UI: N precios recalculados
  else cancela
    Adm->>UI: Cancelar
    UI->>DB: descartar_cotizacion()
  end
```

El aviso «Todavía no se cargó el dólar de hoy» (`cotizacion_del_dia`) se monta en `/cotizacion` y en la
portada; «Cargar ahora» reutiliza el mismo diálogo. Detalle: [Dólar y recálculo](dolar-y-recalculo.md).
Dueños: FR-001…FR-003 (carga y vencimiento), FR-009…FR-015 (vista previa, confirmación y descarte),
FR-016…FR-018 (historial), FR-019…FR-022 (aviso).

## Catálogo (MSF-160)

- **[Arquitectura](../diagrams/msf-160-architecture.html)** y **[ERD](../diagrams/msf-160-erd.html)**.

## Acceso y sesión (MSF-119)

Ingreso → `bloqueo_acceso_hasta` → Auth (hook `verificar_intento_acceso` cuenta fallos) → consulta de `estado` (suspendido: rechazo y cierre) → sesión (`localStorage` con «Mantener», `sessionStorage` sin ella) → vence a 12 h de inactividad o por `timebox` de 30 días. Recuperación: aviso neutro → enlace de 1 h y un solo uso → definir contraseña. Dueño: spec `20261012-140000-acceso-y-organizacion`; tests: Vitest, pgTAP (`estado_usuario`, `bloqueo_servidor`, `rls_en_toda_tabla`, `aislamiento_organizaciones`) y `scripts/e2e-acceso.e2e.mjs`. Detalle: [Acceso](../acceso-ingreso.md).

## Convención

- **Mermaid** para lo que se lee en GitHub y en esta wiki.
- **Archify** para lo que se explora (zoom, foco, fuentes), validado con `finalize`.
- Todo flujo tiene un **dueño** (spec/FR) y un **test** (Vitest/pgTAP/e2e) que lo respalda.
