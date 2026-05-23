const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.dev_tenant:7fuT6l5B50B1o17WJNlrea48rt88rC4l@tsupse.scalingwolf.ai:4321/postgres'
});

async function main() {
  try {
    await client.connect();
    const res = await client.query('SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Error executing query:', err);
  } finally {
    await client.end();
  }
}

main();
