const DEFAULT_JOIN = {
  headline: 'Ready to join the crowd?',
  description:
    'Create an account today to book tickets, manage events, and experience the best live entertainment.',
  ctaButton: {
    text: 'Get Started Now',
    href: '/signup',
  },
};

export const joinModel = {
  get: async () => ({ ...DEFAULT_JOIN }),
};
