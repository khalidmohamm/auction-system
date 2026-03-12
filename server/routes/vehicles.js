const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// Multer config for car images (disk storage — persists while server is running)
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/images');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Multer config for Excel import
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/imports');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `import-${Date.now()}.xlsx`)
});
const uploadExcel = multer({ storage: excelStorage });

async function logAction(vehicleId, action, details) {
  await db.query(
    'INSERT INTO vehicle_log (vehicle_id, action, details) VALUES ($1, $2, $3)',
    [vehicleId, action, details || null]
  );
}

function buildLocation(v) {
  const parts = [];
  if (v.zone_name || v.owner_name) parts.push(v.zone_name || v.owner_name);
  if (v.parking_row) parts.push(`صف ${v.parking_row}`);
  if (v.parking_slot) parts.push(`موقف ${v.parking_slot}`);
  return parts.join(' / ') || null;
}

const VEHICLE_SELECT = `
  SELECT v.*, o.name as owner_name, z.name as zone_name, z.zone_color as zone_color,
    kc.closet_no as kc_closet_no, kc.row_no as kc_row_no, kc.slots_per_row as kc_slots_per_row,
    v.kc_slot_no as kc_slot_no,
    kcz.zone_color as kc_color, kcz.name as kc_zone_name, kco.name as kc_owner_name
  FROM vehicles v
  LEFT JOIN owners o ON o.id = v.owner_id
  LEFT JOIN zones z ON z.id = v.zone_id
  LEFT JOIN key_closets kc ON kc.id = v.key_closet_id
  LEFT JOIN zones kcz ON kcz.id = kc.zone_id
  LEFT JOIN owners kco ON kco.id = kc.owner_id
`;

