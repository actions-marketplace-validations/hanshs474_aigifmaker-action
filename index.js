// AI GIF Maker GitHub Action. Plain node, no dependencies: inputs come from INPUT_* env vars,
// outputs go to $GITHUB_OUTPUT.
'use strict';
const fs = require('fs');
const path = require('path');
const { Aigifmaker } = require('./client');

const input = (name) => (process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '').trim();

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`${name}=${value}`);
}

async function main() {
  const key = input('api-key');
  if (key) console.log(`::add-mask::${key}`);
  const client = new Aigifmaker({ apiKey: key });
  const id = await client.submit(input('prompt'));
  setOutput('id', id);
  console.log(`submitted GIF ${id}; polling`);
  const url = await client.wait(id, { timeoutMs: (Number(input('timeout-minutes')) || 15) * 60_000 });
  setOutput('gif-url', url);
  const out = input('output-path');
  if (out) {
    const target = path.resolve(process.env.GITHUB_WORKSPACE || '.', out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(await (await fetch(url)).arrayBuffer()));
    setOutput('path', target);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.log(`::error::${err.message || err}`);
    process.exit(1);
  });
}

module.exports = { main };
