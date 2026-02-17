const DEFAULT_BEFORE_BOOK_IMAGE = {
  imageUrl: null,
  altText: 'Event booking – live experience',
  backButton: {
    show: true,
    href: '/events',
    ariaLabel: 'Back',
  },
};

export const imageModel = {
  get: async () => ({ ...DEFAULT_BEFORE_BOOK_IMAGE }),
};
