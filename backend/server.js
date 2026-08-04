import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

import { pool, query, iniciarBD, generarCodigoOrden, conTransaccion } from "./db.js";
import { calcularResumenVenta } from "./precios.js";
import { asignarLotesFEFO } from "./inventario.js";
import { firmarToken, requiereSesion, requiereRol, requiereAdminPrincipal, obtenerUsuarioOpcional } from "./auth.js";
import { verificarRecaptcha } from "./recaptcha.js";
import { generarComprobantePDF } from "./factura.js";
import {
  enviarCorreoVerificacion,
  enviarCorreoRecuperacion,
  enviarCorreoPedidoConfirmado,
  enviarCorreoNuevaPassAsignada
} from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.resolve(__dirname, "../frontend")));

app.set("trust proxy", 1);

const limiteLogin = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Demasiados intentos. Espera un minuto." }
});

await iniciarBD();

// ============================================================
// UTILIDADES
// ============================================================

async function getTipoCliente(usuarioId) {
  const { rows } = await query(
    `SELECT c.tipo_cliente FROM cliente c WHERE c.usuario_id = $1`,
    [usuarioId]
  );
  return rows[0]?.tipo_cliente || "PERSONA";
}

async function getClienteId(usuarioId) {
  const { rows } = await query(
    `SELECT cliente_id FROM cliente WHERE usuario_id = $1`,
    [usuarioId]
  );
  return rows[0]?.cliente_id || null;
}

// ============================================================
// 1. AUTENTICACIÓN
// ============================================================

