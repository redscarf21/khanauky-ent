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
import { validarItems, validarDinero, errorHttp } from "./validaciones.js";
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
    if (isNaN(parseInt(ubigeoId))) {
      return res.status(400).json({ error: "Selecciona tu distrito de la lista." });
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

    if (tipoCliente === "PERSONA") {
      const { rows: dniExistente } = await query(`SELECT cliente_id FROM persona WHERE dni = $1`, [dni]);
      if (dniExistente.length > 0) {
        return res.status(409).json({ error: "Ese DNI ya está registrado con otra cuenta." });
      }
    } else {
      const { rows: rucExistente } = await query(`SELECT cliente_id FROM empresa WHERE ruc = $1`, [ruc]);
      if (rucExistente.length > 0) {
        return res.status(409).json({ error: "Ese RUC ya está registrado con otra cuenta." });
      }
    }

    const passHash = await bcrypt.hash(pass, 10);
    const token = crypto.randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await conTransaccion(async (client) => {
      const { rows: usuRows } = await client.query(
        `INSERT INTO usuarios (nombre, usuario, pass_hash, rol, email, email_verificado)
         VALUES ($1,$2,$3,'cliente',$4, FALSE) RETURNING id`,
        [nombre, usuario, passHash, email]
      );
      const nuevoUsuarioId = usuRows[0].id;

      const { rows: cliRows } = await client.query(
        `INSERT INTO cliente (direccion, telefono, tipo_cliente, ubigeo_id, usuario_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING cliente_id`,
        [direccion, telefono, tipoCliente, parseInt(ubigeoId), nuevoUsuarioId]
      );
      const nuevoClienteId = cliRows[0].cliente_id;

      if (tipoCliente === "PERSONA") {
        await client.query(
          `INSERT INTO persona (cliente_id, nombres, apellidos, sexo, dni) VALUES ($1,$2,$3,$4,$5)`,
          [nuevoClienteId, nombre, "", sexo || "M", dni]
        );
      } else {
        await client.query(
          `INSERT INTO empresa (cliente_id, razon_social, ruc) VALUES ($1,$2,$3)`,
          [nuevoClienteId, razonSocial, ruc]
        );
      }

      await client.query(
        `INSERT INTO tokens_verificacion (token, usuario_id, expira) VALUES ($1,$2,$3)`,
        [token, nuevoUsuarioId, expira]
      );
    });

    // A partir de aquí el registro ya quedó guardado de forma completa
    // y consistente. Si el envío del correo falla, la cuenta sigue
    // siendo válida (se puede reenviar la verificación más adelante).
    const correoEnviado = await enviarCorreoVerificacion(email, nombre, token);

    res.status(201).json({
      mensaje: correoEnviado
        ? "Registro exitoso. Revisa tu correo para confirmar tu cuenta."
        : "Registro exitoso, pero no pudimos enviar el correo. Contacta a soporte."
    });
  } catch (error) {
    console.error("Error registro:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "Ya existe una cuenta con ese DNI, RUC, usuario o correo." });
    }
    res.status(500).json({ error: "Error al registrar el usuario. Ningún dato quedó guardado, puedes intentar de nuevo." });
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

    validarItems(items);

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
      if (!prod) throw errorHttp(400, `Producto ${item.producto_id} no encontrado.`);
      return { ...prod, cantidad: item.cantidad, lote_id: item.lote_id || null };
    });

    res.json(calcularResumenVenta(itemsConPrecio, tipoCliente));
  } catch (error) {
    console.error("Error cotizar:", error);
    res.status(error.status || 500).json({ error: error.message || "Error al calcular el precio." });
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

    const { items, metodoPagoId, comprobanteId, direccionEntrega, ubigeoId, nombreContacto, telefonoContacto, ruc, razonSocial, bidonesCompra, bidonesDevolucion } = req.body;

    if (!Array.isArray(items) || items.length === 0 || !metodoPagoId) {
      return res.status(400).json({ error: "Completa todos los datos del pedido." });
    }

    validarItems(items);
    const clienteId = await getClienteId(req.usuario.id);
    if (!clienteId) return res.status(404).json({ error: "Perfil de cliente no encontrado." });

    const { rows: perfiles } = await query(`SELECT direccion, telefono, ubigeo_id FROM cliente WHERE cliente_id = $1`, [clienteId]);
    const perfil = perfiles[0];
    const contacto = String(nombreContacto ?? req.usuario.nombre ?? "").trim();
    const telefono = String(telefonoContacto ?? perfil.telefono ?? "").trim();
    const direccion = String(direccionEntrega ?? perfil.direccion ?? "").trim();
    const zonaId = ubigeoId ?? perfil.ubigeo_id;
    if (!contacto || contacto.length > 150 || !/^\d{9}$/.test(telefono)) {
      throw errorHttp(400, "Ingresa el nombre de quien recibe y un teléfono de 9 dígitos.");
    }
    const { rows: tipos } = await query(`SELECT descripcion FROM tipo_comprobante WHERE comprobante_id = $1`, [comprobanteId || 1]);
    if (!tipos[0]) throw errorHttp(400, "Comprobante no válido.");
    const esFactura = tipos[0].descripcion.toLowerCase() === "factura";
    if (esFactura && (typeof ruc !== "string" || !/^\d{11}$/.test(ruc) ||
        typeof razonSocial !== "string" || !razonSocial.trim() || razonSocial.trim().length > 100)) {
      throw errorHttp(400, "Ingresa un RUC de 11 dígitos y una razón social de hasta 100 caracteres.");
    }
    const { rows: pagos } = await query(`SELECT metodo_pago_id FROM metodo_pago WHERE metodo_pago_id = $1`, [metodoPagoId]);
    if (!pagos[0]) throw errorHttp(400, "Selecciona un método de pago válido.");
    const tipoCliente = await getTipoCliente(req.usuario.id);

    const { rows: productosDB } = await query(
      `SELECT * FROM producto WHERE producto_id = ANY($1)`,
      [items.map((i) => i.producto_id)]
    );

    const itemsConPrecio = items.map((item) => {
      const prod = productosDB.find((p) => p.producto_id === item.producto_id);
      if (!prod) throw errorHttp(400, `Producto ${item.producto_id} no encontrado.`);
      return { ...prod, cantidad: item.cantidad };
    });

    const resumen = calcularResumenVenta(itemsConPrecio, tipoCliente);
    const codigoOrden = generarCodigoOrden();

    const PRECIO_COMPRA_BIDON = 5;
    const cantidadBidones20L = resumen.detalle
      .filter((i) => i.nombre === "Bidón de Agua 20L")
      .reduce((t, i) => t + i.cantidad, 0);

    if (cantidadBidones20L > 0 && (typeof bidonesCompra !== "boolean" || (!bidonesCompra && !["contra_entrega", "posterior"].includes(bidonesDevolucion)))) {
      return res.status(400).json({ error: "Indica si la devolución del bidón será contra entrega o posterior." });
    }

    const cargoBidones = (cantidadBidones20L > 0 && bidonesCompra) ? cantidadBidones20L * PRECIO_COMPRA_BIDON : 0;
    const totalFinal = Math.round((resumen.totalAPagar + cargoBidones) * 100) / 100;

    await conTransaccion(async (client) => {
      const { rows: estadoRows } = await client.query(
        `SELECT estado_id FROM estado_pedido WHERE descripcion = 'Venta Registrada'`
      );
      const estadoId = estadoRows[0]?.estado_id;

      let deliveryId = null;
      if (resumen.modalidadSugerida === "delivery") {
        if (!direccion || direccion.length > 150 || !Number.isInteger(zonaId)) {
          throw errorHttp(400, "Completa la dirección de entrega y el distrito.");
        }
        const { rows: delRows } = await client.query(
          `INSERT INTO delivery (direccion_entrega, ubigeo_id, transporte_id)
           VALUES ($1, $2, NULL)
           RETURNING delivery_id`,
          [direccion, zonaId]
        );
        deliveryId = delRows[0]?.delivery_id || null;
      }

      const { rows: pedidoRows } = await client.query(
        `INSERT INTO pedido (codigo_orden, cliente_id, estado_id, delivery_id, nombre_contacto, telefono_contacto, cargo_bidones, ruc_presencial, razon_social_presencial)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING pedido_id`,
        [codigoOrden, clienteId, estadoId, deliveryId, contacto, telefono, cargoBidones, esFactura ? ruc : null, esFactura ? razonSocial.trim() : null]
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

      if (cantidadBidones20L > 0) {
        const entregados = cantidadBidones20L;
        const recibidos = bidonesCompra ? 0 : (bidonesDevolucion === "contra_entrega" ? cantidadBidones20L : 0);
        const prestados = bidonesCompra ? 0 : cantidadBidones20L;

        await client.query(
          `INSERT INTO control_bidones (cantidad_entregados, cantidad_recibidos, cantidad_prestados, delivery_id, cliente_id, pedido_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [entregados, recibidos, prestados, deliveryId, clienteId, pedidoId]
        );
      }

      const { rows: ventaRows } = await client.query(
        `INSERT INTO venta (pedido_id, comprobante_id, total_pago, saldo_pendiente)
         VALUES ($1,$2,$3,$3) RETURNING venta_id`,
        [pedidoId, comprobanteId || 1, totalFinal]
      );
      const ventaId = ventaRows[0].venta_id;

      await client.query(
        `INSERT INTO detalle_pago (venta_id, metodo_pago_id, monto_pagado)
         VALUES ($1,$2,$3)`,
        [ventaId, metodoPagoId, 0]
      );
    });

    try {
    const { rows: userRows } = await query(
      `SELECT email FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );
    if (userRows[0]?.email) {
      enviarCorreoPedidoConfirmado(
        userRows[0].email, req.usuario.nombre, codigoOrden, totalFinal
      ).catch(() => { });
    }

    } catch (errorCorreo) { console.error("No se pudo preparar el correo del pedido:", errorCorreo.message); }

    res.status(201).json({
      mensaje: "Pedido registrado",
      orden: codigoOrden,
      modalidadEntrega: resumen.modalidadSugerida,
      cargoBidones,
      totalAPagar: totalFinal
    });
  } catch (error) {
    console.error("Error pedido:", error);
    res.status(error.status || 500).json({ error: error.message || "Error al procesar el pedido." });
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
             c.cliente_id, c.tipo_cliente, c.direccion, COALESCE(p.telefono_contacto, c.telefono) AS telefono,
             ub.distrito, ub.provincia, ub.departamento, d.direccion_entrega,
             pe.nombres, pe.apellidos, pe.dni,
             em.razon_social, em.ruc,
             ep.descripcion AS estado
      FROM pedido p
      LEFT JOIN delivery d ON d.delivery_id = p.delivery_id
      LEFT JOIN cliente c ON c.cliente_id = p.cliente_id
      LEFT JOIN ubigeo ub ON ub.ubigeo_id = c.ubigeo_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      LEFT JOIN tipo_comprobante tc ON tc.comprobante_id = v.comprobante_id
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      WHERE p.codigo_orden = $1
    `, [req.params.codigo]);

    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado." });

    if (req.usuario.rol === "cliente" && (pedido.cliente_id == null || pedido.cliente_id !== await getClienteId(req.usuario.id))) {
      return res.status(403).json({ error: "No tienes permiso para ver este comprobante." });
    }

    if (pedido.estado === "Cancelado") {
      return res.status(403).json({ error: "Este pedido fue cancelado, no cuenta con comprobante." });
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

    if (Number(pedido.cargo_bidones) > 0) {
      items.push({ cantidad: 1, precio: Number(pedido.cargo_bidones), sub_total: Number(pedido.cargo_bidones), nombre: "Compra de envases de bidón 20L" });
    }
    const pedidoFormateado = {
      codigoOrden: pedido.codigo_orden,
      cliente: pedido.cliente_id == null
        ? (pedido.razon_social_presencial || "Cliente presencial")
        : pedido.tipo_cliente === "EMPRESA"
        ? pedido.razon_social
        : `${pedido.nombres} ${pedido.apellidos}`,
      ruc: pedido.ruc_presencial || pedido.ruc || null,
      razonSocial: pedido.razon_social_presencial || pedido.razon_social || null,
      dni: pedido.dni_presencial || pedido.dni || null,
      direccion: pedido.direccion_entrega || [pedido.distrito, pedido.provincia, pedido.departamento].filter(Boolean).join(", "),
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
      clienteId = null, dni = null, items, metodoPagoId, comprobanteId,
      descuento = 0, montoPagado, ruc, razonSocial
    } = req.body;

    if (!Array.isArray(items) || items.length === 0 || !metodoPagoId) {
      return res.status(400).json({ error: "Faltan datos para registrar la venta." });
    }

    validarItems(items);
    const dniVenta = typeof dni === "string" ? dni.trim() : dni;
    if (dniVenta !== null && (typeof dniVenta !== "string" || !/^\d{8}$/.test(dniVenta))) {
      return res.status(400).json({ error: "El DNI debe tener exactamente 8 dígitos, o ser null para continuar sin DNI." });
    }
    if (items.some((i) => !i || !Number.isInteger(i.producto_id) || !Number.isInteger(i.cantidad) || i.cantidad <= 0)) {
      return res.status(400).json({ error: "Los productos y cantidades deben ser válidos." });
    }
    if (!Number.isFinite(Number(descuento)) || Number(descuento) < 0 ||
        (montoPagado != null && (!Number.isFinite(Number(montoPagado)) || Number(montoPagado) < 0))) {
      return res.status(400).json({ error: "El descuento y el monto pagado deben ser números no negativos." });
    }
    const { rows: tipos } = await query(
      `SELECT descripcion FROM tipo_comprobante WHERE comprobante_id = $1`, [comprobanteId || 1]
    );
    if (!tipos[0]) return res.status(400).json({ error: "Comprobante no válido." });
    const esFactura = tipos[0].descripcion.toLowerCase() === "factura";
    if (esFactura && (typeof ruc !== "string" || !/^\d{11}$/.test(ruc) ||
        typeof razonSocial !== "string" || !razonSocial.trim() || razonSocial.trim().length > 100)) {
      return res.status(400).json({ error: "Para factura, ingresa un RUC de 11 dígitos y una razón social de hasta 100 caracteres." });
    }
    // Se mantiene compatibilidad con solicitudes que ya incluyen un cliente.
    let tipoCliente = "PERSONA";
    if (clienteId !== null) {
      if (!Number.isInteger(clienteId) || clienteId <= 0) {
        return res.status(400).json({ error: "Cliente no válido." });
      }
      const { rows: clientes } = await query(`SELECT tipo_cliente FROM cliente WHERE cliente_id = $1`, [clienteId]);
      if (!clientes[0]) return res.status(404).json({ error: "Cliente no encontrado." });
      tipoCliente = clientes[0].tipo_cliente;
    }

    const { rows: productosDB } = await query(
      `SELECT * FROM producto WHERE producto_id = ANY($1)`,
      [items.map((i) => i.producto_id)]
    );

    if (items.some((i) => !productosDB.some((p) => p.producto_id === i.producto_id))) {
      return res.status(400).json({ error: "Uno de los productos no existe." });
    }
    const itemsConPrecio = items.map((item) => {
      const prod = productosDB.find((p) => p.producto_id === item.producto_id);
      if (!prod) throw errorHttp(400, `Producto ${item.producto_id} no encontrado.`);
      return { ...prod, cantidad: item.cantidad };
    });

    const { rows: vendedores } = await query(
      `SELECT ev.empleado_id FROM e_venta ev JOIN empleado e ON e.empleado_id = ev.empleado_id WHERE e.usuario_id = $1`, [req.usuario.id]
    );
    const eVentaId = vendedores[0]?.empleado_id || null;
    validarDinero(descuento, "descuento");
    if (montoPagado != null) validarDinero(montoPagado, "monto pagado");
    const resumen = calcularResumenVenta(itemsConPrecio, tipoCliente);
    const codigoOrden = generarCodigoOrden();

    if (Number(descuento) > resumen.totalAPagar) throw errorHttp(400, "El descuento no puede superar el total.");
    const totalConDescuento = Math.round((resumen.totalAPagar - Number(descuento)) * 100) / 100;
    if (montoPagado != null && Number(montoPagado) > totalConDescuento) throw errorHttp(400, "El monto pagado no puede superar el total de la venta.");
    const saldoPendiente = Math.round((totalConDescuento - Number(montoPagado ?? totalConDescuento)) * 100) / 100;

    await conTransaccion(async (client) => {
      const { rows: estadoRows } = await client.query(
        `SELECT estado_id FROM estado_pedido WHERE descripcion = 'Entregado'`
      );
      const estadoId = estadoRows[0]?.estado_id;

      const { rows: pedidoRows } = await client.query(
        `INSERT INTO pedido (codigo_orden, cliente_id, estado_id, e_venta_id, dni_presencial, ruc_presencial, razon_social_presencial)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING pedido_id`,
        [codigoOrden, clienteId, estadoId, eVentaId || null, dniVenta, esFactura ? ruc : null, esFactura ? razonSocial.trim() : null]
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
        [ventaId, metodoPagoId, montoPagado ?? totalConDescuento]
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
    res.status(error.status || 500).json({ error: error.message || "Error al registrar la venta." });
  }
});

app.post("/api/ventas/:ventaId/pago-parcial", requiereRol("empleado"), async (req, res) => {
  try {
    const { metodoPagoId, monto, numeroOperacion } = req.body;
    validarDinero(monto, "abono", false);
    if (!Number.isInteger(metodoPagoId) || metodoPagoId <= 0) throw errorHttp(400, "Selecciona un método de pago.");
    const ventaId = Number(req.params.ventaId);
    if (!Number.isInteger(ventaId) || ventaId <= 0) throw errorHttp(400, "Venta no válida.");
    const nuevoSaldo = await conTransaccion(async (client) => {
      const { rows: pedidos } = await client.query(
        `SELECT p.pedido_id, ep.descripcion AS estado FROM pedido p
         JOIN estado_pedido ep ON ep.estado_id = p.estado_id
         WHERE p.pedido_id = (SELECT pedido_id FROM venta WHERE venta_id = $1) FOR UPDATE OF p`, [ventaId]
      );
      if (!pedidos[0]) throw errorHttp(404, "Venta no encontrada.");
      if (pedidos[0].estado === "Cancelado") throw errorHttp(409, "No puedes cobrar un pedido cancelado.");
      const { rows } = await client.query(`SELECT * FROM venta WHERE venta_id = $1 FOR UPDATE`, [ventaId]);
      const venta = rows[0];
      const saldoCentimos = Math.round(Number(venta.saldo_pendiente) * 100);
      const abonoCentimos = Math.round(Number(monto) * 100);
      if (abonoCentimos > saldoCentimos) throw errorHttp(400, "El abono supera el saldo pendiente.");
      await client.query(
        `INSERT INTO detalle_pago (venta_id, metodo_pago_id, monto_pagado, numero_operacion_transferencia) VALUES ($1,$2,$3,$4)`,
        [ventaId, metodoPagoId, monto, numeroOperacion || null]
      );
      const saldo = (saldoCentimos - abonoCentimos) / 100;
      await client.query(`UPDATE venta SET saldo_pendiente = $1 WHERE venta_id = $2`, [saldo, ventaId]);
      if (saldo === 0 && pedidos[0].estado === "Venta Registrada") {
        await client.query(`UPDATE pedido SET estado_id = (SELECT estado_id FROM estado_pedido WHERE descripcion = 'Pago Confirmado') WHERE pedido_id = $1`, [pedidos[0].pedido_id]);
      }
      return saldo;
    });
    res.json({ mensaje: "Pago registrado", saldoPendiente: nuevoSaldo });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "Error al registrar el pago." });
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
             CASE WHEN p.cliente_id IS NULL THEN COALESCE(p.razon_social_presencial, 'Cliente presencial')
               WHEN c.tipo_cliente = 'PERSONA'
               THEN pe.nombres || ' ' || pe.apellidos
               ELSE em.razon_social
             END AS cliente_nombre,
             c.tipo_cliente, c.telefono,
             d.direccion_entrega,
             ev.empleado_id AS e_venta_id,
             emp.nombres || ' ' || emp.apellidos AS vendedor
      FROM pedido p
      LEFT JOIN cliente c ON c.cliente_id = p.cliente_id
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
    if (!Number.isInteger(estadoId)) throw errorHttp(400, "Estado no válido.");
    await conTransaccion(async (client) => {
      const { rows } = await client.query(
        `SELECT p.*, ep.descripcion AS estado FROM pedido p JOIN estado_pedido ep ON ep.estado_id = p.estado_id WHERE p.codigo_orden = $1 FOR UPDATE OF p`, [req.params.codigo]
      );
      const pedido = rows[0];
      if (!pedido) throw errorHttp(404, "Pedido no encontrado.");
      const { rows: estados } = await client.query(`SELECT descripcion FROM estado_pedido WHERE estado_id = $1`, [estadoId]);
      const destino = estados[0]?.descripcion;
      if (!destino) throw errorHttp(400, "Estado no válido.");
      if (pedido.estado === destino) return;
      if (["Cancelado", "Entregado"].includes(pedido.estado)) throw errorHttp(409, "Un pedido finalizado no puede cambiar de estado.");
      const { rows: ventas } = await client.query(`SELECT * FROM venta WHERE pedido_id = $1 FOR UPDATE`, [pedido.pedido_id]);
      const venta = ventas[0];
      if (!venta) throw errorHttp(409, "El pedido no tiene una venta asociada.");
      if (destino === "Cancelado") {
        const { rows: pagos } = await client.query(`SELECT COALESCE(SUM(monto_pagado),0) AS cobrado FROM detalle_pago WHERE venta_id = $1`, [venta.venta_id]);
        if (Number(pagos[0].cobrado) > 0) throw errorHttp(409, "El pedido tiene cobros. Requiere gestionar su devolución antes de anularlo.");
        const { rows: lotes } = await client.query(`SELECT lote_id, SUM(cantidad)::int AS cantidad FROM detalle_pedido WHERE pedido_id = $1 GROUP BY lote_id ORDER BY lote_id`, [pedido.pedido_id]);
        for (const lote of lotes) {
          await client.query(`UPDATE produccion_lotes SET unidades_disponibles = unidades_disponibles + $1 WHERE lote_id = $2`, [lote.cantidad, lote.lote_id]);
        }
        await client.query(`DELETE FROM control_bidones WHERE pedido_id = $1`, [pedido.pedido_id]);
        await client.query(`UPDATE venta SET estado = 'Cancelado', saldo_pendiente = 0 WHERE pedido_id = $1`, [pedido.pedido_id]);
      } else {
        const permitidos = { "Venta Registrada": ["Pago Confirmado", "Entregado"], "Pago Confirmado": ["Entregado"] };
        if (!permitidos[pedido.estado]?.includes(destino)) throw errorHttp(409, "Ese cambio de estado no está permitido.");
        if (Number(venta.saldo_pendiente) > 0) throw errorHttp(409, "Registra el cobro pendiente antes de confirmar el pago o entregar el pedido.");
        if (destino === "Entregado" && pedido.delivery_id) {
          const { rows: entregas } = await client.query(`SELECT transporte_id, hora_salida FROM delivery WHERE delivery_id = $1 FOR UPDATE`, [pedido.delivery_id]);
          if (!entregas[0]?.transporte_id || !entregas[0]?.hora_salida) throw errorHttp(409, "Asigna transporte y registra la salida en Entregas antes de finalizar el pedido.");
          await client.query(`UPDATE delivery SET hora_entrega = COALESCE(hora_entrega, CURRENT_TIME) WHERE delivery_id = $1`, [pedido.delivery_id]);
        }
      }
      await client.query(`UPDATE pedido SET estado_id = $1 WHERE pedido_id = $2`, [estadoId, pedido.pedido_id]);
    });
    res.json({ mensaje: "Estado actualizado", orden: req.params.codigo });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "Error al actualizar el estado." });
  }
});
app.get("/api/pedidos/buscar/:dato", requiereRol("empleado"), async (req, res) => {
  try {
    const dato = req.params.dato;
    const { rows } = await query(`
      SELECT p.codigo_orden, p.fecha_pedido, p.estado_id,
             ep.descripcion AS estado,
             v.venta_id, v.total_pago, v.saldo_pendiente, v.descuento_aplicado,
             CASE WHEN p.cliente_id IS NULL THEN COALESCE(p.razon_social_presencial, 'Cliente presencial')
               WHEN c.tipo_cliente = 'PERSONA'
               THEN pe.nombres || ' ' || pe.apellidos
               ELSE em.razon_social
             END AS cliente_nombre,
             c.telefono
      FROM pedido p
      LEFT JOIN cliente c ON c.cliente_id = p.cliente_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      WHERE c.telefono = $1 OR pe.dni = $1 OR em.ruc = $1
         OR p.dni_presencial = $1 OR p.ruc_presencial = $1 OR p.codigo_orden = $1
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
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      WHERE ep.descripcion <> 'Cancelado'
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

    if (!Number.isInteger(productoId) || !Number.isInteger(unidadesProducidas) || unidadesProducidas <= 0 ||
        !Number.isInteger(unidadesDefectuosas) || unidadesDefectuosas < 0 || unidadesDefectuosas > unidadesProducidas ||
        !/^\d{4}-\d{2}-\d{2}$/.test(fechaProduccion || "") || !/^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento || "") || fechaVencimiento <= fechaProduccion) {
      throw errorHttp(400, "Revisa las cantidades y las fechas: los defectuosos no pueden superar lo producido y el vencimiento debe ser posterior a la producción.");
    }
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
    res.status(error.status || 500).json({ error: error.status ? error.message : "Error al crear lote. Revisa el producto y las fechas." });
  }
});

