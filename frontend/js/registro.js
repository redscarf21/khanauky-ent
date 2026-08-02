let tipoCliente = "PERSONA";

const btnPersona = document.getElementById("btnPersona");
const btnEmpresa = document.getElementById("btnEmpresa");
const bloquesPersona = document.querySelectorAll(".bloque-persona");
const bloquesEmpresa = document.querySelectorAll(".bloque-empresa");

btnPersona.addEventListener("click", () => {
  tipoCliente = "PERSONA";
  btnPersona.classList.add("activo");
  btnEmpresa.classList.remove("activo");
  bloquesPersona.forEach((b) => b.classList.remove("bloque-oculto"));
  bloquesEmpresa.forEach((b) => b.classList.add("bloque-oculto"));
});

btnEmpresa.addEventListener("click", () => {
  tipoCliente = "EMPRESA";
  btnEmpresa.classList.add("activo");
  btnPersona.classList.remove("activo");
  bloquesEmpresa.forEach((b) => b.classList.remove("bloque-oculto"));
  bloquesPersona.forEach((b) => b.classList.add("bloque-oculto"));
});

async function cargarUbigeo() {
  try {
    const ubigeos = await Api.get("/api/ubigeo");
    const select = document.getElementById("ubigeoId");
    select.innerHTML = '<option value="">Selecciona tu distrito</option>';
    ubigeos.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.ubigeo_id;
      opt.textContent = `${u.distrito} — ${u.provincia}, ${u.departamento}`;
      select.appendChild(opt);
    });
  } catch {
    document.getElementById("ubigeoId").innerHTML =
      '<option value="">Error al cargar distritos</option>';
  }
}

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

  const datos = {
    tipoCliente,
    nombre: tipoCliente === "PERSONA"
      ? `${document.getElementById("nombres").value} ${document.getElementById("apellidos").value}`
      : document.getElementById("razonSocial").value,
    usuario: document.getElementById("usuario").value,
    pass,
    email: document.getElementById("email").value,
    telefono: document.getElementById("telefono").value,
    direccion: document.getElementById("direccion").value,
    ubigeoId: document.getElementById("ubigeoId").value,
    sexo: document.getElementById("sexo")?.value || "M",
    ...(tipoCliente === "PERSONA" && {
      dni: document.getElementById("dni").value
    }),
    ...(tipoCliente === "EMPRESA" && {
      razonSocial: document.getElementById("razonSocial").value,
      ruc: document.getElementById("ruc").value
    })
  };

  try {
    const data = await Api.post("/api/registro", datos);
    alert(data.mensaje);
    window.location.href = "login.html";
  } catch (err) {
    errorMsg.textContent = err.message;
  }
});

cargarUbigeo();