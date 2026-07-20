import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch("https://wttr.in/?format=3");
    
    if (!res.ok) {
      throw new Error("Failed to fetch from wttr.in");
    }
    
    const text = await res.text();
    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/plain' }
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch weather' }, { status: 500 });
  }
}
