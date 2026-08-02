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
  document.getElementById("tipoCliente").textContent =
    usuario.tipoCliente === "EMPRESA" ? "Cuenta Empresa" : "Cuenta Personal";

  cargarPedidos();
  cargarPerfil();
}

async function cargarPerfil() {
  try {
    const perfil = await Api.get("/api/mi-perfil");
    const cont = document.getElementById("infoPerfil");
    cont.innerHTML = `
      <div class="row g-2 small">
        <div class="col-6"><span class="text-mid">Teléfono:</span> ${perfil.telefono || "-"}</div>
        <div class="col-6"><span class="text-mid">Distrito:</span> ${perfil.distrito}, ${perfil.provincia}</div>
        <div class="col-12"><span class="text-mid">Dirección:</span> ${perfil.direccion || "-"}</div>
        ${perfil.tipo_cliente === "PERSONA"
          ? `<div class="col-6"><span class="text-mid">DNI:</span> ${perfil.dni || "-"}</div>`
          : `<div class="col-6"><span class="text-mid">RUC:</span> ${perfil.ruc || "-"}</div>
             <div class="col-12"><span class="text-mid">Razón social:</span> ${perfil.razon_social || "-"}</div>`
        }
      </div>`;
  } catch (err) {
    document.getElementById("infoPerfil").innerHTML = `<p class="text-danger small">${err.message}</p>`;
  }
}

async function cargarPedidos() {
  const contenedor = document.getElementById("listaPedidos");
  try {
    const pedidos = await Api.get("/api/mis-pedidos");

    if (pedidos.length === 0) {
      contenedor.innerHTML = `<p class="text-mid">Aún no tienes pedidos registrados.</p>`;
      return;
    }

    contenedor.innerHTML = pedidos.map((p) => {
      const claseEstado = "estado-" + p.estado.replace(/ /g, "-");
      const saldoPendiente = Number(p.saldo_pendiente || 0);

      return `
        <div class="pedido-card d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <strong>${p.codigo_orden}</strong>
            <span class="badge-estado ${claseEstado} ms-2">${p.estado}</span>
            <div class="small text-mid mt-1">
              ${new Date(p.fecha_pedido).toLocaleDateString("es-PE")} ·
              S/ ${Number(p.total_pago).toFixed(2)}
              ${saldoPendiente > 0
                ? `<span class="text-danger ms-2">· Saldo pendiente: S/ ${saldoPendiente.toFixed(2)}</span>`
                : ""}
            </div>
            ${p.tipo_comprobante ? `<span class="small text-mid">${p.tipo_comprobante}</span>` : ""}
          </div>
          <a class="btn-khanauky-outline btn-sm"
             href="/api/pedidos/${p.codigo_orden}/comprobante"
             target="_blank">
            <i class="bi bi-receipt"></i> Ver ${p.tipo_comprobante === "Factura" ? "factura" : "boleta"}
          </a>
        </div>`;
    }).join("");
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