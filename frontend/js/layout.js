// Navbar y footer compartidos, inyectados en cada página
const ANIO_ACTUAL = new Date().getFullYear();

function plantillaNavbar(paginaActual) {
  const esActiva = (pagina) => (paginaActual === pagina ? "active" : "");

  return `
  <nav class="navbar navbar-khanauky navbar-expand-lg fixed-top" id="navbarKhanauky">
    <div class="container">
      <a class="navbar-brand" href="index.html">
        <img src="img/logo.png" alt="Logo Aquaelis" class="brand-icon-img">
        KHANAUKY<span class="marca-acento">·AQUAELIS</span>
      </a>
      <button class="navbar-toggler bg-light" type="button" data-bs-toggle="collapse" data-bs-target="#navLinksKhanauky" aria-label="Abrir menú">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navLinksKhanauky">
        <ul class="navbar-nav ms-auto align-items-lg-center gap-1">
          <li class="nav-item"><a class="nav-link ${esActiva("inicio")}" href="index.html">Inicio</a></li>
          <li class="nav-item"><a class="nav-link" href="menu.html">Catálogo</a></li>
          <li class="nav-item"><a class="nav-link ${esActiva("nosotros")}" href="nosotros.html">Nosotros</a></li>
          <li class="nav-item" id="navAuthSlot"></li>
        </ul>
      </div>
    </div>
  </nav>`;
}

function plantillaFooter() {
  const direccion = "Av. José Olaya Mz. F Lote 12, Urb. La Victoria, Chao, Virú";
  const linkMaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion + ", Perú")}`;
  const telefono = "933260258";
  const linkWhatsapp = `https://wa.me/51${telefono}`;

  return `
  <footer class="footer-khanauky">
    <div class="container">
      <div class="row g-4">
        <div class="col-md-4">
          <div class="footer-logo d-flex align-items-center gap-2"><img src="img/logo.png" alt="Logo Aquaelis" style="width:28px;height:28px;object-fit:contain;"> KHANAUKY</div>
          <p class="small">Agua de mesa Aquaelis y hielo Aquaelis Ice: 100% pura, osmotizada y ozonizada. Captación, tratamiento y distribución desde Chao, Virú, para todo el norte del país.</p>
        </div>
        <div class="col-md-4">
          <h5>Contacto</h5>
          <a href="${linkMaps}" target="_blank" rel="noopener" class="small mb-1 d-flex align-items-start gap-2 text-decoration-none">
            <i class="bi bi-geo-alt-fill mt-1"></i><span>${direccion}</span>
          </a>
          <a href="${linkWhatsapp}" target="_blank" rel="noopener" class="small mb-1 d-flex align-items-center gap-2 text-decoration-none">
            <i class="bi bi-whatsapp"></i><span>933 260 258</span>
          </a>
          <p class="small mb-1"><i class="bi bi-envelope-fill me-2"></i>administracion@khanauky.com</p>
        </div>
        <div class="col-md-4">
          <h5>Enlaces rápidos</h5>
          <a href="index.html" class="d-block small mb-2">Inicio</a>
          <a href="nosotros.html" class="d-block small mb-2">Nuestra historia</a>
          <a href="menu.html" class="d-block small mb-2">Catálogo de productos</a>
          <a href="login.html" class="d-block small mb-2">Acceso al sistema</a>
        </div>
      </div>
      <div class="footer-bottom">&copy; ${ANIO_ACTUAL} Industria Khanauky. Todos los derechos reservados.</div>
    </div>
  </footer>`;
}

function renderizarAuthSlot() {
  const slot = document.getElementById("navAuthSlot");
  if (!slot) return;

  fetch("/api/sesion")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(({ usuario }) => {
      if (usuario.rol === "cliente") {
        slot.innerHTML = `
          <div class="d-flex gap-2 align-items-center mt-2 mt-lg-0">
            <a href="panel_cliente.html" class="nav-link"><i class="bi bi-person-circle me-1"></i>Mi perfil</a>
            <a href="menu.html" class="btn-carrito-nav"><i class="bi bi-cart3"></i> <span id="cartCountGlobal">0</span></a>
          </div>`;
        actualizarContadorGlobal();
      } else if (usuario.rol === "empleado") {
        slot.innerHTML = `
          <a href="panel_admin.html" class="btn-acceso-nav d-inline-block mt-2 mt-lg-0">
            <i class="bi bi-speedometer2 me-1"></i>Panel de gestión
          </a>`;
      }
    })
    .catch(() => {
      slot.innerHTML = `
        <a href="login.html" class="btn-acceso-nav d-inline-block mt-2 mt-lg-0">Acceder / Crear cuenta</a>`;
    });
}

function actualizarContadorGlobal() {
  const span = document.getElementById("cartCountGlobal");
  if (!span) return;
  const carrito = JSON.parse(localStorage.getItem("carritoAgua")) || [];
  span.textContent = carrito.reduce((total, p) => total + p.cantidad, 0);
}

function inicializarLayout(paginaActual = "") {
  document.getElementById("navbarSlot").innerHTML = plantillaNavbar(paginaActual);
  document.getElementById("footerSlot").innerHTML = plantillaFooter();

  renderizarAuthSlot();

  const navbar = document.getElementById("navbarKhanauky");
  window.addEventListener(
    "scroll",
    () => navbar.classList.toggle("scrolled", window.scrollY > 30),
    { passive: true }
  );
}

window.inicializarLayout = inicializarLayout;
window.actualizarContadorGlobal = actualizarContadorGlobal;
