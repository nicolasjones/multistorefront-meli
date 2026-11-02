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
        self.assertIn(csv["encoding"], ("utf-8", "utf-8-sig"))

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
