let productosCatalogo = [];
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
      "sec-entregas": cargarEntregas,
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
  } catch {}
}

async function cargarMetodosPago() {
  try {
    metodosPago = await Api.get("/api/metodos-pago");
    document.querySelectorAll(".select-metodo-pago").forEach((sel) => {
      sel.innerHTML = metodosPago.map((m) =>
        `<option value="${m.metodo_pago_id}">${m.descripcion}</option>`).join("");
    });
  } catch {}
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
      "S/ " + pedidos.filter(p => p.estado !== "Cancelado").reduce((t, p) => t + Number(p.total_pago || 0), 0).toFixed(2);
    document.getElementById("kpiPendientes").textContent =
      pedidos.filter((p) => p.estado === "Venta Registrada").length;

    const sinStock = stock.filter((s) => Number(s.stock_disponible) === 0).length;
    document.getElementById("kpiSinStock").textContent = sinStock;
    document.getElementById("kpiSinStock").closest(".kpi-card").classList.toggle("border-danger", sinStock > 0);

    const stockBajo = stock.filter((s) =>
      Number(s.stock_disponible) > 0 && Number(s.stock_disponible) < UMBRAL_STOCK_BAJO
    );
    const contStockBajo = document.getElementById("alertaStockBajo");
    contStockBajo.innerHTML = stockBajo.length === 0
      ? `<p class="text-success small mb-0"><i class="bi bi-check-circle me-1"></i>Todo el stock está en niveles saludables.</p>`
      : stockBajo.map((s) => `
        <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
          <span class="small">${escaparHtml(s.nombre_producto)}</span>
          <span class="badge bg-warning text-dark">${s.stock_disponible} unid.</span>
        </div>`).join("");

    const hoy = new Date();
    const lotesPorVencer = lotes.filter((l) => {
      if (l.estado !== "Disponible" || Number(l.unidades_disponibles) <= 0) return false;
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
            <span class="small">${escaparHtml(l.nombre_producto)} <span class="text-mid">(${l.unidades_disponibles} unid.)</span></span>
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
    "Venta Registrada": "#D32F2F",
    "Pago Confirmado": "#1976D2",
    "Entregado": "#388E3C",
    "Cancelado": "#616161"
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

    let html = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Orden</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Saldo</th><th>Entrega</th><th>Estado</th></tr></thead><tbody>`;

    pedidos.forEach((p) => {
      const color = colorEstado(p.estado);
      const saldo = Number(p.saldo_pendiente || 0);
      const fecha = p.fecha_pedido ? new Date(p.fecha_pedido).toLocaleDateString("es-PE") : "-";

      html += `<tr>
        <td><span class="punto-estado" style="background:${color};"></span><strong>${p.codigo_orden}</strong></td>
        <td class="small">${fecha}</td>
        <td>${escaparHtml(p.cliente_nombre || "-")}</td>
        <td>S/ ${Number(p.total_pago || 0).toFixed(2)}</td>
        <td>${p.estado === "Cancelado" ? "—" : saldo > 0 ? `<span class="text-danger">S/ ${saldo.toFixed(2)}</span>` : `<span class="text-success">Pagado</span>`}</td>
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
  } finally {
    cargarPedidos();
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
    cont.innerHTML = resultados.map((p) => {
      const saldo = Number(p.saldo_pendiente || 0);
      const fecha = p.fecha_pedido ? new Date(p.fecha_pedido).toLocaleDateString("es-PE") : "-";
      return `
      <div class="card-khanauky p-3 mb-3">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <div>
            <strong>${p.codigo_orden}</strong> — ${escaparHtml(p.cliente_nombre)}
            <div class="small text-mid">${fecha} · Total: S/ ${Number(p.total_pago || 0).toFixed(2)}
              ${p.estado === "Cancelado" ? "· Cancelado" : saldo > 0
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
        ${p.estado !== "Cancelado" && p.venta_id && saldo > 0 ? `
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
          await buscarYRenderizarPedidos(dato);
        }
      });
    });

    cont.querySelectorAll("button[data-registrar-abono]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ventaId = btn.dataset.registrarAbono;
        const inputMonto = cont.querySelector(`input[data-monto-abono="${ventaId}"]`);
        const selectMetodo = cont.querySelector(`select[data-metodo-abono="${ventaId}"]`);
        const monto = parseFloat(inputMonto.value);

        if (!Number.isFinite(monto) || monto <= 0 || monto > Number(inputMonto.max)) {
          alert("Ingresa un abono mayor que cero y no mayor al saldo.");
          return;
        }

        if (btn.disabled) return;
        btn.disabled = true;
        try {
          await Api.post(`/api/ventas/${ventaId}/pago-parcial`, {
            metodoPagoId: parseInt(selectMetodo.value),
            monto
          });
          await buscarYRenderizarPedidos(dato);
        } catch (err) {
          alert("Error al registrar el abono: " + err.message);
        } finally {
          btn.disabled = false;
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
        <span>${p.codigo_orden} — ${escaparHtml(p.cliente_nombre)} — S/ ${Number(p.total_pago || 0).toFixed(2)}</span>
        ${p.estado === "Cancelado"
          ? `<span class="small text-mid fst-italic">Sin comprobante (cancelado)</span>`
          : `<a class="btn-khanauky-outline btn-sm" target="_blank"
               href="/api/pedidos/${p.codigo_orden}/comprobante">
              ${p.tipo_comprobante || "Boleta"}
            </a>`}
      </div>`).join("");
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
});

async function cargarProductosCatalogo() {
  try {
    productosCatalogo = await Api.get("/api/productos");
  } catch {}
}

async function cargarListaSucursales() {
  const cont = document.getElementById("listaSucursalesAdmin");
  try {
    const ubigeos = await Api.get("/api/ubigeo");
    cont.innerHTML = `<ul class="list-group">` +
      ubigeos.map((u) =>
        `<li class="list-group-item">${escaparHtml(u.distrito)} <span class="text-mid small">— ${escaparHtml(u.provincia)}, ${escaparHtml(u.departamento)}</span></li>`
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
      <th>Zona</th><th>Pedidos</th><th>Ventas registradas</th></tr></thead><tbody>` +
      resumen.map((r) =>
        `<tr><td>${escaparHtml(r.distrito)}, ${escaparHtml(r.provincia)}</td><td>${r.total_pedidos}</td><td>S/ ${Number(r.total_ingresos).toFixed(2)}</td></tr>`
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
      if (usuarioActual?.esAdminPrincipal && emp.usuario_id) {
        acciones += `<button class="btn-khanauky-outline btn-sm me-2" data-accion="reset" data-id="${emp.empleado_id}" data-nombre="${escaparHtml(emp.nombres)}">Asignar clave</button>`;
        if (!emp.es_admin_principal) {
          acciones += `<button class="btn btn-outline-danger btn-sm" data-accion="eliminar" data-id="${emp.empleado_id}" data-nombre="${escaparHtml(emp.nombres)}">Eliminar</button>`;
        }
      }
      html += `<tr>
        <td>${escaparHtml(emp.nombres)} ${escaparHtml(emp.apellidos)}</td>
        <td>${escaparHtml(emp.dni)}</td>
        <td>${escaparHtml(emp.tipo_empleado)}</td>
        <td>${escaparHtml(emp.tipo_contrato)}</td>
        <td>${escaparHtml(emp.estado)}</td>
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
  if (!confirm(`¿Eliminar el acceso de ${nombre}? Se conservará su historial de trabajo y ventas.`)) return;
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
    document.getElementById("empTipo").dispatchEvent(new Event("change"));
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
          <td>${escaparHtml(l.nombre_producto)}</td>
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
        <td>${escaparHtml(t.modelo_transporte)}</td>
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

async function cargarEntregas() {
  const cont = document.getElementById("tablaEntregas");
  const soloPendientes = document.getElementById("soloPendientesEntregas").checked;
  cont.innerHTML = "Cargando...";

  try {
    const [entregas, transportes] = await Promise.all([
      Api.get("/api/deliveries"),
      Api.get("/api/transportes")
    ]);

    const filtradas = soloPendientes ? entregas.filter((d) => !d.hora_entrega && d.estado_pedido !== "Entregado") : entregas;

    if (filtradas.length === 0) {
      cont.innerHTML = `<p class="text-mid">No hay entregas ${soloPendientes ? "pendientes" : "registradas"}.</p>`;
      return;
    }

    const porDistrito = {};
    filtradas.forEach((d) => {
      const clave = `${escaparHtml(d.distrito)}, ${escaparHtml(d.provincia)}`;
      (porDistrito[clave] = porDistrito[clave] || []).push(d);
    });

    cont.innerHTML = Object.entries(porDistrito).map(([distrito, lista]) => `
      <div class="mb-4">
        <h6 class="mb-2"><i class="bi bi-geo-alt-fill text-azul-marca me-1"></i>${distrito} <span class="badge bg-secondary ms-1">${lista.length}</span></h6>
        <div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
          <th>Orden</th><th>Cliente</th><th>Dirección</th><th>Transporte</th><th>Salida</th><th>Entrega</th><th></th>
        </tr></thead><tbody>
        ${lista.map((d) => `
          <tr>
            <td>${d.codigo_orden || "-"}</td>
            <td>${escaparHtml(d.cliente_nombre || "-")}<div class="small text-mid">${escaparHtml(d.telefono || "")}</div></td>
            <td class="small">${escaparHtml(d.direccion_entrega)}</td>
            <td>
              <select class="form-select form-select-sm" style="width:auto;" data-transporte="${d.delivery_id}">
                <option value="">Sin asignar</option>
                ${transportes.filter(t => t.estado === "Operativo" || t.transporte_id === d.transporte_id).map((t) =>
                  `<option value="${t.transporte_id}" ${t.transporte_id === d.transporte_id ? "selected" : ""}>${escaparHtml(t.modelo_transporte)}</option>`
                ).join("")}
              </select>
            </td>
            <td><input type="time" class="form-control form-control-sm" style="width:110px;" data-salida="${d.delivery_id}" value="${d.hora_salida ? d.hora_salida.slice(0,5) : ""}"></td>
            <td><input type="time" class="form-control form-control-sm" style="width:110px;" data-entrega="${d.delivery_id}" value="${d.hora_entrega ? d.hora_entrega.slice(0,5) : ""}"></td>
            <td><button class="btn btn-sm btn-outline-secondary" data-guardar-entrega="${d.delivery_id}">Guardar</button></td>
          </tr>`).join("")}
        </tbody></table></div>
      </div>`).join("");

    cont.querySelectorAll("button[data-guardar-entrega]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.guardarEntrega;
        const transporteSel = cont.querySelector(`select[data-transporte="${id}"]`);
        const salidaInput = cont.querySelector(`input[data-salida="${id}"]`);
        const entregaInput = cont.querySelector(`input[data-entrega="${id}"]`);

        try {
          await Api.patch(`/api/deliveries/${id}`, {
            transporteId: transporteSel.value ? Number(transporteSel.value) : null,
            horaSalida: salidaInput.value || null,
            horaEntrega: entregaInput.value || null
          });
          cargarEntregas();
        } catch (err) {
          alert("Error al guardar la entrega: " + err.message);
        }
      });
    });
  } catch (err) {
    cont.innerHTML = `<p class="text-danger">${err.message}</p>`;
  }
}

document.getElementById("soloPendientesEntregas").addEventListener("change", cargarEntregas);

async function cargarClientes() {
  const cont = document.getElementById("tablaClientes");
  try {
    const clientes = await Api.get("/api/clientes");
    window._clientesCache = clientes;
    cont.innerHTML = `<div class="table-responsive"><table class="tabla-khanauky"><thead><tr>
      <th>Cliente</th><th>Tipo</th><th>DNI / RUC</th><th>Teléfono</th><th>Distrito</th><th>Bidones pendientes</th><th></th></tr></thead><tbody>` +
      clientes.map((c) => `<tr>
        <td>${c.nombres ? `${escaparHtml(c.nombres)} ${escaparHtml(c.apellidos)}` : c.razon_social}</td>
        <td>${c.tipo_cliente}</td>
        <td>${c.dni || c.ruc || "-"}</td>
        <td>${escaparHtml(c.telefono)}</td>
        <td>${escaparHtml(c.distrito)}, ${escaparHtml(c.provincia)}</td>
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
  panel.innerHTML = `<p class="text-mid">Cargando historial de ${escaparHtml(nombreCliente)}...</p>`;

  try {
    const movimientos = await Api.get(`/api/bidones/${clienteId}`);

    const filasHistorial = movimientos.length === 0
      ? `<p class="text-mid small">Sin movimientos registrados todavía.</p>`
      : `<div class="table-responsive"><table class="tabla-khanauky mb-0"><thead><tr>
          <th>Fecha</th><th>Entregados</th><th>Recibidos</th><th>Entregados en préstamo</th></tr></thead><tbody>` +
        movimientos.map((m) => `<tr>
          <td class="small">${new Date(m.fecha_movimiento).toLocaleDateString("es-PE")}</td>
          <td>${m.cantidad_entregados}</td>
          <td>${m.cantidad_recibidos}</td>
          <td>${m.cantidad_prestados}</td>
        </tr>`).join("") + `</tbody></table></div>`;

    panel.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="mb-0">Bidones — ${escaparHtml(nombreCliente)}</h5>
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
          <label class="form-label small mb-1">Entregados en préstamo</label>
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

function actualizarIdentificacionVenta() {
  const conDni = document.getElementById("ventaConDni").checked;
  const input = document.getElementById("ventaDni");
  document.getElementById("bloqueDniVenta").classList.toggle("d-none", !conDni);
  input.disabled = !conDni;
  input.required = conDni;
  if (!conDni) input.value = "";
}

document.querySelectorAll('[name="identificacionVenta"]').forEach((radio) => {
  radio.addEventListener("change", actualizarIdentificacionVenta);
});
actualizarIdentificacionVenta();

function renderizarItemsVenta() {
  const cont = document.getElementById("itemsVenta");
  cont.innerHTML = itemsVentaPresencial.map((item, idx) => `
    <div class="row g-2 align-items-end mb-2">
      <div class="col-6">
        <select class="form-select" data-idx="${idx}" data-campo="producto_id">
          ${productosCatalogo.map((p) =>
            `<option value="${p.producto_id}" ${p.producto_id === item.producto_id ? "selected" : ""}>${escaparHtml(p.nombre_producto)}</option>`
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

let revisionTotalVenta = 0;
async function recalcularTotal() {
  const revision = ++revisionTotalVenta;
  const span = document.getElementById("totalVentaPresencial");
  if (!itemsVentaPresencial.length) { span.textContent = "S/ 0.00"; return; }
  try {
    const resumen = await Api.post("/api/cotizar", { items: itemsVentaPresencial });
    if (revision !== revisionTotalVenta) return;
    const descuento = Number(document.getElementById("ventaDescuento").value) || 0;
    span.textContent = `S/ ${Math.max(0, resumen.totalAPagar - descuento).toFixed(2)}`;
  } catch (err) {
    if (revision === revisionTotalVenta) span.textContent = err.message;
  }
}
document.getElementById("ventaDescuento").addEventListener("input", recalcularTotal);

document.getElementById("ventaComprobante").addEventListener("change", (e) => {
  const esFactura = e.target.options[e.target.selectedIndex].text === "Factura";
  document.getElementById("bloqueFacturaVenta").classList.toggle("d-none", !esFactura);
});

document.getElementById("formVentaPresencial")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const conDni = document.getElementById("ventaConDni").checked;
  const dni = conDni ? document.getElementById("ventaDni").value.trim() : null;
  if (conDni && !/^\d{8}$/.test(dni)) { alert("Ingresa un DNI de 8 dígitos."); return; }
  if (!itemsVentaPresencial.length) { alert("Agrega al menos un producto."); return; }

  const comprobanteSelect = document.getElementById("ventaComprobante");
  const esFactura = comprobanteSelect.options[comprobanteSelect.selectedIndex].text === "Factura";
  const ruc = document.getElementById("ventaRuc").value.trim();
  const razonSocial = document.getElementById("ventaRazonSocial").value.trim();

  if (esFactura && (!/^\d{11}$/.test(ruc) || !razonSocial)) {
    alert("Para emitir factura, ingresa un RUC de 11 dígitos y la razón social.");
    return;
  }

  const descuento = parseFloat(document.getElementById("ventaDescuento").value) || 0;
  const montoTexto = document.getElementById("ventaMontoPagado").value.trim();
  const montoPagado = montoTexto === "" ? undefined : Number(montoTexto);

  const boton = e.currentTarget.querySelector('button[type="submit"]');
  if (boton.disabled) return;
  boton.disabled = true;
  try {
    const data = await Api.post("/api/ventas-presenciales", {
      dni,
      items: itemsVentaPresencial,
      metodoPagoId: parseInt(document.getElementById("ventaMetodoPago").value),
      comprobanteId: parseInt(comprobanteSelect.value),
      descuento,
      montoPagado,
      ...(esFactura && { ruc, razonSocial })
    });

    alert(`Venta registrada: ${data.orden}\nTotal: S/ ${data.totalAPagar.toFixed(2)}\nSaldo pendiente: S/ ${data.saldoPendiente.toFixed(2)}`);
    document.getElementById("formVentaPresencial").reset();
    document.getElementById("bloqueFacturaVenta").classList.add("d-none");
    actualizarIdentificacionVenta();
    document.getElementById("totalVentaPresencial").textContent = "S/ 0.00";
    itemsVentaPresencial = [];
    revisionTotalVenta++;
    renderizarItemsVenta();
    cargarDashboard();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    boton.disabled = false;
  }
});

iniciar();