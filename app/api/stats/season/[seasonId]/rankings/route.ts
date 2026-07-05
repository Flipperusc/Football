import { NextResponse } from "next/server";
import { loadSeasonStats } from "@/lib/server/stats";

export async function GET(_: Request, { params }: { params: { seasonId: string } }) {
  const stats = await loadSeasonStats(params.seasonId);
  if (!stats) return NextResponse.json({ message: "Season not found" }, { status: 404 });
  return NextResponse.json(stats.rankings);
}
