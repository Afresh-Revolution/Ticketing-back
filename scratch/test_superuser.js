import { query } from '../src/shared/config/db.js';

(async () => {
  try {
    const res = await query(`SELECT * FROM "User" WHERE id = '0'`);
    console.log("Superuser:", res.rows);

  } catch (e) { 
    console.error(e); 
  }
  process.exit();
})();
