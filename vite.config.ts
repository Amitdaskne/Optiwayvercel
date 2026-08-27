import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'index.html'),
          login: path.resolve(__dirname, 'login.html'),
          dashboard: path.resolve(__dirname, 'dashboard.html'),
          sales: path.resolve(__dirname, 'sales.html'),
          orders: path.resolve(__dirname, 'orders.html'),
          salesHistory: path.resolve(__dirname, 'sales-history.html'),
          customers: path.resolve(__dirname, 'customers.html'),
          products: path.resolve(__dirname, 'products.html'),
          inventory: path.resolve(__dirname, 'inventory.html'),
          purchaseBills: path.resolve(__dirname, 'purchase-bills.html'),
          suppliers: path.resolve(__dirname, 'suppliers.html'),
          reports: path.resolve(__dirname, 'reports.html'),
          expenses: path.resolve(__dirname, 'expenses.html'),
          prescriptions: path.resolve(__dirname, 'prescriptions.html'),
          invoice: path.resolve(__dirname, 'invoice.html'),
          settings: path.resolve(__dirname, 'settings.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
