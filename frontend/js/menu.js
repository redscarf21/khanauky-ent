// El precio siempre se pide al backend (/api/cotizar), nunca se calcula aquí
let productosDisponibles = [];
let carrito = JSON.parse(localStorage.getItem("carritoAgua")) || [];

const imagenesPorId = {
  1: "img/productos/agua-650ml.jpg",
  2: "img/productos/agua-7l.jpg",
  3: "img/productos/bidon-20l.jpg",
  4: "img/productos/hielo-1-5kg.jpg",
  5: "img/productos/hielo-3kg.jpg"
};

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
    const col = document.createElement("div");
    col.className = "col-sm-6 col-lg-4";
    col.innerHTML = `
      <div class="tarjeta-producto">
        <div class="img-producto" style="background-image:url('${imagenesPorId[prod.id] || ""}')"></div>
        <div class="cuerpo">
          <h5>${prod.nombre}</h5>
          <p class="text-mid small mb-3">${prod.descripcion}</p>
          <button class="btn-khanauky-primario w-100" data-id="${prod.id}">
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

  const producto = productosDisponibles.find((p) => p.id === id);
  const itemExistente = carrito.find((item) => item.id === id);

  if (itemExistente) {
    itemExistente.cantidad += 1;
  } else {
    carrito.push({ id: producto.id, nombre: producto.nombre, cantidad: 1 });
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
            <span class="small text-mid">Subtotal: S/ ${item.subtotal.toFixed(2)}</span>
          </div>
          <div class="controles-cantidad">
            <button class="btn-cant" data-id="${item.id}" data-cambio="-1">−</button>
            <span>${item.cantidad}</span>
            <button class="btn-cant" data-id="${item.id}" data-cambio="1">+</button>
          </div>
        </div>`;
    });

    lista.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", () =>
        cambiarCantidad(parseInt(btn.dataset.id), parseInt(btn.dataset.cambio))
      );
    });

    totalSpan.textContent = `S/ ${resumen.totalAPagar.toFixed(2)}`;
    contador.textContent = carrito.reduce((t, p) => t + p.cantidad, 0);
    if (window.actualizarContadorGlobal) actualizarContadorGlobal();
  } catch (err) {
    lista.innerHTML = `<p class="text-danger small">No se pudo calcular el total: ${err.message}</p>`;
  }
}

function cambiarCantidad(id, cambio) {
  const item = carrito.find((i) => i.id === id);
  if (!item) return;
  item.cantidad += cambio;
  if (item.cantidad <= 0) carrito = carrito.filter((i) => i.id !== id);
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
  if (carrito.length === 0) {
    alert("Agrega productos primero.");
    return;
  }
  window.location.href = "form.html";
});

// Mostrar/ocultar aviso de visitante según si hay sesión activa
Api.get("/api/sesion")
  .catch(() => document.getElementById("mensajeNoLogueado").classList.remove("d-none"));

cargarProductos();
actualizarCarrito();
