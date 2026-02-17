const currentYear = new Date().getFullYear();

const DEFAULT_FOOTER = {
  brand: {
    name: 'GATEWAVE',
    logoUrl: null,
    description:
      'The premier platform for discovering and hosting events. We connect passionate organizers with enthusiastic attendees to create unforgettable experiences.',
    social: [
      { id: 'facebook', name: 'Facebook', href: 'https://facebook.com', icon: 'facebook' },
      { id: 'twitter', name: 'Twitter', href: 'https://twitter.com', icon: 'twitter' },
      { id: 'instagram', name: 'Instagram', href: 'https://instagram.com', icon: 'instagram' },
      { id: 'youtube', name: 'YouTube', href: 'https://youtube.com', icon: 'youtube' },
    ],
  },
  columns: [
    {
      id: 'explore',
      title: 'Explore',
      links: [
        { id: 'browse', text: 'Browse Events', href: '/events' },
        { id: 'upcoming', text: 'Upcoming Events', href: '/events?filter=upcoming' },
        { id: 'popular', text: 'Popular Events', href: '/events?filter=popular' },
        { id: 'organizer', text: 'Become an Organizer', href: '/organizer' },
        { id: 'create', text: 'Create an Event', href: '/events/create' },
      ],
    },
    {
      id: 'support',
      title: 'Support',
      links: [
        { id: 'help', text: 'Help Center', href: '/help' },
        { id: 'faqs', text: 'FAQs', href: '/faqs' },
        { id: 'contact', text: 'Contact Support', href: '/contact' },
        { id: 'report', text: 'Report an Issue', href: '/report' },
      ],
    },
    {
      id: 'legal',
      title: 'Legal',
      links: [
        { id: 'terms', text: 'Terms & Conditions', href: '/terms' },
        { id: 'privacy', text: 'Privacy Policy', href: '/privacy' },
        { id: 'refund', text: 'Refund Policy', href: '/refund' },
        { id: 'cookies', text: 'Cookie Policy', href: '/cookies' },
      ],
    },
  ],
  bottom: {
    copyright: `© ${currentYear} Gatewave. All rights reserved.`,
    companyName: 'Gatewave',
    securePaymentText: 'SECURE PAYMENT',
    paymentMethods: ['card', 'visa', 'mastercard'],
  },
};

export const footerModel = {
  get: async () => ({ ...DEFAULT_FOOTER }),
};
