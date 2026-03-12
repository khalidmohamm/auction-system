const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all active checkouts (keys currently out)
router.get('/active', async (req, res) => {
  const { rows } = await db.query(`
    SELECT kc.*, d.name as driver_name,
      v.plate_letters, v.plate_numbers, v.brand, v.model, v.year, v.key_closet,
      o.name as owner_name
    FROM key_checkouts kc
    JOIN drivers d ON d.id = kc.driver_id
    JOIN vehicles v ON v.id = kc.vehicle_id
    LEFT JOIN owners o ON o.id = v.owner_id
    WHERE kc.returned = 0
    ORDER BY kc.checkout_time DESC
  `);
  res.json(rows);
});

// GET current active checkout for a specific vehicle
router.get('/vehicle/:vehicleId', async (req, res) => {
  const { rows: activeRows } = await db.query(`
    SELECT kc.*, d.name as driver_name
    FROM key_checkouts kc
    JOIN drivers d ON d.id = kc.driver_id
    WHERE kc.vehicle_id = $1 AND kc.returned = 0
    LIMIT 1
  `, [req.params.vehicleId]);

  const { rows: history } = await db.query(`
    SELECT kc.*, d.name as driver_name
    FROM key_checkouts kc
    JOIN drivers d ON d.id = kc.driver_id
    WHERE kc.vehicle_id = $1
    ORDER BY kc.checkout_time DESC
    LIMIT 10
  `, [req.params.vehicleId]);

  res.json({ active: activeRows[0] || null, history });
});

// POST assign key to driver
router.post('/', async (req, res) => {
  const { vehicle_id, driver_id, notes } = req.body;
  if (!vehicle_id || !driver_id) return res.status(400).json({ error: 'بيانات ناقصة' });

  const { rows: existingRows } = await db.query(
    'SELECT * FROM key_checkouts WHERE vehicle_id = $1 AND returned = 0',
    [vehicle_id]
  );
  if (existingRows[0]) {
    const { rows: driverRows } = await db.query('SELECT name FROM drivers WHERE id = $1', [existingRows[0].driver_id]);
    return res.status(400).json({ error: `المفتاح مسلّم بالفعل للسائق: ${driverRows[0]?.name}` });
  }

  const { rows } = await db.query(
    'INSERT INTO key_checkouts (vehicle_id, driver_id, notes) VALUES ($1, $2, $3) RETURNING id',
    [vehicle_id, driver_id, notes || null]
  );

  const { rows: driverRows } = await db.query('SELECT name FROM drivers WHERE id = $1', [driver_id]);
  await db.query(
    'INSERT INTO vehicle_log (vehicle_id, action, details) VALUES ($1, $2, $3)',
    [vehicle_id, 'تسليم مفتاح', `تم تسليم المفتاح للسائق: ${driverRows[0]?.name}`]
  );

  res.json({ id: rows[0].id });
});

// PUT mark key as returned
router.put('/:id/return', async (req, res) => {
  const { rows: checkoutRows } = await db.query('SELECT * FROM key_checkouts WHERE id = $1', [req.params.id]);
  const checkout = checkoutRows[0];
  if (!checkout) return res.status(404).json({ error: 'السجل غير موجود' });
  if (checkout.returned) return res.status(400).json({ error: 'المفتاح مُسترجع مسبقاً' });

  await db.query(
    'UPDATE key_checkouts SET returned = 1, return_time = NOW() WHERE id = $1',
    [req.params.id]
  );

  const { rows: driverRows } = await db.query('SELECT name FROM drivers WHERE id = $1', [checkout.driver_id]);
  await db.query(
    'INSERT INTO vehicle_log (vehicle_id, action, details) VALUES ($1, $2, $3)',
    [checkout.vehicle_id, 'استلام مفتاح', `تم استلام المفتاح من السائق: ${driverRows[0]?.name}`]
  );

  res.json({ success: true });
});

module.exports = router;
