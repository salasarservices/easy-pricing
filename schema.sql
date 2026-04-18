-- Extended Warranty Pricing — PostgreSQL Schema
-- Run this in your Render PostgreSQL database (via psql or any SQL client)

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- provides gen_random_uuid()

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brands (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS models (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   UUID        NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (brand_id, name)
);

CREATE TABLE IF NOT EXISTS variants (
  id                  UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id            UUID  NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  name                TEXT  NOT NULL,
  fuel                TEXT,                -- Petrol | Diesel | EV | CNG | Hybrid
  transmission        TEXT,                -- Manual | Automatic | AMT | CVT | DCA | AGS
  oem_warranty_months INT,
  oem_warranty_kms    INT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_id, name)
);

CREATE TABLE IF NOT EXISTS plans (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      UUID  NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  plan_name       TEXT  NOT NULL,
  plan_code       TEXT,
  duration_months INT,
  max_kms         INT,                     -- NULL = unlimited
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (variant_id, plan_code)
);

CREATE TABLE IF NOT EXISTS tiers (
  id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    UUID           NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  min_days   INT            NOT NULL,
  max_days   INT            NOT NULL,
  price_inr  NUMERIC(10,2)  NOT NULL,
  is_active  BOOLEAN        DEFAULT TRUE,
  created_at TIMESTAMPTZ    DEFAULT NOW(),
  UNIQUE (plan_id, min_days, max_days)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_models_brand     ON models(brand_id);
CREATE INDEX IF NOT EXISTS idx_variants_model   ON variants(model_id);
CREATE INDEX IF NOT EXISTS idx_plans_variant    ON plans(variant_id);
CREATE INDEX IF NOT EXISTS idx_tiers_plan       ON tiers(plan_id);
CREATE INDEX IF NOT EXISTS idx_tiers_days       ON tiers(plan_id, min_days, max_days) WHERE is_active;
