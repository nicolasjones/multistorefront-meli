#!/usr/bin/env python3
"""Runner local del visor E2E (no forma parte del producto).

Expone en el tailnet:
  POST /correr  {"epica": "MSF-121"}  -> dispara el workflow manual (visible + video)
  GET  /estado                         -> estado de la corrida en curso

Cuando la corrida termina bien, baja los artefactos, reescribe el manifiesto con
claves ASCII y publica videos + `latest/cobertura-e2e.json` en el bucket.
"""
import json
import os
import re
import subprocess
import threading
import time
import unicodedata
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.environ.get("E2E_RUNNER_WORK", "/tmp/e2e-runner")
REPO = "nicolasjones/multistorefront-meli"
WORKFLOW = "validate.yml"
BUCKET = "evidencias-e2e"
ORIGENES = {
    "http://100.77.94.122:9327",
    "http://100.77.94.122:9326",
    "http://localhost:9327",
    "http://127.0.0.1:9327",
}
config = json.load(open(os.environ.get("E2E_RUNNER_CONFIG", "/root/e2e-runner/config.json")))
estado = {"estado": "libre", "epica": None, "run_id": None, "mensaje": None}
candado = threading.Lock()


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:300])
    return r.stdout


def clave(ruta):
    partes = []
    for p in ruta.replace("\\", "/").split("/"):
        if p in ("", ".", ".."):
            continue
        p = "".join(c for c in unicodedata.normalize("NFD", p) if unicodedata.category(c) != "Mn")
        p = re.sub(r"[^A-Za-z0-9._-]+", "-", p)
        p = re.sub(r"-+", "-", p).strip("-")
        if not p:
            p = "x"
        if p.startswith("."):
            p = "x" + p
        partes.append(p)
    return "/".join(partes)


def subir(remoto, datos, tipo):
    req = urllib.request.Request(
        f"{config['url']}/storage/v1/object/{BUCKET}/{remoto}",
        data=datos,
        method="POST",
        headers={
            "apikey": config["serviceKey"],
            "authorization": f"Bearer {config['serviceKey']}",
            "content-type": tipo,
            "x-upsert": "true",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status


def publicar(run_id, epica):
    base = f"{RAIZ}/runs/{run_id}"
    os.makedirs(base, exist_ok=True)
    for nombre, destino in (("playwright-report-sesion", "sesion"), ("playwright-report", "publico")):
        try:
            import shutil
            shutil.rmtree(f"{base}/{destino}", ignore_errors=True)
            gh("run", "download", str(run_id), "--repo", REPO, "--name", nombre, "--dir", f"{base}/{destino}")
        except RuntimeError:
            pass
    candidatos = []
    for destino in ("sesion", "publico"):
        manifiesto = f"{base}/{destino}/playwright-report/cobertura-e2e.json"
        if os.path.exists(manifiesto):
            datos = json.load(open(manifiesto))
            if any(e.get("epica") == epica for e in datos.get("evidencias", [])):
                candidatos.append((destino, manifiesto, datos))
    if not candidatos:
        raise RuntimeError(f"la corrida {run_id} no dejó evidencia de {epica}")
    destino, manifiesto, datos = candidatos[0]
    videos_dir = f"{base}/{destino}/test-results"
    for evidencia in datos.get("evidencias", []):
        if evidencia.get("video"):
            evidencia["video"] = clave(evidencia["video"])
    cuerpo = json.dumps(datos, ensure_ascii=False, indent=2).encode()
    subir(f"{run_id}/cobertura-e2e.json", cuerpo, "application/json")
    subir("latest/cobertura-e2e.json", cuerpo, "application/json")
    n = 0
    for raiz, _, archivos in os.walk(videos_dir):
        for archivo in archivos:
            if not archivo.endswith(".webm"):
                continue
            ruta = os.path.join(raiz, archivo)
            rel = clave(os.path.relpath(ruta, videos_dir).replace(os.sep, "/"))
            subir(f"{run_id}/{rel}", open(ruta, "rb").read(), "video/webm")
            n += 1
    return n


def vigilar(run_id, epica):
    while True:
        time.sleep(12)
        try:
            datos = json.loads(gh("run", "view", str(run_id), "--repo", REPO, "--json", "status,conclusion"))
        except Exception as e:  # noqa: BLE001
            with candado:
                estado.update(estado="fallido", mensaje=str(e)[:200])
            return
        if datos.get("status") != "completed":
            continue
        if datos.get("conclusion") != "success":
            with candado:
                estado.update(estado="fallido", mensaje=f"la corrida terminó {datos.get('conclusion')}")
            return
        try:
            n = publicar(run_id, epica)
            with candado:
                estado.update(estado="listo", mensaje=f"{n} video(s) publicados")
        except Exception as e:  # noqa: BLE001
            with candado:
                estado.update(estado="fallido", mensaje=str(e)[:200])
        return


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origen = self.headers.get("Origin", "")
        if origen in ORIGENES:
            self.send_header("Access-Control-Allow-Origin", origen)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")

    def _json(self, codigo, datos):
        cuerpo = json.dumps(datos).encode()
        self.send_response(codigo)
        self._cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/estado":
            with candado:
                self._json(200, dict(estado))
            return
        self._json(404, {"mensaje": "no existe"})

    def do_POST(self):
        if self.path.split("?")[0] != "/correr":
            self._json(404, {"mensaje": "no existe"})
            return
        largo = int(self.headers.get("content-length") or 0)
        try:
            cuerpo = json.loads(self.rfile.read(largo) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"mensaje": "cuerpo inválido"})
            return
        epica = str(cuerpo.get("epica", ""))
        if not re.fullmatch(r"MSF-\d+", epica):
            self._json(400, {"mensaje": "epica inválida"})
            return
        with candado:
            if estado["estado"] == "corriendo":
                self._json(409, {"mensaje": "ya hay una corrida en curso"})
                return
            estado.update(estado="corriendo", epica=epica, run_id=None, mensaje=None)
        try:
            gh("workflow", "run", WORKFLOW, "--repo", REPO, "--ref", "main", "-f", "e2e_sesion=true",
               "-f", "e2e_record=true", "-f", f"e2e_grep={epica}")
            time.sleep(8)
            lista = json.loads(gh("run", "list", "--repo", REPO, "--workflow", WORKFLOW, "--event", "workflow_dispatch",
                                  "--limit", "1", "--json", "databaseId"))
            run_id = lista[0]["databaseId"]
            with candado:
                estado.update(run_id=run_id)
            threading.Thread(target=vigilar, args=(run_id, epica), daemon=True).start()
            self._json(202, dict(estado))
        except Exception as e:  # noqa: BLE001
            with candado:
                estado.update(estado="fallido", mensaje=str(e)[:200])
            self._json(502, dict(estado))

    def log_message(self, formato, *args):
        print(time.strftime("%H:%M:%S"), formato % args, flush=True)


if __name__ == "__main__":
    print("runner e2e en 0.0.0.0:9328", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 9328), Handler).serve_forever()
