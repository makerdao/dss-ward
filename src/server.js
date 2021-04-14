const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  try {
    const content = fs.readFileSync(`graph${ req.url }.json`, 'utf-8');
    res.writeHead(200, headers);
    res.write(content);
  } catch (err) {
    res.writeHead(404, headers);
  }
  res.end();
});
const port = 5783;
console.log(`listening on ${ port }...`);
server.listen(port);
