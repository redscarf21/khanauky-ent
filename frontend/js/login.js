const loginForm = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");
const btnCliente = document.getElementById("btnCliente");
const btnEmpleado = document.getElementById("btnEmpleado");
const labelUsuario = document.getElementById("labelUsuario");
const inputUsuario = document.getElementById("usuario");
const captchaSlot = document.getElementById("captchaSlot");
const bloqueCrearCuenta = document.getElementById("bloqueCrearCuenta");
const bloqueOlvideContrasena = document.getElementById("bloqueOlvideContrasena");

let rolActual = "cliente";

function activarTabCliente() {
  rolActual = "cliente";
  btnCliente.classList.add("active");
  btnEmpleado.classList.remove("active");
  labelUsuario.textContent = "Correo electrónico";
  inputUsuario.placeholder = "tu@correo.com";
  inputUsuario.value = "";
  errorMsg.textContent = "";
  captchaSlot.style.display = "none";
  bloqueCrearCuenta.style.display = "block";
  bloqueOlvideContrasena.style.display = "block";
}

function activarTabEmpleado() {
  rolActual = "empleado";
  btnEmpleado.classList.add("active");
  btnCliente.classList.remove("active");
  labelUsuario.textContent = "Usuario";
  inputUsuario.placeholder = "Nombre de usuario";
  inputUsuario.value = "";
  errorMsg.textContent = "";
  captchaSlot.style.display = "block";
  bloqueCrearCuenta.style.display = "none";
  // La recuperación de contraseña para administradores se gestiona
  // internamente desde el panel, no por aquí.
  bloqueOlvideContrasena.style.display = "none";
}

btnCliente.addEventListener("click", activarTabCliente);
btnEmpleado.addEventListener("click", activarTabEmpleado);

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.textContent = "";

  const usuarioIngresado = inputUsuario.value.trim();
  const pass = document.getElementById("password").value.trim();

  let captchaToken = null;
  if (rolActual === "empleado") {
    captchaToken = typeof grecaptcha !== "undefined" ? grecaptcha.getResponse() : null;
    if (!captchaToken) {
      errorMsg.textContent = "Marca la casilla de verificación antes de continuar.";
      return;
    }
  }

  try {
    const data = await Api.post("/api/login", { usuarioIngresado, pass, rolEsperado: rolActual, captchaToken });
    window.location.href = data.rol === "empleado" ? "panel_admin.html" : "panel_cliente.html";
  } catch (err) {
    errorMsg.textContent = err.message;
    if (typeof grecaptcha !== "undefined" && rolActual === "empleado") grecaptcha.reset();
  }
});