app.patch("/api/lotes/:id", requiereRol("empleado"), async (req, res) => {
  try {
    const { unidadesDisponibles, estado, fechaVencimiento } = req.body;
    if (unidadesDisponibles != null && (!Number.isInteger(unidadesDisponibles) || unidadesDisponibles < 0)) throw errorHttp(400, "Las unidades disponibles deben ser un entero no negativo.");
    if (estado != null && !["Disponible", "Agotado", "Dañado / no vendible", "Retirado"].includes(estado)) throw errorHttp(400, "Estado de lote no válido.");
    const { rows } = await query(
      `UPDATE produccion_lotes
       SET unidades_disponibles = COALESCE($1, unidades_disponibles),
           estado = COALESCE($2, estado),
           fecha_vencimiento = COALESCE($3, fecha_vencimiento)
       WHERE lote_id = $4
         AND COALESCE($1, unidades_disponibles) <= unidades_netas
         AND COALESCE($3, fecha_vencimiento) > fecha_produccion
       RETURNING *`,
      [unidadesDisponibles, estado, fechaVencimiento, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Lote no encontrado o cantidades/fechas fuera del rango permitido." });
    res.json(rows[0]);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "Error al actualizar el lote." });
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
      LEFT JOIN tipo_transporte tt ON tt.tipo_id = t.tipo_id
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
             CASE WHEN p.nombre_contacto IS NOT NULL THEN p.nombre_contacto
               WHEN c.tipo_cliente = 'PERSONA'
               THEN pe.nombres || ' ' || pe.apellidos
               ELSE em.razon_social
             END AS cliente_nombre,
             COALESCE(p.telefono_contacto, c.telefono) AS telefono
      FROM delivery d
      JOIN ubigeo ub ON ub.ubigeo_id = d.ubigeo_id
      LEFT JOIN transporte t ON t.transporte_id = d.transporte_id
      LEFT JOIN tipo_transporte tt ON tt.tipo_id = t.tipo_id
      LEFT JOIN pedido p ON p.delivery_id = d.delivery_id
      LEFT JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      LEFT JOIN cliente c ON c.cliente_id = p.cliente_id
      LEFT JOIN persona pe ON pe.cliente_id = c.cliente_id
      LEFT JOIN empresa em ON em.cliente_id = c.cliente_id
      WHERE ep.descripcion <> 'Cancelado'
      ORDER BY ub.distrito, d.fecha DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener deliveries." });
  }
});

