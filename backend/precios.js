const IGV = 0.18;
const MONTO_MINIMO_DELIVERY = 24;

export function calcularSubtotal(idProducto, cantidad) {
  if (!Number.isInteger(cantidad) || cantidad <= 0) return 0;

  let precio = 0;
  let packs, sueltas, tarifa;

  switch (idProducto) {
    case 1:
      packs = Math.floor(cantidad / 15);
      sueltas = cantidad % 15;
      precio = packs * 8 + sueltas * 1;
      break;

    case 2:
      precio = cantidad * 5;
      break;

    case 3:
      tarifa = cantidad < 3 ? 9 : cantidad <= 21 ? 6 : 5.5;
      precio = cantidad * tarifa;
      break;

    case 4:
      packs = Math.floor(cantidad / 6);
      sueltas = cantidad % 6;
      precio = packs * 20;
      if (sueltas > 0) precio += sueltas * (sueltas >= 3 ? 4 : 5);
      break;

    case 5:
      packs = Math.floor(cantidad / 3);
      sueltas = cantidad % 3;
      precio = packs * 20;
      if (sueltas > 0) precio += sueltas * 7;
      break;

    default:
      precio = 0;
  }

  return Math.round(precio * 100) / 100;
}

export function precioBaseUnitario(idProducto) {
  switch (idProducto) {
    case 1: return 1.00;
    case 2: return 5.00;
    case 3: return 9.00;
    case 4: return 5.00;
    case 5: return 7.00;
    default: return 0;
  }
}

export function calcularResumenVenta(items) {
  let subtotalConDescuento = 0;
  let descuentoTotal = 0;

  const detalle = items.map((item) => {
    const subtotal = calcularSubtotal(item.id, item.cantidad);
    const base = precioBaseUnitario(item.id) * item.cantidad;
    const descuento = Math.max(0, Math.round((base - subtotal) * 100) / 100);

    subtotalConDescuento += subtotal;
    descuentoTotal += descuento;

    return {
      id: item.id,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precioUnitarioBase: precioBaseUnitario(item.id),
      subtotal,
      descuento
    };
  });

  const totalAPagar = Math.round(subtotalConDescuento * 100) / 100;
  const baseImponible = Math.round((totalAPagar / (1 + IGV)) * 100) / 100;
  const igv = Math.round((totalAPagar - baseImponible) * 100) / 100;

  // Pedidos pequeños van a recojo en tienda; desde S/24 ya califican para delivery
  const modalidadSugerida = totalAPagar < MONTO_MINIMO_DELIVERY ? "recojo" : "delivery";

  return {
    detalle,
    descuentoTotal: Math.round(descuentoTotal * 100) / 100,
    baseImponible,
    igv,
    totalAPagar,
    modalidadSugerida,
    montoMinimoDelivery: MONTO_MINIMO_DELIVERY
  };
}
