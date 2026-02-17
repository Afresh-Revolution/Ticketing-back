import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL || '';
const isRemote =
  url && !url.includes('localhost') && !url.includes('127.0.0.1');
const connectionString =
  isRemote && url.includes('sslmode=') && !url.includes('uselibpqcompat=')
    ? (url.includes('?') ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`)
    : url;
const pool = new pg.Pool({
  connectionString,
  ssl: isRemote ? { rejectUnauthorized: false } : false,
});

const defaultHero = {
  headline: "Don't Miss the Moment . Get Your Tickets Now.",
  subtitle:
    'Discover concerts, festivals, conferences, and unforgettable experiences and happening near you',
  ctaText: 'Find Events →',
  ctaHref: '/events',
  backgroundImageUrl: null,
  logoText: 'GATEWAVE',
  logoImageUrl: null,
  navLinks: [{ label: 'Explore Events', href: '/events' }],
  signInButtonText: 'Sign In',
  signInButtonHref: '/signin',
  featuredItems: [
    { imageUrl: '', title: 'Featured 1', videoUrl: null, eventId: null },
    { imageUrl: '', title: 'Featured 2', videoUrl: null, eventId: null },
    { imageUrl: '', title: 'Featured 3', videoUrl: null, eventId: null },
  ],
};

async function main() {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query('SELECT id FROM "HeroSection" LIMIT 1');
    if (existing.length > 0) {
      console.log('Hero section already exists, skip seed.');
      return;
    }
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO "HeroSection" (id, headline, subtitle, "ctaText", "ctaHref", "backgroundImageUrl", "logoText", "logoImageUrl", "navLinks", "signInButtonText", "signInButtonHref", "featuredItems")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        defaultHero.headline,
        defaultHero.subtitle,
        defaultHero.ctaText,
        defaultHero.ctaHref,
        defaultHero.backgroundImageUrl,
        defaultHero.logoText,
        defaultHero.logoImageUrl,
        JSON.stringify(defaultHero.navLinks),
        defaultHero.signInButtonText,
        defaultHero.signInButtonHref,
        JSON.stringify(defaultHero.featuredItems),
      ]
    );
    console.log('Hero section seeded.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
