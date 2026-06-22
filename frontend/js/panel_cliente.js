async function iniciar() {
  let usuario;
  try {
    const data = await Api.get("/api/sesion");
    usuario = data.usuario;
    if (usuario.rol !== "cliente") throw new Error("rol incorrecto");
  } catch {
    window.location.replace("login.html");
    return;
  }

  document.getElementById("nombreCliente").textContent = `Hola, ${usuario.nombre}`;
  cargarPedidos();
}

async function cargarPedidos() {
  const contenedor = document.getElementById("listaPedidos");
  try {
    const pedidos = await Api.get("/api/mis-pedidos");

    if (pedidos.length === 0) {
      contenedor.innerHTML = `<p class="text-mid">Aún no tienes pedidos registrados en el sistema.</p>`;
      return;
    }

    contenedor.innerHTML = pedidos
      .map((p) => {
        const claseEstado = "estado-" + p.estado.replace(/ /g, "-");
        const etiquetaEntrega = p.modalidadEntrega === "delivery" ? "Delivery" : "Recojo en tienda";
        return `
        <div class="pedido-card d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <strong>${p.codigoOrden}</strong>
            <span class="badge-estado ${claseEstado} ms-2">${p.estado}</span>
            <span class="ms-2 small text-mid">${etiquetaEntrega}</span>
            <div class="small text-mid mt-1">${p.creadoEn} · S/ ${p.precio.totalAPagar.toFixed(2)}</div>
          </div>
          <a class="btn-khanauky-outline btn-sm" href="/api/pedidos/${p.codigoOrden}/comprobante?tipo=${p.tipoComprobante}" target="_blank">
            <i class="bi bi-receipt"></i> Ver ${p.tipoComprobante === "factura" ? "factura" : "boleta"}
          </a>
        </div>`;
      })
      .join("");
  } catch (err) {
    contenedor.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("btnCerrarSesion").addEventListener("click", async () => {
  await Api.post("/api/logout", {});
  localStorage.removeItem("carritoAgua");
  window.location.replace("login.html");
});

iniciar();
