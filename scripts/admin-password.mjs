import readline from 'node:readline';
import { hashPassword } from '../server/password.mjs';
if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.');
process.stdout.write('New admin password (12–128 characters, input hidden): ');
readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
let password = '';
process.stdin.on('keypress', async (text, key) => {
  if (key.ctrl && key.name === 'c') process.exit(1);
  if (key.name === 'return') {
    process.stdin.setRawMode(false); process.stdin.pause();
    if (password.length < 12 || password.length > 128) { console.error('\nUse 12–128 characters.'); process.exit(1); }
    console.log(`\nAdd this line to .env and Vercel environment variables:\nADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
    process.exit(0);
  }
  if (key.name === 'backspace') password = password.slice(0, -1);
  else if (text && !key.ctrl && !key.meta) password += text;
});
