const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all drivers
router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM drivers ORDER BY name');
  res.json(rows);
});

// POST add driver
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  try {
    const { rows } = await db.query(
      'INSERT INTO drivers (name) VALUES ($1) RETURNING id, name',
      [name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'السائق موجود مسبقاً' });
  }
});

// DELETE driver
router.delete('/:id', async (req, res) => {
  const { rows } = await db.query(
    'SELECT COUNT(*) as c FROM key_checkouts WHERE driver_id = $1 AND returned = 0',
    [req.params.id]
  );
  if (Number(rows[0].c) > 0) return res.status(400).json({ error: 'لا يمكن الحذف، يوجد مفاتيح لم تُسترجع بعد' });
  await db.query('DELETE FROM drivers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
