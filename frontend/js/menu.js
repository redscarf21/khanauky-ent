let productosDisponibles = [];
let carrito = JSON.parse(localStorage.getItem("carritoAgua")) || [];

async function cargarProductos() {
  try {
    productosDisponibles = await Api.get("/api/productos");
    renderizarProductos();
  } catch (err) {
    document.getElementById("contenedorProductos").innerHTML =
      `<p class="text-danger">No se pudo cargar el catálogo: ${err.message}</p>`;
  }
}

function renderizarProductos() {
  const contenedor = document.getElementById("contenedorProductos");
  contenedor.innerHTML = "";

  productosDisponibles.forEach((prod) => {
    const sinStock = prod.stock_total === 0;
    const col = document.createElement("div");
    col.className = "col-sm-6 col-lg-4";
    col.innerHTML = `
      <div class="tarjeta-producto ${sinStock ? "opacity-50" : ""}">
        <div class="img-producto" style="background-image:url('img/productos/${prod.imagen || ""}')"></div>
        <div class="cuerpo">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <span class="badge bg-light text-secondary small">${prod.categoria}</span>
            <span class="badge ${sinStock ? "bg-danger" : "bg-success"} small">
              ${sinStock ? "Sin stock" : `${prod.stock_total} disp.`}
            </span>
          </div>
          <h5 class="mb-1">${prod.nombre_producto}</h5>
          <p class="text-mid small mb-2">${prod.descripcion || ""}</p>
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold fs-5 text-azul-marca">S/ ${Number(prod.precio).toFixed(2)}</span>
            <span class="small text-mid">${prod.capacidad}</span>
          </div>
          <div class="mb-3">
            ${prod.tipoCliente === "EMPRESA"
              ? `<span class="badge bg-light text-azul-marca border border-azul-marca small"><i class="bi bi-building me-1"></i>Precio empresa aplicado</span>`
              : `<span class="small text-ambar"><i class="bi bi-box-seam me-1"></i>Precio por mayor (cuenta empresa): S/ ${Number(prod.precio_mayorista).toFixed(2)}</span>`
            }
          </div>
          <button class="btn-khanauky-primario w-100" data-id="${prod.producto_id}" ${sinStock ? "disabled" : ""}>
            <i class="bi bi-plus-circle me-1"></i> Agregar al carrito
          </button>
        </div>
      </div>`;
    contenedor.appendChild(col);
  });

  contenedor.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => agregarAlCarrito(parseInt(btn.dataset.id)));
  });
}

async function agregarAlCarrito(id) {
  try {
    await Api.get("/api/sesion");
  } catch {
    alert("Para realizar pedidos, primero inicia sesión.");
    window.location.href = "login.html";
    return;
  }

  const producto = productosDisponibles.find((p) => p.producto_id === id);
  const existente = carrito.find((item) => item.producto_id === id);

  if (existente) {
    existente.cantidad += 1;
  } else {
    carrito.push({ producto_id: producto.producto_id, nombre_producto: producto.nombre_producto, cantidad: 1 });
  }

  await actualizarCarrito();
  abrirCarrito();
}

async function actualizarCarrito() {
  localStorage.setItem("carritoAgua", JSON.stringify(carrito));

  const lista = document.getElementById("listaCarrito");
  const totalSpan = document.getElementById("totalCarrito");
  const contador = document.getElementById("contadorCarrito");

  if (carrito.length === 0) {
    lista.innerHTML = `<p class="text-center text-mid mt-4">El carrito está vacío.</p>`;
    totalSpan.textContent = "S/ 0.00";
    contador.textContent = "0";
    if (window.actualizarContadorGlobal) actualizarContadorGlobal();
    return;
  }

  try {
    const resumen = await Api.post("/api/cotizar", { items: carrito });

    lista.innerHTML = "";
    resumen.detalle.forEach((item) => {
      lista.innerHTML += `
        <div class="item-carrito">
          <div>
            <h6 class="mb-0">${item.nombre}</h6>
            <span class="small text-mid">S/ ${Number(item.precioUnitario).toFixed(2)} c/u · Subtotal: S/ ${Number(item.subTotal).toFixed(2)}</span>
          </div>
          <div class="controles-cantidad">
            <button class="btn-cant" data-id="${item.producto_id}" data-cambio="-1">−</button>
            <span>${item.cantidad}</span>
            <button class="btn-cant" data-id="${item.producto_id}" data-cambio="1">+</button>
            <button class="btn-cant btn-eliminar-item" data-eliminar="${item.producto_id}" title="Quitar del carrito"><i class="bi bi-trash"></i></button>
          </div>
        </div>`;
    });

    lista.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", () =>
        cambiarCantidad(parseInt(btn.dataset.id), parseInt(btn.dataset.cambio))
      );
    });

    lista.querySelectorAll("button[data-eliminar]").forEach((btn) => {
      btn.addEventListener("click", () => eliminarDelCarrito(parseInt(btn.dataset.eliminar)));
    });

    totalSpan.textContent = `S/ ${resumen.totalAPagar.toFixed(2)}`;
    const aviso = resumen.modalidadSugerida === "delivery"
      ? `<span class="badge badge-delivery ms-2">Delivery</span>`
      : `<span class="badge badge-recojo ms-2">Recojo en tienda</span>`;
    const badgeAnterior = totalSpan.nextElementSibling;
    if (badgeAnterior && (badgeAnterior.classList.contains("badge-delivery") || badgeAnterior.classList.contains("badge-recojo"))) {
      badgeAnterior.remove();
    }
    totalSpan.insertAdjacentHTML("afterend", aviso);

    contador.textContent = carrito.reduce((t, p) => t + p.cantidad, 0);
    if (window.actualizarContadorGlobal) actualizarContadorGlobal();
  } catch (err) {
    lista.innerHTML = `<p class="text-danger small">${err.message}</p>`;
  }
}

function cambiarCantidad(id, cambio) {
  const item = carrito.find((i) => i.producto_id === id);
  if (!item) return;
  item.cantidad += cambio;
  if (item.cantidad <= 0) carrito = carrito.filter((i) => i.producto_id !== id);
  actualizarCarrito();
}

function eliminarDelCarrito(id) {
  carrito = carrito.filter((i) => i.producto_id !== id);
  actualizarCarrito();
}

function abrirCarrito() {
  document.getElementById("carritoLateral").classList.add("abierto");
  document.getElementById("overlayCarrito").classList.add("abierto");
}
function cerrarCarrito() {
  document.getElementById("carritoLateral").classList.remove("abierto");
  document.getElementById("overlayCarrito").classList.remove("abierto");
}

document.getElementById("btnAbrirCarrito").addEventListener("click", abrirCarrito);
document.getElementById("btnCerrarCarrito").addEventListener("click", cerrarCarrito);
document.getElementById("overlayCarrito").addEventListener("click", cerrarCarrito);

document.getElementById("btnProcederPago").addEventListener("click", () => {
  if (carrito.length === 0) { alert("Agrega productos primero."); return; }
  window.location.href = "form.html";
});

Api.get("/api/sesion")
  .catch(() => document.getElementById("mensajeNoLogueado").classList.remove("d-none"));

cargarProductos();
actualizarCarrito();