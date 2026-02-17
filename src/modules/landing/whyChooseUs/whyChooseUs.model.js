const DEFAULT_WHY_CHOOSE_US = {
  title: 'Why choose Us',
  leftColumn: [
    { id: '1', text: '100% Secure Transactions' },
    { id: '2', text: 'Instant Digital Tickets' },
    { id: '3', text: 'Trusted Event Organizers' },
    { id: '4', text: 'Smooth Booking Experience' },
  ],
  rightColumn: [
    { id: '5', text: 'Dedicated Customer Support' },
    { id: '6', text: 'Verified & Trusted Events' },
    { id: '7', text: 'Fast, Seamless Checkout' },
    { id: '8', text: 'Reliable Customer Support' },
  ],
};

export const whyChooseUsModel = {
  get: async () => ({ ...DEFAULT_WHY_CHOOSE_US }),
};
