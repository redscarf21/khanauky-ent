export function errorHttp(status, message) {
  return Object.assign(new Error(message), { status });
}

export function validarItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100 || items.some(i =>
    !i || !Number.isInteger(i.producto_id) || i.producto_id <= 0 ||
    !Number.isInteger(i.cantidad) || i.cantidad <= 0 || i.cantidad > 100000)) {
    throw errorHttp(400, "Agrega productos válidos con cantidades enteras mayores que cero.");
  }
}

export function validarDinero(valor, nombre, permiteCero = true) {
  const n = Number(valor);
  if (valor == null || typeof valor === "boolean" || String(valor).trim() === "" ||
      !Number.isFinite(n) || (permiteCero ? n < 0 : n <= 0) || n > 99999999.99 ||
      Math.abs(n * 100 - Math.round(n * 100)) > 0.000001) {
    throw errorHttp(400, `El ${nombre} debe ser un importe válido con hasta dos decimales.`);
  }
} 
