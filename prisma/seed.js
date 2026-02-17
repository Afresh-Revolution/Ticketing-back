import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

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
  const existing = await prisma.heroSection.findFirst();
  if (existing) {
    console.log('Hero section already exists, skip seed.');
    return;
  }
  await prisma.heroSection.create({ data: defaultHero });
  console.log('Hero section seeded.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
