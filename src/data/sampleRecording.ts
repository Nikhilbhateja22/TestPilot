export const createSampleRecording = (origin = 'http://localhost:5173') => ({
  title: 'Checkout clearance',
  executionMode: 'live' as const,
  steps: [
    {
      type: 'setViewport',
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: false,
    },
    {
      type: 'navigate',
      url: `${origin}/demo-store`,
      assertedEvents: [{ type: 'navigation', url: `${origin}/demo-store`, title: 'Northstar Supply' }],
    },
    {
      type: 'click',
      target: 'main',
      selectors: [['aria/Add Trail Camera to cart[role="button"]'], ['[data-testid="add-camera"]']],
      offsetY: 18,
      offsetX: 72,
    },
    {
      type: 'click',
      target: 'main',
      selectors: [['aria/Open cart[role="button"]'], ['[data-testid="open-cart"]']],
    },
    {
      type: 'change',
      value: 'nikhil@example.com',
      selectors: [['aria/Email address'], ['#checkout-email']],
      target: 'main',
    },
    {
      type: 'change',
      value: 'portfolio-demo',
      selectors: [['aria/Password'], ['#checkout-password']],
      target: 'main',
    },
    {
      type: 'click',
      target: 'main',
      selectors: [['aria/Complete order[role="button"]'], ['#complete-order']],
    },
    {
      type: 'waitForElement',
      selectors: [['text/Order cleared for dispatch'], ['[data-testid="order-success"]']],
      count: 1,
      operator: '>=',
    },
  ],
})