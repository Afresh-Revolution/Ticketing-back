import { query } from '../src/shared/config/db.js';

(async () => {
  try {
    const res = await query(`SELECT id, role, email FROM "User" LIMIT 5`);
    console.log("Users:", res.rows);

  } catch (e) { 
    console.error(e); 
  }
  process.exit();
})();