app.patch("/api/deliveries/:id", requiereRol("empleado"), async (req, res) => {
  try {
    const { horaSalida, horaEntrega, transporteId } = req.body;
    for (const hora of [horaSalida, horaEntrega]) {
      if (hora != null && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(hora)) throw errorHttp(400, "Hora no válida.");
    }
    await conTransaccion(async (client) => {
      const { rows: pedidos } = await client.query(`SELECT p.*, ep.descripcion AS estado FROM pedido p JOIN estado_pedido ep ON ep.estado_id = p.estado_id WHERE p.delivery_id = $1 FOR UPDATE OF p`, [req.params.id]);
      const pedido = pedidos[0];
      if (!pedido) throw errorHttp(404, "Pedido de delivery no encontrado.");
      if (pedido.estado === "Cancelado") throw errorHttp(409, "El pedido está cancelado.");
      const { rows } = await client.query(`SELECT * FROM delivery WHERE delivery_id = $1 FOR UPDATE`, [req.params.id]);
      const delivery = rows[0];
      const transporte = transporteId === undefined ? delivery.transporte_id : transporteId;
      if (transporte != null) {
        if (!Number.isInteger(transporte) || transporte <= 0) throw errorHttp(400, "Transporte no válido.");
        const { rows: vehiculos } = await client.query(`SELECT t.transporte_id FROM transporte t JOIN estado_transporte et ON et.estado_transporte_id = t.estado_transporte_id WHERE t.transporte_id = $1 AND et.descripcion = 'Operativo'`, [transporte]);
        if (!vehiculos[0]) throw errorHttp(400, "Selecciona un transporte operativo.");
      }
      const salida = horaSalida === undefined ? delivery.hora_salida : horaSalida;
      const entrega = horaEntrega === undefined ? delivery.hora_entrega : horaEntrega;
      if ((salida || entrega) && !transporte) throw errorHttp(400, "Asigna un transporte antes de registrar la salida o entrega.");
      if (entrega && !salida) throw errorHttp(400, "Registra primero la hora de salida.");
      if (pedido.estado === "Entregado" && !entrega) throw errorHttp(409, "No se puede borrar la entrega de un pedido finalizado.");
      if (entrega) {
        const { rows: ventas } = await client.query(`SELECT saldo_pendiente FROM venta WHERE pedido_id = $1 FOR UPDATE`, [pedido.pedido_id]);
        if (!ventas[0] || Number(ventas[0].saldo_pendiente) > 0) throw errorHttp(409, "Registra el cobro pendiente antes de confirmar la entrega.");
        await client.query(`UPDATE pedido SET estado_id = (SELECT estado_id FROM estado_pedido WHERE descripcion = 'Entregado') WHERE pedido_id = $1`, [pedido.pedido_id]);
      }
      await client.query(`UPDATE delivery SET transporte_id = $1, hora_salida = $2, hora_entrega = $3 WHERE delivery_id = $4`, [transporte, salida, entrega, req.params.id]);
    });
    res.json({ mensaje: "Delivery actualizado." });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "Error al actualizar delivery." });
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
             u.id AS usuario_id, u.usuario, u.email, u.es_admin_principal
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

    if (![nombres, apellidos, usuario, email, telefono].every(v => typeof v === "string" && v.trim()) ||
        typeof pass !== "string" || pass.length < 6 || !/^\d{8}$/.test(dni || "") || !["M", "F"].includes(sexo) ||
        !["VENTA", "PRODUCCION", "ENTREGA"].includes(tipoEmpleado) || !Number.isInteger(tipoContratoId) || !Number.isInteger(ubigeoId) || !fechaContratacion) {
      throw errorHttp(400, "Completa los datos del empleado, DNI de 8 dígitos y contraseña de al menos 6 caracteres.");
    }
    if (tipoEmpleado === "PRODUCCION" && (!carnetSanidad || !fechaVencimientoCarnet)) throw errorHttp(400, "Completa el carnet de sanidad y su vencimiento.");
    if (tipoEmpleado === "ENTREGA" && (!numeroLicencia || !fechaVencimientoLicencia)) throw errorHttp(400, "Completa la licencia y su vencimiento.");
    const passHash = await bcrypt.hash(pass, 10);

    await conTransaccion(async (client) => {
      const { rows: usuRows } = await client.query(
        `INSERT INTO usuarios (nombre, usuario, pass_hash, rol, email, email_verificado)
         VALUES ($1,$2,$3,'empleado',$4, TRUE) RETURNING id`,
        [`${nombres} ${apellidos}`, usuario, passHash, email]
      );
      const usuarioId = usuRows[0].id;

      const { rows: empRows } = await client.query(
        `INSERT INTO empleado (nombres, apellidos, telefono_empleado, sexo, dni, fecha_contratacion,
           tipo_empleado, tipo_contrato_id, ubigeo_id, estado_empleado_id, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING empleado_id`,
        [nombres, apellidos, telefono, sexo, dni, fechaContratacion,
          tipoEmpleado, tipoContratoId, ubigeoId, estadoEmpleadoId || 1, usuarioId]
      );
      const empleadoId = empRows[0].empleado_id;

      if (tipoEmpleado === "VENTA") {
        await client.query(
          `INSERT INTO e_venta (empleado_id, telefono_corporativo) VALUES ($1,$2)`,
          [empleadoId, telefonoCorporativo || null]
        );
      } else if (tipoEmpleado === "PRODUCCION") {
        await client.query(
          `INSERT INTO e_produccion (empleado_id, carnet_sanidad, fecha_vencimiento_carnet, talla_vestimenta)
           VALUES ($1,$2,$3,$4)`,
          [empleadoId, carnetSanidad, fechaVencimientoCarnet, tallaVestimenta || null]
        );
      } else if (tipoEmpleado === "ENTREGA") {
        await client.query(
          `INSERT INTO e_entrega (empleado_id, numero_licencia_conducir, fecha_vencimiento_licencia)
           VALUES ($1,$2,$3)`,
          [empleadoId, numeroLicencia, fechaVencimientoLicencia]
        );
      }
    });

    res.status(201).json({ mensaje: "Empleado creado correctamente." });
  } catch (error) {
    console.error("Error crear empleado:", error);
    res.status(error.status || (error.code === "23505" ? 409 : 500)).json({ error: error.status ? error.message : error.code === "23505" ? "Ya existe el usuario, correo o DNI ingresado." : "Error al crear el empleado. Ningún dato quedó guardado, revisa los campos." });
  }
});

