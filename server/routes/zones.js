const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all zones with car count
router.get('/', async (req, res) => {
  const { rows } = await db.query(`
    SELECT z.*, COUNT(v.id) as car_count
    FROM zones z
    LEFT JOIN vehicles v ON v.zone_id = z.id
    GROUP BY z.id
    ORDER BY z.name
  `);
  res.json(rows);
});

// Add zone
router.post('/', async (req, res) => {
  const { name, zone_color } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم الموقع مطلوب' });
  try {
    const color = zone_color || '#1a6a9a';
    const { rows } = await db.query(
      'INSERT INTO zones (name, zone_color) VALUES ($1, $2) RETURNING id, name, zone_color',
      [name, color]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'الموقع موجود مسبقاً' });
  }
});

// Update zone
router.put('/:id', async (req, res) => {
  const { name, zone_color } = req.body;
  await db.query(
    'UPDATE zones SET name = $1, zone_color = $2 WHERE id = $3',
    [name, zone_color || '#1a6a9a', req.params.id]
  );
  res.json({ success: true });
});

// Delete zone
router.delete('/:id', async (req, res) => {
  await db.query('UPDATE vehicles SET zone_id = NULL WHERE zone_id = $1', [req.params.id]);
  await db.query('DELETE FROM zones WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
