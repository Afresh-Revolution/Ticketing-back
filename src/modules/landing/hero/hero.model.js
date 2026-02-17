import { query } from '../../../shared/config/db.js';

const DEFAULT_HERO = {
  header: {
    logoText: 'GATEWAVE',
    logoImageUrl: null,
    navLinks: [{ label: 'Explore Events', href: '/events' }],
    signInButton: { text: 'Sign In', href: '/signin' },
  },
  hero: {
    backgroundImageUrl: null,
    headline: "Don't Miss the Moment . Get Your Tickets Now.",
    subtitle:
      'Discover concerts, festivals, conferences, and unforgettable experiences and happening near you',
    ctaButton: { text: 'Find Events →', href: '/events' },
  },
  featuredItems: [],
};

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function mapRowToHero(row) {
  const navLinks = parseJson(row?.navLinks, DEFAULT_HERO.header.navLinks);
  const featuredItems = parseJson(row?.featuredItems, DEFAULT_HERO.featuredItems);
  return {
    header: {
      logoText: row?.logoText ?? DEFAULT_HERO.header.logoText,
      logoImageUrl: row?.logoImageUrl ?? DEFAULT_HERO.header.logoImageUrl,
      navLinks: Array.isArray(navLinks) ? navLinks : DEFAULT_HERO.header.navLinks,
      signInButton: {
        text: row?.signInButtonText ?? DEFAULT_HERO.header.signInButton.text,
        href: row?.signInButtonHref ?? DEFAULT_HERO.header.signInButton.href,
      },
    },
    hero: {
      backgroundImageUrl: row?.backgroundImageUrl ?? DEFAULT_HERO.hero.backgroundImageUrl,
      headline: row?.headline ?? DEFAULT_HERO.hero.headline,
      subtitle: row?.subtitle ?? DEFAULT_HERO.hero.subtitle,
      ctaButton: {
        text: row?.ctaText ?? DEFAULT_HERO.hero.ctaButton.text,
        href: row?.ctaHref ?? DEFAULT_HERO.hero.ctaButton.href,
      },
    },
    featuredItems: Array.isArray(featuredItems) ? featuredItems : DEFAULT_HERO.featuredItems,
  };
}

export const heroModel = {
  async get() {
    try {
      const { rows } = await query(
        'SELECT * FROM "HeroSection" ORDER BY "createdAt" DESC LIMIT 1'
      );
      const row = rows[0];
      if (!row) return DEFAULT_HERO;
      return mapRowToHero(row);
    } catch {
      return DEFAULT_HERO;
    }
  },
};