app.delete("/api/empleados/:id", requiereAdminPrincipal, async (req, res) => {
  try {
    await conTransaccion(async (client) => {
      const { rows } = await client.query(`SELECT e.usuario_id, u.es_admin_principal FROM empleado e JOIN usuarios u ON u.id = e.usuario_id WHERE e.empleado_id = $1 FOR UPDATE OF e, u`, [req.params.id]);
      const empleado = rows[0];
      if (!empleado) throw errorHttp(404, "Empleado sin cuenta de acceso o no encontrado.");
      if (empleado.usuario_id === req.usuario.id || empleado.es_admin_principal) throw errorHttp(400, "No puedes eliminar tu cuenta ni la del administrador principal.");
      await client.query(`UPDATE empleado SET estado_empleado_id = (SELECT estado_empleado_id FROM estado_empleado WHERE descripcion = 'Inactivo') WHERE empleado_id = $1`, [req.params.id]);
      await client.query(`DELETE FROM usuarios WHERE id = $1`, [empleado.usuario_id]);
    });
    res.json({ mensaje: "Cuenta eliminada. Se conserva el historial del empleado." });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "Error al eliminar la cuenta." });
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
      await enviarCorreoNuevaPassAsignada(empleado.email, empleado.nombre, passTemporal).catch((err) => console.error("No se pudo enviar la contraseña por correo:", err.message));
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
      SELECT ub.ubigeo_id, COALESCE(ub.distrito, 'Venta sin zona registrada') AS distrito,
             COALESCE(ub.provincia, '') AS provincia,
             COUNT(p.pedido_id) AS total_pedidos,
             COALESCE(SUM(v.total_pago), 0) AS total_ingresos
      FROM pedido p
      JOIN estado_pedido ep ON ep.estado_id = p.estado_id
      LEFT JOIN cliente c ON c.cliente_id = p.cliente_id
      LEFT JOIN delivery d ON d.delivery_id = p.delivery_id
      LEFT JOIN ubigeo ub ON ub.ubigeo_id = COALESCE(d.ubigeo_id, c.ubigeo_id)
      LEFT JOIN venta v ON v.pedido_id = p.pedido_id
      WHERE ep.descripcion <> 'Cancelado'
      GROUP BY ub.ubigeo_id, ub.distrito, ub.provincia
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
