-- ============================================================
-- INDUSTRIA KHANAUKY — SCHEMA PostgreSQL
-- Convertido desde T-SQL (SQL Server) a PostgreSQL para Neon
-- ============================================================

-- ============================================================
-- 1. TABLAS DE CATÁLOGO
-- ============================================================

CREATE TABLE IF NOT EXISTS ubigeo (
    ubigeo_id     SERIAL PRIMARY KEY,
    departamento  VARCHAR(50) NOT NULL,
    provincia     VARCHAR(50) NOT NULL,
    distrito      VARCHAR(50) NOT NULL,
    CONSTRAINT ubigeo_uq UNIQUE (departamento, provincia, distrito)
);

CREATE TABLE IF NOT EXISTS tipo_comprobante (
    comprobante_id SERIAL PRIMARY KEY,
    descripcion    VARCHAR(50) NOT NULL,
    CONSTRAINT tipo_comprobante_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS metodo_pago (
    metodo_pago_id SERIAL PRIMARY KEY,
    descripcion    VARCHAR(50) NOT NULL,
    CONSTRAINT metodo_pago_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS estado_pedido (
    estado_id   SERIAL PRIMARY KEY,
    descripcion VARCHAR(50) NOT NULL,
    CONSTRAINT estado_pedido_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS estado_empleado (
    estado_empleado_id SERIAL PRIMARY KEY,
    descripcion        VARCHAR(50) NOT NULL,
    CONSTRAINT estado_empleado_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS tipo_contrato (
    tipo_contrato_id SERIAL PRIMARY KEY,
    descripcion      VARCHAR(50) NOT NULL,
    sueldo           NUMERIC(10,2) NOT NULL CHECK (sueldo >= 0),
    CONSTRAINT tipo_contrato_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS roles (
    rol_id      SERIAL PRIMARY KEY,
    descripcion VARCHAR(50) NOT NULL,
    CONSTRAINT roles_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS capacidad (
    capacidad_id SERIAL PRIMARY KEY,
    descripcion  VARCHAR(50) NOT NULL,
    CONSTRAINT capacidad_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS categoria (
    categoria_id SERIAL PRIMARY KEY,
    descripcion  VARCHAR(50) NOT NULL,
    CONSTRAINT categoria_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS tipo_transporte (
    tipo_id     SERIAL PRIMARY KEY,
    descripcion VARCHAR(50) NOT NULL,
    CONSTRAINT tipo_transporte_desc_uq UNIQUE (descripcion)
);

CREATE TABLE IF NOT EXISTS estado_transporte (
    estado_transporte_id SERIAL PRIMARY KEY,
    descripcion          VARCHAR(50) NOT NULL,
    CONSTRAINT estado_transporte_desc_uq UNIQUE (descripcion)
);

-- ============================================================
-- 2. USUARIOS (sistema de autenticación — se mantiene del sistema actual)
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id                SERIAL PRIMARY KEY,
    nombre            VARCHAR(150) NOT NULL,
    usuario           VARCHAR(60)  NOT NULL UNIQUE,
    pass_hash         VARCHAR(255) NOT NULL,
    rol               VARCHAR(20)  NOT NULL CHECK (rol IN ('cliente', 'empleado')),
    email             VARCHAR(150) UNIQUE,
    es_admin_principal BOOLEAN NOT NULL DEFAULT FALSE,
    email_verificado  BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens_verificacion (
    token       VARCHAR(80) PRIMARY KEY,
    usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens_recuperacion (
    token       VARCHAR(80) PRIMARY KEY,
    usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira      TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- 3. CLIENTE Y ESPECIALIZACIÓN (PERSONA / EMPRESA)
-- ============================================================

CREATE TABLE IF NOT EXISTS cliente (
    cliente_id     SERIAL PRIMARY KEY,
    fecha_registro DATE        NOT NULL DEFAULT CURRENT_DATE,
    hora_registro  TIME        NOT NULL DEFAULT CURRENT_TIME,
    direccion      VARCHAR(150) NOT NULL,
    telefono       VARCHAR(15)  NOT NULL,
    tipo_cliente   VARCHAR(10)  NOT NULL CHECK (tipo_cliente IN ('PERSONA', 'EMPRESA')),
    ubigeo_id      INT NOT NULL REFERENCES ubigeo(ubigeo_id),
    usuario_id     INT UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS persona (
    cliente_id INT PRIMARY KEY REFERENCES cliente(cliente_id),
    nombres    VARCHAR(50) NOT NULL,
    apellidos  VARCHAR(50) NOT NULL,
    sexo       CHAR(1)     NOT NULL CHECK (sexo IN ('M', 'F')),
    dni        VARCHAR(8)  NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS empresa (
    cliente_id    INT PRIMARY KEY REFERENCES cliente(cliente_id),
    razon_social  VARCHAR(100) NOT NULL,
    ruc           VARCHAR(11)  NOT NULL UNIQUE
);

-- ============================================================
-- 4. EMPLEADO Y ESPECIALIZACIONES
-- ============================================================

CREATE TABLE IF NOT EXISTS empleado (
    empleado_id        SERIAL PRIMARY KEY,
    nombres            VARCHAR(50) NOT NULL,
    apellidos          VARCHAR(50) NOT NULL,
    telefono_empleado  VARCHAR(15) NOT NULL,
    sexo               CHAR(1)     NOT NULL CHECK (sexo IN ('M', 'F')),
    dni                VARCHAR(8)  NOT NULL UNIQUE,
    fecha_contratacion DATE        NOT NULL,
    tipo_empleado      VARCHAR(20) NOT NULL,
    tipo_contrato_id   INT NOT NULL REFERENCES tipo_contrato(tipo_contrato_id),
    ubigeo_id          INT NOT NULL REFERENCES ubigeo(ubigeo_id),
    estado_empleado_id INT NOT NULL REFERENCES estado_empleado(estado_empleado_id),
    usuario_id         INT UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS e_venta (
    empleado_id          INT PRIMARY KEY REFERENCES empleado(empleado_id),
    telefono_corporativo VARCHAR(15)
);

CREATE TABLE IF NOT EXISTS e_produccion (
    empleado_id              INT PRIMARY KEY REFERENCES empleado(empleado_id),
    carnet_sanidad           VARCHAR(20) NOT NULL,
    fecha_vencimiento_carnet DATE        NOT NULL,
    talla_vestimenta         VARCHAR(5)
);

CREATE TABLE IF NOT EXISTS e_entrega (
    empleado_id                  INT PRIMARY KEY REFERENCES empleado(empleado_id),
    numero_licencia_conducir     VARCHAR(20) NOT NULL,
    fecha_vencimiento_licencia   DATE        NOT NULL
);

-- ============================================================
-- 5. TRANSPORTE
-- ============================================================

CREATE TABLE IF NOT EXISTS transporte (
    transporte_id        SERIAL PRIMARY KEY,
    modelo_transporte    VARCHAR(50) NOT NULL,
    tipo_id              INT NOT NULL REFERENCES tipo_transporte(tipo_id),
    estado_transporte_id INT NOT NULL REFERENCES estado_transporte(estado_transporte_id)
);

-- ============================================================
-- 6. PRODUCTO Y LOTES DE PRODUCCIÓN
-- ============================================================

CREATE TABLE IF NOT EXISTS producto (
    producto_id       SERIAL PRIMARY KEY,
    nombre_producto   VARCHAR(50)    NOT NULL,
    descripcion       VARCHAR(255),
    precio_minorista  NUMERIC(10,2)  NOT NULL CHECK (precio_minorista >= 0),
    precio_mayorista  NUMERIC(10,2)  NOT NULL CHECK (precio_mayorista >= 0),
    categoria_id      INT NOT NULL REFERENCES categoria(categoria_id),
    capacidad_id      INT NOT NULL REFERENCES capacidad(capacidad_id),
    imagen            VARCHAR(255),
    CONSTRAINT producto_nombre_uq UNIQUE (nombre_producto)
);

CREATE TABLE IF NOT EXISTS produccion_lotes (
    lote_id              SERIAL PRIMARY KEY,
    producto_id          INT NOT NULL REFERENCES producto(producto_id),
    fecha_produccion     DATE    NOT NULL,
    hora_produccion      TIME    NOT NULL,
    unidades_producidas  INT     NOT NULL CHECK (unidades_producidas >= 0),
    unidades_defectuosas INT     NOT NULL DEFAULT 0 CHECK (unidades_defectuosas >= 0),
    unidades_netas       INT     NOT NULL,
    unidades_disponibles INT     NOT NULL,
    estado               VARCHAR(30) NOT NULL,
    fecha_vencimiento    DATE    NOT NULL,
    CONSTRAINT lotes_fechas_chk CHECK (fecha_vencimiento > fecha_produccion)
);

-- ============================================================
-- 7. DELIVERY, PEDIDO Y DETALLE
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery (
    delivery_id       SERIAL PRIMARY KEY,
    fecha             DATE    NOT NULL DEFAULT CURRENT_DATE,
    hora_salida       TIME,
    hora_entrega      TIME,
    direccion_entrega VARCHAR(150) NOT NULL,
    ubigeo_id         INT NOT NULL REFERENCES ubigeo(ubigeo_id),
    transporte_id     INT NOT NULL REFERENCES transporte(transporte_id)
);

CREATE TABLE IF NOT EXISTS pedido (
    pedido_id    SERIAL PRIMARY KEY,
    codigo_orden VARCHAR(20) NOT NULL UNIQUE,
    fecha_pedido DATE        NOT NULL DEFAULT CURRENT_DATE,
    hora_pedido  TIME        NOT NULL DEFAULT CURRENT_TIME,
    cliente_id   INT         NOT NULL REFERENCES cliente(cliente_id),
    estado_id    INT         NOT NULL REFERENCES estado_pedido(estado_id),
    e_venta_id   INT         REFERENCES e_venta(empleado_id),
    delivery_id  INT         REFERENCES delivery(delivery_id)
);

CREATE TABLE IF NOT EXISTS detalle_pedido (
    detalle_pedido_id SERIAL PRIMARY KEY,
    pedido_id         INT            NOT NULL REFERENCES pedido(pedido_id) ON DELETE CASCADE,
    producto_id       INT            NOT NULL REFERENCES producto(producto_id),
    lote_id           INT            NOT NULL REFERENCES produccion_lotes(lote_id),
    cantidad          INT            NOT NULL CHECK (cantidad > 0),
    precio            NUMERIC(10,2)  NOT NULL,
    sub_total         NUMERIC(10,2)  NOT NULL
);

-- ============================================================
-- 8. VENTA Y PAGOS
-- ============================================================

CREATE TABLE IF NOT EXISTS venta (
    venta_id           SERIAL PRIMARY KEY,
    pedido_id          INT           NOT NULL REFERENCES pedido(pedido_id),
    comprobante_id     INT           NOT NULL REFERENCES tipo_comprobante(comprobante_id),
    fecha_venta        DATE          NOT NULL DEFAULT CURRENT_DATE,
    hora_venta         TIME          NOT NULL DEFAULT CURRENT_TIME,
    descuento_aplicado NUMERIC(10,2) NOT NULL DEFAULT 0,
    saldo_pendiente    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (saldo_pendiente >= 0),
    total_pago         NUMERIC(10,2) NOT NULL CHECK (total_pago >= 0),
    estado             VARCHAR(20)   NOT NULL DEFAULT 'Activo'
);

CREATE INDEX IF NOT EXISTS venta_pedido_idx ON venta(pedido_id);

CREATE TABLE IF NOT EXISTS detalle_pago (
    detalle_pago_id               SERIAL PRIMARY KEY,
    venta_id                      INT           NOT NULL REFERENCES venta(venta_id),
    metodo_pago_id                INT           NOT NULL REFERENCES metodo_pago(metodo_pago_id),
    hora_pago                     TIME          NOT NULL DEFAULT CURRENT_TIME,
    fecha_pago                    DATE          NOT NULL DEFAULT CURRENT_DATE,
    monto_pagado                  NUMERIC(10,2) NOT NULL CHECK (monto_pagado >= 0),
    numero_operacion_transferencia VARCHAR(50)
);

-- ============================================================
-- 9. DELIVERY — EQUIPO Y CONTROL DE BIDONES
-- ============================================================

CREATE TABLE IF NOT EXISTS detalle_equipo_delivery (
    detalle_delivery_id    SERIAL PRIMARY KEY,
    e_entrega_empleado_id  INT  NOT NULL REFERENCES e_entrega(empleado_id),
    delivery_id            INT  NOT NULL REFERENCES delivery(delivery_id),
    rol_id                 INT  NOT NULL REFERENCES roles(rol_id),
    fecha_inicio           DATE NOT NULL,
    hora_inicio            TIME NOT NULL,
    fecha_fin              DATE,
    hora_fin               TIME,
    CONSTRAINT ded_uq UNIQUE (e_entrega_empleado_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS control_bidones (
    control_id          SERIAL PRIMARY KEY,
    cantidad_entregados INT  NOT NULL DEFAULT 0,
    cantidad_recibidos  INT  NOT NULL DEFAULT 0,
    cantidad_prestados  INT  NOT NULL DEFAULT 0,
    fecha_movimiento    DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_movimiento     TIME NOT NULL DEFAULT CURRENT_TIME,
    delivery_id         INT  REFERENCES delivery(delivery_id) ON DELETE SET NULL,
    cliente_id          INT  NOT NULL REFERENCES cliente(cliente_id),
    CONSTRAINT control_bidones_cant_chk CHECK (
        cantidad_entregados >= 0 AND
        cantidad_recibidos  >= 0 AND
        cantidad_prestados  >= 0
    )
);

-- ============================================================
-- 10. PRODUCCIÓN — EQUIPO DE PRODUCCIÓN
-- ============================================================

CREATE TABLE IF NOT EXISTS detalle_equipo_produccion (
    detalle_equipo_id SERIAL PRIMARY KEY,
    e_produccion_id   INT  NOT NULL REFERENCES e_produccion(empleado_id),
    lote_id           INT  NOT NULL REFERENCES produccion_lotes(lote_id),
    rol_id            INT  NOT NULL REFERENCES roles(rol_id),
    fecha_inicio      DATE NOT NULL,
    hora_inicio       TIME NOT NULL,
    fecha_fin         DATE,
    hora_fin          TIME,
    CONSTRAINT dep_uq UNIQUE (e_produccion_id, lote_id)
);

-- ============================================================
-- ÍNDICES ADICIONALES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pedido_cliente    ON pedido(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedido_estado     ON pedido(estado_id);
CREATE INDEX IF NOT EXISTS idx_detalle_pedido    ON detalle_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_venta_pedido      ON venta(pedido_id);
CREATE INDEX IF NOT EXISTS idx_detalle_pago      ON detalle_pago(venta_id);
CREATE INDEX IF NOT EXISTS idx_lotes_producto    ON produccion_lotes(producto_id);
CREATE INDEX IF NOT EXISTS idx_control_cliente   ON control_bidones(cliente_id);

-- ============================================================
-- DATOS BASE (catálogos mínimos para que el sistema funcione)
-- ============================================================

INSERT INTO ubigeo (departamento, provincia, distrito) VALUES
('La Libertad', 'Virú',     'Chao'),
('La Libertad', 'Trujillo', 'Trujillo'),
('La Libertad', 'Trujillo', 'Victor Larco Herrera'),
('La Libertad', 'Trujillo', 'Florencia de Mora'),
('La Libertad', 'Trujillo', 'Huanchaco'),
('La Libertad', 'Trujillo', 'La Esperanza'),
('La Libertad', 'Trujillo', 'El Porvenir'),
('La Libertad', 'Virú',     'Virú'),
('La Libertad', 'Trujillo', 'Moche')
ON CONFLICT (departamento, provincia, distrito) DO NOTHING;

INSERT INTO tipo_comprobante (descripcion) VALUES
('Boleta'),
('Factura')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO metodo_pago (descripcion) VALUES
('Efectivo'),
('Yape'),
('Plin'),
('Transferencia')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO estado_pedido (descripcion) VALUES
('Venta Registrada'),
('Pago Confirmado'),
('Entregado'),
('Cancelado')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO estado_empleado (descripcion) VALUES
('Activo'),
('Inactivo'),
('De Vacaciones'),
('Cese')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO tipo_contrato (descripcion, sueldo) VALUES
('Planta Permanente - Ventas',      1200.00),
('Planta Permanente - Producción',  1150.00),
('Planta Permanente - Entrega',     1300.00),
('Tiempo Parcial',                   700.00),
('Práctica Pre-Profesional',        1025.00)
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO roles (descripcion) VALUES
('Conductor'),
('Ayudante de Reparto'),
('Supervisor de Producción'),
('Operario de Llenado'),
('Control de Calidad')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO capacidad (descripcion) VALUES
('20 Litros'),
('7 Litros'),
('650 ml'),
('1.5 kg'),
('3 kg')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO categoria (descripcion) VALUES
('Agua en Bidón'),
('Agua Embotellada'),
('Hielo')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO tipo_transporte (descripcion) VALUES
('Mototaxi'),
('Furgón'),
('Motocar'),
('Carro Particular')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO estado_transporte (descripcion) VALUES
('Operativo'),
('En Mantenimiento'),
('Fuera de Servicio')
ON CONFLICT (descripcion) DO NOTHING;

INSERT INTO producto (nombre_producto, descripcion, precio_minorista, precio_mayorista, categoria_id, capacidad_id, imagen) VALUES
('Bidón de Agua 20L',      'Nuestro formato más solicitado. Ideal para hogar y negocio.',  12.00, 10.00, 1, 1, 'bidon-20l.jpg'),
('Bidón de Agua 7L',       'Formato mediano Aquaelis, perfecto para el hogar o la oficina.', 6.00,  5.00, 1, 2, 'agua-7l.jpg'),
('Agua Embotellada 650ml', 'Botella individual Aquaelis, ideal para consumo personal.',       2.00,  1.50, 2, 3, 'agua-650ml.jpg'),
('Hielo en Bolsa 1.5kg',   'Hielo Aquaelis Ice, tratado con los mismos estándares de pureza.', 4.00, 3.50, 3, 4, 'hielo-1-5kg.jpg'),
('Hielo en Bolsa 3kg',     'Formato grande de hielo Aquaelis Ice, ideal para eventos.',      7.50,  6.50, 3, 5, 'hielo-3kg.jpg')
ON CONFLICT (nombre_producto) DO NOTHING;

-- Ventas presenciales sin cuenta: datos propios de cada venta.
-- Idempotente: iniciarBD() aplica también esta migración a bases existentes.
ALTER TABLE pedido ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS dni_presencial VARCHAR(8)
  CHECK (dni_presencial IS NULL OR dni_presencial ~ '^[0-9]{8}$');
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS ruc_presencial VARCHAR(11);
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS razon_social_presencial VARCHAR(100);
