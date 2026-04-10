import { query } from '../src/shared/config/db.js';

(async () => {
  try {
    const res = await query(`
      ALTER TABLE "WalkInSale" DROP CONSTRAINT IF EXISTS "WalkInSale_recordedBy_fkey"; 
      ALTER TABLE "WalkInSale" ADD CONSTRAINT "WalkInSale_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id");
    `);
    console.log("Success", res);

  } catch (e) { 
    console.error(e); 
  }
  process.exit();
})();
