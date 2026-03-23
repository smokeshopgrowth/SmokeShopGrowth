/**
 * scrape-leads — Rewired for smoke shops
 *
 * Accepts { city, userId, bizType? } and uses Firecrawl's search
 * + Google Maps enrichment to find smoke/vape shops, insert them
 * into the leads table, and auto-trigger qualify-lead scoring.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── helpers ──────────────────────────────────────────────────────────────────
function cleanPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function dedupeByPhone(
  leads: Record<string, unknown>[]
): Record<string, unknown>[] {
  const seen = new Set<string>();
  return leads.filter((l) => {
    const p = l.phone as string | null;
    if (!p) return true; // keep leads without phone (can enrich later)
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

// ── main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { city, userId, bizType } = await req.json();
    if (!city || !userId) {
      throw new Error("city and userId are required");
    }

    const searchType = bizType || "smoke shop";

    // Init Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY is missing");
    }

    console.log(`Scraping ${searchType}s in ${city}...`);

    // ── Step 1: Firecrawl search ─────────────────────────────────────────
    const searchQueries = [
      `${searchType}s in ${city}`,
      `vape shops in ${city}`,
      `tobacco stores in ${city}`,
    ];

    const allResults: Record<string, unknown>[] = [];

    for (const query of searchQueries) {
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, limit: 10 }),
        });

        if (!res.ok) {
          console.error(`Firecrawl search failed for "${query}": ${res.status}`);
          continue;
        }

        const result = await res.json();
        if (result.success && result.data) {
          allResults.push(...result.data);
        }
      } catch (err) {
        console.error(`Firecrawl query error for "${query}":`, err);
      }
    }

    if (allResults.length === 0) {
      throw new Error(`No results found for ${searchType}s in ${city}`);
    }

    // ── Step 2: Map to lead schema ───────────────────────────────────────
    // Dedupe by URL first
    const seenUrls = new Set<string>();
    const uniqueResults = allResults.filter((item: Record<string, unknown>) => {
      const url = (item.url as string) || "";
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });

    // Extract phone/email from descriptions where possible
    const phoneRx = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
    const emailRx = /[\w.-]+@[\w.-]+\.\w{2,}/;

    const leadsToInsert = uniqueResults.map(
      (item: Record<string, unknown>) => {
        const desc = (item.description as string) || "";
        const phoneMatch = desc.match(phoneRx);
        const emailMatch = desc.match(emailRx);

        return {
          business_name: (item.title as string) || "Unknown Shop",
          industry: "Smoke Shop",
          phone: cleanPhone(phoneMatch ? phoneMatch[0] : null),
          email: emailMatch ? emailMatch[0] : null,
          website: (item.url as string) || null,
          ai_score: null, // will be set by qualify-lead
          status: "new",
          source: "scraper",
          notes: `Scraped from Firecrawl: ${desc}`.slice(0, 500),
          user_id: userId,
          city: city,
        };
      }
    );

    const dedupedLeads = dedupeByPhone(leadsToInsert);

    // ── Step 3: Skip leads that already exist (by business_name + city) ──
    const { data: existing } = await supabase
      .from("leads")
      .select("business_name")
      .eq("user_id", userId)
      .in(
        "business_name",
        dedupedLeads.map((l) => l.business_name)
      );

    const existingNames = new Set(
      (existing || []).map(
        (l: { business_name: string }) => l.business_name
      )
    );
    const newLeads = dedupedLeads.filter(
      (l) => !existingNames.has(l.business_name as string)
    );

    if (newLeads.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `All ${dedupedLeads.length} leads already exist for ${city}`,
          inserted: 0,
          skipped: dedupedLeads.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Step 4: Insert ───────────────────────────────────────────────────
    const { data: inserted, error: insertError } = await supabase
      .from("leads")
      .insert(newLeads)
      .select();

    if (insertError) throw insertError;

    console.log(`Inserted ${inserted.length} leads for ${city}`);

    // ── Step 5: Auto-score each lead ─────────────────────────────────────
    const scorePromises = inserted.map((lead: { id: string }) =>
      supabase.functions.invoke("qualify-lead", {
        body: { leadId: lead.id },
      })
    );
    await Promise.allSettled(scorePromises);

    // ── Step 6: Log activity for each lead ───────────────────────────────
    const activities = inserted.map((lead: { id: string }) => ({
      lead_id: lead.id,
      user_id: userId,
      action: "created",
      description: `Lead scraped from ${city} (${searchType})`,
    }));
    await supabase.from("lead_activities").insert(activities);

    return new Response(
      JSON.stringify({
        success: true,
        city,
        inserted: inserted.length,
        skipped: dedupedLeads.length - newLeads.length,
        leads: inserted.map(
          (l: { id: string; business_name: string; ai_score: number }) => ({
            id: l.id,
            business_name: l.business_name,
            ai_score: l.ai_score,
          })
        ),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Scrape error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Scrape failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
