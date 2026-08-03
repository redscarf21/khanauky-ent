let productosCatalogo = [];
let sucursalesCache = [];
let itemsVentaPresencial = [];
let usuarioActual = null;
let estadosPedido = [];
let metodosPago = [];

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

  await Promise.all([
    cargarProductosCatalogo(),
    cargarEstadosPedido(),
    cargarMetodosPago()
  ]);
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

    const acciones = {
      "sec-reporte": cargarPedidos,
      "sec-sucursales": () => { cargarListaSucursales(); cargarResumenIngresos(); },
      "sec-empleados": cargarTablaEmpleados,
      "sec-lotes": cargarLotes,
      "sec-transportes": cargarTransportes,
      "sec-clientes": cargarClientes
    };
    if (acciones[boton.dataset.target]) acciones[boton.dataset.target]();
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

async function cargarEstadosPedido() {
  try {
    estadosPedido = await Api.get("/api/estados-pedido");
  } catch { }
}

async function cargarMetodosPago() {
  try {
    metodosPago = await Api.get("/api/metodos-pago");
    document.querySelectorAll(".select-metodo-pago").forEach((sel) => {
      sel.innerHTML = metodosPago.map((m) =>
        `<option value="${m.metodo_pago_id}">${m.descripcion}</option>`).join("");
    });
  } catch { }
}

const UMBRAL_STOCK_BAJO = 10;
const DIAS_ALERTA_VENCIMIENTO = 7;

