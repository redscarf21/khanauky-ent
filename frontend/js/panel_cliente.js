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

  try {
    document.getElementById("nombreCliente").textContent = `Hola, ${usuario.nombre}`;
    document.getElementById("tipoCliente").textContent =
      usuario.tipoCliente === "EMPRESA" ? "Cuenta Empresa" : "Cuenta Personal";
  } catch (err) {
    console.error("Error mostrando datos de sesión:", err.message);
  }

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

const PASOS_SEGUIMIENTO = ["Venta Registrada", "Pago Confirmado", "Entregado"];
const ESTADOS_FINALIZADOS_SIN_STEPPER = ["Cancelado"];

function construirStepper(estadoActual) {
  if (ESTADOS_FINALIZADOS_SIN_STEPPER.includes(estadoActual)) return "";

  const indiceActual = PASOS_SEGUIMIENTO.indexOf(estadoActual);
  if (indiceActual === -1) return "";

  return `<div class="stepper-pedido">` +
    PASOS_SEGUIMIENTO.map((paso, i) => {
      const clase = i < indiceActual ? "completado" : i === indiceActual ? "actual" : "";
      return `
        <div class="stepper-paso ${clase}">
          <div class="linea"></div>
          <div class="punto">${i < indiceActual ? '<i class="bi bi-check"></i>' : ""}</div>
          <div class="etiqueta">${paso}</div>
        </div>`;
    }).join("") +
    `</div>`;
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

      const infoEntrega = p.direccion_entrega ? `
        <div class="info-entrega-pedido">
          <i class="bi bi-geo-alt me-1"></i>${p.direccion_entrega}
          ${p.hora_salida ? `<br><i class="bi bi-truck me-1"></i>Salió a las ${p.hora_salida.slice(0,5)}` : ""}
          ${p.hora_entrega ? `<br><i class="bi bi-check-circle me-1"></i>Entregado a las ${p.hora_entrega.slice(0,5)}` : ""}
        </div>` : "";

      return `
        <div class="pedido-card">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
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
            ${p.estado !== "Venta Registrada" && p.estado !== "Cancelado" ? `
              <a class="btn-khanauky-outline btn-sm"
                 href="/api/pedidos/${p.codigo_orden}/comprobante"
                 target="_blank">
                <i class="bi bi-receipt"></i> Ver ${p.tipo_comprobante === "Factura" ? "factura" : "boleta"}
              </a>` : p.estado === "Cancelado" ? `
              <span class="small text-mid fst-italic"><i class="bi bi-x-circle me-1"></i>Sin comprobante (cancelado)</span>` : `
              <span class="small text-mid fst-italic"><i class="bi bi-hourglass-split me-1"></i>Comprobante disponible al confirmar el pago</span>`
            }
          </div>
          ${construirStepper(p.estado)}
          ${infoEntrega}
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