import { query } from '../src/shared/config/db.js';

(async () => {
  try {
    const res = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'WalkInSale';
    `);
    console.log("WalkInSale columns", res.rows);
    
    const res2 = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'User';
    `);
    console.log("User columns", res2.rows);

    const res3 = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Event';
    `);
    console.log("Event columns", res3.rows);

  } catch (e) { 
    console.error(e); 
  }
  process.exit();
})();