app.post("/api/login", limiteLogin, async (req, res) => {
  try {
    const { usuarioIngresado, pass, rolEsperado, captchaToken } = req.body;

    if (!usuarioIngresado || !pass || !rolEsperado) {
      return res.status(400).json({ error: "Faltan datos para iniciar sesión." });
    }

    if (rolEsperado === "empleado") {
      const captchaValido = await verificarRecaptcha(captchaToken);
      if (!captchaValido) {
        return res.status(400).json({ error: "Verificación de seguridad fallida." });
      }
    }

    const { rows } = await query(
      `SELECT * FROM usuarios WHERE (usuario = $1 OR email = $1) AND rol = $2`,
      [usuarioIngresado, rolEsperado]
    );
    const usuario = rows[0];

    if (!usuario) return res.status(401).json({ error: "Datos incorrectos o rol equivocado." });

    const passCorrecta = await bcrypt.compare(pass, usuario.pass_hash);
    if (!passCorrecta) return res.status(401).json({ error: "Datos incorrectos o rol equivocado." });

    if (usuario.rol === "cliente" && !usuario.email_verificado) {
      return res.status(403).json({ error: "Confirma tu correo antes de iniciar sesión." });
    }

    const tipoCliente = usuario.rol === "cliente" ? await getTipoCliente(usuario.id) : null;

    const token = firmarToken({ ...usuario, tipoCliente });
    res.cookie("sesion", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    });

    res.json({ mensaje: "Login exitoso", nombre: usuario.nombre, rol: usuario.rol, tipoCliente });
  } catch (error) {
    console.error("Error login:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.post("/api/registro", limiteLogin, async (req, res) => {
  try {
    const {
      tipoCliente, nombre, usuario, pass, email,
      dni, razonSocial, ruc,
      sexo, telefono, direccion, ubigeoId
    } = req.body;

    if (!tipoCliente || !nombre || !usuario || !pass || !email || !telefono || !direccion || !ubigeoId) {
      return res.status(400).json({ error: "Completa todos los campos obligatorios." });
    }
    if (tipoCliente === "PERSONA" && (!dni || !/^\d{8}$/.test(dni))) {
      return res.status(400).json({ error: "El DNI debe tener exactamente 8 dígitos." });
    }
    if (tipoCliente === "EMPRESA" && (!ruc || !/^\d{11}$/.test(ruc))) {
      return res.status(400).json({ error: "El RUC debe tener exactamente 11 dígitos." });
    }
    if (pass.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
    }

    const { rows: existentes } = await query(
      `SELECT id FROM usuarios WHERE usuario = $1 OR email = $2`,
      [usuario, email]
    );
    if (existentes.length > 0) {
      return res.status(409).json({ error: "Ese usuario o correo ya está registrado." });
    }

    const passHash = await bcrypt.hash(pass, 10);

    const { rows: usuRows } = await query(
      `INSERT INTO usuarios (nombre, usuario, pass_hash, rol, email, email_verificado)
       VALUES ($1,$2,$3,'cliente',$4, FALSE) RETURNING id`,
      [nombre, usuario, passHash, email]
    );
    const nuevoUsuarioId = usuRows[0].id;

    const { rows: cliRows } = await query(
      `INSERT INTO cliente (direccion, telefono, tipo_cliente, ubigeo_id, usuario_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING cliente_id`,
      [direccion, telefono, tipoCliente, ubigeoId, nuevoUsuarioId]
    );
    const nuevoClienteId = cliRows[0].cliente_id;

    if (tipoCliente === "PERSONA") {
      await query(
        `INSERT INTO persona (cliente_id, nombres, apellidos, sexo, dni) VALUES ($1,$2,$3,$4,$5)`,
        [nuevoClienteId, nombre, "", sexo || "M", dni]
      );
    } else {
      await query(
        `INSERT INTO empresa (cliente_id, razon_social, ruc) VALUES ($1,$2,$3)`,
        [nuevoClienteId, razonSocial, ruc]
      );
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO tokens_verificacion (token, usuario_id, expira) VALUES ($1,$2,$3)`,
      [token, nuevoUsuarioId, expira]
    );

    const correoEnviado = await enviarCorreoVerificacion(email, nombre, token);

    res.status(201).json({
      mensaje: correoEnviado
        ? "Registro exitoso. Revisa tu correo para confirmar tu cuenta."
        : "Registro exitoso, pero no pudimos enviar el correo. Contacta a soporte."
    });
  } catch (error) {
    console.error("Error registro:", error);
    res.status(500).json({ error: "Error al registrar el usuario." });
  }
});

app.post("/api/verificar-email", async (req, res) => {
  try {
    const { token } = req.body;
    const { rows } = await query(`SELECT * FROM tokens_verificacion WHERE token = $1`, [token]);
    const registro = rows[0];

    if (!registro || new Date(registro.expira) < new Date()) {
      return res.status(400).json({ error: "El enlace es inválido o ha expirado." });
    }

    await query(`UPDATE usuarios SET email_verificado = TRUE WHERE id = $1`, [registro.usuario_id]);
    await query(`DELETE FROM tokens_verificacion WHERE token = $1`, [token]);

    res.json({ mensaje: "Correo verificado correctamente. Ya puedes iniciar sesión." });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.post("/api/recuperar-password", limiteLogin, async (req, res) => {
  try {
    const { email } = req.body;
    const { rows } = await query(
      `SELECT * FROM usuarios WHERE email = $1 AND rol = 'cliente'`,
      [email]
    );
    const usuario = rows[0];

    if (usuario) {
      const token = crypto.randomBytes(32).toString("hex");
      const expira = new Date(Date.now() + 30 * 60 * 1000);
      await query(
        `INSERT INTO tokens_recuperacion (token, usuario_id, expira) VALUES ($1,$2,$3)`,
        [token, usuario.id, expira]
      );
      await enviarCorreoRecuperacion(usuario.email, usuario.nombre, token);
    }

    res.json({ mensaje: "Si el correo existe, te enviamos un enlace para restablecer tu contraseña." });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.post("/api/restablecer-password", async (req, res) => {
  try {
    const { token, nuevaPass } = req.body;
    if (!nuevaPass || nuevaPass.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
    }

    const { rows } = await query(`SELECT * FROM tokens_recuperacion WHERE token = $1`, [token]);
    const registro = rows[0];

    if (!registro || new Date(registro.expira) < new Date()) {
      return res.status(400).json({ error: "El enlace es inválido o ha expirado." });
    }

    const passHash = await bcrypt.hash(nuevaPass, 10);
    await query(`UPDATE usuarios SET pass_hash = $1 WHERE id = $2`, [passHash, registro.usuario_id]);
    await query(`DELETE FROM tokens_recuperacion WHERE token = $1`, [token]);

    res.json({ mensaje: "Contraseña actualizada correctamente." });
  } catch (error) {
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.get("/api/sesion", requiereSesion, (req, res) => {
  res.json({ usuario: req.usuario });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("sesion");
  res.json({ mensaje: "Sesión cerrada." });
});

// ============================================================
// 2. CATÁLOGO
// ============================================================

app.get("/api/productos", async (req, res) => {
  try {
    let tipoCliente = "PERSONA";
    const usuarioSesion = obtenerUsuarioOpcional(req);
    if (usuarioSesion) {
      try {
        const { rows } = await query(
          `SELECT c.tipo_cliente FROM usuarios u
           JOIN cliente c ON c.usuario_id = u.id
           WHERE u.id = $1`,
          [usuarioSesion.id]
        );
        if (rows[0]) tipoCliente = rows[0].tipo_cliente;
      } catch { }
    }

    const { rows } = await query(`
      SELECT p.producto_id, p.nombre_producto, p.descripcion,
             p.precio_minorista, p.precio_mayorista, p.imagen,
             cat.descripcion AS categoria,
             cap.descripcion AS capacidad,
             COALESCE(SUM(pl.unidades_disponibles), 0) AS stock_total
      FROM producto p
      JOIN categoria cat ON cat.categoria_id = p.categoria_id
      JOIN capacidad cap ON cap.capacidad_id = p.capacidad_id
      LEFT JOIN produccion_lotes pl ON pl.producto_id = p.producto_id
        AND pl.estado = 'Disponible'
        AND pl.fecha_vencimiento >= CURRENT_DATE
      GROUP BY p.producto_id, p.nombre_producto, p.descripcion,
               p.precio_minorista, p.precio_mayorista, p.imagen,
               cat.descripcion, cap.descripcion
      ORDER BY p.producto_id
    `);

    const productos = rows.map((p) => ({
      ...p,
      precio: tipoCliente === "EMPRESA"
        ? Number(p.precio_mayorista)
        : Number(p.precio_minorista),
      tipoCliente,
      stock_total: Number(p.stock_total)
    }));

    res.json(productos);
  } catch (error) {
    console.error("Error productos:", error);
    res.status(500).json({ error: "Error al obtener productos." });
  }
});

app.get("/api/ubigeo", async (req, res) => {
  const { rows } = await query(
    `SELECT ubigeo_id, departamento, provincia, distrito FROM ubigeo ORDER BY departamento, provincia, distrito`
  );
  res.json(rows);
});

app.get("/api/metodos-pago", async (req, res) => {
  const { rows } = await query(`SELECT * FROM metodo_pago ORDER BY metodo_pago_id`);
  res.json(rows);
});

app.get("/api/tipos-comprobante", async (req, res) => {
  const { rows } = await query(`SELECT * FROM tipo_comprobante ORDER BY comprobante_id`);
  res.json(rows);
});

// ============================================================
// 3. PERFIL DE CLIENTE
// ============================================================

app.get("/api/mi-perfil", requiereSesion, async (req, res) => {
  try {
    if (req.usuario.rol !== "cliente") {
      return res.status(403).json({ error: "Solo para clientes." });
    }

    const { rows } = await query(`
      SELECT u.nombre, u.email, c.cliente_id, c.direccion, c.telefono,
             c.tipo_cliente, c.fecha_registro, c.ubigeo_id,
             ub.departamento, ub.provincia, ub.distrito,
             p.nombres, p.apellidos, p.dni, p.sexo,
             e.razon_social, e.ruc
      FROM usuarios u
      JOIN cliente c ON c.usuario_id = u.id
      JOIN ubigeo ub ON ub.ubigeo_id = c.ubigeo_id
      LEFT JOIN persona p ON p.cliente_id = c.cliente_id
      LEFT JOIN empresa e ON e.cliente_id = c.cliente_id
      WHERE u.id = $1
    `, [req.usuario.id]);

    if (!rows[0]) return res.status(404).json({ error: "Perfil no encontrado." });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el perfil." });
  }
});

// ============================================================
// 4. COTIZACIÓN
// ============================================================

app.post("/api/cotizar", requiereSesion, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay productos para cotizar." });
    }

    const tipoCliente = req.usuario.rol === "cliente"
      ? await getTipoCliente(req.usuario.id)
      : "PERSONA";

    const { rows: productosDB } = await query(
      `SELECT producto_id, nombre_producto, precio_minorista, precio_mayorista, imagen
       FROM producto WHERE producto_id = ANY($1)`,
      [items.map((i) => i.producto_id)]
    );

    const itemsConPrecio = items.map((item) => {
      const prod = productosDB.find((p) => p.producto_id === item.producto_id);
      if (!prod) throw new Error(`Producto ${item.producto_id} no encontrado.`);
      return { ...prod, cantidad: item.cantidad, lote_id: item.lote_id || null };
    });

    res.json(calcularResumenVenta(itemsConPrecio, tipoCliente));
  } catch (error) {
    console.error("Error cotizar:", error);
    res.status(500).json({ error: error.message || "Error al calcular el precio." });
  }
});

// ============================================================
// 5. PEDIDOS (clientes desde la web)
// ============================================================

app.post("/api/pedidos", requiereSesion, async (req, res) => {
  try {
    if (req.usuario.rol !== "cliente") {
      return res.status(403).json({ error: "Solo los clientes pueden registrar pedidos." });
    }

    const { items, metodoPagoId, comprobanteId, direccionEntrega, ubigeoId } = req.body;

    if (!Array.isArray(items) || items.length === 0 || !metodoPagoId) {
      return res.status(400).json({ error: "Completa todos los datos del pedido." });
    }

    const clienteId = await getClienteId(req.usuario.id);
    if (!clienteId) return res.status(404).json({ error: "Perfil de cliente no encontrado." });

    const tipoCliente = await getTipoCliente(req.usuario.id);

    const { rows: productosDB } = await query(
      `SELECT * FROM producto WHERE producto_id = ANY($1)`,
      [items.map((i) => i.producto_id)]
    );

    const itemsConPrecio = items.map((item) => {
      const prod = productosDB.find((p) => p.producto_id === item.producto_id);
      if (!prod) throw new Error(`Producto ${item.producto_id} no encontrado.`);
      return { ...prod, cantidad: item.cantidad };
    });

    const resumen = calcularResumenVenta(itemsConPrecio, tipoCliente);
    const codigoOrden = generarCodigoOrden();

    await conTransaccion(async (client) => {
      const { rows: estadoRows } = await client.query(
        `SELECT estado_id FROM estado_pedido WHERE descripcion = 'Venta Registrada'`
      );
      const estadoId = estadoRows[0]?.estado_id;

      let deliveryId = null;
      if (resumen.modalidadSugerida === "delivery" && ubigeoId) {
        const { rows: delRows } = await client.query(
          `INSERT INTO delivery (direccion_entrega, ubigeo_id, transporte_id)
           VALUES ($1, $2, (SELECT transporte_id FROM transporte WHERE estado_transporte_id =
             (SELECT estado_transporte_id FROM estado_transporte WHERE descripcion = 'Operativo')
             LIMIT 1))
           RETURNING delivery_id`,
          [direccionEntrega || "", ubigeoId]
        );
        deliveryId = delRows[0]?.delivery_id || null;
      }

      const { rows: pedidoRows } = await client.query(
        `INSERT INTO pedido (codigo_orden, cliente_id, estado_id, delivery_id)
         VALUES ($1,$2,$3,$4) RETURNING pedido_id`,
        [codigoOrden, clienteId, estadoId, deliveryId]
      );
      const pedidoId = pedidoRows[0].pedido_id;

      for (const item of resumen.detalle) {
        const asignaciones = await asignarLotesFEFO(client, item.producto_id, item.nombre, item.cantidad);
        for (const asignacion of asignaciones) {
          const subTotalAsignado = Math.round(item.precioUnitario * asignacion.cantidad * 100) / 100;
          await client.query(
            `INSERT INTO detalle_pedido (pedido_id, producto_id, lote_id, cantidad, precio, sub_total)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [pedidoId, item.producto_id, asignacion.lote_id, asignacion.cantidad, item.precioUnitario, subTotalAsignado]
          );
        }
      }

      const { rows: ventaRows } = await client.query(
        `INSERT INTO venta (pedido_id, comprobante_id, total_pago)
         VALUES ($1,$2,$3) RETURNING venta_id`,
        [pedidoId, comprobanteId || 1, resumen.totalAPagar]
      );
      const ventaId = ventaRows[0].venta_id;

      await client.query(
        `INSERT INTO detalle_pago (venta_id, metodo_pago_id, monto_pagado)
         VALUES ($1,$2,$3)`,
        [ventaId, metodoPagoId, resumen.totalAPagar]
      );
    });

    const { rows: userRows } = await query(
      `SELECT email FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );
    if (userRows[0]?.email) {
      enviarCorreoPedidoConfirmado(
        userRows[0].email, req.usuario.nombre, codigoOrden, resumen.totalAPagar
      ).catch(() => { });
    }

    res.status(201).json({
      mensaje: "Pedido registrado",
      orden: codigoOrden,
      modalidadEntrega: resumen.modalidadSugerida,
      totalAPagar: resumen.totalAPagar
    });
  } catch (error) {
    console.error("Error pedido:", error);
    res.status(500).json({ error: error.message || "Error al procesar el pedido." });
  }
});

app.get("/api/mis-pedidos", requiereSesion, async (req, res) => {
  try {
    const clienteId = await getClienteId(req.usuario.id);
    if (!clienteId) return res.json([]);

    const { rows } = await query(`
      SELECT p.pedido_id, p.codigo_orden, p.fecha_pedido, p.hora_pedido,
             ep.descripcion AS estado,
             v.total_pago, v.saldo_pendiente, v.venta_id,
             tc.descripcion AS tipo_comprobante,
             d.direccion_entrega, d.hora_salida, d.hora_entrega
      FROM pedido p
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      LEFT JOIN tipo_comprobante tc ON tc.comprobante_id = v.comprobante_id
      LEFT JOIN delivery d ON d.delivery_id = p.delivery_id
      WHERE p.cliente_id = $1
      ORDER BY p.fecha_pedido DESC, p.hora_pedido DESC
    `, [clienteId]);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener pedidos." });
  }
});

// ============================================================
// 6. COMPROBANTES PDF
// ============================================================

app.get("/api/pedidos/:codigo/comprobante", requiereSesion, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.*, v.total_pago, v.descuento_aplicado, v.saldo_pendiente,
             tc.descripcion AS tipo_comprobante,
             c.cliente_id, c.tipo_cliente, c.direccion, c.telefono,
             ub.distrito, ub.provincia, ub.departamento,
             pe.nombres, pe.apellidos, pe.dni,
             em.razon_social, em.ruc,
             ep.descripcion AS estado
      FROM pedido p
      JOIN cliente c ON c.cliente_id = p.cliente_id
      JOIN ubigeo ub ON ub.ubigeo_id = c.ubigeo_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      LEFT JOIN tipo_comprobante tc ON tc.comprobante_id = v.comprobante_id
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      WHERE p.codigo_orden = $1
    `, [req.params.codigo]);

    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado." });

    if (req.usuario.rol === "cliente" && pedido.cliente_id !== await getClienteId(req.usuario.id)) {
      return res.status(403).json({ error: "No tienes permiso para ver este comprobante." });
    }

    if (req.usuario.rol === "cliente" && pedido.estado === "Venta Registrada") {
      return res.status(403).json({
        error: "Tu comprobante estará disponible apenas confirmemos tu pago."
      });
    }

    const { rows: items } = await query(`
      SELECT dp.cantidad, dp.precio, dp.sub_total,
             pr.nombre_producto AS nombre
      FROM detalle_pedido dp
      JOIN producto pr ON pr.producto_id = dp.producto_id
      WHERE dp.pedido_id = $1
    `, [pedido.pedido_id]);

    const pedidoFormateado = {
      codigoOrden: pedido.codigo_orden,
      cliente: pedido.tipo_cliente === "EMPRESA"
        ? pedido.razon_social
        : `${pedido.nombres} ${pedido.apellidos}`,
      ruc: pedido.ruc || null,
      razonSocial: pedido.razon_social || null,
      dni: pedido.dni || null,
      direccion: `${pedido.distrito}, ${pedido.provincia}, ${pedido.departamento}`,
      telefono: pedido.telefono,
      tipoComprobante: pedido.tipo_comprobante,
      metodopago: "Varios",
      creadoEn: `${new Date(pedido.fecha_pedido).toLocaleDateString("es-PE")} ${
        pedido.hora_pedido ? pedido.hora_pedido.slice(0, 5) : ""
      }`.trim(),
      productos: items.map((i) => ({
        nombre: i.nombre,
        cantidad: i.cantidad,
        precioUnitarioBase: Number(i.precio),
        subtotal: Number(i.sub_total)
      })),
      precio: {
        baseImponible: Number(pedido.total_pago) / 1.18,
        igv: Number(pedido.total_pago) - Number(pedido.total_pago) / 1.18,
        descuento: Number(pedido.descuento_aplicado),
        totalAPagar: Number(pedido.total_pago)
      }
    };

    const tipo = pedido.tipo_comprobante?.toLowerCase() === "factura" ? "factura" : "boleta";
    generarComprobantePDF(res, pedidoFormateado, tipo);
  } catch (error) {
    console.error("Error comprobante:", error);
    res.status(500).json({ error: "Error al generar el comprobante." });
  }
});

