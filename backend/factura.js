import PDFDocument from "pdfkit";

const RUC_EMPRESA = "20123456789";
const RAZON_SOCIAL_EMPRESA = "INDUSTRIA KHANAUKY E.I.R.L.";

const UNIDADES = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const DECENAS = ["", "DIEZ", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const ESPECIALES = ["ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
const VEINTES = ["VEINTIUN", "VEINTIDOS", "VEINTITRES", "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function convertirEntero(numero) {
  let letras = "";

  if (numero >= 1000) {
    const miles = Math.floor(numero / 1000);
    letras += miles === 1 ? "MIL " : convertirEntero(miles) + "MIL ";
    numero %= 1000;
  }

  if (numero >= 100) {
    if (numero === 100) {
      letras += "CIEN ";
      numero = 0;
    } else {
      letras += CENTENAS[Math.floor(numero / 100)] + " ";
      numero %= 100;
    }
  }

  if (numero >= 10 && numero <= 19) {
    letras += numero === 10 ? "DIEZ " : ESPECIALES[numero - 11] + " ";
    numero = 0;
  } else if (numero >= 20 && numero <= 29) {
    letras += numero === 20 ? "VEINTE " : VEINTES[numero - 21] + " ";
    numero = 0;
  } else if (numero >= 30) {
    letras += DECENAS[Math.floor(numero / 10)] + " ";
    numero %= 10;
    if (numero > 0) letras += "Y ";
  }

  if (numero > 0 && numero < 10) {
    letras += UNIDADES[numero] + " ";
  }

  return letras;
}

function numeroALetras(monto) {
  const entero = Math.trunc(monto);
  const decimales = Math.round((monto - entero) * 100);
  const res = entero === 0 ? "CERO " : convertirEntero(entero);
  return `${res}Y ${String(decimales).padStart(2, "0")}/100 SOLES`;
}

// La boleta mantiene el formato ticket térmico de toda la vida
function generarBoleta(doc, pedido) {
  const centerOpts = { width: 196, align: "center" };

  doc.font("Courier-Bold").fontSize(13).text("INDUSTRIA KHANAUKY", centerOpts);
  doc.moveDown(0.2);
  doc.font("Courier").fontSize(8).text(`RUC: ${RUC_EMPRESA}`, centerOpts);
  doc.text(`SUCURSAL: ${(pedido.sucursal || "Chao").toUpperCase()} - LA LIBERTAD`, centerOpts);
  doc.moveDown(0.3);
  doc.text("----------------------------------------", centerOpts);

  doc.font("Courier-Bold").fontSize(9).text("BOLETA DE VENTA ELECTRÓNICA", centerOpts);
  doc.text(`N° ${pedido.codigoOrden}`, centerOpts);
  doc.font("Courier").fontSize(8);
  doc.text("----------------------------------------", centerOpts);

  doc.moveDown(0.3);
  const fechaHora = pedido.creadoEn || new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
  doc.text(`Fecha  : ${fechaHora}`);
  doc.text(`Cliente: ${pedido.cliente}`);
  if (pedido.dni) doc.text(`DNI    : ${pedido.dni}`);
  doc.text(`Tel.   : ${pedido.telefono || "-"}`);
  doc.text("----------------------------------------", centerOpts);

  doc.moveDown(0.3);
  doc.font("Courier-Bold").text("DESCRIPCION");
  doc.font("Courier");

  (pedido.productos || []).forEach((item) => {
    const subtotal = Number(item.subtotal || 0);
    doc.text(item.nombre);
    doc.text(`  ${item.cantidad} x   S/ ${subtotal.toFixed(2)}`, { width: 196, align: "right" });
  });

  doc.text("----------------------------------------", centerOpts);

  const precio = pedido.precio || {};
  doc.moveDown(0.2);
  doc.text(`OP. GRAVADAS:        S/ ${Number(precio.baseImponible).toFixed(2)}`);
  if (precio.descuento) doc.text(`DESCUENTO:            S/ ${Number(precio.descuento).toFixed(2)}`);
  doc.text(`IGV (18%):            S/ ${Number(precio.igv).toFixed(2)}`);
  doc.font("Courier-Bold").text(`TOTAL A PAGAR:    S/ ${Number(precio.totalAPagar).toFixed(2)}`);

  doc.moveDown(0.4);
  doc.font("Courier").text(`PAGO: ${(pedido.metodopago || "EFECTIVO").toUpperCase()}`);
  doc.font("Courier-Bold").fontSize(7).text(`SON: ${numeroALetras(Number(precio.totalAPagar))}`, { width: 196 });

  doc.moveDown(0.6);
  doc.font("Courier").fontSize(8).text("¡Gracias por su compra!", centerOpts);
}

// La factura usa formato A4, con RUC y razón social del cliente
function generarFactura(doc, pedido) {
  const margenIzq = 50;
  const anchoUtil = 495;

  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0B3D5C").text(RAZON_SOCIAL_EMPRESA, margenIzq, 50);
  doc.font("Helvetica").fontSize(9).fillColor("#333333");
  doc.text(`RUC: ${RUC_EMPRESA}`);
  doc.text("Av. José Olaya Mz. F Lote 12, Urb. La Victoria, Chao, Virú, La Libertad");

  doc.rect(380, 50, 165, 60).stroke("#0B3D5C");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0B3D5C").text("FACTURA ELECTRÓNICA", 390, 60, { width: 145, align: "center" });
  doc.fontSize(13).text(pedido.codigoOrden, 390, 80, { width: 145, align: "center" });

  doc.moveDown(2);
  let y = 140;
  doc.moveTo(margenIzq, y).lineTo(margenIzq + anchoUtil, y).stroke("#cccccc");
  y += 12;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0B3D5C").text("DATOS DEL CLIENTE", margenIzq, y);
  y += 16;
  doc.font("Helvetica").fontSize(9).fillColor("#333333");
  doc.text(`Razón social: ${pedido.razonSocial || pedido.cliente}`, margenIzq, y); y += 14;
  doc.text(`RUC: ${pedido.ruc || "-"}`, margenIzq, y); y += 14;
  doc.text(`Dirección: ${pedido.direccion || "-"}`, margenIzq, y); y += 14;
  doc.text(`Teléfono: ${pedido.telefono || "-"}`, margenIzq, y); y += 14;
  const fechaHora = pedido.creadoEn || new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
  doc.text(`Fecha de emisión: ${fechaHora}`, margenIzq, y); y += 14;
  doc.text(`Sucursal: ${pedido.sucursal || "Chao"}`, margenIzq, y);

  y += 26;
  doc.moveTo(margenIzq, y).lineTo(margenIzq + anchoUtil, y).stroke("#cccccc");
  y += 14;

  doc.rect(margenIzq, y, anchoUtil, 22).fill("#0B3D5C");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
  doc.text("DESCRIPCIÓN", margenIzq + 10, y + 6);
  doc.text("CANT.", margenIzq + 290, y + 6, { width: 60, align: "right" });
  doc.text("P. UNIT.", margenIzq + 350, y + 6, { width: 60, align: "right" });
  doc.text("SUBTOTAL", margenIzq + 410, y + 6, { width: 75, align: "right" });
  y += 22;

  doc.font("Helvetica").fontSize(9).fillColor("#333333");
  (pedido.productos || []).forEach((item, idx) => {
    const alturaFila = 20;
    if (idx % 2 === 1) doc.rect(margenIzq, y, anchoUtil, alturaFila).fill("#F7FAFA");
    doc.fillColor("#333333");
    doc.text(item.nombre, margenIzq + 10, y + 5);
    doc.text(String(item.cantidad), margenIzq + 290, y + 5, { width: 60, align: "right" });
    doc.text(`S/ ${Number(item.precioUnitarioBase || 0).toFixed(2)}`, margenIzq + 350, y + 5, { width: 60, align: "right" });
    doc.text(`S/ ${Number(item.subtotal || 0).toFixed(2)}`, margenIzq + 410, y + 5, { width: 75, align: "right" });
    y += alturaFila;
  });

  y += 10;
  doc.moveTo(margenIzq + 280, y).lineTo(margenIzq + anchoUtil, y).stroke("#cccccc");
  y += 10;

  const precio = pedido.precio || {};
  const filaTotales = (etiqueta, valor, negrita = false) => {
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(negrita ? 11 : 9.5);
    doc.text(etiqueta, margenIzq + 280, y, { width: 130, align: "left" });
    doc.text(`S/ ${Number(valor).toFixed(2)}`, margenIzq + 410, y, { width: 75, align: "right" });
    y += negrita ? 20 : 16;
  };

  filaTotales("Operación gravada:", precio.baseImponible);
  if (precio.descuento) filaTotales("Descuento:", precio.descuento);
  filaTotales("IGV (18%):", precio.igv);
  doc.fillColor("#0B3D5C");
  filaTotales("TOTAL A PAGAR:", precio.totalAPagar, true);
  doc.fillColor("#333333");

  y += 10;
  doc.font("Helvetica-Oblique").fontSize(9).text(`Son: ${numeroALetras(Number(precio.totalAPagar))}`, margenIzq, y, { width: anchoUtil });
  y += 16;
  doc.text(`Forma de pago: ${(pedido.metodopago || "Efectivo").toUpperCase()}`, margenIzq, y);

  y += 40;
  doc.font("Helvetica").fontSize(8).fillColor("#888888");
  doc.text("Representación impresa de la Factura Electrónica. Gracias por su compra.", margenIzq, y, { width: anchoUtil, align: "center" });
}

export function generarComprobantePDF(res, pedido, tipoComprobante = "boleta") {
  const esFactura = tipoComprobante === "factura";
  const doc = esFactura
    ? new PDFDocument({ size: "A4", margin: 50 })
    : new PDFDocument({ size: [220, 600], margin: 12 });

  const nombreArchivo = `${esFactura ? "Factura" : "Boleta"}_${pedido.codigoOrden}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${nombreArchivo}"`);

  doc.pipe(res);

  if (esFactura) {
    generarFactura(doc, pedido);
  } else {
    generarBoleta(doc, pedido);
  }

  doc.end();
}
