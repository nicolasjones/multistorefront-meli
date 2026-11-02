"""Pruebas de superset_config.py y del permiso de descarga (FR-007/FR-008).

Corre sin Superset instalado: se simula `superset.config` y las variables de
entorno que el archivo exige. Ejecutar: `pnpm test:superset:config`.
"""
import ast
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def cargar_config():
    superset = types.ModuleType("superset")
    base = types.ModuleType("superset.config")
    base.WTF_CSRF_EXEMPT_LIST = ["superset.charts.data.api.data"]
    superset.config = base
    entorno = {
        "SUPERSET_SECRET_KEY": "x",
        "SUPERSET_DB_PASSWORD": "x",
        "SUPERSET_GUEST_TOKEN_JWT_SECRET": "x",
    }
    previo = dict(os.environ)
    os.environ.update(entorno)
    sys.modules["superset"], sys.modules["superset.config"] = superset, base
    try:
        spec = importlib.util.spec_from_file_location(
            "superset_config_bajo_prueba", AQUI / "superset_config.py"
        )
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        return modulo
    finally:
        os.environ.clear()
        os.environ.update(previo)
        sys.modules.pop("superset", None)
        sys.modules.pop("superset.config", None)


class ConfiguracionCsv(unittest.TestCase):
    def test_csv_export_formato_excel_es(self):
        csv = cargar_config().CSV_EXPORT
        self.assertEqual(csv["sep"], ";")
        self.assertEqual(csv["decimal"], ",")

    def test_bom_se_antepone_a_la_respuesta_csv_real(self):
        # pandas ignora "encoding" cuando to_csv no tiene ruta (caso de Superset),
        # así que el BOM sale de un after_request: se ejercita con una Response real.
        try:
            from flask import Flask
        except ImportError:
            self.skipTest("flask no instalado")
        modulo = cargar_config()
        self.assertNotIn("encoding", modulo.CSV_EXPORT)
        app = Flask(__name__)
        modulo.FLASK_APP_MUTATOR(app)

        @app.route("/csv")
        def _csv():
            return app.response_class("Cotización;María\n", mimetype="text/csv")

        @app.route("/json")
        def _json():
            return app.response_class("{}", mimetype="application/json")

        c = app.test_client()
        self.assertEqual(c.get("/csv").data[:3], b"\xef\xbb\xbf")
        self.assertEqual(c.get("/csv").data[3:].decode("utf-8"), "Cotización;María\n")
        self.assertEqual(c.get("/json").data, b"{}")

    def test_bom_idempotente_y_solo_csv(self):
        modulo = cargar_config()

        class R:
            mimetype, direct_passthrough, status_code = "text/csv", False, 200
            def __init__(s, d): s.d = d
            def get_data(s): return s.d
            def set_data(s, d): s.d = d

        r = modulo._anteponer_bom_csv(R(b"a;b"))
        self.assertEqual(r.d, b"\xef\xbb\xbfa;b")
        self.assertEqual(modulo._anteponer_bom_csv(r).d, b"\xef\xbb\xbfa;b")

    def test_ningun_consumidor_del_repo_parsea_csv_de_superset(self):
        # CSV_EXPORT es global (cambia Ventas y Rentabilidad): si algún código
        # versionado leyera CSV bajados de Superset esperando "," y ".", se
        # rompería. Hoy ninguno lo hace; esta prueba avisa si aparece uno.
        raiz = AQUI.parent.parent
        for base in ("workers", "infra/kestra", "apps/web/src"):
            for f in (raiz / base).rglob("*"):
                if not f.is_file() or f.suffix not in (".ts", ".tsx", ".py", ".yml", ".yaml", ".mjs"):
                    continue
                if "node_modules" in f.parts or ".test." in f.name:
                    continue
                t = f.read_text(errors="ignore").lower()
                self.assertFalse(
                    "chart/data" in t and "csv" in t,
                    f"{f} parece consumir CSV de Superset; revisar CSV_EXPORT",
                )

    def test_guest_conserva_permiso_de_descarga(self):
        # configurar_embebido.py corre dentro de `superset shell`, no se importa:
        # se lee su lista PERMISOS_GUEST del árbol sintáctico.
        arbol = ast.parse((AQUI / "configurar_embebido.py").read_text())
        permisos = next(
            ast.literal_eval(n.value)
            for n in arbol.body
            if isinstance(n, ast.Assign)
            and any(getattr(t, "id", None) == "PERMISOS_GUEST" for t in n.targets)
        )
        self.assertIn(("can_csv", "Superset"), permisos)
        # Sin "View query": la descarga no abre otro camino a las consultas.
        self.assertNotIn(("can_view_query", "Dashboard"), permisos)


if __name__ == "__main__":
    unittest.main()
