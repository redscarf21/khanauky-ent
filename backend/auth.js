import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "clave_de_desarrollo_no_usar_en_produccion";
const JWT_EXPIRA = "8h";

export function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, usuario: usuario.usuario, rol: usuario.rol, nombre: usuario.nombre, esAdminPrincipal: !!usuario.es_admin_principal },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRA }
  );
}

export function requiereSesion(req, res, next) {
  const token = req.cookies?.sesion;
  if (!token) return res.status(401).json({ error: "No has iniciado sesión." });

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Tu sesión expiró, inicia sesión nuevamente." });
  }
}

export function requiereRol(rolEsperado) {
  return (req, res, next) => {
    requiereSesion(req, res, () => {
      if (req.usuario.rol !== rolEsperado) {
        return res.status(403).json({ error: "No tienes permisos para acceder a este recurso." });
      }
      next();
    });
  };
}

export function requiereAdminPrincipal(req, res, next) {
  requiereRol("empleado")(req, res, () => {
    if (!req.usuario.esAdminPrincipal) {
      return res.status(403).json({ error: "Solo el administrador principal puede hacer esto." });
    }
    next();
  });
}
