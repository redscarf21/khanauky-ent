const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM_NAME = "Industria Khanauky";
const EMAIL_FROM_ADDRESS = process.env.GMAIL_USER;

async function enviar(destinatario, subject, htmlContent) {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM_ADDRESS },
        to: [{ email: destinatario }],
        subject,
        htmlContent
      })
    });
    if (!res.ok) {
      const err = await res.json();
      console.error("Error Brevo:", err);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error enviando correo:", error);
    return false;
  }
}

function plantillaBase(titulo, contenidoHtml) {
  return `
  <div style="font-family: Arial, sans-serif; background-color: #F7FAFA; padding: 30px 0;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #0B3D5C; padding: 28px 30px; text-align: center;">
        <h1 style="color: #ffffff; font-size: 20px; margin: 0;">INDUSTRIA KHANAUKY</h1>
        <p style="color: #5FBFD9; font-size: 12px; margin: 4px 0 0;">AQUAELIS · AGUA PURIFICADA</p>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #0E2433; font-size: 18px; margin-top: 0;">${titulo}</h2>
        ${contenidoHtml}
      </div>
      <div style="background-color: #F7FAFA; padding: 16px 30px; text-align: center; font-size: 12px; color: #6b7c87;">
        Industria Khanauky · Chao, Virú, La Libertad
      </div>
    </div>
  </div>`;
}

export async function enviarCorreoVerificacion(destinatario, nombre, token) {
  const link = `${SITE_URL}/verificar-email.html?token=${token}`;
  const html = plantillaBase(
    `¡Hola, ${nombre}!`,
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Gracias por crear tu cuenta en Industria Khanauky. Para activar tu acceso,
        confirma tu correo haciendo clic en el siguiente botón:
     </p>
     <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background-color:#1C7C9C; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-weight:600; font-size:14px;">Confirmar mi correo</a>
     </p>
     <p style="color:#8a96a0; font-size:12px;">Si el botón no funciona, copia este enlace:<br>${link}</p>`
  );
  return enviar(destinatario, "Confirma tu cuenta — Industria Khanauky", html);
}

export async function enviarCorreoRecuperacion(destinatario, nombre, token) {
  const link = `${SITE_URL}/restablecer-password.html?token=${token}`;
  const html = plantillaBase(
    "Recupera tu contraseña",
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Hola ${nombre}, recibimos una solicitud para restablecer tu contraseña.
        Este enlace caduca en 30 minutos.
     </p>
     <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background-color:#E8902E; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-weight:600; font-size:14px;">Restablecer contraseña</a>
     </p>
     <p style="color:#8a96a0; font-size:12px;">Si no solicitaste esto, ignora este correo.</p>`
  );
  return enviar(destinatario, "Restablece tu contraseña — Industria Khanauky", html);
}

export async function enviarCorreoPedidoConfirmado(destinatario, nombre, codigoOrden, totalAPagar) {
  const html = plantillaBase(
    "¡Tu pedido fue registrado!",
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Hola ${nombre}, confirmamos tu pedido <strong>${codigoOrden}</strong>
        por un total de <strong>S/ ${totalAPagar.toFixed(2)}</strong>.
        Nuestro equipo se pondrá en contacto para coordinar la entrega.
     </p>`
  );
  return enviar(destinatario, `Pedido ${codigoOrden} registrado — Industria Khanauky`, html);
}

export async function enviarCorreoNuevaPassAsignada(destinatario, nombre, passTemporal) {
  const link = `${SITE_URL}/login.html`;
  const html = plantillaBase(
    "Se actualizó tu contraseña",
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Hola ${nombre}, el administrador asignó una nueva contraseña temporal:
     </p>
     <p style="text-align:center; margin: 20px 0; font-size:18px; font-weight:700; color:#0B3D5C;">${passTemporal}</p>
     <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background-color:#1C7C9C; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-weight:600; font-size:14px;">Ir a iniciar sesión</a>
     </p>`
  );
  return enviar(destinatario, "Tu contraseña fue actualizada — Industria Khanauky", html);
}