// GET all vehicles with filters
router.get('/', async (req, res) => {
  const { search, status, owner_id, zone_id, in_auction, has_keys, page = 1, limit = 50 } = req.query;
  const where = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    const p = params.length;
    where.push(`(v.vin ILIKE $${p} OR v.plate_letters ILIKE $${p} OR v.plate_numbers ILIKE $${p} OR v.brand ILIKE $${p} OR v.model ILIKE $${p} OR o.name ILIKE $${p} OR (v.plate_letters || ' ' || v.plate_numbers) ILIKE $${p})`);
  }
  if (status) { params.push(status); where.push(`v.status = $${params.length}`); }
  if (owner_id) { params.push(owner_id); where.push(`v.owner_id = $${params.length}`); }
  if (zone_id) { params.push(zone_id); where.push(`v.zone_id = $${params.length}`); }
  if (in_auction !== undefined && in_auction !== '') { params.push(Number(in_auction)); where.push(`v.in_auction = $${params.length}`); }
  if (has_keys !== undefined && has_keys !== '') { params.push(Number(has_keys)); where.push(`v.has_keys = $${params.length}`); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Number(page) - 1) * Number(limit);

  const { rows: countRows } = await db.query(`
    SELECT COUNT(*) as count FROM vehicles v
    LEFT JOIN owners o ON o.id = v.owner_id
    ${whereClause}
  `, params);

  params.push(Number(limit), offset);
  const { rows: vehicles } = await db.query(`
    ${VEHICLE_SELECT}
    ${whereClause}
    ORDER BY o.name ASC, v.parking_row ASC, v.parking_slot ASC, v.sequence_no ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const data = vehicles.map(v => ({ ...v, full_location: buildLocation(v) }));
  res.json({ total: Number(countRows[0].count), page: Number(page), limit: Number(limit), data });
});

// GET quick find by plate or VIN
router.get('/find/quick', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const s = `%${q}%`;
  const { rows } = await db.query(`
    ${VEHICLE_SELECT}
    WHERE v.vin ILIKE $1 OR v.plate_numbers ILIKE $1 OR v.plate_letters ILIKE $1
      OR (v.plate_letters || ' ' || v.plate_numbers) ILIKE $1
      OR (v.plate_letters || v.plate_numbers) ILIKE $1
    LIMIT 10
  `, [s]);
  res.json(rows.map(v => ({ ...v, full_location: buildLocation(v) })));
});

// GET single vehicle
router.get('/:id', async (req, res) => {
  const { rows } = await db.query(`${VEHICLE_SELECT} WHERE v.id = $1`, [req.params.id]);
  const vehicle = rows[0];
  if (!vehicle) return res.status(404).json({ error: 'المركبة غير موجودة' });

  const { rows: images } = await db.query(
    'SELECT * FROM vehicle_images WHERE vehicle_id = $1 ORDER BY uploaded_at DESC',
    [req.params.id]
  );
  const { rows: logs } = await db.query(
    'SELECT * FROM vehicle_log WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.params.id]
  );

  res.json({ ...vehicle, full_location: buildLocation(vehicle), images, logs });
});

// POST create vehicle
router.post('/', async (req, res) => {
  const {
    vin, plate_letters, plate_numbers, owner_id, brand, model, color, year,
    status, has_keys, zone_id, zone_note, parking_row, parking_slot,
    in_auction, entry_time, notes, key_closet, key_closet_id, kc_slot_no
  } = req.body;

  const { rows: seqRows } = await db.query('SELECT MAX(sequence_no) as m FROM vehicles');
  const sequence_no = (Number(seqRows[0].m) || 0) + 1;

  try {
    const { rows } = await db.query(`
      INSERT INTO vehicles (
        sequence_no, vin, plate_letters, plate_numbers, owner_id, brand, model, color, year,
        status, has_keys, zone_id, zone_note, parking_row, parking_slot,
        in_auction, entry_time, notes, key_closet, key_closet_id, kc_slot_no, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
      RETURNING id, sequence_no
    `, [
      sequence_no, vin || null, plate_letters || null, plate_numbers || null, owner_id || null,
      brand || null, model || null, color || null, year || null,
      status || 'يعمل', has_keys !== undefined ? Number(has_keys) : 1,
      zone_id || null, zone_note || null,
      parking_row || null, parking_slot || null,
      in_auction !== undefined ? Number(in_auction) : 1,
      entry_time || new Date().toISOString(), notes || null,
      key_closet || null, key_closet_id || null, kc_slot_no || null
    ]);
    await logAction(rows[0].id, 'إضافة', 'تم إضافة المركبة');
    res.json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'رقم الهيكل مكرر أو بيانات غير صحيحة', detail: e.message });
  }
});

// PUT update vehicle
router.put('/:id', async (req, res) => {
  const { rows: oldRows } = await db.query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
  const old = oldRows[0];
  if (!old) return res.status(404).json({ error: 'المركبة غير موجودة' });

  const {
    vin, plate_letters, plate_numbers, owner_id, brand, model, color, year,
    status, has_keys, zone_id, zone_note, parking_row, parking_slot,
    in_auction, entry_time, exit_time, notes, key_closet, key_closet_id, kc_slot_no
  } = req.body;

  if (Number(in_auction) === 0 && old.in_auction === 1) {
    await db.query(`
      UPDATE vehicles SET
        in_auction=0, exit_time=NOW(), updated_at=NOW(),
        vin=$1, plate_letters=$2, plate_numbers=$3, owner_id=$4, brand=$5, model=$6,
        color=$7, year=$8, status=$9, has_keys=$10, zone_id=$11, zone_note=$12,
        parking_row=$13, parking_slot=$14, notes=$15, key_closet=$16, key_closet_id=$17, kc_slot_no=$18
      WHERE id=$19
    `, [
      vin || old.vin, plate_letters || old.plate_letters, plate_numbers || old.plate_numbers,
      owner_id || old.owner_id, brand || old.brand, model || old.model, color || old.color, year || old.year,
      status || old.status, has_keys !== undefined ? Number(has_keys) : old.has_keys,
      zone_id !== undefined ? zone_id || null : old.zone_id,
      zone_note !== undefined ? zone_note : old.zone_note,
      parking_row !== undefined ? parking_row || null : old.parking_row,
      parking_slot !== undefined ? parking_slot || null : old.parking_slot,
      notes !== undefined ? notes : old.notes,
      key_closet !== undefined ? key_closet || null : old.key_closet,
      key_closet_id !== undefined ? key_closet_id || null : old.key_closet_id,
      kc_slot_no !== undefined ? kc_slot_no || null : old.kc_slot_no,
      req.params.id
    ]);
    await logAction(req.params.id, 'خروج من المزاد', `الحالة: ${status || old.status}`);
  } else {
    await db.query(`
      UPDATE vehicles SET
        vin=$1, plate_letters=$2, plate_numbers=$3, owner_id=$4, brand=$5, model=$6,
        color=$7, year=$8, status=$9, has_keys=$10, zone_id=$11, zone_note=$12,
        parking_row=$13, parking_slot=$14, in_auction=$15, entry_time=$16, exit_time=$17,
        notes=$18, key_closet=$19, key_closet_id=$20, kc_slot_no=$21, updated_at=NOW()
      WHERE id=$22
    `, [
      vin || old.vin, plate_letters || old.plate_letters, plate_numbers || old.plate_numbers,
      owner_id || old.owner_id, brand || old.brand, model || old.model, color || old.color, year || old.year,
      status || old.status, has_keys !== undefined ? Number(has_keys) : old.has_keys,
      zone_id !== undefined ? zone_id || null : old.zone_id,
      zone_note !== undefined ? zone_note : old.zone_note,
      parking_row !== undefined ? parking_row || null : old.parking_row,
      parking_slot !== undefined ? parking_slot || null : old.parking_slot,
      in_auction !== undefined ? Number(in_auction) : old.in_auction,
      entry_time || old.entry_time,
      exit_time !== undefined ? exit_time : old.exit_time,
      notes !== undefined ? notes : old.notes,
      key_closet !== undefined ? key_closet || null : old.key_closet,
      key_closet_id !== undefined ? key_closet_id || null : old.key_closet_id,
      kc_slot_no !== undefined ? kc_slot_no || null : old.kc_slot_no,
      req.params.id
    ]);

    const changes = [];
    if (status && status !== old.status) changes.push(`الحالة: ${old.status} ← ${status}`);
    if (has_keys !== undefined && Number(has_keys) !== Number(old.has_keys)) changes.push(`المفاتيح: ${old.has_keys ? 'موجودة' : 'غير موجودة'} ← ${Number(has_keys) ? 'موجودة' : 'غير موجودة'}`);
    if (zone_id !== undefined && String(zone_id) !== String(old.zone_id)) changes.push(`الموقع تغيّر`);
    if (parking_row !== undefined && parking_row !== old.parking_row) changes.push(`الصف: ${old.parking_row || '-'} ← ${parking_row || '-'}`);
    if (parking_slot !== undefined && parking_slot !== old.parking_slot) changes.push(`الموقف: ${old.parking_slot || '-'} ← ${parking_slot || '-'}`);
    if (key_closet_id !== undefined && String(key_closet_id) !== String(old.key_closet_id)) changes.push(`خزانة المفاتيح تغيّرت`);
    if (kc_slot_no !== undefined && kc_slot_no !== old.kc_slot_no) changes.push(`رقم الخانة: ${old.kc_slot_no || '-'} ← ${kc_slot_no || '-'}`);
    if (changes.length) await logAction(req.params.id, 'تعديل', changes.join(' | '));
  }

  res.json({ success: true });
});

// DELETE vehicle
router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM vehicles WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// POST upload image
router.post('/:id/images', uploadImage.array('images', 20), async (req, res) => {
  const { rows } = await db.query('SELECT id FROM vehicles WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'المركبة غير موجودة' });
  const inserted = [];
  for (const file of req.files) {
    const { rows: imgRows } = await db.query(
      'INSERT INTO vehicle_images (vehicle_id, filename) VALUES ($1, $2) RETURNING id, filename',
      [req.params.id, file.filename]
    );
    inserted.push(imgRows[0]);
  }
  await logAction(req.params.id, 'صور', `تم رفع ${req.files.length} صورة`);
  res.json(inserted);
});

// DELETE image
router.delete('/:id/images/:imgId', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM vehicle_images WHERE id = $1 AND vehicle_id = $2',
    [req.params.imgId, req.params.id]
  );
  const img = rows[0];
  if (!img) return res.status(404).json({ error: 'الصورة غير موجودة' });
  const filePath = path.join(__dirname, '../uploads/images', img.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await db.query('DELETE FROM vehicle_images WHERE id = $1', [req.params.imgId]);
  res.json({ success: true });
});

// POST import Excel
router.post('/import/excel', uploadExcel.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع الملف' });
  const wb = XLSX.readFile(req.file.path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (rows.length < 2) return res.status(400).json({ error: 'الملف فارغ' });

  const headers = rows[0];
  const colMap = {};
  headers.forEach((h, i) => {
    if (!h) return;
    const hn = String(h).trim();
    if (hn.includes('هيكل')) colMap.vin = i;
    else if (hn.includes('أحرف') || hn.includes('احرف')) colMap.plate_letters = i;
    else if (hn.includes('أرقام') || hn.includes('ارقام')) colMap.plate_numbers = i;
    else if (hn.includes('مالك') || hn.includes('المالك')) colMap.owner = i;
    else if (hn.includes('تجارية') || hn.includes('علامة')) colMap.brand = i;
    else if (hn.includes('طراز')) colMap.model = i;
    else if (hn.includes('لون') || hn.includes('اللون')) colMap.color = i;
    else if (hn.includes('سنة') || hn.includes('صنع')) colMap.year = i;
  });

  const client = await db.connect();
  let imported = 0, skipped = 0;
  try {
    await client.query('BEGIN');
    const { rows: seqRows } = await client.query('SELECT MAX(sequence_no) as m FROM vehicles');
    let maxSeq = Number(seqRows[0].m) || 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c)) continue;
      const vin = colMap.vin !== undefined ? String(row[colMap.vin] || '').trim() : null;
      const pl = colMap.plate_letters !== undefined ? String(row[colMap.plate_letters] || '').trim() : null;
      const pn = colMap.plate_numbers !== undefined ? String(row[colMap.plate_numbers] || '').trim() : null;
      const ownerName = colMap.owner !== undefined ? String(row[colMap.owner] || '').trim() : null;
      const brand = colMap.brand !== undefined ? String(row[colMap.brand] || '').trim() : null;
      const model = colMap.model !== undefined ? String(row[colMap.model] || '').trim() : null;
      const color = colMap.color !== undefined ? String(row[colMap.color] || '').trim() : null;
      const year = colMap.year !== undefined ? Number(row[colMap.year]) || null : null;

      let owner_id = null;
      if (ownerName) {
        await client.query('INSERT INTO owners (name) VALUES ($1) ON CONFLICT DO NOTHING', [ownerName]);
        const { rows: ownerRows } = await client.query('SELECT id FROM owners WHERE name = $1', [ownerName]);
        if (ownerRows[0]) owner_id = ownerRows[0].id;
      }
      maxSeq++;
      const { rowCount } = await client.query(`
        INSERT INTO vehicles (sequence_no, vin, plate_letters, plate_numbers, owner_id, brand, model, color, year, entry_time, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        ON CONFLICT (vin) DO NOTHING
      `, [maxSeq, vin || null, pl, pn, owner_id, brand, model, color, year]);
      if (rowCount > 0) imported++; else skipped++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'خطأ في الاستيراد', detail: e.message });
  } finally {
    client.release();
    fs.unlinkSync(req.file.path);
  }
  res.json({ imported, skipped, total: rows.length - 1 });
});

// GET export Excel
router.get('/export/excel', async (req, res) => {
  const { owner_id, zone_id, status } = req.query;
  const where = [], params = [];
  if (owner_id) { params.push(owner_id); where.push(`v.owner_id = $${params.length}`); }
  if (zone_id) { params.push(zone_id); where.push(`v.zone_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`v.status = $${params.length}`); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows: vehicles } = await db.query(`
    SELECT
      v.sequence_no as "رقم التسلسل", v.vin as "رقم الهيكل",
      v.plate_letters as "اللوحة/أحرف", v.plate_numbers as "اللوحة/أرقام",
      o.name as "المالك", v.brand as "العلامة التجارية", v.model as "الطراز",
      v.color as "اللون", v.year as "سنة الصنع",
      v.status as "الحالة",
      CASE v.has_keys WHEN 1 THEN 'نعم' ELSE 'لا' END as "المفاتيح",
      v.key_closet as "خزانة المفاتيح",
      z.name as "المنطقة", v.parking_row as "الصف", v.parking_slot as "الموقف",
      CASE v.in_auction WHEN 1 THEN 'داخل المزاد' ELSE 'خارج المزاد' END as "حالة المزاد",
      v.entry_time as "وقت الدخول", v.exit_time as "وقت الخروج", v.notes as "ملاحظات"
    FROM vehicles v
    LEFT JOIN owners o ON o.id = v.owner_id
    LEFT JOIN zones z ON z.id = v.zone_id
    ${whereClause}
    ORDER BY o.name ASC, v.parking_row ASC, v.parking_slot ASC
  `, params);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(vehicles);
  XLSX.utils.book_append_sheet(wb, ws, 'قائمة المركبات');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=vehicles.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET dashboard stats
router.get('/stats/summary', async (req, res) => {
  const [
    { rows: [{ count: total }] },
    { rows: [{ count: inAuction }] },
    { rows: byStatus },
    { rows: byOwner },
    { rows: byZone },
    { rows: [{ count: noKeys }] },
    { rows: [{ count: noLocation }] }
  ] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM vehicles'),
    db.query('SELECT COUNT(*) as count FROM vehicles WHERE in_auction = 1'),
    db.query('SELECT status, COUNT(*) as count FROM vehicles GROUP BY status ORDER BY count DESC'),
    db.query(`SELECT o.id, o.name, COUNT(v.id) as count FROM owners o LEFT JOIN vehicles v ON v.owner_id = o.id GROUP BY o.id ORDER BY count DESC LIMIT 20`),
    db.query(`SELECT z.id, z.name, z.zone_color, COUNT(v.id) as count FROM zones z LEFT JOIN vehicles v ON v.zone_id = z.id GROUP BY z.id ORDER BY count DESC`),
    db.query('SELECT COUNT(*) as count FROM vehicles WHERE has_keys = 0'),
    db.query('SELECT COUNT(*) as count FROM vehicles WHERE zone_id IS NULL AND in_auction = 1')
  ]);

  res.json({
    total: Number(total), inAuction: Number(inAuction),
    noKeys: Number(noKeys), noLocation: Number(noLocation),
    byStatus, byOwner, byZone
  });
});

module.exports = router;
