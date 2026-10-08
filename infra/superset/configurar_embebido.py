# Deja la analítica embebida (spec 007) lista después de cada `superset
# init`, sin pasos manuales en la UI de Superset. Antes esto se cargaba a
# mano y se perdía al recrear el volumen o al cambiar el puerto de Refine
# (ver docs/operar-superset.md). Corre con `superset shell`, igual que
# crear_cuenta_servicio_guest_token.py, y es idempotente y solo aditivo:
# nunca saca un permiso ni un dominio que alguien haya agregado a mano.
#
# Hace tres cosas:
#   1. Rol GUEST_ROLE_NAME: permisos fijos que el SDK embebido necesita para
#      arrancar y para pedir datos de cada chart.
#   2. Mismo rol: `datasource_access` sobre cada dataset que usa un dashboard
#      con embed (charts y filtros nativos). Se deriva de la metadata, así que
#      no hay listas de negocio acá. Qué FILAS ve cada quien lo sigue
#      resolviendo el RLS del guest token, no este rol.
#   3. Cada embed: agrega a allow_domain_list los mismos orígenes de Refine
#      que CORS_OPTIONS de superset_config.py (REFINE_ORIGIN + loopback con
#      WEB_PORT), para que ambos salgan de la misma fuente.
#
# Los dashboards o embeds creados después del init se cubren volviendo a
# correr el init: `docker compose -f infra/superset/compose.yaml run --rm
# superset-init`.
import json

from flask import current_app
from superset import security_manager
from superset.connectors.sqla.models import SqlaTable
from superset.extensions import db
from superset.models.dashboard import Dashboard
from superset.models.embedded_dashboard import EmbeddedDashboard

# A propósito NO se incluye `can_view_query` sobre `Dashboard`: "View query"
# no debe verse para quien entra por guest token. `can_share_chart` sí,
# para conservar "Copy permalink"/"Share by email"; "Embed code" se apaga con
# EMBEDDABLE_CHARTS=False en superset_config.py.
PERMISOS_GUEST = [
    # Bootstrap del SDK.
    ("can_read", "CurrentUserRestApi"),
    ("can_read", "Dashboard"),
    # Pedido de datos de cada chart.
    ("can_read", "Chart"),
    ("can_read", "Dataset"),
    ("can_get", "Datasource"),
    ("can_external_metadata", "Datasource"),
    ("can_external_metadata_by_name", "Datasource"),
    ("can_query", "Api"),
    ("can_time_range", "Api"),
    ("can_query_form_data", "Api"),
    # Menú "..." de cada chart.
    ("can_csv", "Superset"),
    ("can_share_chart", "Superset"),
]

cambios = []

rol_nombre = current_app.config["GUEST_ROLE_NAME"]
rol = security_manager.find_role(rol_nombre)
if rol is None:
    rol = security_manager.add_role(rol_nombre)
    cambios.append(f"rol {rol_nombre} creado")


def otorgar(permiso_vista, descripcion):
    if permiso_vista not in rol.permissions:
        security_manager.add_permission_role(rol, permiso_vista)
        cambios.append(f"{rol_nombre} += {descripcion}")


for permiso, vista in PERMISOS_GUEST:
    # find_ y no add_: estos pares los registra `superset init`. Si falta uno
    # es un nombre mal escrito o un cambio de versión de Superset, y crear un
    # par nuevo no serviría (nadie lo chequea; ver
    # crear_cuenta_servicio_guest_token.py). Mejor fallar en el init.
    permiso_vista = security_manager.find_permission_view_menu(permiso, vista)
    if permiso_vista is None:
        raise RuntimeError(f"Superset no registra el permiso {permiso} sobre {vista}")
    otorgar(permiso_vista, f"{permiso} | {vista}")

# dict.fromkeys: REFINE_ORIGIN suele repetir la variante localhost:WEB_PORT.
origenes = list(dict.fromkeys(current_app.config["CORS_OPTIONS"]["origins"]))

for embed in db.session.query(EmbeddedDashboard).all():
    dashboard = db.session.get(Dashboard, embed.dashboard_id)
    if dashboard is None:
        continue

    datasets = {chart.datasource for chart in dashboard.slices if chart.datasource is not None}
    metadata = json.loads(dashboard.json_metadata or "{}")
    for filtro in metadata.get("native_filter_configuration", []):
        for destino in filtro.get("targets", []):
            if destino.get("datasetId"):
                dataset = db.session.get(SqlaTable, destino["datasetId"])
                if dataset is not None:
                    datasets.add(dataset)
    for dataset in sorted(datasets, key=lambda d: d.perm):
        otorgar(
            security_manager.add_permission_view_menu("datasource_access", dataset.perm),
            f"datasource_access | {dataset.perm}",
        )

    permitidos = [d for d in (embed.allow_domain_list or "").split(",") if d]
    faltantes = [o for o in origenes if o not in permitidos]
    if faltantes:
        embed.allow_domain_list = ",".join(permitidos + faltantes)
        cambios.append(f"embed {embed.uuid} += {', '.join(faltantes)}")

db.session.commit()

print(f"configurar_embebido: {len(cambios)} cambios")
for cambio in cambios:
    print(f"  {cambio}")