async function cargarDashboard() {
  try {
    const [pedidos, stock, lotes] = await Promise.all([
      Api.get("/api/pedidos"),
      Api.get("/api/stock"),
      Api.get("/api/lotes")
    ]);

    document.getElementById("kpiPedidos").textContent = pedidos.length;
    document.getElementById("kpiVentas").textContent =
      "S/ " + pedidos.reduce((t, p) => t + Number(p.total_pago || 0), 0).toFixed(2);
    document.getElementById("kpiPendientes").textContent =
      pedidos.filter((p) => p.estado === "Pendiente" || p.estado === "En Proceso de Llenado").length;

    const sinStock = stock.filter((s) => Number(s.stock_disponible) === 0).length;
    document.getElementById("kpiSinStock").textContent = sinStock;
    if (sinStock > 0) {
      document.getElementById("kpiSinStock").closest(".kpi-card").classList.add("border-danger");
    }

    const stockBajo = stock.filter((s) =>
      Number(s.stock_disponible) > 0 && Number(s.stock_disponible) < UMBRAL_STOCK_BAJO
    );
    const contStockBajo = document.getElementById("alertaStockBajo");
    contStockBajo.innerHTML = stockBajo.length === 0
      ? `<p class="text-success small mb-0"><i class="bi bi-check-circle me-1"></i>Todo el stock está en niveles saludables.</p>`
      : stockBajo.map((s) => `
        <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
          <span class="small">${s.nombre_producto}</span>
          <span class="badge bg-warning text-dark">${s.stock_disponible} unid.</span>
        </div>`).join("");

    const hoy = new Date();
    const lotesPorVencer = lotes.filter((l) => {
      if (l.estado !== "Disponible") return false;
      const dias = Math.ceil((new Date(l.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24));
      return dias <= DIAS_ALERTA_VENCIMIENTO;
    });
    const contVencer = document.getElementById("alertaLotesVencer");
    contVencer.innerHTML = lotesPorVencer.length === 0
      ? `<p class="text-success small mb-0"><i class="bi bi-check-circle me-1"></i>Ningún lote vence pronto.</p>`
      : lotesPorVencer.map((l) => {
        const dias = Math.ceil((new Date(l.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24));
        const vencido = dias < 0;
        return `
          <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
            <span class="small">${l.nombre_producto} <span class="text-mid">(${l.unidades_disponibles} unid.)</span></span>
            <span class="badge ${vencido ? "bg-danger" : "bg-warning text-dark"}">
              ${vencido ? "Vencido" : `Vence en ${dias} día(s)`}
            </span>
          </div>`;
      }).join("");
  } catch (err) {
    console.error("Error dashboard:", err.message);
  }
}

function colorEstado(estado) {
  const mapa = {
    "Pendiente": "#D32F2F",
    "En Proceso de Llenado": "#F57C00",
    "Listo para Despacho": "#FBC02D",
    "En Ruta de Entrega": "#1976D2",
    "Entregado": "#388E3C",
    "Cancelado": "#616161",
    "Devuelto por Defecto": "#7B1FA2",
    "Facturado": "#0288D1"
  };
  return mapa[estado] || "#999";
}

async function cargarPedidos() {
  const cont = document.getElementById("contenedorTablaPedidos");
  const tabActiva = document.querySelector(".tab-reporte-btn.activa")?.dataset.reporte;
  if (tabActiva === "mensual") { cargarReporteMensual(); return; }

  try {
    const pedidos = await Api.get("/api/pedidos");
    if (pedidos.length === 0) {
      cont.innerHTML = `<p class="text-mid">Todavía no hay ventas registradas.</p>`;
      return;
    }

    const selectEstados = estadosPedido.map((e) =>
      `<option value="${e.estado_id}">${e.descripcion}</option>`).join("");

    let html = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Orden</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Saldo</th><th>Entrega</th><th>Estado</th></tr></thead><tbody>`;

    pedidos.forEach((p) => {
      const color = colorEstado(p.estado);
      const saldo = Number(p.saldo_pendiente || 0);
      const fecha = p.fecha_pedido ? new Date(p.fecha_pedido).toLocaleDateString("es-PE") : "-";

      html += `<tr>
        <td><span class="punto-estado" style="background:${color};"></span><strong>${p.codigo_orden}</strong></td>
        <td class="small">${fecha}</td>
        <td>${p.cliente_nombre || "-"}</td>
        <td>S/ ${Number(p.total_pago || 0).toFixed(2)}</td>
        <td>${saldo > 0 ? `<span class="text-danger">S/ ${saldo.toFixed(2)}</span>` : `<span class="text-success">Pagado</span>`}</td>
        <td>${p.direccion_entrega
          ? `<span class="badge-modalidad badge-delivery">Delivery</span>`
          : `<span class="badge-modalidad badge-recojo">Recojo</span>`}</td>
        <td>
          <select class="form-select form-select-sm" style="width:auto;" data-orden="${p.codigo_orden}">
            ${estadosPedido.map((e) =>
            `<option value="${e.estado_id}" ${e.descripcion === p.estado ? "selected" : ""}>${e.descripcion}</option>`
          ).join("")}
          </select>
        </td>
      </tr>`;
    });

    cont.innerHTML = html + "</tbody></table></div>";

    cont.querySelectorAll("select[data-orden]").forEach((sel) => {
      sel.addEventListener("change", () => actualizarEstado(sel.dataset.orden, sel.value));
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

async function actualizarEstado(orden, estadoId) {
  try {
    await Api.patch(`/api/pedidos/${orden}/estado`, { estadoId: parseInt(estadoId) });
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
    if (esMensual) cargarReporteMensual(); else cargarPedidos();
  });
});

async function cargarReporteMensual() {
  const cont = document.getElementById("contenedorTablaMensual");
  try {
    const meses = await Api.get("/api/reportes/mensual");
    if (meses.length === 0) {
      cont.innerHTML = `<p class="text-mid">Sin historial mensual todavía.</p>`;
      return;
    }
    const totalHistorico = meses.reduce((t, m) => t + m.totalVentas, 0);
    document.getElementById("kpiMesesConVentas").textContent = meses.length;
    document.getElementById("kpiTotalHistorico").textContent = `S/ ${totalHistorico.toFixed(2)}`;
    document.getElementById("kpiPromedioMensual").textContent = `S/ ${(totalHistorico / meses.length).toFixed(2)}`;

    cont.innerHTML = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Mes</th><th>Pedidos</th><th>Ventas totales</th></tr></thead><tbody>` +
      meses.map((m) => `<tr><td>${m.mes}</td><td>${m.totalPedidos}</td><td>S/ ${Number(m.totalVentas).toFixed(2)}</td></tr>`).join("") +
      `</tbody></table></div>`;
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("btnBuscarDni").addEventListener("click", async () => {
  const dato = document.getElementById("inputDni").value.trim();
  if (!dato) return;
  await buscarYRenderizarPedidos(dato);
});

async function buscarYRenderizarPedidos(dato) {
  const cont = document.getElementById("resultadoBusqueda");
  try {
    const resultados = await Api.get(`/api/pedidos/buscar/${encodeURIComponent(dato)}`);
    if (resultados.length === 0) {
      cont.innerHTML = `<p class="text-mid">No se encontraron pedidos.</p>`;
      return;
    }

    const opcionesMetodoPago = metodosPago.map((m) =>
      `<option value="${m.metodo_pago_id}">${m.descripcion}</option>`).join("");
    const opcionesEstado = estadosPedido.map((e) =>
      `<option value="${e.estado_id}">${e.descripcion}</option>`).join("");

    cont.innerHTML = resultados.map((p) => {
      const saldo = Number(p.saldo_pendiente || 0);
      const fecha = p.fecha_pedido ? new Date(p.fecha_pedido).toLocaleDateString("es-PE") : "-";
      return `
      <div class="card-khanauky p-3 mb-3">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <div>
            <strong>${p.codigo_orden}</strong> — ${p.cliente_nombre}
            <div class="small text-mid">${fecha} · Total: S/ ${Number(p.total_pago || 0).toFixed(2)}
              ${saldo > 0
          ? `· <span class="text-danger fw-semibold">Saldo pendiente: S/ ${saldo.toFixed(2)}</span>`
          : `· <span class="text-success fw-semibold">Pagado completo</span>`}
            </div>
          </div>
          <select class="form-select form-select-sm" style="width:auto;" data-cambiar-estado="${p.codigo_orden}">
            ${estadosPedido.map((e) =>
            `<option value="${e.estado_id}" ${e.estado_id === p.estado_id ? "selected" : ""}>${e.descripcion}</option>`
          ).join("")}
          </select>
        </div>
        ${p.venta_id && saldo > 0 ? `
          <div class="d-flex flex-wrap gap-2 align-items-end border-top pt-2 mt-2">
            <div>
              <label class="form-label small mb-1">Monto del abono</label>
              <input type="number" min="0.01" max="${saldo}" step="0.01" class="form-control form-control-sm" style="width:130px;" data-monto-abono="${p.venta_id}" placeholder="S/ 0.00">
            </div>
            <div>
              <label class="form-label small mb-1">Método de pago</label>
              <select class="form-select form-select-sm" style="width:150px;" data-metodo-abono="${p.venta_id}">${opcionesMetodoPago}</select>
            </div>
            <button class="btn-khanauky-outline btn-sm" data-registrar-abono="${p.venta_id}">Registrar abono</button>
          </div>` : ""}
      </div>`;
    }).join("");

    cont.querySelectorAll("select[data-cambiar-estado]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          await Api.patch(`/api/pedidos/${sel.dataset.cambiarEstado}/estado`, { estadoId: parseInt(sel.value) });
          await buscarYRenderizarPedidos(dato);
        } catch (err) {
          alert("Error al actualizar el estado: " + err.message);
        }
      });
    });

    cont.querySelectorAll("button[data-registrar-abono]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ventaId = btn.dataset.registrarAbono;
        const inputMonto = cont.querySelector(`input[data-monto-abono="${ventaId}"]`);
        const selectMetodo = cont.querySelector(`select[data-metodo-abono="${ventaId}"]`);
        const monto = parseFloat(inputMonto.value);

        if (!monto || monto <= 0) {
          alert("Ingresa un monto válido para el abono.");
          return;
        }

        try {
          await Api.post(`/api/ventas/${ventaId}/pago-parcial`, {
            metodoPagoId: parseInt(selectMetodo.value),
            monto
          });
          await buscarYRenderizarPedidos(dato);
        } catch (err) {
          alert("Error al registrar el abono: " + err.message);
        }
      });
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("btnListarFacturas").addEventListener("click", async () => {
  const cont = document.getElementById("listaFacturas");
  try {
    const pedidos = await Api.get("/api/pedidos");
    cont.innerHTML = pedidos.map((p) => `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <span>${p.codigo_orden} — ${p.cliente_nombre} — S/ ${Number(p.total_pago || 0).toFixed(2)}</span>
        <a class="btn-khanauky-outline btn-sm" target="_blank"
           href="/api/pedidos/${p.codigo_orden}/comprobante">
          ${p.tipo_comprobante || "Boleta"}
        </a>
      </div>`).join("");
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
});

async function cargarProductosCatalogo() {
  try {
    productosCatalogo = await Api.get("/api/productos");
    const select = document.getElementById("ventaSucursal");
    if (select) {
      const ubigeos = await Api.get("/api/ubigeo");
      select.innerHTML = ubigeos.map((u) =>
        `<option value="${u.ubigeo_id}">${u.distrito} — ${u.provincia}</option>`).join("");
    }
  } catch { }
}

async function cargarListaSucursales() {
  const cont = document.getElementById("listaSucursalesAdmin");
  try {
    const ubigeos = await Api.get("/api/ubigeo");
    cont.innerHTML = `<ul class="list-group">` +
      ubigeos.map((u) =>
        `<li class="list-group-item">${u.distrito} <span class="text-mid small">— ${u.provincia}, ${u.departamento}</span></li>`
      ).join("") + `</ul>`;
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

async function cargarResumenIngresos() {
  const cont = document.getElementById("resumenIngresosSucursales");
  try {
    const resumen = await Api.get("/api/sucursales/resumen-ingresos");
    cont.innerHTML = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Zona</th><th>Pedidos</th><th>Ingresos</th></tr></thead><tbody>` +
      resumen.map((r) =>
        `<tr><td>${r.distrito}, ${r.provincia}</td><td>${r.total_pedidos}</td><td>S/ ${Number(r.total_ingresos).toFixed(2)}</td></tr>`
      ).join("") + `</tbody></table></div>`;
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

async function cargarTablaEmpleados() {
  const cont = document.getElementById("tablaEmpleados");
  const aviso = document.getElementById("avisoAdminPrincipal");
  aviso.textContent = usuarioActual?.esAdminPrincipal
    ? "Como administrador principal, puedes asignar contraseñas nuevas y eliminar cuentas."
    : "Solo el administrador principal puede reasignar contraseñas o eliminar cuentas.";

  try {
    const empleados = await Api.get("/api/empleados");
    let html = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Nombre</th><th>DNI</th><th>Tipo</th><th>Contrato</th><th>Estado</th><th></th></tr></thead><tbody>`;

    empleados.forEach((emp) => {
      let acciones = "";
      if (usuarioActual?.esAdminPrincipal) {
        acciones += `<button class="btn-khanauky-outline btn-sm me-2" data-accion="reset" data-id="${emp.empleado_id}" data-nombre="${emp.nombres}">Asignar clave</button>`;
        if (!emp.es_admin_principal) {
          acciones += `<button class="btn btn-outline-danger btn-sm" data-accion="eliminar" data-id="${emp.empleado_id}" data-nombre="${emp.nombres}">Eliminar</button>`;
        }
      }
      html += `<tr>
        <td>${emp.nombres} ${emp.apellidos}</td>
        <td>${emp.dni}</td>
        <td>${emp.tipo_empleado}</td>
        <td>${emp.tipo_contrato}</td>
        <td>${emp.estado}</td>
        <td>${acciones}</td>
      </tr>`;
    });

    cont.innerHTML = html + "</tbody></table></div>";

    cont.querySelectorAll("[data-accion='reset']").forEach((btn) => {
      btn.addEventListener("click", () => asignarNuevaPassword(btn.dataset.id, btn.dataset.nombre));
    });
    cont.querySelectorAll("[data-accion='eliminar']").forEach((btn) => {
      btn.addEventListener("click", () => eliminarEmpleado(btn.dataset.id, btn.dataset.nombre));
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

async function asignarNuevaPassword(id, nombre) {
  if (!confirm(`¿Asignar una nueva contraseña temporal a ${nombre}?`)) return;
  try {
    const data = await Api.post(`/api/empleados/${id}/asignar-password`, {});
    alert(`Contraseña reasignada.\n\nContraseña temporal: ${data.passTemporal}`);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function eliminarEmpleado(id, nombre) {
  if (!confirm(`¿Eliminar la cuenta de ${nombre}? Esta acción no se puede deshacer.`)) return;
  try {
    await Api.delete(`/api/empleados/${id}`);
    cargarTablaEmpleados();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

document.getElementById("formEmpleado").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById("empMensaje");
  const tipoEmpleado = document.getElementById("empTipo").value;

  const datos = {
    nombres: document.getElementById("empNombres").value,
    apellidos: document.getElementById("empApellidos").value,
    dni: document.getElementById("empDni").value,
    telefono: document.getElementById("empTelefono").value,
    sexo: document.getElementById("empSexo").value,
    fechaContratacion: document.getElementById("empFechaContratacion").value,
    tipoEmpleado,
    tipoContratoId: parseInt(document.getElementById("empTipoContrato").value),
    ubigeoId: parseInt(document.getElementById("empUbigeo").value),
    estadoEmpleadoId: 1,
    usuario: document.getElementById("empUsuario").value,
    email: document.getElementById("empEmail").value,
    pass: document.getElementById("empPass").value,
    ...(tipoEmpleado === "VENTA" && {
      telefonoCorporativo: document.getElementById("empTelCorp").value
    }),
    ...(tipoEmpleado === "PRODUCCION" && {
      carnetSanidad: document.getElementById("empCarnet").value,
      fechaVencimientoCarnet: document.getElementById("empVencCarnet").value,
      tallaVestimenta: document.getElementById("empTalla").value
    }),
    ...(tipoEmpleado === "ENTREGA" && {
      numeroLicencia: document.getElementById("empLicencia").value,
      fechaVencimientoLicencia: document.getElementById("empVencLicencia").value
    })
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

async function cargarLotes() {
  const cont = document.getElementById("tablaLotes");
  try {
    const lotes = await Api.get("/api/lotes");
    if (lotes.length === 0) {
      cont.innerHTML = `<p class="text-mid">No hay lotes registrados.</p>`;
      return;
    }
    const opcionesEstadoLote = ["Disponible", "Agotado", "Dañado / no vendible", "Retirado"];
    cont.innerHTML = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Producto</th><th>Fecha prod.</th><th>Producidas</th><th>Disponibles</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>` +
      lotes.map((l) => {
        const vence = new Date(l.fecha_vencimiento);
        const hoy = new Date();
        const diasRestantes = Math.ceil((vence - hoy) / (1000 * 60 * 60 * 24));
        const alertaVenc = diasRestantes <= 7 ? "text-danger fw-bold" : "";
        return `<tr>
          <td>${l.nombre_producto}</td>
          <td>${new Date(l.fecha_produccion).toLocaleDateString("es-PE")}</td>
          <td>${l.unidades_producidas}</td>
          <td><input type="number" min="0" class="form-control form-control-sm" style="width:90px;" data-disp="${l.lote_id}" value="${l.unidades_disponibles}"></td>
          <td class="${alertaVenc}">${vence.toLocaleDateString("es-PE")}</td>
          <td>
            <select class="form-select form-select-sm" style="width:auto;" data-estado="${l.lote_id}">
              ${opcionesEstadoLote.map((e) => `<option value="${e}" ${e === l.estado ? "selected" : ""}>${e}</option>`).join("")}
            </select>
          </td>
          <td><button class="btn btn-sm btn-outline-secondary" data-guardar-lote="${l.lote_id}">Guardar</button></td>
        </tr>`;
      }).join("") +
      `</tbody></table></div>`;

    cont.querySelectorAll("button[data-guardar-lote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.guardarLote;
        const inputDisp = cont.querySelector(`input[data-disp="${id}"]`);
        const selEstado = cont.querySelector(`select[data-estado="${id}"]`);
        try {
          await Api.patch(`/api/lotes/${id}`, {
            unidadesDisponibles: parseInt(inputDisp.value),
            estado: selEstado.value
          });
          cargarLotes();
        } catch (err) {
          alert("Error al actualizar el lote: " + err.message);
        }
      });
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("formLote")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await Api.post("/api/lotes", {
      productoId: parseInt(document.getElementById("loteProducto").value),
      fechaProduccion: document.getElementById("loteFechaProduccion").value,
      unidadesProducidas: parseInt(document.getElementById("loteUnidades").value),
      unidadesDefectuosas: parseInt(document.getElementById("loteDefectuosas").value) || 0,
      fechaVencimiento: document.getElementById("loteFechaVencimiento").value
    });
    document.getElementById("formLote").reset();
    cargarLotes();
    cargarDashboard();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

async function cargarTransportes() {
  const cont = document.getElementById("tablaTransportes");
  try {
    const transportes = await Api.get("/api/transportes");
    const estadosTransporte = await Api.get("/api/estados-transporte");

    cont.innerHTML = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Modelo</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>` +
      transportes.map((t) => `<tr>
        <td>${t.modelo_transporte}</td>
        <td>${t.tipo}</td>
        <td>
          <select class="form-select form-select-sm" style="width:auto;" data-id="${t.transporte_id}">
            ${estadosTransporte.map((e) =>
        `<option value="${e.estado_transporte_id}" ${e.descripcion === t.estado ? "selected" : ""}>${e.descripcion}</option>`
      ).join("")}
          </select>
        </td>
        <td><button class="btn btn-sm btn-outline-secondary" data-transporte-id="${t.transporte_id}">Guardar</button></td>
      </tr>`).join("") +
      `</tbody></table></div>`;

    cont.querySelectorAll("button[data-transporte-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.transporteId;
        const sel = cont.querySelector(`select[data-id="${id}"]`);
        try {
          await Api.patch(`/api/transportes/${id}/estado`, { estadoTransporteId: parseInt(sel.value) });
          cargarTransportes();
        } catch (err) {
          alert("Error: " + err.message);
        }
      });
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("formTransporte").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById("transMensaje");
  mensaje.className = "small mt-2 mb-0 text-mid";
  mensaje.textContent = "Guardando...";

  try {
    await Api.post("/api/transportes", {
      modeloTransporte: document.getElementById("transModelo").value,
      tipoId: parseInt(document.getElementById("transTipo").value),
      estadoTransporteId: parseInt(document.getElementById("transEstado").value)
    });
    mensaje.className = "small mt-2 mb-0 text-success fw-semibold";
    mensaje.textContent = "Transporte registrado correctamente.";
    document.getElementById("formTransporte").reset();
    cargarTransportes();
  } catch (err) {
    mensaje.className = "small mt-2 mb-0 text-danger fw-semibold";
    mensaje.textContent = err.message;
  }
});

async function cargarClientes() {
  const cont = document.getElementById("tablaClientes");
  try {
    const clientes = await Api.get("/api/clientes");
    window._clientesCache = clientes;
    cont.innerHTML = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Cliente</th><th>Tipo</th><th>DNI / RUC</th><th>Teléfono</th><th>Distrito</th><th>Bidones pendientes</th><th></th></tr></thead><tbody>` +
      clientes.map((c) => `<tr>
        <td>${c.nombres ? `${c.nombres} ${c.apellidos}` : c.razon_social}</td>
        <td>${c.tipo_cliente}</td>
        <td>${c.dni || c.ruc || "-"}</td>
        <td>${c.telefono}</td>
        <td>${c.distrito}, ${c.provincia}</td>
        <td>${Number(c.bidones_pendientes) > 0
          ? `<span class="text-danger fw-bold">${c.bidones_pendientes}</span>`
          : `<span class="text-success">0</span>`}</td>
        <td><button class="btn btn-sm btn-outline-secondary" data-bidones-cliente="${c.cliente_id}">Bidones</button></td>
      </tr>`).join("") +
      `</tbody></table></div>`;

    cont.querySelectorAll("button[data-bidones-cliente]").forEach((btn) => {
      btn.addEventListener("click", () => mostrarPanelBidones(parseInt(btn.dataset.bidonesCliente)));
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

async function mostrarPanelBidones(clienteId) {
  const panel = document.getElementById("panelBidonesCliente");
  const cliente = (window._clientesCache || []).find((c) => c.cliente_id === clienteId);
  const nombreCliente = cliente ? (cliente.nombres ? `${cliente.nombres} ${cliente.apellidos}` : cliente.razon_social) : "";

  panel.classList.remove("d-none");
  panel.innerHTML = `<p class="text-mid">Cargando historial de ${nombreCliente}...</p>`;

  try {
    const movimientos = await Api.get(`/api/bidones/${clienteId}`);

    const filasHistorial = movimientos.length === 0
      ? `<p class="text-mid small">Sin movimientos registrados todavía.</p>`
      : `<div class="table-responsive"><table class="tabla-khanauky mb-0"><thead><tr>
          <th>Fecha</th><th>Entregados</th><th>Recibidos</th><th>Prestados (neto)</th></tr></thead><tbody>` +
      movimientos.map((m) => `<tr>
          <td class="small">${new Date(m.fecha_movimiento).toLocaleDateString("es-PE")}</td>
          <td>${m.cantidad_entregados}</td>
          <td>${m.cantidad_recibidos}</td>
          <td>${m.cantidad_prestados}</td>
        </tr>`).join("") + `</tbody></table></div>`;

    panel.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="mb-0">Bidones — ${nombreCliente}</h5>
        <button class="btn-close" id="btnCerrarPanelBidones" aria-label="Cerrar"></button>
      </div>

      <form id="formNuevoBidon" class="row g-3 align-items-end mb-4">
        <div class="col-md-3">
          <label class="form-label small mb-1">Entregados hoy</label>
          <input type="number" min="0" class="form-control form-control-sm" id="bidonEntregados" value="0">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Recibidos (vacíos)</label>
          <input type="number" min="0" class="form-control form-control-sm" id="bidonRecibidos" value="0">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Prestados (neto)</label>
          <input type="number" min="0" class="form-control form-control-sm" id="bidonPrestados" value="0">
        </div>
        <div class="col-md-3">
          <button type="submit" class="btn-khanauky-primario btn-sm w-100">Registrar movimiento</button>
        </div>
      </form>

      <h6 class="mb-2">Historial</h6>
      ${filasHistorial}
    `;

    document.getElementById("btnCerrarPanelBidones").addEventListener("click", () => {
      panel.classList.add("d-none");
      panel.innerHTML = "";
    });

    document.getElementById("formNuevoBidon").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await Api.post("/api/bidones", {
          clienteId,
          cantidadEntregados: parseInt(document.getElementById("bidonEntregados").value) || 0,
          cantidadRecibidos: parseInt(document.getElementById("bidonRecibidos").value) || 0,
          cantidadPrestados: parseInt(document.getElementById("bidonPrestados").value) || 0
        });
        await mostrarPanelBidones(clienteId);
        cargarClientes();
      } catch (err) {
        alert("Error al registrar el movimiento: " + err.message);
      }
    });
  } catch (err) {
    panel.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("btnBuscarCliente")?.addEventListener("click", async () => {
  const dato = document.getElementById("inputBuscarCliente").value.trim();
  if (!dato) return;
  try {
    const resultados = await Api.get(`/api/clientes/buscar/${encodeURIComponent(dato)}`);
    const cont = document.getElementById("resultadoBuscarCliente");
    if (resultados.length === 0) {
      cont.innerHTML = `<p class="text-mid">No se encontraron clientes.</p>`;
      return;
    }
    cont.innerHTML = `<ul class="list-group">` +
      resultados.map((c) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <span>${c.nombres ? `${c.nombres} ${c.apellidos}` : c.razon_social}
            <span class="text-mid small ms-2">${c.dni || c.ruc || ""} · ${c.telefono}</span>
          </span>
          <button class="btn btn-sm btn-outline-primary" data-cliente-id="${c.cliente_id}"
                  data-cliente-nombre="${c.nombres ? `${c.nombres} ${c.apellidos}` : c.razon_social}">
            Seleccionar
          </button>
        </li>`
      ).join("") + `</ul>`;

    cont.querySelectorAll("button[data-cliente-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("ventaClienteId").value = btn.dataset.clienteId;
        document.getElementById("ventaClienteNombre").textContent = btn.dataset.clienteNombre;
        cont.innerHTML = "";
        document.getElementById("inputBuscarCliente").value = "";
      });
    });
  } catch (err) {
    document.getElementById("resultadoBuscarCliente").innerHTML =
      `<p class="text-danger">${err.message}</p>`;
  }
});

function renderizarItemsVenta() {
  const cont = document.getElementById("itemsVenta");
  cont.innerHTML = itemsVentaPresencial.map((item, idx) => `
    <div class="row g-2 align-items-end mb-2">
      <div class="col-6">
        <select class="form-select" data-idx="${idx}" data-campo="producto_id">
          ${productosCatalogo.map((p) =>
    `<option value="${p.producto_id}" ${p.producto_id === item.producto_id ? "selected" : ""}>${p.nombre_producto}</option>`
  ).join("")}
        </select>
      </div>
      <div class="col-4">
        <input type="number" min="1" class="form-control" data-idx="${idx}" data-campo="cantidad" value="${item.cantidad}">
      </div>
      <div class="col-2">
        <button type="button" class="btn btn-outline-danger w-100" data-idx="${idx}" data-accion="quitar">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>`).join("");

  cont.querySelectorAll("[data-campo]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const campo = e.target.dataset.campo;
      itemsVentaPresencial[idx][campo] = campo === "producto_id"
        ? parseInt(e.target.value)
        : parseInt(e.target.value) || 1;
      if (campo === "producto_id") {
        itemsVentaPresencial[idx].nombre_producto =
          productosCatalogo.find((p) => p.producto_id === itemsVentaPresencial[idx].producto_id)?.nombre_producto;
      }
      recalcularTotal();
    });
  });

  cont.querySelectorAll("[data-accion='quitar']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      itemsVentaPresencial.splice(parseInt(e.currentTarget.dataset.idx), 1);
      renderizarItemsVenta();
      recalcularTotal();
    });
  });
}

document.getElementById("btnAgregarItem")?.addEventListener("click", () => {
  if (!productosCatalogo.length) return;
  const primero = productosCatalogo[0];
  itemsVentaPresencial.push({ producto_id: primero.producto_id, nombre_producto: primero.nombre_producto, cantidad: 1 });
  renderizarItemsVenta();
  recalcularTotal();
});

async function recalcularTotal() {
  const span = document.getElementById("totalVentaPresencial");
  if (!itemsVentaPresencial.length) { span.textContent = "S/ 0.00"; return; }
  try {
    const resumen = await Api.post("/api/cotizar", { items: itemsVentaPresencial });
    span.textContent = `S/ ${resumen.totalAPagar.toFixed(2)}`;
  } catch {
    span.textContent = "S/ 0.00";
  }
}

document.getElementById("formVentaPresencial")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const clienteId = document.getElementById("ventaClienteId").value;
  if (!clienteId) { alert("Busca y selecciona un cliente primero."); return; }
  if (!itemsVentaPresencial.length) { alert("Agrega al menos un producto."); return; }

  const descuento = parseFloat(document.getElementById("ventaDescuento").value) || 0;
  const montoPagado = parseFloat(document.getElementById("ventaMontoPagado").value) || 0;

  try {
    const data = await Api.post("/api/ventas-presenciales", {
      clienteId: parseInt(clienteId),
      items: itemsVentaPresencial,
      metodoPagoId: parseInt(document.getElementById("ventaMetodoPago").value),
      comprobanteId: parseInt(document.getElementById("ventaComprobante").value),
      descuento,
      montoPagado: montoPagado || undefined
    });

    alert(`Venta registrada: ${data.orden}\nTotal: S/ ${data.totalAPagar.toFixed(2)}\nSaldo pendiente: S/ ${data.saldoPendiente.toFixed(2)}`);
    document.getElementById("formVentaPresencial").reset();
    document.getElementById("ventaClienteId").value = "";
    document.getElementById("ventaClienteNombre").textContent = "";
    itemsVentaPresencial = [];
    renderizarItemsVenta();
    cargarDashboard();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

iniciar();