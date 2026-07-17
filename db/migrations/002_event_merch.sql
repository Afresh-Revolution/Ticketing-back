-- Event merch: admin-configured products, orders, and at-event save requests.
-- Run after your base events schema exists. Safe to re-run with IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE merch_availability AS ENUM ('online', 'at_event', 'both');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS event_merch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  availability merch_availability NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  types TEXT[] NOT NULL DEFAULT '{}',
  custom_type VARCHAR(255),
  same_amount BOOLEAN NOT NULL DEFAULT TRUE,
  unit_price DECIMAL(12, 2),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_merch_event_id ON event_merch (event_id);
CREATE INDEX IF NOT EXISTS idx_event_merch_availability ON event_merch (event_id, availability);

CREATE TABLE IF NOT EXISTS event_merch_colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merch_id UUID NOT NULL REFERENCES event_merch (id) ON DELETE CASCADE,
  color_name VARCHAR(120) NOT NULL,
  quantity_available INT NOT NULL DEFAULT 0 CHECK (quantity_available >= 0)
);

CREATE INDEX IF NOT EXISTS idx_event_merch_colors_merch ON event_merch_colors (merch_id);

CREATE TABLE IF NOT EXISTS event_merch_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merch_id UUID NOT NULL REFERENCES event_merch (id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  quantity_available INT NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  unit_price DECIMAL(12, 2),
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_merch_images_merch ON event_merch_images (merch_id);

CREATE TABLE IF NOT EXISTS merch_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(80),
  address TEXT,
  total_amount DECIMAL(12, 2) NOT NULL CHECK (total_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  payment_method VARCHAR(20) NOT NULL
    CHECK (payment_method IN ('paystack', 'manual')),
  paystack_reference VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merch_orders_event ON merch_orders (event_id);
CREATE INDEX IF NOT EXISTS idx_merch_orders_status ON merch_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_merch_orders_email ON merch_orders (email);

CREATE TABLE IF NOT EXISTS merch_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES merch_orders (id) ON DELETE CASCADE,
  merch_id UUID NOT NULL REFERENCES event_merch (id),
  image_id UUID REFERENCES event_merch_images (id),
  color_name VARCHAR(120),
  type_name VARCHAR(120),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(12, 2) NOT NULL,
  line_total DECIMAL(12, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merch_order_items_order ON merch_order_items (order_id);

CREATE TABLE IF NOT EXISTS merch_save_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  merch_id UUID NOT NULL REFERENCES event_merch (id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ticket_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INT
);

CREATE INDEX IF NOT EXISTS idx_merch_save_requests_event ON merch_save_requests (event_id, status);

-- Decrement stock atomically when order is paid (application layer should use transactions).
COMMENT ON TABLE event_merch IS 'Per-event merch configured by admin';
COMMENT ON TABLE merch_orders IS 'Online merch purchases (Paystack or manual transfer)';
