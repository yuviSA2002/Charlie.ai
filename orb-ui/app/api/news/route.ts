import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const query = encodeURIComponent('all:bioinformatics');
    const res = await fetch(`https://export.arxiv.org/api/query?search_query=${query}&sortBy=lastUpdatedDate&sortOrder=descending&max_results=3`, {
      next: { revalidate: 86400 } // Cache for 24 hours (86400 seconds)
    });
    
    if (!res.ok) {
      throw new Error("Failed to fetch from Arxiv");
    }
    
    const text = await res.text();
    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/xml' }
    });
  } catch (err: any) {
    console.error("Arxiv fetch error:", err);
    return NextResponse.json({ error: 'Failed to fetch news', details: err.message }, { status: 500 });
  }
}
