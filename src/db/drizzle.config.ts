import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../../.env' }); // Adjust relative path to find your root .env file

const connectionUrl = process.env.DATABASE_URL || process.env.SQL_URL;

if (!connectionUrl) {
  throw new Error('DATABASE_URL must be set in environment variables.');
}

export default defineConfig({
  schema: './schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    url: connectionUrl,
  },
  verbose: true,
});