import { createServer } from 'node:http';

const port = Number(process.env.OSRM_TEST_PORT ?? 5100);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  const match = url.pathname.match(/^\/route\/v1\/driving\/([^;]+);([^/]+)$/);
  if (!match) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 'NotFound' }));
    return;
  }
  const parseCoordinate = (value) => value.split(',').map(Number);
  const origin = parseCoordinate(match[1]);
  const destination = parseCoordinate(match[2]);
  const coordinates = [
    origin,
    [(origin[0] + destination[0]) / 2, (origin[1] + destination[1]) / 2],
    destination,
  ];
  const includeGeometry = url.searchParams.get('geometries') === 'geojson';
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      code: 'Ok',
      routes: [
        {
          distance: 2_400,
          duration: 360,
          ...(includeGeometry
            ? { geometry: { type: 'LineString', coordinates } }
            : {}),
        },
      ],
    }),
  );
});

server.listen(port, '127.0.0.1');

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
