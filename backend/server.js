require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB client error:', err.message);
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// ── Brands ────────────────────────────────────────────────────────────────────

app.get('/api/brands', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM brands ORDER BY name ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/brands:', err.message);
    res.status(500).json({ error: 'Failed to fetch brands' });
  }
});

// ── Models ────────────────────────────────────────────────────────────────────

app.get('/api/models/:brandId', async (req, res) => {
  const { brandId } = req.params;
  if (!brandId) return res.status(400).json({ error: 'brandId is required' });
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM models WHERE brand_id = $1 ORDER BY name ASC',
      [brandId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/models:', err.message);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// ── Variants ──────────────────────────────────────────────────────────────────

app.get('/api/variants/:modelId', async (req, res) => {
  const { modelId } = req.params;
  if (!modelId) return res.status(400).json({ error: 'modelId is required' });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, fuel, transmission, oem_warranty_months, oem_warranty_kms
       FROM variants WHERE model_id = $1 ORDER BY name ASC`,
      [modelId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/variants:', err.message);
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
});

// ── Calculate ─────────────────────────────────────────────────────────────────

app.post('/api/calculate', async (req, res) => {
  const { variant_id, purchase_date } = req.body;

  if (!variant_id || !purchase_date) {
    return res.status(400).json({ error: 'variant_id and purchase_date are required' });
  }

  const purchaseDate = new Date(purchase_date);
  if (isNaN(purchaseDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  const days = Math.floor((Date.now() - purchaseDate.getTime()) / 86_400_000);

  if (days < 0) {
    return res.status(400).json({ error: 'Purchase date cannot be in the future' });
  }
  if (days > 1095) {
    return res.json([]);
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         p.plan_name,
         p.duration_months,
         p.max_kms,
         t.price_inr  AS price,
         t.min_days,
         t.max_days
       FROM plans p
       JOIN tiers t ON t.plan_id = p.id
       WHERE p.variant_id = $1
         AND t.is_active  = TRUE
         AND t.min_days  <= $2
         AND t.max_days  >= $2
       ORDER BY t.price_inr ASC`,
      [variant_id, days]
    );
    res.json(rows);
  } catch (err) {
    console.error('POST /api/calculate:', err.message);
    res.status(500).json({ error: 'Calculation failed' });
  }
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`EW Pricing API → http://localhost:${PORT}`);
});
