import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool, iniciarBD } from "./db.js";

async function crearAdminPrincipal() {
  await iniciarBD();

  const nombre = process.argv[2];
  const usuario = process.argv[3];
  const email = process.argv[4];
  const pass = process.argv[5];

  if (!nombre || !usuario || !email || !pass) {
    console.log("Uso: node seed-admin.js \"Nombre Completo\" usuario correo@ejemplo.com contraseña");
    process.exit(1);
  }

  const { rows } = await pool.query("SELECT id FROM usuarios WHERE usuario = $1", [usuario]);
  if (rows.length > 0) {
    console.log("Ya existe un usuario con ese nombre de usuario.");
    process.exit(1);
  }

  const passHash = await bcrypt.hash(pass, 10);
  await pool.query(
    `INSERT INTO usuarios (nombre, usuario, pass_hash, email, rol, email_verificado, es_admin_principal)
     VALUES ($1,$2,$3,$4,'empleado', TRUE, TRUE)`,
    [nombre, usuario, passHash, email]
  );

  console.log(`Administrador principal "${nombre}" creado correctamente.`);
  process.exit(0);
}

crearAdminPrincipal();
