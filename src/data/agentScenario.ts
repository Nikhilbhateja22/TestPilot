export const createLocatorRepairScenario = (origin = 'http://localhost:5173') => ({
  title: 'Locator drift recovery',
  executionMode: 'live' as const,
  steps: [
    {
      type: 'setViewport',
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: false,
    },
    {
      type: 'navigate',
      url: `${origin}/demo-store?mutation=locator-drift`,
    },
    {
      type: 'click',
      target: 'main',
      selectors: [
        ['aria/Add Trail Camera to cart[role="button"]'],
        ['[data-testid="add-camera"]'],
      ],
    },
    {
      type: 'waitForElement',
      selectors: [['[data-testid="cart-confirmation"]']],
    },
  ],
})