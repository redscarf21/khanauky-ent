const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;

function llaveEsValida(llave) {
  return typeof llave === "string" && llave.length > 20 && !llave.includes("aqui");
}

export async function verificarRecaptcha(tokenRespuesta) {
  if (!llaveEsValida(RECAPTCHA_SECRET)) {
    console.warn("RECAPTCHA_SECRET_KEY no configurada: se omite verificación (modo desarrollo).");
    return true;
  }

  if (!tokenRespuesta) return false;

  try {
    const params = new URLSearchParams({
      secret: RECAPTCHA_SECRET,
      response: tokenRespuesta
    });

    const respuesta = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    const data = await respuesta.json();
    return data.success === true;
  } catch (error) {
    console.error("Error verificando reCAPTCHA:", error);
    return false;
  }
}
