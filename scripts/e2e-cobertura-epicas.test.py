"""Pruebas del reporte de cobertura E2E por épica (MSF-907).

El runner no puede derivar los criterios de un ítem cuya descripción no alcanza; antes
eso degradaba en silencio (el ítem se contaba como «sólo base de datos» y nadie escribía el
test). Estas pruebas fijan la regla compartida y la columna propia del reporte.

Ejecutar: `pnpm test:e2e:cobertura:epicas`.
"""
import contextlib
import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path

AQUI = Path(__file__).resolve().parent

TASKS = """- [ ] T001 [F-DEMO-01][US1] Migración aditiva `dominio.clientes` y pgTAP de aislamiento
- [ ] T002 [F-DEMO-02][US1] Pantalla de clientes: listado, botón de alta y filtro por empresa
- [ ] T003 [P] [US1]
- [ ] T004 Documentación de la historia
- [ ] T005 [F-DEMO-03][US1]
- [ ] T006 [P] Crear el hook `useClientes` en
  `apps/web/src/hooks/useClientes.ts`.
"""


def cargar():
    spec = importlib.util.spec_from_file_location("e2e_cobertura_epicas", AQUI / "e2e-cobertura-epicas.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


class ReporteCoberturaPorEpica(unittest.TestCase):
    def setUp(self):
        self.mod = cargar()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        raiz = Path(self.tmp.name)
        spec_dir = raiz / "specs" / "spec-demo"
        spec_dir.mkdir(parents=True)
        (spec_dir / "spec.md").write_text("**Jira Epic**: MSF-999 — Demo\n")
        (spec_dir / "tasks.md").write_text(TASKS)
        self.mod.RAIZ = raiz
        self.spec_dir = spec_dir

    def correr(self, *args):
        argv = sys.argv
        sys.argv = ["e2e-cobertura-epicas.py", *args]
        salida = io.StringIO()
        try:
            with contextlib.redirect_stdout(salida):
                self.mod.main()
        finally:
            sys.argv = argv
        return salida.getvalue()

    def test_calcula_la_historia_de_cada_item_aunque_el_codigo_no_venga_primero(self):
        items = self.mod.tareas_de(self.spec_dir)
        por_id = {i["id"]: i for i in items}
        self.assertEqual(por_id["T001"]["historia"], "F-DEMO-01")
        self.assertEqual(por_id["T002"]["historia"], "F-DEMO-02")
        # El texto del ítem incluye las líneas de continuación.
        self.assertIn("useClientes.ts", por_id["T006"]["texto"])

    def test_cada_item_sabe_si_su_descripcion_alcanza_y_por_que_no(self):
        por_id = {i["id"]: i for i in self.mod.tareas_de(self.spec_dir)}
        self.assertEqual(por_id["T001"]["motivo"], "")
        self.assertEqual(por_id["T003"]["motivo"], "sin texto")
        self.assertEqual(por_id["T004"]["motivo"], "sin historia")
        self.assertEqual(por_id["T005"]["motivo"], "sin texto")

    def test_el_reporte_cuenta_las_historias_del_working_tree(self):
        salida = self.correr("--epicas", "MSF-999")
        self.assertIn("historias=  3", salida)
        self.assertIn("SIN E2E=  1", salida)

    def test_un_item_sin_descripcion_no_cuenta_como_solo_base_de_datos(self):
        salida = self.correr("--epicas", "MSF-999")
        # F-DEMO-01 es de base de datos; F-DEMO-03 no tiene descripción y NO entra ahí.
        self.assertIn("base   1", salida)
        # T003 (sin texto), T004 y T006 (sin historia) y T005 (sin texto) van en su columna.
        self.assertIn("sin descr.=  4", salida)


if __name__ == "__main__":
    unittest.main()
