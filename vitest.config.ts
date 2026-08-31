import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    environment: 'node',
    // `.env` — только секреты, и только через тот же разбор, каким их видит `vpe` (`V-06`).
    // Денежный флаг `ELEVENLABS_LIVE` файл не даёт: см. шапку `packages/cli/bin/test-env.ts`.
    setupFiles: ['packages/cli/bin/test-env.ts'],
    // Тесты границ M3/M4/M5 создают и удаляют временные файлы-нарушители внутри
    // packages/**. Параллельный запуск файлов сделал бы их зависимыми друг от друга:
    // ESLint одного теста увидел бы нарушителя другого.
    fileParallelism: false,
  },
});
