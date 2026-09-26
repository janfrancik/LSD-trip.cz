import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Statický web (index.html + assets) - beze změny proti původnímu návrhu.
app.use(express.static(publicDir));

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// GET /api/poptavky - seznam poptávek, nejnovější první
app.get(
  '/api/poptavky',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, jmeno, email, zprava, vyrizeno, created_at, updated_at FROM poptavky ORDER BY created_at DESC'
    );
    res.json(rows);
  })
);

// GET /api/poptavky/:id - detail jedné poptávky
app.get(
  '/api/poptavky/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM poptavky WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Poptávka nenalezena' });
    }
    res.json(rows[0]);
  })
);

// POST /api/poptavky - odeslání kontaktního formuláře
app.post(
  '/api/poptavky',
  asyncHandler(async (req, res) => {
    const { jmeno, email, zprava } = req.body ?? {};

    if (typeof jmeno !== 'string' || !jmeno.trim()) {
      return res.status(400).json({ error: 'Pole "jmeno" je povinné' });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Pole "email" musí být platná adresa' });
    }

    const [result] = await pool.query(
      'INSERT INTO poptavky (jmeno, email, zprava) VALUES (?, ?, ?)',
      [jmeno.trim(), email.trim(), typeof zprava === 'string' ? zprava.trim() : null]
    );

    const [rows] = await pool.query('SELECT * FROM poptavky WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/poptavky/:id/vyrizeno - označení poptávky jako vyřízené/nevyřízené
app.patch(
  '/api/poptavky/:id/vyrizeno',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [existingRows] = await pool.query('SELECT * FROM poptavky WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Poptávka nenalezena' });
    }

    const newVyrizeno = existingRows[0].vyrizeno ? 0 : 1;
    await pool.query('UPDATE poptavky SET vyrizeno = ? WHERE id = ?', [newVyrizeno, id]);

    const [rows] = await pool.query('SELECT * FROM poptavky WHERE id = ?', [id]);
    res.json(rows[0]);
  })
);

// DELETE /api/poptavky/:id - smazání poptávky
app.delete(
  '/api/poptavky/:id',
  asyncHandler(async (req, res) => {
    const [result] = await pool.query('DELETE FROM poptavky WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Poptávka nenalezena' });
    }
    res.status(204).send();
  })
);

// GET /api/health - kontrola dostupnosti DB (hodí se pro monitoring/healthcheck)
app.get(
  '/api/health',
  asyncHandler(async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  })
);

// Neznámé /api/* cesty vracejí JSON, ne HTML shell.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Neznámý endpoint' });
});

// Zbytek obsluhuje shell - web routuje na hashi, tohle jen zajistí,
// že se index.html vrátí i pro přímý vstup na jakoukoli cestu.
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// centrální error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Interní chyba serveru' });
});

app.listen(port, () => {
  console.log(`Server běží na http://localhost:${port}`);
});
