import { opinionFetch } from "@/lib/opinion";

export async function GET(_req, { params }) {
  try {
    const marketId = params?.marketId;
    if (!marketId) {
      return new Response(
        JSON.stringify({ errno: -1, errormsg: "missing_marketId", result: null }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await opinionFetch(`/market/${marketId}`);

    // Return ONLY the useful part to keep response small/stable
    const payload = {
      errno: data?.errno ?? 0,
      errormsg: data?.errormsg ?? "",
      result: data?.result ?? data ?? null,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        errno: -1,
        errormsg: "proxy_exception",
        result: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
