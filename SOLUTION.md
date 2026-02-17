# Fix: Cannot find module '.prisma/client/default'

## Problem

When starting the app (`npm run dev` or `node src/server.js`), Node threw:

```
Error: Cannot find module '.prisma/client/default'
Require stack:
- ...\node_modules\@prisma\client\default.js
code: 'MODULE_NOT_FOUND'
```

`@prisma/client` expects a **generated** client under `node_modules/.prisma/client/`. That code is created by Prisma from your `prisma/schema.prisma` file. If you never run the generator (or you cloned the repo / reinstalled deps without generating), that folder is missing and the error appears.

## Root cause

The Prisma Client had not been generated after:

- Installing or reinstalling dependencies (`npm install`), or  
- Changing `prisma/schema.prisma`, or  
- Cloning the project and not running the generate step.

`npm install` only installs the `@prisma/client` package; it does **not** run the Prisma code generator. You must run it explicitly (or via a script).

## Solution applied

1. **Generate the Prisma Client** (this was the fix):

   ```bash
   npx prisma generate
   ```

   Or use the project script:

   ```bash
   npm run db:generate
   ```

   This reads `prisma/schema.prisma` and writes the client into `node_modules/@prisma/client` (and the internal `.prisma/client` layout), so `require('@prisma/client')` / `import from '@prisma/client'` can resolve `.prisma/client/default`.

2. **Restart the app**  
   After a successful generate, start the server again:

   ```bash
   npm run dev
   # or
   npm start
   ```

   The "Cannot find module '.prisma/client/default'" error should be gone.

## Prevention

- **After `npm install`** (especially on a fresh clone): run `npx prisma generate` (or `npm run db:generate`) before starting the app.
- **After editing `prisma/schema.prisma`**: run `npx prisma generate` again so the client matches your schema.
- **Optional – postinstall script**: To generate automatically after every `npm install`, add this to `package.json`:

  ```json
  "scripts": {
    "postinstall": "prisma generate"
  }
  ```

  Then anyone who runs `npm install` will get the client generated without a separate step. If you add this, keep using `npm run db:generate` when you change the schema.

## Summary

| What happened | Fix |
|---------------|-----|
| App couldn't find `.prisma/client/default` | Run `npx prisma generate` (or `npm run db:generate`) |
| Avoid in future | Run generate after install/schema changes, or add a `postinstall` script |

After applying the fix, the server should start and connect to the database (assuming `DATABASE_URL` is set in `.env` and migrations are applied).
