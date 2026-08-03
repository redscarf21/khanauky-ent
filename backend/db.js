import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function iniciarBD() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("Base de datos PostgreSQL lista.");
}

export async function query(texto, valores) {
  return pool.query(texto, valores);
}

// Ejecuta varias queries como una sola transacción atómica: si algo falla
// a la mitad, se revierte todo (ROLLBACK). Úsalo para cualquier operación
// que escriba en más de una tabla relacionada (ej. registrar una venta).
export async function conTransaccion(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await callback(client);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function generarCodigoOrden() {
  const letras = "BCDFGHJKLMNPQRSTVWXYZ";
  const l1 = letras[Math.floor(Math.random() * letras.length)];
  const l2 = letras[Math.floor(Math.random() * letras.length)];
  const numero = Math.floor(100000 + Math.random() * 900000);
  return `${l1}${l2}-${numero}`;
}