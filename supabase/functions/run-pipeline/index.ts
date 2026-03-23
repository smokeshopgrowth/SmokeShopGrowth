/**
 * run-pipeline — Full automation orchestrator
 *
 * The "one button" that chains the entire flow:
 *   1. Scrape smoke shops in a city
 *   2. Score/qualify each lead
 *   3. Auto-call leads with phone numbers (via Vapi)
 *   4. Generate demo websites for high-scoring leads
 *   5. Email the preview link
 *
 * Accepts: { city, userId, options? }
 * Options:
 *   - autoCall:     boolean (default true)  — trigger Vapi calls
 *   - autoGenerate: boolean (default true)  — generate demo sites
 *   - autoEmail:    boolean (default false) — send preview emails
 *   - minScore:     number  (default 6)     — minimum score to call/generate
 *   - maxCalls:     number  (default 10)    — max calls per run
 *   - callDelay:    number  (default 15)    — seconds between calls
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PipelineOptions {
  autoCall: boolean;
  autoGenerate: boolean;
  autoEmail: boolean;
  minScore: number;
  maxCalls: number;
  callDelay: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { city, userId } = body;

    if (!city || !userId) {
      throw new Error("city and userId are required");
    }

    const opts: PipelineOptions = {
      autoCall: body.options?.autoCall ?? true,
      autoGenerate: body.options?.autoGenerate ?? true,
      autoEmail: body.options?.autoEmail ?? false,
      minScore: body.options?.minScore ?? 6,
      maxCalls: body.options?.maxCalls ?? 10,
      callDelay: body.options?.callDelay ?? 15,
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results = {
      city,
      steps: {} as Record<string, unknown>,
      errors: [] as string[],
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: SCRAPE
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[Pipeline] Step 1: Scraping smoke shops in ${city}...`);

    const { data: scrapeResult, error: scrapeError } =
      await supabase.functions.invoke("scrape-leads", {
        body: { city, userId, bizType: "smoke shop" },
      });

    if (scrapeError) {
      results.errors.push(`Scrape failed: ${scrapeError.message}`);
      results.steps["scrape"] = { success: false, error: scrapeError.message };
    } else {
      results.steps["scrape"] = {
        success: true,
        inserted: scrapeResult.inserted,
        skipped: scrapeResult.skipped,
      };
      console.log(
        `[Pipeline] Scraped ${scrapeResult.inserted} new leads (${scrapeResult.skipped} skipped)`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: FETCH QUALIFIED LEADS
    // ═══════════════════════════════════════════════════════════════════════
    // Give scoring a moment to complete (it runs async in scrape-leads)
    await sleep(3000);

    console.log(
      `[Pipeline] Step 2: Fetching leads scored ≥${opts.minScore}...`
    );

    const { data: qualifiedLeads, error: fetchError } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId)
      .gte("ai_score", opts.minScore)
      .in("status", ["new", "qualified"])
      .order("ai_score", { ascending: false });

    if (fetchError) {
      results.errors.push(`Fetch leads failed: ${fetchError.message}`);
      results.steps["qualify"] = { success: false, error: fetchError.message };
      return respondJson(results, corsHeaders);
    }

    results.steps["qualify"] = {
      success: true,
      qualifiedCount: qualifiedLeads?.length || 0,
    };

    console.log(
      `[Pipeline] Found ${qualifiedLeads?.length || 0} qualified leads`
    );

    if (!qualifiedLeads || qualifiedLeads.length === 0) {
      return respondJson(results, corsHeaders);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: CALL (if enabled)
    // ═══════════════════════════════════════════════════════════════════════
    if (opts.autoCall) {
      const callableLeads = qualifiedLeads
        .filter((l) => l.phone && l.status !== "contacted")
        .slice(0, opts.maxCalls);

      console.log(
        `[Pipeline] Step 3: Calling ${callableLeads.length} leads...`
      );

      const callResults: {
        leadId: string;
        name: string;
        success: boolean;
        callId?: string;
        error?: string;
      }[] = [];

      for (const lead of callableLeads) {
        try {
          const { data, error } = await supabase.functions.invoke(
            "vapi-outbound-call",
            { body: { leadId: lead.id } }
          );

          if (error) throw error;

          callResults.push({
            leadId: lead.id,
            name: lead.business_name,
            success: true,
            callId: data.callId,
          });
        } catch (err) {
          callResults.push({
            leadId: lead.id,
            name: lead.business_name,
            success: false,
            error: err instanceof Error ? err.message : "Call failed",
          });
        }

        // Delay between calls to avoid Vapi concurrency limits
        if (callableLeads.indexOf(lead) < callableLeads.length - 1) {
          await sleep(opts.callDelay * 1000);
        }
      }

      results.steps["call"] = {
        success: true,
        attempted: callResults.length,
        succeeded: callResults.filter((c) => c.success).length,
        failed: callResults.filter((c) => !c.success).length,
        details: callResults,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: GENERATE DEMO WEBSITES (if enabled)
    // ═══════════════════════════════════════════════════════════════════════
    if (opts.autoGenerate) {
      // Generate for leads that don't already have a generated website
      const leadsNeedingSites = qualifiedLeads.filter(
        (l) => l.ai_score >= opts.minScore
      );

      // Check which already have generated sites
      const leadIds = leadsNeedingSites.map((l) => l.id);
      const { data: existingSites } = await supabase
        .from("generated_websites")
        .select("lead_id")
        .in("lead_id", leadIds);

      const existingLeadIds = new Set(
        (existingSites || []).map((s: { lead_id: string }) => s.lead_id)
      );
      const leadsToGenerate = leadsNeedingSites.filter(
        (l) => !existingLeadIds.has(l.id)
      );

      console.log(
        `[Pipeline] Step 4: Generating ${leadsToGenerate.length} demo websites...`
      );

      const genResults: {
        leadId: string;
        name: string;
        success: boolean;
      }[] = [];

      for (const lead of leadsToGenerate.slice(0, 20)) {
        try {
          await supabase.functions.invoke("generate-website", {
            body: {
              leadId: lead.id,
              templateId: "bold",
              businessName: lead.business_name,
              industry: lead.industry || "Smoke Shop",
            },
          });

          genResults.push({
            leadId: lead.id,
            name: lead.business_name,
            success: true,
          });
        } catch (err) {
          genResults.push({
            leadId: lead.id,
            name: lead.business_name,
            success: false,
          });
        }
      }

      results.steps["generate"] = {
        success: true,
        generated: genResults.filter((g) => g.success).length,
        failed: genResults.filter((g) => !g.success).length,
        skipped: existingLeadIds.size,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: EMAIL PREVIEWS (if enabled)
    // ═══════════════════════════════════════════════════════════════════════
    if (opts.autoEmail) {
      // Get leads with generated websites AND email addresses
      const { data: emailableLeads } = await supabase
        .from("generated_websites")
        .select("*, leads!inner(id, email, business_name)")
        .eq("leads.user_id", userId)
        .not("leads.email", "is", null);

      const toEmail = (emailableLeads || []).filter(
        (site: Record<string, unknown>) => {
          const lead = site.leads as Record<string, unknown>;
          return lead && lead.email;
        }
      );

      console.log(`[Pipeline] Step 5: Emailing ${toEmail.length} previews...`);

      let emailsSent = 0;
      for (const site of toEmail.slice(0, 20)) {
        const lead = site.leads as Record<string, unknown>;
        try {
          await supabase.functions.invoke("send-website-email", {
            body: {
              leadEmail: lead.email,
              leadName: lead.business_name,
              businessName: site.business_name,
              websitePreviewUrl: `${supabaseUrl.replace(".supabase.co", "")}.lovable.app/website/${site.public_id}`,
            },
          });
          emailsSent++;
        } catch (err) {
          console.error(`Email failed for ${lead.email}:`, err);
        }
      }

      results.steps["email"] = {
        success: true,
        sent: emailsSent,
        total: toEmail.length,
      };
    }

    return respondJson(results, corsHeaders);
  } catch (error) {
    console.error("Pipeline error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Pipeline failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function respondJson(
  data: unknown,
  headers: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
