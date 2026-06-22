let productosCatalogo = [];
let sucursalesCache = [];
let itemsVentaPresencial = [];
let usuarioActual = null;

async function iniciar() {
  try {
    const data = await Api.get("/api/sesion");
    usuarioActual = data.usuario;
    if (usuarioActual.rol !== "empleado") throw new Error("rol incorrecto");
  } catch {
    window.location.replace("login.html");
    return;
  }

  document.getElementById("nombreEmpleado").textContent = usuarioActual.nombre;
  await Promise.all([cargarProductosCatalogo(), cargarSucursalesEnSelect()]);
  cargarDashboard();
}

document.getElementById("btnCerrarSesion").addEventListener("click", async () => {
  await Api.post("/api/logout", {});
  window.location.replace("login.html");
});

const botonesMenu = document.querySelectorAll(".menu-btn[data-target]");
const secciones = document.querySelectorAll(".seccion-admin");
const sidebar = document.getElementById("sidebarAdmin");
const overlaySidebar = document.getElementById("overlaySidebar");

botonesMenu.forEach((boton) => {
  boton.addEventListener("click", () => {
    botonesMenu.forEach((b) => b.classList.remove("activa"));
    secciones.forEach((s) => s.classList.remove("activa"));
    boton.classList.add("activa");
    document.getElementById(boton.dataset.target).classList.add("activa");
    sidebar.classList.remove("abierto");
    overlaySidebar.classList.remove("activo");

    if (boton.dataset.target === "sec-reporte") cargarPedidos();
    if (boton.dataset.target === "sec-sucursales") { cargarListaSucursales(); cargarResumenIngresos(); }
    if (boton.dataset.target === "sec-empleados") cargarTablaEmpleados();
  });
});

document.getElementById("btnAbrirSidebar").addEventListener("click", () => {
  sidebar.classList.add("abierto");
  overlaySidebar.classList.add("activo");
});
overlaySidebar.addEventListener("click", () => {
  sidebar.classList.remove("abierto");
  overlaySidebar.classList.remove("activo");
});

async function cargarDashboard() {
  try {
    const [pedidos, sucursales] = await Promise.all([Api.get("/api/pedidos"), Api.get("/api/sucursales")]);

    document.getElementById("kpiPedidos").textContent = pedidos.length;
    document.getElementById("kpiVentas").textContent = "S/ " + pedidos.reduce((t, p) => t + p.precio.totalAPagar, 0).toFixed(2);
    document.getElementById("kpiPendientes").textContent =
      pedidos.filter((p) => p.estado === "Entrega Pendiente" || p.estado === "Venta Registrada").length;
    document.getElementById("kpiSucursales").textContent = sucursales.length;
  } catch (err) {
    console.error("Error cargando dashboard:", err.message);
  }
}

function filaEstadoSelect(p) {
  return `
    <select class="form-select form-select-sm" style="width:auto;" data-orden="${p.codigoOrden}">
      <option ${p.estado === "Venta Registrada" ? "selected" : ""}>Venta Registrada</option>
      <option ${p.estado === "Venta Exitosa" ? "selected" : ""}>Venta Exitosa</option>
      <option ${p.estado === "Entrega Pendiente" ? "selected" : ""}>Entrega Pendiente</option>
      <option ${p.estado === "Venta Entregada" ? "selected" : ""}>Venta Entregada</option>
    </select>`;
}

