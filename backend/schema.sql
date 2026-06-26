-- sql -- neon

CREATE TABLE IF NOT EXISTS sucursales (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    direccion VARCHAR(255),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    usuario VARCHAR(60) NOT NULL UNIQUE,
    pass_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('cliente', 'empleado')),
    email VARCHAR(150) UNIQUE,
    dni VARCHAR(8),
    direccion VARCHAR(255),
    telefono VARCHAR(20),
    fecha_nac VARCHAR(20),
    email_verificado BOOLEAN NOT NULL DEFAULT FALSE,
    es_admin_principal BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255),
    categoria VARCHAR(40),
    unidad_empaque INT DEFAULT 1,
    imagen VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS pedidos (
    id SERIAL PRIMARY KEY,
    codigo_orden VARCHAR(20) NOT NULL UNIQUE,
    usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    registrado_por VARCHAR(150),
    cliente VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    direccion VARCHAR(255),
    dni VARCHAR(8),
    ruc VARCHAR(11),
    razon_social VARCHAR(150),
    sucursal_id INT REFERENCES sucursales(id),
    metodo_pago VARCHAR(40),
    modalidad_entrega VARCHAR(20) NOT NULL DEFAULT 'recojo' CHECK (modalidad_entrega IN ('recojo', 'delivery')),
    tipo_comprobante VARCHAR(10) NOT NULL DEFAULT 'boleta' CHECK (tipo_comprobante IN ('boleta', 'factura')),
    base_imponible NUMERIC(10,2) NOT NULL DEFAULT 0,
    igv NUMERIC(10,2) NOT NULL DEFAULT 0,
    descuento NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_a_pagar NUMERIC(10,2) NOT NULL DEFAULT 0,
    estado VARCHAR(30) NOT NULL DEFAULT 'Venta Registrada',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS detalle_pedido (
    id SERIAL PRIMARY KEY,
    pedido_id INT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    producto_id INT NOT NULL REFERENCES productos(id),
    nombre_producto VARCHAR(100) NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario_base NUMERIC(10,2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
    descuento NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tokens_verificacion (
    token VARCHAR(80) PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens_recuperacion (
    token VARCHAR(80) PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_usuario ON pedidos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_dni ON pedidos(dni);
CREATE INDEX IF NOT EXISTS idx_pedidos_telefono ON pedidos(telefono);
CREATE INDEX IF NOT EXISTS idx_detalle_pedido ON detalle_pedido(pedido_id);

-- Datos base
INSERT INTO sucursales (nombre, direccion) VALUES
    ('Sede Principal - Chao', 'Av. José Olaya Mz. F Lote 12, Urb. La Victoria, Chao, Virú')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO productos (id, nombre, descripcion, categoria, unidad_empaque, imagen) VALUES
    (1, 'Agua 650 ml', 'Botella individual Aquaelis, ideal para consumo personal en el día a día.', 'agua', 15, 'agua-650ml.jpg'),
    (2, 'Agua 7 Litros', 'Bidón mediano Aquaelis, perfecto para el hogar o la oficina.', 'agua', 1, 'agua-7l.jpg'),
    (3, 'Bidón Agua 20 Litros', 'Nuestro formato más solicitado. Precio dinámico según volumen de compra.', 'agua', 1, 'agua-20l.jpg'),
    (4, 'Hielo 1.5 kg', 'Hielo Aquaelis Ice en bolsa, tratado con los mismos estándares de pureza.', 'hielo', 6, 'hielo-1-5kg.jpg'),
    (5, 'Hielo 3 kg', 'Formato grande de hielo Aquaelis Ice, ideal para eventos y negocios.', 'hielo', 3, 'hielo-3kg.jpg')
ON CONFLICT (id) DO NOTHING;

SELECT setval('productos_id_seq', (SELECT MAX(id) FROM productos));
