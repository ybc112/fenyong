const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const handlerPath = (name) => {
  const localPath = path.join(__dirname, 'api', `${name}.js`);
  if (fs.existsSync(localPath)) return localPath;
  return path.resolve(__dirname, '..', '..', 'frontend 3', 'api', `${name}.js`);
};

const stakingHandler = require(handlerPath('staking'));
const rpcHandler = require(handlerPath('rpc'));

const PORT = Number(process.env.PORT || 8787);

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) {
      resolve(undefined);
      return;
    }
    try {
      resolve(JSON.parse(raw));
    } catch (error) {
      reject(error);
    }
  });
  req.on('error', reject);
});

const createResponse = (res) => {
  let statusCode = 200;
  const response = {
    setHeader: (key, value) => res.setHeader(key, value),
    status: (code) => {
      statusCode = code;
      return response;
    },
    json: (payload) => {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(statusCode);
      res.end(JSON.stringify(payload));
    },
    end: (payload = '') => {
      res.writeHead(statusCode);
      res.end(payload);
    },
  };
  return response;
};

const sendJson = (res, code, payload) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'cz-api', time: new Date().toISOString() });
    return;
  }

  try {
    const apiReq = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams.entries()),
      body: req.method === 'POST' ? await readBody(req) : undefined,
    };

    const response = createResponse(res);

    if (url.pathname === '/api/staking') {
      await stakingHandler(apiReq, response);
      return;
    }

    if (url.pathname === '/api/rpc') {
      await rpcHandler(apiReq, response);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error?.message || String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cz-api listening on http://127.0.0.1:${PORT}`);
});