async function cargarPedidos() {
  const cont = document.getElementById("contenedorTablaPedidos");
  try {
    const pedidos = await Api.get("/api/pedidos");

    if (pedidos.length === 0) {
      cont.innerHTML = `<p class="text-mid">Todavía no hay ventas registradas.</p>`;
      return;
    }

    let html = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Orden</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Entrega</th><th>Estado</th></tr></thead><tbody>`;

    pedidos.forEach((p) => {
      const claseEstado = "estado-" + p.estado.replace(/ /g, "-");
      const badgeEntrega = p.modalidadEntrega === "delivery"
        ? `<span class="badge-modalidad badge-delivery">Delivery</span>`
        : `<span class="badge-modalidad badge-recojo">Recojo en tienda</span>`;

      html += `<tr>
        <td><span class="punto-estado ${claseEstado}"></span><strong>${p.codigoOrden}</strong></td>
        <td class="small">${p.creadoEn}</td>
        <td>${p.cliente}</td>
        <td>S/ ${p.precio.totalAPagar.toFixed(2)}</td>
        <td>${badgeEntrega}</td>
        <td>${filaEstadoSelect(p)}</td>
      </tr>`;
    });

    cont.innerHTML = html + "</tbody></table></div>";

    cont.querySelectorAll("select[data-orden]").forEach((select) => {
      select.addEventListener("change", () => actualizarEstado(select.dataset.orden, select.value));
    });
  } catch (error) {
    cont.innerHTML = `<p class="text-danger">${error.message}</p>`;
  }
}

async function actualizarEstado(orden, nuevoEstado) {
  try {
    await Api.patch(`/api/pedidos/${orden}/estado`, { estado: nuevoEstado });
    cargarDashboard();
  } catch (err) {
    alert("Error al actualizar el estado: " + err.message);
  }
}

document.querySelectorAll(".tab-reporte-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-reporte-btn").forEach((b) => b.classList.remove("activa"));
    btn.classList.add("activa");
    const esMensual = btn.dataset.reporte === "mensual";
    document.getElementById("vistaReporteDiario").classList.toggle("d-none", esMensual);
    document.getElementById("vistaReporteMensual").classList.toggle("d-none", !esMensual);
    if (esMensual) cargarReporteMensual();
  });
});

async function cargarReporteMensual() {
  const cont = document.getElementById("contenedorTablaMensual");
  try {
    const meses = await Api.get("/api/reportes/mensual");

    if (meses.length === 0) {
      cont.innerHTML = `<p class="text-mid">Aún no hay historial suficiente para un reporte mensual.</p>`;
      document.getElementById("kpiMesesConVentas").textContent = "0";
      document.getElementById("kpiTotalHistorico").textContent = "S/ 0.00";
      document.getElementById("kpiPromedioMensual").textContent = "S/ 0.00";
      return;
    }

    const totalHistorico = meses.reduce((t, m) => t + m.totalVentas, 0);
    document.getElementById("kpiMesesConVentas").textContent = meses.length;
    document.getElementById("kpiTotalHistorico").textContent = `S/ ${totalHistorico.toFixed(2)}`;
    document.getElementById("kpiPromedioMensual").textContent = `S/ ${(totalHistorico / meses.length).toFixed(2)}`;

    let html = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Mes</th><th>Pedidos</th><th>Ventas totales</th></tr></thead><tbody>`;

    meses.forEach((m) => {
      html += `<tr><td>${m.mes}</td><td>${m.totalPedidos}</td><td>S/ ${m.totalVentas.toFixed(2)}</td></tr>`;
    });

    cont.innerHTML = html + "</tbody></table></div>";
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("btnBuscarDni").addEventListener("click", async () => {
  const dato = document.getElementById("inputDni").value.trim();
  const cont = document.getElementById("resultadoBusqueda");
  if (!dato) return;

  try {
    const resultados = await Api.get(`/api/pedidos/buscar/${encodeURIComponent(dato)}`);
    if (resultados.length === 0) {
      cont.innerHTML = `<p class="text-mid">No se encontraron pedidos con ese dato.</p>`;
      return;
    }
    cont.innerHTML = `<ul class="list-group">` +
      resultados.map((p) => `<li class="list-group-item">${p.codigoOrden} — ${p.cliente} — S/ ${p.precio.totalAPagar.toFixed(2)} — ${p.estado}</li>`).join("") +
      `</ul>`;
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
});

document.getElementById("btnListarFacturas").addEventListener("click", async () => {
  const cont = document.getElementById("listaFacturas");
  try {
    const pedidos = await Api.get("/api/pedidos");
    cont.innerHTML = pedidos
      .map((p) => `
        <div class="d-flex justify-content-between align-items-center border-bottom py-2">
          <span>${p.codigoOrden} — ${p.cliente} — S/ ${p.precio.totalAPagar.toFixed(2)}</span>
          <div class="d-flex gap-2">
            <a class="btn-khanauky-outline btn-sm" target="_blank" href="/api/pedidos/${p.codigoOrden}/comprobante?tipo=boleta">Boleta</a>
            ${p.ruc ? `<a class="btn-khanauky-outline btn-sm" target="_blank" href="/api/pedidos/${p.codigoOrden}/comprobante?tipo=factura">Factura</a>` : ""}
          </div>
        </div>`)
      .join("");
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
});

async function cargarProductosCatalogo() {
  productosCatalogo = await Api.get("/api/productos");
}

async function cargarSucursalesEnSelect() {
  sucursalesCache = await Api.get("/api/sucursales");
  document.getElementById("ventaSucursal").innerHTML = sucursalesCache.map((s) => `<option value="${s.nombre}">${s.nombre}</option>`).join("");
}

async function cargarListaSucursales() {
  const cont = document.getElementById("listaSucursalesAdmin");
  try {
    sucursalesCache = await Api.get("/api/sucursales");
    cont.innerHTML = `<ul class="list-group">` +
      sucursalesCache.map((s) => `<li class="list-group-item"><strong>${s.nombre}</strong>${s.direccion ? " — " + s.direccion : ""}</li>`).join("") +
      `</ul>`;
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

async function cargarResumenIngresos() {
  const cont = document.getElementById("resumenIngresosSucursales");
  try {
    const resumen = await Api.get("/api/sucursales/resumen-ingresos");
    let html = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Sucursal</th><th>Pedidos</th><th>Ingresos</th></tr></thead><tbody>`;
    resumen.forEach((r) => {
      html += `<tr><td>${r.nombre}</td><td>${r.totalPedidos}</td><td>S/ ${r.totalIngresos.toFixed(2)}</td></tr>`;
    });
    cont.innerHTML = html + "</tbody></table></div>";
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("formSucursal").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = document.getElementById("nuevaSucursalNombre").value.trim();
  const direccion = document.getElementById("nuevaSucursalDireccion").value.trim();
  try {
    await Api.post("/api/sucursales", { nombre, direccion });
    document.getElementById("formSucursal").reset();
    cargarListaSucursales();
    cargarSucursalesEnSelect();
    cargarResumenIngresos();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("formEmpleado").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById("empMensaje");
  const datos = {
    nombre: document.getElementById("empNombre").value,
    usuario: document.getElementById("empUsuario").value,
    email: document.getElementById("empEmail").value,
    pass: document.getElementById("empPass").value
  };
  try {
    const data = await Api.post("/api/empleados", datos);
    mensaje.className = "small mt-2 mb-0 text-success fw-semibold";
    mensaje.textContent = data.mensaje;
    document.getElementById("formEmpleado").reset();
    cargarTablaEmpleados();
  } catch (err) {
    mensaje.className = "small mt-2 mb-0 text-danger fw-semibold";
    mensaje.textContent = err.message;
  }
});

async function cargarTablaEmpleados() {
  const cont = document.getElementById("tablaEmpleados");
  const aviso = document.getElementById("avisoAdminPrincipal");

  aviso.textContent = usuarioActual?.esAdminPrincipal
    ? "Como administrador principal, puedes asignar una nueva contraseña a cualquier empleado."
    : "Solo el administrador principal puede reasignar contraseñas de otros empleados.";

  try {
    const empleados = await Api.get("/api/empleados");
    let html = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th></th></tr></thead><tbody>`;

    empleados.forEach((emp) => {
      const etiquetaRol = emp.esAdminPrincipal ? "Administrador principal" : "Administrador";
      const botonReset = usuarioActual?.esAdminPrincipal
        ? `<button class="btn-khanauky-outline btn-sm" data-id="${emp.id}" data-nombre="${emp.nombre}">Asignar nueva contraseña</button>`
        : "";
      html += `<tr><td>${emp.nombre}</td><td>${emp.usuario}</td><td>${emp.email || "-"}</td><td>${etiquetaRol}</td><td>${botonReset}</td></tr>`;
    });

    cont.innerHTML = html + "</tbody></table></div>";

    cont.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => asignarNuevaPassword(btn.dataset.id, btn.dataset.nombre));
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

async function asignarNuevaPassword(id, nombre) {
  if (!confirm(`¿Asignar una nueva contraseña temporal a ${nombre}? Se le enviará por correo.`)) return;
  try {
    const data = await Api.post(`/api/empleados/${id}/asignar-password`, {});
    alert(`Contraseña reasignada. Se envió a su correo.\n\nContraseña temporal: ${data.passTemporal}`);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

function renderizarItemsVenta() {
  const cont = document.getElementById("itemsVenta");
  cont.innerHTML = itemsVentaPresencial
    .map((item, idx) => `
      <div class="row g-2 align-items-end mb-2">
        <div class="col-6">
          <select class="form-select" data-idx="${idx}" data-campo="id">
            ${productosCatalogo.map((p) => `<option value="${p.id}" ${p.id === item.id ? "selected" : ""}>${p.nombre}</option>`).join("")}
          </select>
        </div>
        <div class="col-4">
          <input type="number" min="1" class="form-control" data-idx="${idx}" data-campo="cantidad" value="${item.cantidad}">
        </div>
        <div class="col-2">
          <button type="button" class="btn btn-outline-danger w-100" data-idx="${idx}" data-accion="quitar"><i class="bi bi-trash"></i></button>
        </div>
      </div>`)
    .join("");

  cont.querySelectorAll("[data-campo]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const campo = e.target.dataset.campo;
      itemsVentaPresencial[idx][campo] = campo === "id" ? parseInt(e.target.value) : parseInt(e.target.value) || 1;
      if (campo === "id") {
        itemsVentaPresencial[idx].nombre = productosCatalogo.find((p) => p.id === itemsVentaPresencial[idx].id)?.nombre;
      }
      recalcularTotalVentaPresencial();
    });
  });

  cont.querySelectorAll("[data-accion='quitar']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      itemsVentaPresencial.splice(parseInt(e.currentTarget.dataset.idx), 1);
      renderizarItemsVenta();
      recalcularTotalVentaPresencial();
    });
  });
}

document.getElementById("btnAgregarItem").addEventListener("click", () => {
  const primero = productosCatalogo[0];
  itemsVentaPresencial.push({ id: primero.id, nombre: primero.nombre, cantidad: 1 });
  renderizarItemsVenta();
  recalcularTotalVentaPresencial();
});

async function recalcularTotalVentaPresencial() {
  const span = document.getElementById("totalVentaPresencial");
  if (itemsVentaPresencial.length === 0) {
    span.textContent = "S/ 0.00";
    return;
  }
  try {
    const resumen = await Api.post("/api/cotizar", { items: itemsVentaPresencial });
    span.textContent = `S/ ${resumen.totalAPagar.toFixed(2)} (${resumen.modalidadSugerida === "delivery" ? "Delivery" : "Recojo en tienda"})`;
  } catch {
    span.textContent = "S/ 0.00";
  }
}

document.getElementById("formVentaPresencial").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (itemsVentaPresencial.length === 0) {
    alert("Agrega al menos un producto a la venta.");
    return;
  }

  const datos = {
    cliente: document.getElementById("ventaCliente").value,
    dni: document.getElementById("ventaDni").value,
    telefono: document.getElementById("ventaTelefono").value,
    sucursal: document.getElementById("ventaSucursal").value,
    ruc: document.getElementById("ventaRuc").value || null,
    razonSocial: document.getElementById("ventaRazonSocial").value || null,
    metodopago: "Efectivo al recibir",
    productos: itemsVentaPresencial
  };

  try {
    const data = await Api.post("/api/ventas-presenciales", datos);
    alert(`Venta registrada con orden ${data.orden}`);
    document.getElementById("formVentaPresencial").reset();
    itemsVentaPresencial = [];
    renderizarItemsVenta();
    recalcularTotalVentaPresencial();
    cargarDashboard();
  } catch (err) {
    alert("No se pudo registrar la venta: " + err.message);
  }
});

iniciar();
