import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || "Industria Khanauky <onboarding@resend.dev>";
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";

function plantillaBase(titulo, contenidoHtml) {
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; background-color: #F7FAFA; padding: 30px 0;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 14px rgba(11,61,92,0.08);">
      <div style="background-color: #0B3D5C; padding: 28px 30px; text-align: center;">
        <h1 style="color: #ffffff; font-size: 20px; margin: 0; letter-spacing: 0.5px;">INDUSTRIA KHANAUKY</h1>
        <p style="color: #5FBFD9; font-size: 12px; margin: 4px 0 0; letter-spacing: 1px;">AQUAELIS · AGUA PURIFICADA</p>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #0E2433; font-size: 18px; margin-top: 0;">${titulo}</h2>
        ${contenidoHtml}
      </div>
      <div style="background-color: #F7FAFA; padding: 16px 30px; text-align: center; font-size: 12px; color: #6b7c87;">
        Industria Khanauky · Chao, Virú, La Libertad · administracion@khanauky.com
      </div>
    </div>
  </div>`;
}

export async function enviarCorreoVerificacion(destinatario, nombre, token) {
  const link = `${SITE_URL}/verificar-email.html?token=${token}`;
  const html = plantillaBase(
    `¡Hola, ${nombre}!`,
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Gracias por crear tu cuenta en Industria Khanauky. Para activar tu acceso y comenzar a hacer pedidos,
        confirma tu correo electrónico haciendo clic en el siguiente botón:
     </p>
     <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background-color:#1C7C9C; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-weight:600; font-size:14px;">Confirmar mi correo</a>
     </p>
     <p style="color:#8a96a0; font-size:12px;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${link}</p>`
  );

  try {
    await resend.emails.send({ from: EMAIL_FROM, to: destinatario, subject: "Confirma tu cuenta — Industria Khanauky", html });
    return true;
  } catch (error) {
    console.error("Error enviando correo de verificación:", error);
    return false;
  }
}

export async function enviarCorreoRecuperacion(destinatario, nombre, token) {
  const link = `${SITE_URL}/restablecer-password.html?token=${token}`;
  const html = plantillaBase(
    "Recupera tu contraseña",
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Hola ${nombre}, recibimos una solicitud para restablecer tu contraseña. Si fuiste tú, haz clic en el botón
        de abajo. Este enlace caduca en 30 minutos por tu seguridad.
     </p>
     <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background-color:#E8902E; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-weight:600; font-size:14px;">Restablecer contraseña</a>
     </p>
     <p style="color:#8a96a0; font-size:12px;">Si no solicitaste esto, ignora este correo; tu contraseña actual seguirá funcionando.</p>`
  );

  try {
    await resend.emails.send({ from: EMAIL_FROM, to: destinatario, subject: "Restablece tu contraseña — Industria Khanauky", html });
    return true;
  } catch (error) {
    console.error("Error enviando correo de recuperación:", error);
    return false;
  }
}

export async function enviarCorreoPedidoConfirmado(destinatario, nombre, codigoOrden, totalAPagar) {
  const html = plantillaBase(
    "¡Tu pedido fue registrado!",
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Hola ${nombre}, confirmamos la recepción de tu pedido <strong>${codigoOrden}</strong> por un total de
        <strong>S/ ${totalAPagar.toFixed(2)}</strong>. Nuestro equipo se pondrá en contacto para coordinar la entrega.
     </p>`
  );

  try {
    await resend.emails.send({ from: EMAIL_FROM, to: destinatario, subject: `Pedido ${codigoOrden} registrado — Industria Khanauky`, html });
    return true;
  } catch (error) {
    console.error("Error enviando correo de pedido:", error);
    return false;
  }
}

export async function enviarCorreoNuevaPassAsignada(destinatario, nombre, passTemporal) {
  const link = `${SITE_URL}/login.html`;
  const html = plantillaBase(
    "Se actualizó tu contraseña",
    `<p style="color:#4A5A6A; font-size:14px; line-height:1.6;">
        Hola ${nombre}, el administrador del sistema asignó una nueva contraseña temporal para tu cuenta:
     </p>
     <p style="text-align:center; margin: 20px 0; font-size:18px; font-weight:700; color:#0B3D5C; letter-spacing:1px;">${passTemporal}</p>
     <p style="text-align:center; margin: 28px 0;">
        <a href="${link}" style="background-color:#1C7C9C; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-weight:600; font-size:14px;">Ir a iniciar sesión</a>
     </p>
     <p style="color:#8a96a0; font-size:12px;">Por seguridad, te recomendamos cambiarla apenas inicies sesión.</p>`
  );

  try {
    await resend.emails.send({ from: EMAIL_FROM, to: destinatario, subject: "Tu contraseña fue actualizada — Industria Khanauky", html });
    return true;
  } catch (error) {
    console.error("Error enviando correo de nueva contraseña:", error);
    return false;
  }
}
