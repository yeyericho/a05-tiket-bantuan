// Konfigurasi proyek A05. Membaca .env di folder proyek bila ada, lalu jatuh
// ke nilai bawaan yang cocok dengan compose.yml proyek ini (kredensial dummy lokal).
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

function integer(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} harus bilangan bulat ${min}-${max}`);
  }
  return value;
}

module.exports = {
  ROOT,
  amqpUrl: process.env.AMQP_URL || 'amqp://simpel:simpel123@localhost:5673',
  databaseUrl: process.env.DATABASE_URL || 'postgres://simpel:simpel123@localhost:5442/tiket',
  mgmt: {
    url: process.env.RABBITMQ_MGMT_URL || 'http://localhost:15673',
    user: process.env.RABBITMQ_USER || 'simpel',
    pass: process.env.RABBITMQ_PASS || 'simpel123',
    vhost: process.env.RABBITMQ_VHOST || '/',
  },
  prefetch: () => integer('WORKER_PREFETCH', 4, 1, 100),
  workMs: () => integer('WORKER_WORK_MS', 0, 0, 10000),
  integer,
};
