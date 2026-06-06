const { Pool, types } = require('pg');

// Return timestamps as strings (not Date objects) to keep same behaviour as SQLite
types.setTypeParser(1114, str => str); // TIMESTAMP
types.setTypeParser(1184, str => str); // TIMESTAMPTZ

// Supabase free tier direct connections (db.*.supabase.co) are IPv6-only.
// Render doesn't support IPv6, so convert to the IPv4 session pooler automatically.
function resolveConnectionString(url) {
  if (!url) return url;
  const m = url.match(/^postgresql:\/\/postgres:(.+)@db\.([^.]+)\.supabase\.co:5432\/postgres$/);
  if (m) {
    const [, password, projectId] = m;
    return `postgresql://postgres.${projectId}:${password}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;
  }
  return url;
}

const pool = new Pool({
  connectionString: resolveConnectionString(process.env.DATABASE_URL),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = pool;
