// Funciones centralizadas para hablar con el backend, siempre con cookies de sesión
const Api = {
  async post(ruta, datos) {
    const res = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(datos)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Ocurrió un error inesperado.");
    return data;
  },

  async patch(ruta, datos) {
    const res = await fetch(ruta, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(datos)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Ocurrió un error inesperado.");
    return data;
  },

  async delete(ruta) {
    const res = await fetch(ruta, { method: "DELETE", credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo eliminar la cuenta.");
    return data;
  },

  async get(ruta) {
    const res = await fetch(ruta, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Ocurrió un error inesperado.");
    return data;
  }
};

window.Api = Api;

// Datos de clientes/empleados se muestran como texto, nunca como HTML ejecutable.
window.escaparHtml = (valor) => String(valor ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
