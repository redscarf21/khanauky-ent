// Llenado de los selects de fecha de nacimiento

const selectDia = document.getElementById("dia");
const selectMes = document.getElementById("mes");
const selectAnio = document.getElementById("anio");

for (let i = 1; i <= 31; i++) selectDia.innerHTML += `<option value="${i}">${i}</option>`;

const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
meses.forEach((m, i) => (selectMes.innerHTML += `<option value="${i + 1}">${m}</option>`));

for (let i = new Date().getFullYear(); i >= 1950; i--) selectAnio.innerHTML += `<option value="${i}">${i}</option>`;

document.getElementById("registroForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorMsg = document.getElementById("error-msg");
  errorMsg.textContent = "";

  const pass = document.getElementById("pass").value;
  const passConfirmar = document.getElementById("passConfirmar").value;

  if (pass !== passConfirmar) {
    errorMsg.textContent = "Las contraseñas no coinciden.";
    return;
  }

  const cliente = {
    nombre: `${document.getElementById("nombre").value} ${document.getElementById("apellidos").value}`,
    usuario: document.getElementById("usuario").value,
    pass,
    email: document.getElementById("email").value,
    dni: document.getElementById("dni").value,
    direccion: document.getElementById("dir").value,
    telefono: document.getElementById("tel").value,
    fechaNac: `${selectDia.value}/${selectMes.value}/${selectAnio.value}`
  };

  try {
    const data = await Api.post("/api/registro", cliente);
    alert(data.mensaje);
    window.location.href = "login.html";
  } catch (err) {
    errorMsg.textContent = err.message;
  }
});
