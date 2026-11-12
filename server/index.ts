import { createApp } from './app.js';

const app = await createApp(process.argv.includes('--dev'));
const port = Number(process.env.PORT ?? 3000);
app.http.listen(port, '0.0.0.0', () => console.log(`나라입찰 실행 중: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
