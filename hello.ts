export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  return new Response(
    JSON.stringify({
      service: "locateam-geocoder-api",
      status: "ok",
      path: url.pathname,
      timestamp: new Date().toISOString(),
      message: "Hello from LocateAm Neon Function!",
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  );
}
