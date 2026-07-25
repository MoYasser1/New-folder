export const APP = {
  name: import.meta.env.VITE_APP_NAME || 'Yasser AI Academy',
  instructor: 'م. محمد ياسر',
  support: 'support@yasser-ai.academy',
  paymentMode: import.meta.env.VITE_PAYMENT_MODE || 'sandbox',
} as const;
