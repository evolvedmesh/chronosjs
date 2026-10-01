/** The payment provider is down: every payment fails, the way a real outage would. */
export async function POST() {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return Response.json({ error: "Payment provider did not answer in time" }, { status: 502 });
}
