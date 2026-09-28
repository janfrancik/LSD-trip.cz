import 'dotenv/config';
import mysql from 'mysql2';

// Sdílený connection pool pro celou aplikaci.
// Všechny dotazy v aplikaci musí jít přes tento pool a používat
// parametrizované placeholdery (?), nikdy skládání SQL řetězcem.
//
// Čas: v databázi je všechno v UTC. Spojení proto nastavuje time_zone na
// '+00:00', takže NOW(), CURRENT_TIMESTAMP i výchozí hodnoty sloupců píšou UTC
// bez ohledu na to, jak má server nastavenou zónu. `timezone: 'Z'` zase říká
// ovladači, aby JS Date do dotazu posílal jako UTC. Na Europe/Prague se
// převádí až při zobrazení (src/cas.js).
const zakladni = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  timezone: 'Z',
});

// Nastavuje se u každého nového spojení v poolu, ne jednorázově - pool si
// spojení otevírá průběžně a nové by jinak zdědilo zónu serveru.
zakladni.on('connection', (spojeni) => {
  spojeni.query("SET time_zone = '+00:00'");
});

const pool = zakladni.promise();

export default pool;
