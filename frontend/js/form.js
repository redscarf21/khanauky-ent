const divResumen = document.getElementById("resumenProductos");
const spanTotal = document.getElementById("totalFinal");
const btnConfirmar = document.getElementById("btnConfirmar");
const avisoEntrega = document.getElementById("avisoEntrega");
const checkFactura = document.getElementById("quiereFactura");
const bloqueFactura = document.getElementById("bloqueFactura");

let pedido = JSON.parse(localStorage.getItem("carritoAgua")) || [];
let resumenActual = null;
let metodosPago = [];
let tiposComprobante = [];
let ubigeoIdCliente = null;

checkFactura.addEventListener("change", () => {
  bloqueFactura.classList.toggle("d-none", !checkFactura.checked);
});

async function cargarResumen() {
  if (pedido.length === 0) {
    divResumen.innerHTML = `<p class="empty-msg">Tu carrito está vacío.</p>`;
    btnConfirmar.disabled = true;
    return;
  }

  try {
    resumenActual = await Api.post("/api/cotizar", { items: pedido });

    divResumen.innerHTML = "";
    resumenActual.detalle.forEach((item) => {
      divResumen.innerHTML += `
        <div class="resumen-item">
          <span>${item.cantidad}x <strong>${item.nombre}</strong></span>
          <span>S/ ${Number(item.subTotal).toFixed(2)}</span>
        </div>`;
    });

    spanTotal.textContent = `S/ ${resumenActual.totalAPagar.toFixed(2)}`;

    if (resumenActual.modalidadSugerida === "delivery") {
      avisoEntrega.innerHTML = `<div class="aviso-entrega aviso-delivery"><i class="bi bi-truck"></i><span>Tu pedido califica para <strong>delivery</strong>: te lo llevamos hasta tu dirección.</span></div>`;
    } else {
      avisoEntrega.innerHTML = `<div class="aviso-entrega aviso-recojo"><i class="bi bi-shop"></i><span>Por el monto de tu pedido, la entrega es <strong>recojo en tienda</strong>. Desde S/ ${resumenActual.montoMinimoDelivery.toFixed(2)} ya calificas para delivery.</span></div>`;
    }
  } catch (err) {
    divResumen.innerHTML = `<p class="text-danger small">${err.message}</p>`;
  }

  try {
    const { usuario } = await Api.get("/api/sesion");
    document.getElementById("nombre").value = usuario.nombre || "";
  } catch {}

  try {
    const perfil = await Api.get("/api/mi-perfil");
    ubigeoIdCliente = perfil.ubigeo_id || null;
    document.getElementById("direccion").value = perfil.direccion || "";
    document.getElementById("telefono").value = perfil.telefono || "";
  } catch {}
}

async function cargarOpciones() {
  try {
    [metodosPago, tiposComprobante] = await Promise.all([
      Api.get("/api/metodos-pago"),
      Api.get("/api/tipos-comprobante")
    ]);

    const selectPago = document.getElementById("metodoPagoId");
    selectPago.innerHTML = metodosPago
      .map((m) => `<option value="${m.metodo_pago_id}">${m.descripcion}</option>`)
      .join("");
  } catch (err) {
    console.error("Error cargando opciones:", err.message);
  }
}

document.getElementById("formularioPedido").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!pedido.length || !resumenActual) return;

  const comprobanteId = checkFactura.checked
    ? tiposComprobante.find((t) => t.descripcion === "Factura")?.comprobante_id
    : tiposComprobante.find((t) => t.descripcion === "Boleta")?.comprobante_id;

  const datos = {
    items: pedido,
    metodoPagoId: parseInt(document.getElementById("metodoPagoId").value),
    comprobanteId: comprobanteId || 1,
    direccionEntrega: document.getElementById("direccion").value,
    ubigeoId: ubigeoIdCliente
  };

  btnConfirmar.disabled = true;
  btnConfirmar.textContent = "Enviando...";

  try {
    const data = await Api.post("/api/pedidos", datos);
    alert(`¡Pedido ${data.orden} enviado con éxito!`);
    localStorage.removeItem("carritoAgua");
    window.location.replace("panel_cliente.html");
  } catch (err) {
    alert(err.message);
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = "Confirmar y enviar pedido";
  }
});

cargarResumen();
cargarOpciones();