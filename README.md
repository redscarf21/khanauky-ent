```markdown
# Industria Khanauky - Sistema Web de Ventas

Página web para Industria Khanauky, una empresa de Chao, Virú (La Libertad) que produce y distribuye agua de mesa **Aquaelis** y hielo **Aquaelis Ice**.

Este proyecto nace con el objetivo de digitalizar el proceso de ventas de la empresa: desde que el cliente hace su pedido por la web, hasta que el administrador lo gestiona y genera su comprobante. Del mismo modo, permite a los empleados gestionar y generar ventas ingresando como "administrador" al sistema.

## ¿Qué hace la página?

- Catálogo de productos (agua y hielo) con precios que varían según la cantidad comprada
- Registro y inicio de sesión para clientes, con confirmación por correo
- Carrito de compras y registro de pedidos
- Panel para que el cliente vea el historial de sus pedidos y descargue su boleta o factura
- Panel de gestión para los administradores: registrar ventas presenciales, ver reportes de ventas (diarios y mensuales), gestionar sucursales y empleados
- Generación de boletas y facturas en PDF
- Inicio de sesión de administradores protegido con verificación de seguridad (captcha)
- Diseño adaptado para verse bien tanto en computadora como en celular

## Cómo está hecho

**Frontend:** HTML, CSS y JavaScript, usando Bootstrap para los estilos y componentes.

**Backend:** Node.js con Express.

**Base de datos:** PostgreSQL.

**Otros servicios usados:** Google reCAPTCHA (para el login de administradores) y envío de correos automáticos para confirmación de cuenta y recuperación de contraseña.

## Sobre el proyecto

La lógica de precios y generación de boletas fue probada primero en programas de consola (C# y Python) antes de integrarse a la versión web, como parte del proceso de aprendizaje en las distintas asignaturas del curso.

```