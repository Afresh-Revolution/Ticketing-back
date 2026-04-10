import { query } from '../src/shared/config/db.js';

(async () => {
  try {
    const res = await query(`
      INSERT INTO "WalkInSale" ("eventId", "fullName", "recordedBy") 
      VALUES ('test', 'test', 'test') 
      RETURNING id
    `);
    console.log("Success", res);

  } catch (e) { 
    console.error(e); 
  }
  process.exit();
})();
