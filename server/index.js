const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/owners', require('./routes/owners'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/closets', require('./routes/closets'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/key-checkouts', require('./routes/keyCheckouts'));

// Serve React build in production
const buildPath = path.join(__dirname, '../client/build');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

// Global error handler — returns JSON instead of HTML
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'خطأ في الخادم', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`\n✅ الخادم يعمل على المنفذ ${PORT}`);
  console.log(`🌐 افتح المتصفح على: http://localhost:${PORT}\n`);
});
