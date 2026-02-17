const DEFAULT_CATEGORIES = {
  title: 'Browse Categories',
  categories: [
    { id: 'music', name: 'Music', icon: 'music' },
    { id: 'tech', name: 'Tech', icon: 'tech' },
    { id: 'food', name: 'Food', icon: 'food' },
    { id: 'art', name: 'Art', icon: 'art' },
    { id: 'nightlife', name: 'Nightlife', icon: 'nightlife' },
  ],
};

export const categoriesModel = {
  get: async () => ({ ...DEFAULT_CATEGORIES }),
};
