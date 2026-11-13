// Ampliar capturas del manual: clic en una imagen para verla grande; Esc o clic para cerrar.
(function () {
  var visor = null;

  function cerrar() {
    if (visor) {
      visor.remove();
      visor = null;
      document.body.classList.remove("msf-zoom-abierto");
    }
  }

  function abrir(img) {
    cerrar();
    visor = document.createElement("div");
    visor.className = "msf-zoom";
    visor.setAttribute("role", "dialog");
    visor.setAttribute("aria-label", "Imagen ampliada");
    var grande = document.createElement("img");
    grande.src = img.currentSrc || img.src;
    grande.alt = img.alt || "";
    var pie = document.createElement("p");
    pie.textContent = (img.alt ? img.alt + " · " : "") + "Clic o Esc para cerrar";
    visor.appendChild(grande);
    visor.appendChild(pie);
    visor.addEventListener("click", cerrar);
    document.body.appendChild(visor);
    document.body.classList.add("msf-zoom-abierto");
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG" && t.closest(".md-content__inner") && !t.closest("a") && !t.closest(".msf-zoom")) {
      abrir(t);
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") cerrar();
  });
})();
