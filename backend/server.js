import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

import { pool, query, iniciarBD, generarCodigoOrden } from "./db.js";
import { calcularResumenVenta } from "./precios.js";
import { firmarToken, requiereSesion, requiereRol, requiereAdminPrincipal } from "./auth.js";
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

const limiteLogin = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Demasiados intentos. Espera un minuto e inténtalo de nuevo." }
});

await iniciarBD();

function perfilPublico(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    usuario: usuario.usuario,
    email: usuario.email,
    dni: usuario.dni || null,
    direccion: usuario.direccion || null,
    telefono: usuario.telefono || null
  };
}

function mapearPedidoConDetalle(filaPedido, items) {
  return {
    codigoOrden: filaPedido.codigo_orden,
    usuarioId: filaPedido.usuario_id,
    cliente: filaPedido.cliente,
    telefono: filaPedido.telefono,
    direccion: filaPedido.direccion,
    dni: filaPedido.dni,
    ruc: filaPedido.ruc,
    razonSocial: filaPedido.razon_social,
    sucursal: filaPedido.sucursal_nombre,
    metodopago: filaPedido.metodo_pago,
    modalidadEntrega: filaPedido.modalidad_entrega,
    tipoComprobante: filaPedido.tipo_comprobante,
    estado: filaPedido.estado,
    creadoEn: new Date(filaPedido.creado_en).toLocaleString("es-PE", { timeZone: "America/Lima" }),
    productos: items,
    precio: {
      baseImponible: Number(filaPedido.base_imponible),
      igv: Number(filaPedido.igv),
      descuento: Number(filaPedido.descuento),
      totalAPagar: Number(filaPedido.total_a_pagar)
    }
  };
}

async function obtenerPedidoCompleto(codigoOrden) {
  const { rows } = await query(
    `SELECT p.*, s.nombre AS sucursal_nombre FROM pedidos p
     LEFT JOIN sucursales s ON s.id = p.sucursal_id
     WHERE p.codigo_orden = $1`,
    [codigoOrden]
  );
  if (rows.length === 0) return null;

  const { rows: items } = await query(
    `SELECT producto_id AS id, nombre_producto AS nombre, cantidad,
            precio_unitario_base AS "precioUnitarioBase", subtotal, descuento
     FROM detalle_pedido WHERE pedido_id = $1 ORDER BY id`,
    [rows[0].id]
  );

  return mapearPedidoConDetalle(rows[0], items.map((i) => ({ ...i, precioUnitarioBase: Number(i.precioUnitarioBase), subtotal: Number(i.subtotal), descuento: Number(i.descuento) })));
}

// ============================================================
// AUTENTICACIÓN
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
        return res.status(400).json({ error: "Verificación de seguridad fallida. Vuelve a intentarlo." });
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
      return res.status(403).json({ error: "Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada." });
    }

    const token = firmarToken(usuario);
    res.cookie("sesion", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    });

    res.json({ mensaje: "Login exitoso", nombre: usuario.nombre, rol: usuario.rol, perfil: perfilPublico(usuario) });
  } catch (error) {
    console.error("Error al validar login:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.post("/api/registro", limiteLogin, async (req, res) => {
  try {
    const { nombre, usuario, pass, email, dni, direccion, telefono, fechaNac } = req.body;

    if (!nombre || !usuario || !pass || !email || !dni) {
      return res.status(400).json({ error: "Completa todos los campos obligatorios." });
    }
    if (!/^\d{8}$/.test(dni)) {
      return res.status(400).json({ error: "El DNI debe tener exactamente 8 dígitos." });
    }
    if (pass.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
    }

    const { rows: existentes } = await query(`SELECT id FROM usuarios WHERE usuario = $1 OR email = $2`, [usuario, email]);
    if (existentes.length > 0) {
      return res.status(409).json({ error: "Ese usuario o correo ya está registrado." });
    }

    const passHash = await bcrypt.hash(pass, 10);
    const { rows } = await query(
      `INSERT INTO usuarios (nombre, usuario, pass_hash, email, dni, direccion, telefono, fecha_nac, rol, email_verificado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cliente', FALSE) RETURNING id`,
      [nombre, usuario, passHash, email, dni, direccion, telefono, fechaNac]
    );
    const nuevoId = rows[0].id;

    const token = crypto.randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await query(`INSERT INTO tokens_verificacion (token, usuario_id, expira) VALUES ($1,$2,$3)`, [token, nuevoId, expira]);

    const correoEnviado = await enviarCorreoVerificacion(email, nombre, token);

    res.status(201).json({
      mensaje: correoEnviado
        ? "Registro exitoso. Revisa tu correo para confirmar tu cuenta."
        : "Registro exitoso, pero no pudimos enviar el correo de confirmación. Contacta a soporte."
    });
  } catch (error) {
    console.error("Error al registrar:", error);
    res.status(500).json({ error: "Error al registrar el usuario." });
  }
});

