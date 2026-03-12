const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all owners with car count
router.get('/', async (req, res) => {
  const { rows } = await db.query(`
    SELECT o.*, COUNT(v.id) as car_count
    FROM owners o
    LEFT JOIN vehicles v ON v.owner_id = o.id
    GROUP BY o.id
    ORDER BY car_count DESC
  `);
  res.json(rows);
});

// Add owner
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المالك مطلوب' });
  try {
    const { rows } = await db.query(
      'INSERT INTO owners (name) VALUES ($1) RETURNING id, name',
      [name]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'المالك موجود مسبقاً' });
  }
});

// Update owner
router.put('/:id', async (req, res) => {
  const { name } = req.body;
  await db.query('UPDATE owners SET name = $1 WHERE id = $2', [name, req.params.id]);
  res.json({ success: true });
});

// Bulk assign zone to all vehicles of this owner
router.post('/:id/assign-zone', async (req, res) => {
  const { zone_id } = req.body;
  const { rows: ownerRows } = await db.query('SELECT * FROM owners WHERE id = $1', [req.params.id]);
  const owner = ownerRows[0];
  if (!owner) return res.status(404).json({ error: 'المالك غير موجود' });

  const { rowCount } = await db.query(
    'UPDATE vehicles SET zone_id = $1, updated_at = NOW() WHERE owner_id = $2',
    [zone_id || null, req.params.id]
  );

  const { rows: vehicles } = await db.query('SELECT id FROM vehicles WHERE owner_id = $1', [req.params.id]);
  let zoneName = 'بدون منطقة';
  if (zone_id) {
    const { rows: zoneRows } = await db.query('SELECT name FROM zones WHERE id = $1', [zone_id]);
    zoneName = zoneRows[0]?.name || zone_id;
  }
  for (const v of vehicles) {
    await db.query(
      'INSERT INTO vehicle_log (vehicle_id, action, details) VALUES ($1, $2, $3)',
      [v.id, 'تعيين جماعي', `تم تعيين المنطقة: ${zoneName} لجميع مركبات ${owner.name}`]
    );
  }

  res.json({ updated: rowCount, zone_id: zone_id || null, owner: owner.name });
});

// Delete owner
router.delete('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT COUNT(*) as c FROM vehicles WHERE owner_id = $1', [req.params.id]);
  if (Number(rows[0].c) > 0) return res.status(400).json({ error: 'لا يمكن الحذف، يوجد مركبات مرتبطة بهذا المالك' });
  await db.query('DELETE FROM owners WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
