const IGV = 0.18;
const MONTO_MINIMO_DELIVERY = 24;

export function calcularPrecioUnitario(producto, tipoCliente) {
  return tipoCliente === "EMPRESA"
    ? Number(producto.precio_mayorista)
    : Number(producto.precio_minorista);
}

export function calcularResumenVenta(items, tipoCliente = "PERSONA") {
  let subtotal = 0;

  const detalle = items.map((item) => {
    const precioUnit = calcularPrecioUnitario(item, tipoCliente);
    const subTotal = Math.round(precioUnit * item.cantidad * 100) / 100;
    subtotal += subTotal;
    return {
      producto_id: item.producto_id,
      lote_id: item.lote_id || null,
      nombre: item.nombre_producto,
      cantidad: item.cantidad,
      precioUnitario: precioUnit,
      subTotal,
      imagen: item.imagen || null
    };
  });

  const totalAPagar = Math.round(subtotal * 100) / 100;
  const baseImponible = Math.round((totalAPagar / (1 + IGV)) * 100) / 100;
  const igv = Math.round((totalAPagar - baseImponible) * 100) / 100;
  const modalidadSugerida = totalAPagar < MONTO_MINIMO_DELIVERY ? "recojo" : "delivery";

  return {
    detalle,
    baseImponible,
    igv,
    totalAPagar,
    modalidadSugerida,
    montoMinimoDelivery: MONTO_MINIMO_DELIVERY
  };
}