app.post("/api/verificar-email", async (req, res) => {
  try {
    const { token } = req.body;
    const { rows } = await query(`SELECT * FROM tokens_verificacion WHERE token = $1`, [token]);
    const registro = rows[0];

    if (!registro || new Date(registro.expira) < new Date()) {
      return res.status(400).json({ error: "El enlace de verificación es inválido o ha expirado." });
    }

    await query(`UPDATE usuarios SET email_verificado = TRUE WHERE id = $1`, [registro.usuario_id]);
    await query(`DELETE FROM tokens_verificacion WHERE token = $1`, [token]);

    res.json({ mensaje: "Correo verificado correctamente. Ya puedes iniciar sesión." });
  } catch (error) {
    console.error("Error al verificar email:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.post("/api/recuperar-password", limiteLogin, async (req, res) => {
  try {
    const { email } = req.body;
    const { rows } = await query(`SELECT * FROM usuarios WHERE email = $1 AND rol = 'cliente'`, [email]);
    const usuario = rows[0];

    if (usuario) {
      const token = crypto.randomBytes(32).toString("hex");
      const expira = new Date(Date.now() + 30 * 60 * 1000);
      await query(`INSERT INTO tokens_recuperacion (token, usuario_id, expira) VALUES ($1,$2,$3)`, [token, usuario.id, expira]);
      await enviarCorreoRecuperacion(usuario.email, usuario.nombre, token);
    }

    res.json({ mensaje: "Si el correo existe en nuestro sistema, te enviamos un enlace para restablecer tu contraseña." });
  } catch (error) {
    console.error("Error en recuperación de contraseña:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.post("/api/restablecer-password", async (req, res) => {
  try {
    const { token, nuevaPass } = req.body;
    if (!nuevaPass || nuevaPass.length < 6) {
      return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres." });
    }

    const { rows } = await query(`SELECT * FROM tokens_recuperacion WHERE token = $1`, [token]);
    const registro = rows[0];

    if (!registro || new Date(registro.expira) < new Date()) {
      return res.status(400).json({ error: "El enlace de recuperación es inválido o ha expirado." });
    }

    const passHash = await bcrypt.hash(nuevaPass, 10);
    await query(`UPDATE usuarios SET pass_hash = $1 WHERE id = $2`, [passHash, registro.usuario_id]);
    await query(`DELETE FROM tokens_recuperacion WHERE token = $1`, [token]);

    res.json({ mensaje: "Contraseña actualizada correctamente. Ya puedes iniciar sesión." });
  } catch (error) {
    console.error("Error al restablecer contraseña:", error);
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

// productos y sucursales

app.get("/api/productos", async (req, res) => {
  const { rows } = await query(`SELECT * FROM productos ORDER BY id`);
  res.json(rows);
});

app.get("/api/sucursales", async (req, res) => {
  const { rows } = await query(`SELECT * FROM sucursales WHERE activa ORDER BY id`);
  res.json(rows);
});

app.post("/api/sucursales", requiereRol("empleado"), async (req, res) => {
  const { nombre, direccion } = req.body;
  if (!nombre) return res.status(400).json({ error: "El nombre de la sucursal es obligatorio." });

  try {
    const { rows } = await query(`INSERT INTO sucursales (nombre, direccion) VALUES ($1,$2) RETURNING *`, [nombre, direccion || ""]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Esa sucursal ya existe." });
    res.status(500).json({ error: "Error al crear la sucursal." });
  }
});

app.get("/api/sucursales/resumen-ingresos", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(`
    SELECT s.id, s.nombre, COUNT(p.id) AS total_pedidos, COALESCE(SUM(p.total_a_pagar), 0) AS total_ingresos
    FROM sucursales s
    LEFT JOIN pedidos p ON p.sucursal_id = s.id
    GROUP BY s.id, s.nombre
    ORDER BY s.id
  `);
  res.json(rows.map((r) => ({ id: r.id, nombre: r.nombre, totalPedidos: Number(r.total_pedidos), totalIngresos: Number(r.total_ingresos) })));
});

// cotizar

app.post("/api/cotizar", async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay productos para cotizar." });
    }
    res.json(calcularResumenVenta(items));
  } catch (error) {
    console.error("Error al cotizar:", error);
    res.status(500).json({ error: "Error al calcular el precio." });
  }
});

// pedidos

async function crearPedidoEnBD({ usuarioId, registradoPor, cliente, telefono, direccion, dni, ruc, razonSocial, sucursalNombre, metodopago, productos, estadoInicial }) {
  const resumen = calcularResumenVenta(productos);

  const { rows: sucursalRows } = await query(`SELECT id FROM sucursales WHERE nombre = $1`, [sucursalNombre]);
  const sucursalId = sucursalRows[0]?.id || null;

  const codigoOrden = generarCodigoOrden();
  const tipoComprobante = ruc ? "factura" : "boleta";
  const modalidadEntrega = resumen.modalidadSugerida;

  const { rows } = await query(
    `INSERT INTO pedidos (codigo_orden, usuario_id, registrado_por, cliente, telefono, direccion, dni, ruc, razon_social,
        sucursal_id, metodo_pago, modalidad_entrega, tipo_comprobante, base_imponible, igv, descuento, total_a_pagar, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, codigo_orden`,
    [codigoOrden, usuarioId, registradoPor, cliente, telefono, direccion, dni || null, ruc || null, razonSocial || null,
      sucursalId, metodopago, modalidadEntrega, tipoComprobante, resumen.baseImponible, resumen.igv, resumen.descuentoTotal, resumen.totalAPagar, estadoInicial]
  );

  const pedidoId = rows[0].id;

  for (const item of resumen.detalle) {
    await query(
      `INSERT INTO detalle_pedido (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario_base, subtotal, descuento)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pedidoId, item.id, item.nombre, item.cantidad, item.precioUnitarioBase, item.subtotal, item.descuento]
    );
  }

  return { codigoOrden: rows[0].codigo_orden, resumen, modalidadEntrega };
}

app.post("/api/pedidos", requiereSesion, async (req, res) => {
  try {
    if (req.usuario.rol !== "cliente") {
      return res.status(403).json({ error: "Solo los clientes pueden registrar pedidos desde el catálogo." });
    }

    const { cliente, telefono, direccion, dni, ruc, razonSocial, sucursal, metodopago, productos } = req.body;

    if (!cliente || !telefono || !direccion || !Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: "Completa todos los datos del pedido." });
    }

    const { codigoOrden, resumen, modalidadEntrega } = await crearPedidoEnBD({
      usuarioId: req.usuario.id,
      registradoPor: null,
      cliente, telefono, direccion, dni, ruc, razonSocial,
      sucursalNombre: sucursal, metodopago, productos,
      estadoInicial: "Venta Registrada"
    });

    const { rows: userRows } = await query(`SELECT email FROM usuarios WHERE id = $1`, [req.usuario.id]);
    if (userRows[0]?.email) {
      enviarCorreoPedidoConfirmado(userRows[0].email, cliente, codigoOrden, resumen.totalAPagar).catch(() => {});
    }

    res.status(201).json({ mensaje: "Pedido registrado", orden: codigoOrden, modalidadEntrega, totalAPagar: resumen.totalAPagar });
  } catch (error) {
    console.error("Error al guardar el pedido:", error);
    res.status(500).json({ error: "Error interno al procesar el pedido." });
  }
});

app.post("/api/ventas-presenciales", requiereRol("empleado"), async (req, res) => {
  try {
    const { cliente, telefono, dni, ruc, razonSocial, sucursal, metodopago, productos } = req.body;

    if (!cliente || !Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: "Completa los datos de la venta." });
    }

    const { codigoOrden, resumen, modalidadEntrega } = await crearPedidoEnBD({
      usuarioId: null,
      registradoPor: req.usuario.nombre,
      cliente, telefono, direccion: "Venta en sucursal", dni, ruc, razonSocial,
      sucursalNombre: sucursal, metodopago: metodopago || "Efectivo al recibir", productos,
      estadoInicial: "Venta Exitosa"
    });

    res.status(201).json({ mensaje: "Venta registrada", orden: codigoOrden, modalidadEntrega, totalAPagar: resumen.totalAPagar });
  } catch (error) {
    console.error("Error al registrar venta presencial:", error);
    res.status(500).json({ error: "Error interno al procesar la venta." });
  }
});

app.get("/api/pedidos", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(`
    SELECT p.*, s.nombre AS sucursal_nombre FROM pedidos p
    LEFT JOIN sucursales s ON s.id = p.sucursal_id
    ORDER BY p.creado_en DESC
  `);
  res.json(rows.map((r) => mapearPedidoConDetalle(r, [])));
});

app.get("/api/reportes/mensual", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(`
    SELECT to_char(creado_en, 'YYYY-MM') AS mes,
           COUNT(*) AS total_pedidos,
           COALESCE(SUM(total_a_pagar), 0) AS total_ventas
    FROM pedidos
    GROUP BY mes
    ORDER BY mes DESC
    LIMIT 12
  `);
  res.json(rows.map((r) => ({ mes: r.mes, totalPedidos: Number(r.total_pedidos), totalVentas: Number(r.total_ventas) })));
});

app.get("/api/mis-pedidos", requiereSesion, async (req, res) => {
  const { rows } = await query(`
    SELECT p.*, s.nombre AS sucursal_nombre FROM pedidos p
    LEFT JOIN sucursales s ON s.id = p.sucursal_id
    WHERE p.usuario_id = $1 ORDER BY p.creado_en DESC
  `, [req.usuario.id]);
  res.json(rows.map((r) => mapearPedidoConDetalle(r, [])));
});

app.patch("/api/pedidos/:codigo/estado", requiereRol("empleado"), async (req, res) => {
  try {
    const estadosValidos = ["Venta Registrada", "Venta Exitosa", "Entrega Pendiente", "Venta Entregada"];
    if (!estadosValidos.includes(req.body.estado)) {
      return res.status(400).json({ error: "Estado no válido." });
    }

    const { rows } = await query(`UPDATE pedidos SET estado = $1 WHERE codigo_orden = $2 RETURNING codigo_orden`, [req.body.estado, req.params.codigo]);
    if (rows.length === 0) return res.status(404).json({ error: "Pedido no encontrado." });

    res.json({ mensaje: "Estado actualizado", codigoOrden: rows[0].codigo_orden });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar el pedido." });
  }
});

app.get("/api/pedidos/buscar/:dato", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(`
    SELECT p.*, s.nombre AS sucursal_nombre FROM pedidos p
    LEFT JOIN sucursales s ON s.id = p.sucursal_id
    WHERE p.dni = $1 OR p.telefono = $1
    ORDER BY p.creado_en DESC
  `, [req.params.dato]);
  res.json(rows.map((r) => mapearPedidoConDetalle(r, [])));
});

// comprobantes pdf

app.get("/api/pedidos/:codigo/comprobante", requiereSesion, async (req, res) => {
  try {
    const pedido = await obtenerPedidoCompleto(req.params.codigo);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado." });

    if (req.usuario.rol === "cliente" && pedido.usuarioId !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para ver este comprobante." });
    }

    const tipo = pedido.tipoComprobante === "factura" ? "factura" : "boleta";
    generarComprobantePDF(res, pedido, tipo);
  } catch (error) {
    console.error("Error al generar comprobante:", error);
    res.status(500).json({ error: "Error al generar el comprobante." });
  }
});

// admin/empleados

app.get("/api/empleados", requiereRol("empleado"), async (req, res) => {
  const { rows } = await query(
    `SELECT id, nombre, usuario, email, rol, es_admin_principal AS "esAdminPrincipal", creado_en AS "creadoEn"
     FROM usuarios WHERE rol = 'empleado' ORDER BY id`
  );
  res.json(rows);
});

app.post("/api/empleados", requiereRol("empleado"), async (req, res) => {
  try {
    const { nombre, usuario, pass, email } = req.body;
    if (!nombre || !usuario || !pass || !email) {
      return res.status(400).json({ error: "Completa todos los campos." });
    }

    const { rows: existentes } = await query(`SELECT id FROM usuarios WHERE usuario = $1`, [usuario]);
    if (existentes.length > 0) return res.status(409).json({ error: "Ese nombre de usuario ya existe." });

    const passHash = await bcrypt.hash(pass, 10);
    await query(
      `INSERT INTO usuarios (nombre, usuario, pass_hash, email, rol, email_verificado) VALUES ($1,$2,$3,$4,'empleado', TRUE)`,
      [nombre, usuario, passHash, email]
    );

    res.status(201).json({ mensaje: "Empleado creado correctamente." });
  } catch (error) {
    console.error("Error al crear empleado:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// solo el admin principal puede asignar una contraseña nueva a otro empleado
app.post("/api/empleados/:id/asignar-password", requiereAdminPrincipal, async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM usuarios WHERE id = $1 AND rol = 'empleado'`, [req.params.id]);
    const empleado = rows[0];
    if (!empleado) return res.status(404).json({ error: "Empleado no encontrado." });

    const passTemporal = crypto.randomBytes(4).toString("hex");
    const passHash = await bcrypt.hash(passTemporal, 10);
    await query(`UPDATE usuarios SET pass_hash = $1 WHERE id = $2`, [passHash, empleado.id]);

    if (empleado.email) {
      await enviarCorreoNuevaPassAsignada(empleado.email, empleado.nombre, passTemporal);
    }

    res.json({ mensaje: "Contraseña reasignada y enviada por correo.", passTemporal });
  } catch (error) {
    console.error("Error al asignar contraseña:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de Khanauky corriendo en http://localhost:${PORT}`);
});
