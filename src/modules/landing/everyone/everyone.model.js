const DEFAULT_EVERYONE = {
  title: 'Built for Everyone',
  subtitle:
    "Whether you're a die-hard fan or a professional organizer, we've crafted the perfect experience for you.",
  cards: [
    {
      id: 'instant-mobile-entry',
      icon: 'ticket', // or icon URL – frontend can map to component/asset
      title: 'Instant Mobile Entry',
      description:
        'Forget printing. Your phone is your ticket with our secure QR code system',
    },
    {
      id: 'secure-payments',
      icon: 'shield',
      title: 'Secure Payments',
      description:
        'Buy with confidence using our encrypted payment processing system.',
    },
    {
      id: 'global-reach',
      icon: 'globe',
      title: 'Global Reach',
      description:
        'Discover events happening anywhere in the world, right from your pocket.',
    },
  ],
};

export const everyoneModel = {
  get: async () => ({ ...DEFAULT_EVERYONE }),
};
