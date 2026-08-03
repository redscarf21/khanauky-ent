export async function asignarLotesFEFO(client, productoId, nombreProducto, cantidadNecesaria) {
  const { rows: lotes } = await client.query(
    `SELECT lote_id, unidades_disponibles
     FROM produccion_lotes
     WHERE producto_id = $1
       AND estado = 'Disponible'
       AND fecha_vencimiento >= CURRENT_DATE
       AND unidades_disponibles > 0
     ORDER BY fecha_vencimiento ASC
     FOR UPDATE`,
    [productoId]
  );

  const asignaciones = [];
  let restante = cantidadNecesaria;

  for (const lote of lotes) {
    if (restante <= 0) break;
    const tomar = Math.min(restante, lote.unidades_disponibles);
    asignaciones.push({ lote_id: lote.lote_id, cantidad: tomar });
    restante -= tomar;
  }

  if (restante > 0) {
    throw new Error(
      `Stock insuficiente para ${nombreProducto}. Faltan ${restante} unidad(es) disponibles.`
    );
  }

  for (const asignacion of asignaciones) {
    await client.query(
      `UPDATE produccion_lotes SET unidades_disponibles = unidades_disponibles - $1 WHERE lote_id = $2`,
      [asignacion.cantidad, asignacion.lote_id]
    );
  }

  return asignaciones;
}
