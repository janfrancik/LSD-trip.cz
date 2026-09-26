import 'dotenv/config';
import mysql from 'mysql2/promise';

// Sdílený connection pool pro celou aplikaci.
// Všechny dotazy v aplikaci musí jít přes tento pool a používat
// parametrizované placeholdery (?), nikdy skládání SQL řetězcem.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

export default pool;