// ============================================================
// 7. ADMIN — VENTAS PRESENCIALES
// ============================================================

app.post("/api/ventas-presenciales", requiereRol("empleado"), async (req, res) => {
  try {
    const {
      clienteId, items, metodoPagoId, comprobanteId,
      descuento = 0, montoPagado, eVentaId
    } = req.body;

    if (!clienteId || !Array.isArray(items) || items.length === 0 || !metodoPagoId) {
      return res.status(400).json({ error: "Faltan datos para registrar la venta." });
    }

    const { rows: cliRows } = await query(
      `SELECT tipo_cliente FROM cliente WHERE cliente_id = $1`,
      [clienteId]
    );
    if (!cliRows[0]) return res.status(404).json({ error: "Cliente no encontrado." });

    const tipoCliente = cliRows[0].tipo_cliente;

    const { rows: productosDB } = await query(
      `SELECT * FROM producto WHERE producto_id = ANY($1)`,
      [items.map((i) => i.producto_id)]
    );

    const itemsConPrecio = items.map((item) => {
      const prod = productosDB.find((p) => p.producto_id === item.producto_id);
      if (!prod) throw new Error(`Producto ${item.producto_id} no encontrado.`);
      return { ...prod, cantidad: item.cantidad };
    });

    const resumen = calcularResumenVenta(itemsConPrecio, tipoCliente);
    const codigoOrden = generarCodigoOrden();

    const totalConDescuento = Math.max(0, resumen.totalAPagar - Number(descuento));
    const saldoPendiente = Math.max(0, totalConDescuento - Number(montoPagado || totalConDescuento));

    await conTransaccion(async (client) => {
      const { rows: estadoRows } = await client.query(
        `SELECT estado_id FROM estado_pedido WHERE descripcion = 'Entregado'`
      );
      const estadoId = estadoRows[0]?.estado_id;

      const { rows: pedidoRows } = await client.query(
        `INSERT INTO pedido (codigo_orden, cliente_id, estado_id, e_venta_id)
         VALUES ($1,$2,$3,$4) RETURNING pedido_id`,
        [codigoOrden, clienteId, estadoId, eVentaId || null]
      );
      const pedidoId = pedidoRows[0].pedido_id;

      for (const item of resumen.detalle) {
        const asignaciones = await asignarLotesFEFO(client, item.producto_id, item.nombre, item.cantidad);
        for (const asignacion of asignaciones) {
          const subTotalAsignado = Math.round(item.precioUnitario * asignacion.cantidad * 100) / 100;
          await client.query(
            `INSERT INTO detalle_pedido (pedido_id, producto_id, lote_id, cantidad, precio, sub_total)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [pedidoId, item.producto_id, asignacion.lote_id, asignacion.cantidad, item.precioUnitario, subTotalAsignado]
          );
        }
      }

      const { rows: ventaRows } = await client.query(
        `INSERT INTO venta (pedido_id, comprobante_id, descuento_aplicado, saldo_pendiente, total_pago)
         VALUES ($1,$2,$3,$4,$5) RETURNING venta_id`,
        [pedidoId, comprobanteId || 1, descuento, saldoPendiente, totalConDescuento]
      );
      const ventaId = ventaRows[0].venta_id;

      await client.query(
        `INSERT INTO detalle_pago (venta_id, metodo_pago_id, monto_pagado)
         VALUES ($1,$2,$3)`,
        [ventaId, metodoPagoId, montoPagado || totalConDescuento]
      );
    });

    res.status(201).json({
      mensaje: "Venta registrada",
      orden: codigoOrden,
      totalAPagar: totalConDescuento,
      saldoPendiente
    });
  } catch (error) {
    console.error("Error venta presencial:", error);
    res.status(500).json({ error: error.message || "Error al registrar la venta." });
  }
});

app.post("/api/ventas/:ventaId/pago-parcial", requiereRol("empleado"), async (req, res) => {
  try {
    const { metodoPagoId, monto, numeroOperacion } = req.body;
    const ventaId = parseInt(req.params.ventaId);

    const { rows } = await query(`SELECT * FROM venta WHERE venta_id = $1`, [ventaId]);
    const venta = rows[0];
    if (!venta) return res.status(404).json({ error: "Venta no encontrada." });

    await query(
      `INSERT INTO detalle_pago (venta_id, metodo_pago_id, monto_pagado, numero_operacion_transferencia)
       VALUES ($1,$2,$3,$4)`,
      [ventaId, metodoPagoId, monto, numeroOperacion || null]
    );

    const nuevoSaldo = Math.max(0, Number(venta.saldo_pendiente) - Number(monto));
    await query(`UPDATE venta SET saldo_pendiente = $1 WHERE venta_id = $2`, [nuevoSaldo, ventaId]);

    res.json({ mensaje: "Pago registrado", saldoPendiente: nuevoSaldo });
  } catch (error) {
    res.status(500).json({ error: "Error al registrar el pago." });
  }
});

// ============================================================
// 8. ADMIN — PEDIDOS Y REPORTES
// ============================================================

app.get("/api/pedidos", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.pedido_id, p.codigo_orden, p.fecha_pedido, p.hora_pedido,
             ep.descripcion AS estado, ep.estado_id,
             v.total_pago, v.saldo_pendiente, v.venta_id,
             tc.descripcion AS tipo_comprobante,
             CASE WHEN c.tipo_cliente = 'PERSONA'
               THEN pe.nombres || ' ' || pe.apellidos
               ELSE em.razon_social
             END AS cliente_nombre,
             c.tipo_cliente, c.telefono,
             d.direccion_entrega,
             ev.empleado_id AS e_venta_id,
             emp.nombres || ' ' || emp.apellidos AS vendedor
      FROM pedido p
      JOIN cliente c ON c.cliente_id = p.cliente_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      LEFT JOIN tipo_comprobante tc ON tc.comprobante_id = v.comprobante_id
      LEFT JOIN delivery d ON d.delivery_id = p.delivery_id
      LEFT JOIN e_venta ev ON ev.empleado_id = p.e_venta_id
      LEFT JOIN empleado emp ON emp.empleado_id = ev.empleado_id
      ORDER BY p.fecha_pedido DESC, p.hora_pedido DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener pedidos." });
  }
});

app.patch("/api/pedidos/:codigo/estado", requiereRol("empleado"), async (req, res) => {
  try {
    const { estadoId } = req.body;
    const { rows } = await query(
      `UPDATE pedido SET estado_id = $1 WHERE codigo_orden = $2 RETURNING codigo_orden`,
      [estadoId, req.params.codigo]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Pedido no encontrado." });
    res.json({ mensaje: "Estado actualizado", codigoOrden: rows[0].codigo_orden });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar el pedido." });
  }
});

app.get("/api/pedidos/buscar/:dato", requiereRol("empleado"), async (req, res) => {
  try {
    const dato = req.params.dato;
    const { rows } = await query(`
      SELECT p.codigo_orden, p.fecha_pedido, p.estado_id,
             ep.descripcion AS estado,
             v.venta_id, v.total_pago, v.saldo_pendiente, v.descuento_aplicado,
             CASE WHEN c.tipo_cliente = 'PERSONA'
               THEN pe.nombres || ' ' || pe.apellidos
               ELSE em.razon_social
             END AS cliente_nombre,
             c.telefono
      FROM pedido p
      JOIN cliente c ON c.cliente_id = p.cliente_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      WHERE c.telefono = $1 OR pe.dni = $1 OR em.ruc = $1
      ORDER BY p.fecha_pedido DESC
    `, [dato]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al buscar." });
  }
});

app.get("/api/reportes/mensual", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT to_char(p.fecha_pedido, 'YYYY-MM') AS mes,
             COUNT(p.pedido_id) AS total_pedidos,
             COALESCE(SUM(v.total_pago), 0) AS total_ventas
      FROM pedido p
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      GROUP BY mes ORDER BY mes DESC LIMIT 12
    `);
    res.json(rows.map((r) => ({
      mes: r.mes,
      totalPedidos: Number(r.total_pedidos),
      totalVentas: Number(r.total_ventas)
    })));
  } catch (error) {
    res.status(500).json({ error: "Error al generar reporte." });
  }
});

// ============================================================
// 9. ADMIN — LOTES DE PRODUCCIÓN
// ============================================================

app.get("/api/lotes", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT pl.*, pr.nombre_producto,
             cat.descripcion AS categoria,
             cap.descripcion AS capacidad
      FROM produccion_lotes pl
      JOIN producto pr ON pr.producto_id = pl.producto_id
      JOIN categoria cat ON cat.categoria_id = pr.categoria_id
      JOIN capacidad cap ON cap.capacidad_id = pr.capacidad_id
      ORDER BY pl.fecha_produccion DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener lotes." });
  }
});

app.post("/api/lotes", requiereRol("empleado"), async (req, res) => {
  try {
    const {
      productoId, fechaProduccion, horaProduccion,
      unidadesProducidas, unidadesDefectuosas = 0, fechaVencimiento
    } = req.body;

    const unidadesNetas = unidadesProducidas - unidadesDefectuosas;

    const { rows } = await query(`
      INSERT INTO produccion_lotes
        (producto_id, fecha_produccion, hora_produccion, unidades_producidas,
         unidades_defectuosas, unidades_netas, unidades_disponibles, estado, fecha_vencimiento)
      VALUES ($1,$2,$3,$4,$5,$6,$6,'Disponible',$7)
      RETURNING *`,
      [productoId, fechaProduccion, horaProduccion || "08:00",
        unidadesProducidas, unidadesDefectuosas, unidadesNetas, fechaVencimiento]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al crear lote." });
  }
});

app.patch("/api/lotes/:id", requiereRol("empleado"), async (req, res) => {
  try {
    const { unidadesDisponibles, estado, fechaVencimiento } = req.body;
    const { rows } = await query(
      `UPDATE produccion_lotes
       SET unidades_disponibles = COALESCE($1, unidades_disponibles),
           estado = COALESCE($2, estado),
           fecha_vencimiento = COALESCE($3, fecha_vencimiento)
       WHERE lote_id = $4
       RETURNING *`,
      [unidadesDisponibles, estado, fechaVencimiento, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Lote no encontrado." });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar el lote." });
  }
});

app.get("/api/stock", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT pr.producto_id, pr.nombre_producto,
             COALESCE(SUM(pl.unidades_disponibles), 0) AS stock_disponible,
             COUNT(pl.lote_id) AS lotes_activos,
             MIN(pl.fecha_vencimiento) AS proximo_vencimiento
      FROM producto pr
      LEFT JOIN produccion_lotes pl ON pl.producto_id = pr.producto_id
        AND pl.estado = 'Disponible'
        AND pl.fecha_vencimiento >= CURRENT_DATE
      GROUP BY pr.producto_id, pr.nombre_producto
      ORDER BY pr.producto_id
    `);
    res.json(rows.map((r) => ({ ...r, stock_disponible: Number(r.stock_disponible) })));
  } catch (error) {
    res.status(500).json({ error: "Error al obtener stock." });
  }
});

// ============================================================
// 10. ADMIN — TRANSPORTES
// ============================================================

app.get("/api/transportes", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT t.transporte_id, t.modelo_transporte,
             tt.descripcion AS tipo,
             et.descripcion AS estado
      FROM transporte t
      JOIN tipo_transporte tt ON tt.tipo_id = t.tipo_id
      JOIN estado_transporte et ON et.estado_transporte_id = t.estado_transporte_id
      ORDER BY t.transporte_id
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener transportes." });
  }
});

app.post("/api/transportes", requiereRol("empleado"), async (req, res) => {
  try {
    const { modeloTransporte, tipoId, estadoTransporteId } = req.body;
    const { rows } = await query(
      `INSERT INTO transporte (modelo_transporte, tipo_id, estado_transporte_id)
       VALUES ($1,$2,$3) RETURNING *`,
      [modeloTransporte, tipoId, estadoTransporteId]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al crear transporte." });
  }
});

app.patch("/api/transportes/:id/estado", requiereRol("empleado"), async (req, res) => {
  try {
    const { estadoTransporteId } = req.body;
    await query(
      `UPDATE transporte SET estado_transporte_id = $1 WHERE transporte_id = $2`,
      [estadoTransporteId, req.params.id]
    );
    res.json({ mensaje: "Estado actualizado." });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar transporte." });
  }
});

// ============================================================
// 11. ADMIN — DELIVERIES
// ============================================================

app.get("/api/deliveries", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT d.*,
             ub.distrito, ub.provincia,
             t.transporte_id, t.modelo_transporte,
             tt.descripcion AS tipo_transporte,
             p.codigo_orden, p.estado_id,
             ep.descripcion AS estado_pedido,
             CASE WHEN c.tipo_cliente = 'PERSONA'
               THEN pe.nombres || ' ' || pe.apellidos
               ELSE em.razon_social
             END AS cliente_nombre,
             c.telefono
      FROM delivery d
      JOIN ubigeo ub ON ub.ubigeo_id = d.ubigeo_id
      JOIN transporte t ON t.transporte_id = d.transporte_id
      JOIN tipo_transporte tt ON tt.tipo_id = t.tipo_id
      LEFT JOIN pedido p ON p.delivery_id = d.delivery_id
      LEFT JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      LEFT JOIN cliente c ON c.cliente_id = p.cliente_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      ORDER BY ub.distrito, d.fecha DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener deliveries." });
  }
});

app.patch("/api/deliveries/:id/transporte", requiereRol("empleado"), async (req, res) => {
  try {
    const { transporteId } = req.body;
    const { rows } = await query(
      `UPDATE delivery SET transporte_id = $1 WHERE delivery_id = $2 RETURNING delivery_id`,
      [transporteId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Delivery no encontrado." });
    res.json({ mensaje: "Transporte reasignado." });
  } catch (error) {
    res.status(500).json({ error: "Error al reasignar transporte." });
  }
});

app.patch("/api/deliveries/:id", requiereRol("empleado"), async (req, res) => {
  try {
    const { horaSalida, horaEntrega } = req.body;
    await query(
      `UPDATE delivery SET hora_salida = COALESCE($1, hora_salida),
       hora_entrega = COALESCE($2, hora_entrega)
       WHERE delivery_id = $3`,
      [horaSalida || null, horaEntrega || null, req.params.id]
    );
    res.json({ mensaje: "Delivery actualizado." });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar delivery." });
  }
});

// ============================================================
// 12. ADMIN — CONTROL DE BIDONES
// ============================================================

app.get("/api/bidones/:clienteId", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT cb.*,
             CASE WHEN c.tipo_cliente = 'PERSONA'
               THEN pe.nombres || ' ' || pe.apellidos
               ELSE em.razon_social
             END AS cliente_nombre
      FROM control_bidones cb
      JOIN cliente c ON c.cliente_id = cb.cliente_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      WHERE cb.cliente_id = $1
      ORDER BY cb.fecha_movimiento DESC
    `, [req.params.clienteId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener control de bidones." });
  }
});

app.post("/api/bidones", requiereRol("empleado"), async (req, res) => {
  try {
    const { clienteId, deliveryId, cantidadEntregados, cantidadRecibidos, cantidadPrestados } = req.body;
    const { rows } = await query(
      `INSERT INTO control_bidones
         (cliente_id, delivery_id, cantidad_entregados, cantidad_recibidos, cantidad_prestados)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [clienteId, deliveryId || null, cantidadEntregados || 0,
        cantidadRecibidos || 0, cantidadPrestados || 0]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Error al registrar movimiento de bidones." });
  }
});

// ============================================================
// 13. ADMIN — EMPLEADOS
// ============================================================

app.get("/api/empleados", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT e.empleado_id, e.nombres, e.apellidos, e.dni, e.telefono_empleado,
             e.fecha_contratacion, e.tipo_empleado,
             tc.descripcion AS tipo_contrato, tc.sueldo,
             ee.descripcion AS estado,
             ub.distrito, ub.provincia,
             u.usuario, u.email, u.es_admin_principal
      FROM empleado e
      JOIN tipo_contrato tc ON tc.tipo_contrato_id = e.tipo_contrato_id
      JOIN estado_empleado ee ON ee.estado_empleado_id = e.estado_empleado_id
      JOIN ubigeo ub ON ub.ubigeo_id = e.ubigeo_id
      LEFT JOIN usuarios u ON u.id = e.usuario_id
      ORDER BY e.empleado_id
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener empleados." });
  }
});

app.post("/api/empleados", requiereRol("empleado"), async (req, res) => {
  try {
    const {
      nombres, apellidos, dni, telefono, sexo, fechaContratacion,
      tipoEmpleado, tipoContratoId, ubigeoId, estadoEmpleadoId,
      usuario, email, pass,
      telefonoCorporativo,
      carnetSanidad, fechaVencimientoCarnet, tallaVestimenta,
      numeroLicencia, fechaVencimientoLicencia
    } = req.body;

    const passHash = await bcrypt.hash(pass, 10);
    const { rows: usuRows } = await query(
      `INSERT INTO usuarios (nombre, usuario, pass_hash, rol, email, email_verificado)
       VALUES ($1,$2,$3,'empleado',$4, TRUE) RETURNING id`,
      [`${nombres} ${apellidos}`, usuario, passHash, email]
    );
    const usuarioId = usuRows[0].id;

    const { rows: empRows } = await query(
      `INSERT INTO empleado (nombres, apellidos, telefono_empleado, sexo, dni, fecha_contratacion,
         tipo_empleado, tipo_contrato_id, ubigeo_id, estado_empleado_id, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING empleado_id`,
      [nombres, apellidos, telefono, sexo, dni, fechaContratacion,
        tipoEmpleado, tipoContratoId, ubigeoId, estadoEmpleadoId || 1, usuarioId]
    );
    const empleadoId = empRows[0].empleado_id;

    if (tipoEmpleado === "VENTA") {
      await query(
        `INSERT INTO e_venta (empleado_id, telefono_corporativo) VALUES ($1,$2)`,
        [empleadoId, telefonoCorporativo || null]
      );
    } else if (tipoEmpleado === "PRODUCCION") {
      await query(
        `INSERT INTO e_produccion (empleado_id, carnet_sanidad, fecha_vencimiento_carnet, talla_vestimenta)
         VALUES ($1,$2,$3,$4)`,
        [empleadoId, carnetSanidad, fechaVencimientoCarnet, tallaVestimenta || null]
      );
    } else if (tipoEmpleado === "ENTREGA") {
      await query(
        `INSERT INTO e_entrega (empleado_id, numero_licencia_conducir, fecha_vencimiento_licencia)
         VALUES ($1,$2,$3)`,
        [empleadoId, numeroLicencia, fechaVencimientoLicencia]
      );
    }

    res.status(201).json({ mensaje: "Empleado creado correctamente." });
  } catch (error) {
    console.error("Error crear empleado:", error);
    res.status(500).json({ error: "Error al crear el empleado." });
  }
});

app.delete("/api/empleados/:id", requiereAdminPrincipal, async (req, res) => {
  try {
    const idEliminar = parseInt(req.params.id);
    if (idEliminar === req.usuario.id) {
      return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
    }
    const { rows } = await query(
      `SELECT u.es_admin_principal FROM empleado e JOIN usuarios u ON u.id = e.usuario_id WHERE e.empleado_id = $1`,
      [idEliminar]
    );
    if (!rows[0]) return res.status(404).json({ error: "Empleado no encontrado." });
    if (rows[0].es_admin_principal) {
      return res.status(400).json({ error: "No se puede eliminar al administrador principal." });
    }
    await query(`DELETE FROM empleado WHERE empleado_id = $1`, [idEliminar]);
    res.json({ mensaje: "Empleado eliminado correctamente." });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar empleado." });
  }
});

app.post("/api/empleados/:id/asignar-password", requiereAdminPrincipal, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.* FROM empleado e JOIN usuarios u ON u.id = e.usuario_id WHERE e.empleado_id = $1`,
      [req.params.id]
    );
    const empleado = rows[0];
    if (!empleado) return res.status(404).json({ error: "Empleado no encontrado." });

    const passTemporal = crypto.randomBytes(4).toString("hex");
    const passHash = await bcrypt.hash(passTemporal, 10);
    await query(`UPDATE usuarios SET pass_hash = $1 WHERE id = $2`, [passHash, empleado.id]);

    if (empleado.email) {
      await enviarCorreoNuevaPassAsignada(empleado.email, empleado.nombre, passTemporal);
    }

    res.json({ mensaje: "Contraseña reasignada.", passTemporal });
  } catch (error) {
    res.status(500).json({ error: "Error al asignar contraseña." });
  }
});

// ============================================================
// 14. ADMIN — CLIENTES
// ============================================================

app.get("/api/clientes", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.cliente_id, c.tipo_cliente, c.telefono, c.direccion, c.fecha_registro,
             ub.distrito, ub.provincia,
             pe.nombres, pe.apellidos, pe.dni,
             em.razon_social, em.ruc,
             COALESCE(SUM(cb.cantidad_prestados - cb.cantidad_recibidos), 0) AS bidones_pendientes
      FROM cliente c
      JOIN ubigeo ub ON ub.ubigeo_id = c.ubigeo_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      LEFT JOIN control_bidones cb ON cb.cliente_id = c.cliente_id
      GROUP BY c.cliente_id, c.tipo_cliente, c.telefono, c.direccion, c.fecha_registro,
               ub.distrito, ub.provincia, pe.nombres, pe.apellidos, pe.dni,
               em.razon_social, em.ruc
      ORDER BY c.fecha_registro DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener clientes." });
  }
});

app.get("/api/clientes/buscar/:dato", requiereRol("empleado"), async (req, res) => {
  try {
    const dato = req.params.dato;
    const { rows } = await query(`
      SELECT c.cliente_id, c.tipo_cliente, c.telefono,
             pe.nombres, pe.apellidos, pe.dni,
             em.razon_social, em.ruc
      FROM cliente c
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      WHERE pe.dni = $1 OR em.ruc = $1 OR c.telefono = $1
         OR LOWER(pe.nombres || ' ' || pe.apellidos) LIKE LOWER('%' || $1 || '%')
         OR LOWER(em.razon_social) LIKE LOWER('%' || $1 || '%')
    `, [dato]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al buscar cliente." });
  }
});

app.get("/api/estados-pedido", async (req, res) => {
  const { rows } = await query(`SELECT * FROM estado_pedido ORDER BY estado_id`);
  res.json(rows);
});

app.get("/api/tipos-transporte", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(`SELECT * FROM tipo_transporte ORDER BY tipo_id`);
  res.json(rows);
});

app.get("/api/estados-transporte", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(`SELECT * FROM estado_transporte ORDER BY estado_transporte_id`);
  res.json(rows);
});

app.get("/api/tipos-contrato", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(`SELECT * FROM tipo_contrato ORDER BY tipo_contrato_id`);
  res.json(rows);
});

app.get("/api/sucursales/resumen-ingresos", requiereRol("empleado"), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT ub.ubigeo_id, ub.distrito, ub.provincia,
             COUNT(p.pedido_id) AS total_pedidos,
             COALESCE(SUM(v.total_pago), 0) AS total_ingresos
      FROM ubigeo ub
      LEFT JOIN cliente c ON c.ubigeo_id = ub.ubigeo_id
      LEFT JOIN pedido p ON p.cliente_id = c.cliente_id
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      GROUP BY ub.ubigeo_id, ub.distrito, ub.provincia
      HAVING COUNT(p.pedido_id) > 0
      ORDER BY total_ingresos DESC
    `);
    res.json(rows.map((r) => ({
      ...r,
      total_pedidos: Number(r.total_pedidos),
      total_ingresos: Number(r.total_ingresos)
    })));
  } catch (error) {
    res.status(500).json({ error: "Error al obtener resumen por zona." });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de Khanauky corriendo en http://localhost:${PORT}`);
});