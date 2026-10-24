# Documentación

Tres entradas según lo que necesites:

| Quiero… | Empezá por |
|---|---|
| **Usar** el sistema (funciones por rol) | [guia-funcional.md](guia-funcional.md) |
| **Operar** ambientes, Supabase, Kestra, Superset, workers, alertas y copias | [operar-sistema.md](operar-sistema.md) |
| **Entregar** el sistema (checklist) | [entregar-sistema.md](entregar-sistema.md) |

## Funcionalidad ↔ documento

| Funcionalidad | Documento |
|---|---|
| Ingreso y bloqueo por intentos | [acceso-ingreso.md](acceso-ingreso.md) |
| Solicitud de acceso | [solicitar-acceso.md](solicitar-acceso.md) |
| Invitaciones de usuarios | [invitar-usuarios.md](invitar-usuarios.md), [migracion-invitaciones-usuarios.md](migracion-invitaciones-usuarios.md) |
| Empresa activa | [empresa-activa.md](empresa-activa.md) |
| Usuarios, empresas y permisos | [usuarios-y-empresas.md](usuarios-y-empresas.md), [permisos-por-rol.md](permisos-por-rol.md) |
| Organización: alta, administración, empresas | [alta-de-organizaciones.md](alta-de-organizaciones.md), [administracion-organizacion.md](administracion-organizacion.md), [empresas.md](empresas.md) |
| Aislamiento por organización | [aislamiento-por-organizacion.md](aislamiento-por-organizacion.md) |
| Actividad e historial | [actividad.md](actividad.md) |
| Cotización del dólar: carga diaria | [cotizacion-carga-diaria.md](cotizacion-carga-diaria.md) |
| Cotización del dólar: vista previa y recálculo | [cotizacion-recalculo.md](cotizacion-recalculo.md) |
| Clientes, catálogo, stock | [clientes.md](clientes.md), [catalogo.md](catalogo.md), [stock.md](stock.md) |
| Ventas: comprobantes (factura, presupuesto, stock) | [ventas-comprobantes.md](ventas-comprobantes.md) |
| Ventas: formas de pago y envío, cuentas de cobro, transportes | [ventas-catalogos.md](ventas-catalogos.md), [cuentas-cobro.md](cuentas-cobro.md), [ventas-transportes.md](ventas-transportes.md) |
| Ingreso de mercadería por proveedor | [ingreso-de-mercaderia.md](ingreso-de-mercaderia.md) |
| Ambientes y despliegue | [deployment.md](deployment.md), [ambientes-verificacion.md](ambientes-verificacion.md), [adoptar-cicd-staging-produccion.md](adoptar-cicd-staging-produccion.md) |
| Kestra: ejecuciones, conectores, OAuth | [adoptar-ciclo-ejecuciones.md](adoptar-ciclo-ejecuciones.md), [disenar-conector.md](disenar-conector.md), [adoptar-conexiones-oauth.md](adoptar-conexiones-oauth.md) |
| Superset | [operar-superset.md](operar-superset.md) |
| Workers | [adoptar-blindaje-imagenes-workers.md](adoptar-blindaje-imagenes-workers.md) |
| CI y runners | [adoptar-runners-locales.md](adoptar-runners-locales.md), [ci-self-hosted-storage.md](ci-self-hosted-storage.md), [adoptar-ci-base-aislada.md](adoptar-ci-base-aislada.md) |
| Prototipos y sistema de diseño | [prototipos.md](prototipos.md), [sistema-de-diseno.md](sistema-de-diseno.md), [adoptar-kit-panel-operable.md](adoptar-kit-panel-operable.md) |
| Pruebas E2E | [e2e-app.md](e2e-app.md), [validacion-e2e3.md](validacion-e2e3.md) |
| Producto derivado / template | [crear-producto-derivado.md](crear-producto-derivado.md), [adoptar-capacidades-template.md](adoptar-capacidades-template.md), [adoptar-tooling-typescript.md](adoptar-tooling-typescript.md), [registrar-funcionalidad-desde-migracion.md](registrar-funcionalidad-desde-migracion.md) |
| Documentación obligatoria y skills | [documentacion-cambios.md](documentacion-cambios.md), [skills.md](skills.md) |
| Arquitectura y roadmap | [architecture.md](architecture.md), [roadmap-template.md](roadmap-template.md) |
| Copias y restauración | [copias-y-restauracion.md](copias-y-restauracion.md), [simulacro-restauracion.md](simulacro-restauracion.md) |

## Deuda trazada

- **Simulacro de restauración en staging**: documentado pero **no ejecutado** (sin autorización sobre staging); ver [simulacro-restauracion.md](simulacro-restauracion.md). Seguimiento: **MSF-520** (Tarea `seguimiento` en Jira).
- `deployment.md` todavía menciona Supabase Cloud para producción; la constitución v1.8.0 establece Supabase self-hosted sin Cloud. Corregir al documentar el ambiente de producción.
