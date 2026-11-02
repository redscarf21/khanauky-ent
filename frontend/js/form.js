const divResumen = document.getElementById("resumenProductos");
const spanTotal = document.getElementById("totalFinal");
const btnConfirmar = document.getElementById("btnConfirmar");
const avisoEntrega = document.getElementById("avisoEntrega");
const checkFactura = document.getElementById("quiereFactura");
const bloqueFactura = document.getElementById("bloqueFactura");
const bloqueBidones = document.getElementById("bloqueBidones");
const bloqueDevolucionBidon = document.getElementById("bloqueDevolucionBidon");

const PRECIO_COMPRA_BIDON = 5;

let pedido = [];
try {
  const guardado = JSON.parse(localStorage.getItem("carritoAgua"));
  if (Array.isArray(guardado)) pedido = guardado;
} catch { localStorage.removeItem("carritoAgua"); }
let resumenActual = null;
let metodosPago = [];
let tiposComprobante = [];
let ubigeoIdCliente = null;
let cantidadBidones20L = 0;
let enviando = false;
btnConfirmar.disabled = true;

checkFactura.addEventListener("change", () => {
  bloqueFactura.classList.toggle("d-none", !checkFactura.checked);
});

document.querySelectorAll('input[name="opcionBidon"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const esCompra = document.getElementById("bidonCompra").checked;
    bloqueDevolucionBidon.classList.toggle("d-none", esCompra);
    actualizarTotalMostrado();
  });
});

function actualizarTotalMostrado() {
  if (!resumenActual) return;
  const comprarBidon = document.getElementById("bidonCompra")?.checked;
  const extra = (comprarBidon && cantidadBidones20L > 0) ? cantidadBidones20L * PRECIO_COMPRA_BIDON : 0;
  spanTotal.textContent = `S/ ${(resumenActual.totalAPagar + extra).toFixed(2)}`;
}

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
          <span>${item.cantidad}x <strong>${escaparHtml(item.nombre)}</strong></span>
          <span>S/ ${Number(item.subTotal).toFixed(2)}</span>
        </div>`;
    });

    cantidadBidones20L = resumenActual.detalle
      .filter((i) => i.nombre === "Bidón de Agua 20L")
      .reduce((t, i) => t + i.cantidad, 0);
    bloqueBidones.classList.toggle("d-none", cantidadBidones20L === 0);

    actualizarTotalMostrado();

    document.getElementById("direccion").required = resumenActual.modalidadSugerida === "delivery";
    if (resumenActual.modalidadSugerida === "delivery") {
      avisoEntrega.innerHTML = `<div class="aviso-entrega aviso-delivery"><i class="bi bi-truck"></i><span>Tu pedido califica para <strong>delivery</strong>: te lo llevamos hasta tu dirección.</span></div>`;
    } else {
      avisoEntrega.innerHTML = `<div class="aviso-entrega aviso-recojo"><i class="bi bi-shop"></i><span>Por el monto de tu pedido, la entrega es <strong>recojo en tienda</strong>. Desde S/ ${resumenActual.montoMinimoDelivery.toFixed(2)} ya calificas para delivery.</span></div>`;
    }
  } catch (err) {
    resumenActual = null;
    divResumen.textContent = err.message;
    btnConfirmar.disabled = true;
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
  if (enviando || !pedido.length || !resumenActual) return;

  const comprobanteId = checkFactura.checked
    ? tiposComprobante.find((t) => t.descripcion === "Factura")?.comprobante_id
    : tiposComprobante.find((t) => t.descripcion === "Boleta")?.comprobante_id;

  if (checkFactura.checked) {
    const ruc = document.getElementById("ruc").value.trim();
    const razonSocial = document.getElementById("razonSocial").value.trim();
    if (!/^\d{11}$/.test(ruc) || !razonSocial || razonSocial.length > 100) {
      alert("Ingresa un RUC de 11 dígitos y una razón social de hasta 100 caracteres.");
      return;
    }
  }

  const datos = {
    items: pedido,
    metodoPagoId: parseInt(document.getElementById("metodoPagoId").value),
    comprobanteId: comprobanteId || 1,
    nombreContacto: document.getElementById("nombre").value.trim(),
    telefonoContacto: document.getElementById("telefono").value.trim(),
    direccionEntrega: document.getElementById("direccion").value.trim(),
    ubigeoId: ubigeoIdCliente,
    ...(checkFactura.checked && {
      ruc: document.getElementById("ruc").value.trim(),
      razonSocial: document.getElementById("razonSocial").value.trim()
    }),
    ...(cantidadBidones20L > 0 && {
      bidonesCompra: document.getElementById("bidonCompra").checked,
      bidonesDevolucion: document.getElementById("bidonCompra").checked
        ? null
        : document.getElementById("devolucionBidon").value
    })
  };

  enviando = true;
  btnConfirmar.disabled = true;
  btnConfirmar.textContent = "Enviando...";

  try {
    const data = await Api.post("/api/pedidos", datos);
    alert(`¡Pedido ${data.orden} enviado con éxito!`);
    localStorage.removeItem("carritoAgua");
    window.location.replace("panel_cliente.html");
  } catch (err) {
    alert(err.message);
    enviando = false;
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = "Confirmar y enviar pedido";
  }
});

Promise.all([cargarResumen(), cargarOpciones()]).then(() => {
  btnConfirmar.disabled = !(pedido.length && resumenActual && metodosPago.length && tiposComprobante.length && ubigeoIdCliente);
  if (pedido.length && !ubigeoIdCliente) avisoEntrega.textContent = "No se pudo cargar tu perfil. Recarga la página antes de confirmar.";
});