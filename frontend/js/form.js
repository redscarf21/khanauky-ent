const divResumen = document.getElementById("resumenProductos");
const spanTotal = document.getElementById("totalFinal");
const btnConfirmar = document.getElementById("btnConfirmar");
const selectSucursal = document.getElementById("sucursal");
const avisoEntrega = document.getElementById("avisoEntrega");
const checkFactura = document.getElementById("quiereFactura");
const bloqueFactura = document.getElementById("bloqueFactura");

let pedido = JSON.parse(localStorage.getItem("carritoAgua")) || [];

checkFactura.addEventListener("change", () => {
  bloqueFactura.classList.toggle("d-none", !checkFactura.checked);
});

async function cargarResumen() {
  if (pedido.length === 0) {
    divResumen.innerHTML = `<p class="empty-msg">Tu carrito está vacío.</p>`;
    btnConfirmar.disabled = true;
    btnConfirmar.classList.add("disabled");
    return;
  }

  try {
    const resumen = await Api.post("/api/cotizar", { items: pedido });

    divResumen.innerHTML = "";
    resumen.detalle.forEach((item) => {
      divResumen.innerHTML += `
        <div class="resumen-item">
          <span>${item.cantidad}x <strong>${item.nombre}</strong></span>
          <span>S/ ${item.subtotal.toFixed(2)}</span>
        </div>`;
    });

    spanTotal.textContent = `S/ ${resumen.totalAPagar.toFixed(2)}`;

    if (resumen.modalidadSugerida === "delivery") {
      avisoEntrega.innerHTML = `<div class="aviso-entrega aviso-delivery"><i class="bi bi-truck"></i><span>Tu pedido califica para <strong>delivery</strong>: te lo llevamos hasta tu dirección.</span></div>`;
    } else {
      avisoEntrega.innerHTML = `<div class="aviso-entrega aviso-recojo"><i class="bi bi-shop"></i><span>Por el monto de tu pedido, la entrega es <strong>recojo en tienda</strong>. Desde S/ ${resumen.montoMinimoDelivery.toFixed(2)} ya puedes elegir delivery.</span></div>`;
    }
  } catch (err) {
    divResumen.innerHTML = `<p class="text-danger small">${err.message}</p>`;
  }

  try {
    const { usuario } = await Api.get("/api/sesion");
    document.getElementById("nombre").value = usuario.nombre || "";
  } catch {
    // sin sesión activa, el backend rechazará el envío más adelante
  }
}

async function cargarSucursales() {
  try {
    const sucursales = await Api.get("/api/sucursales");
    selectSucursal.innerHTML = sucursales.map((s) => `<option value="${s.nombre}">${s.nombre}</option>`).join("");
  } catch {
    selectSucursal.innerHTML = `<option value="Chao">Sede Principal - Chao</option>`;
  }
}

document.getElementById("formularioPedido").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pedido.length === 0) return;

  const datosEnvio = {
    cliente: document.getElementById("nombre").value,
    telefono: document.getElementById("telefono").value,
    direccion: document.getElementById("direccion").value,
    sucursal: selectSucursal.value,
    metodopago: document.getElementById("pago").value,
    ruc: checkFactura.checked ? document.getElementById("ruc").value : null,
    razonSocial: checkFactura.checked ? document.getElementById("razonSocial").value : null,
    productos: pedido
  };

  btnConfirmar.disabled = true;
  btnConfirmar.textContent = "Enviando...";

  try {
    const data = await Api.post("/api/pedidos", datosEnvio);
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
cargarSucursales();
