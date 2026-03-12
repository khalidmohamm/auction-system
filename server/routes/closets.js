const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all closet rows with owner/zone info + vehicle count
router.get('/', async (req, res) => {
  const { rows } = await db.query(`
    SELECT kc.*,
      o.name as owner_name,
      z.name as zone_name,
      z.zone_color as zone_color,
      COUNT(v.id) as vehicle_count
    FROM key_closets kc
    LEFT JOIN owners o ON o.id = kc.owner_id
    LEFT JOIN zones z ON z.id = kc.zone_id
    LEFT JOIN vehicles v ON v.key_closet_id = kc.id
    GROUP BY kc.id, o.name, z.name, z.zone_color
    ORDER BY kc.closet_no ASC, kc.row_no ASC
  `);
  res.json(rows);
});

// GET vehicles assigned to a specific closet row (slot view)
router.get('/:id/slots', async (req, res) => {
  const { rows: closetRows } = await db.query('SELECT * FROM key_closets WHERE id = $1', [req.params.id]);
  const closet = closetRows[0];
  if (!closet) return res.status(404).json({ error: 'الصف غير موجود' });

  const { rows: vehicles } = await db.query(`
    SELECT v.id, v.kc_slot_no, v.plate_letters, v.plate_numbers, v.brand, v.model, v.color, v.year,
      v.vin, o.name as owner_name
    FROM vehicles v
    LEFT JOIN owners o ON o.id = v.owner_id
    WHERE v.key_closet_id = $1
    ORDER BY v.kc_slot_no ASC
  `, [req.params.id]);

  res.json({ closet, vehicles });
});

// POST create closet row
router.post('/', async (req, res) => {
  const { closet_no, row_no, slots_per_row, owner_id, zone_id, notes } = req.body;
  if (!closet_no || !row_no) return res.status(400).json({ error: 'رقم الخزانة والصف مطلوبان' });
  try {
    const { rows } = await db.query(`
      INSERT INTO key_closets (closet_no, row_no, slots_per_row, owner_id, zone_id, notes)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [
      Number(closet_no), Number(row_no),
      slots_per_row ? Number(slots_per_row) : 200,
      owner_id || null, zone_id || null, notes || null
    ]);
    res.json({ id: rows[0].id });
  } catch (e) {
    res.status(400).json({ error: 'هذا الصف موجود مسبقاً في نفس الخزانة' });
  }
});

// PUT update closet row
router.put('/:id', async (req, res) => {
  const { owner_id, zone_id, notes, slots_per_row } = req.body;
  const { rows } = await db.query('SELECT * FROM key_closets WHERE id = $1', [req.params.id]);
  const current = rows[0];
  if (!current) return res.status(404).json({ error: 'الصف غير موجود' });

  await db.query(
    'UPDATE key_closets SET owner_id = $1, zone_id = $2, notes = $3, slots_per_row = $4 WHERE id = $5',
    [
      owner_id !== undefined ? owner_id || null : current.owner_id,
      zone_id !== undefined ? zone_id || null : current.zone_id,
      notes !== undefined ? notes || null : current.notes,
      slots_per_row !== undefined ? Number(slots_per_row) : (current.slots_per_row || 200),
      req.params.id
    ]
  );
  res.json({ success: true });
});

// DELETE closet row (only if no vehicles reference it)
router.delete('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT COUNT(*) as c FROM vehicles WHERE key_closet_id = $1', [req.params.id]);
  if (Number(rows[0].c) > 0) {
    return res.status(400).json({ error: `لا يمكن الحذف — يوجد ${rows[0].c} مركبة مرتبطة بهذا الصف` });
  }
  await db.query('DELETE FROM key_closets WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
