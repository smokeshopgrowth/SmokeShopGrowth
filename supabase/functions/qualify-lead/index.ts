/**
 * qualify-lead — Smoke-shop scoring logic
 *
 * Scores 1-10 based on:
 *   +3  has phone (callable)
 *   +2  has email (emailable)
 *   +4  no website (prime prospect — they need one!)
 *   +2  wix/wordpress/square site (needs upgrade)
 *   +1  industry match
 *   -2  already contacted / not interested
 *
 * High-score (≥7) triggers Telegram notification.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { leadId } = await req.json();
    if (!leadId) throw new Error("leadId is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch lead
    const { data: lead, error: fetchError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (fetchError || !lead) throw new Error("Lead not found");

    // ── Scoring ──────────────────────────────────────────────────────────
    let score = 1; // base

    // Contact info
    if (lead.phone) score += 3;
    if (lead.email) score += 2;

    // Website situation — the money signal
    if (!lead.website || lead.website.trim() === "") {
      score += 4; // No website = prime prospect
    } else {
      const site = lead.website.toLowerCase();
      const weakPlatforms = [
        ".wix.com",
        ".wordpress.com",
        ".squarespace.com",
        ".weebly.com",
        ".godaddy.com",
        "square.site",
        "carrd.co",
      ];
      if (weakPlatforms.some((p) => site.includes(p))) {
        score += 2; // Template site — needs upgrade
      }
    }

    // Industry bonus
    const industry = (lead.industry || "").toLowerCase();
    if (
      industry.includes("smoke") ||
      industry.includes("vape") ||
      industry.includes("tobacco") ||
      industry.includes("cbd") ||
      industry.includes("head shop")
    ) {
      score += 1;
    }

    // Penalty for already-worked leads
    if (lead.status === "contacted") score -= 1;
    if (lead.status === "not_interested") score -= 2;

    // Clamp
    score = Math.max(1, Math.min(10, score));

    // ── Update lead ──────────────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        ai_score: score,
        status:
          score >= 7 && lead.status === "new" ? "qualified" : lead.status,
      })
      .eq("id", leadId);

    if (updateError) throw updateError;

    // ── Telegram notification for hot leads ──────────────────────────────
    if (score >= 7) {
      const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

      if (BOT_TOKEN && CHAT_ID) {
        const msg =
          `🔥 *Hot Lead Detected!*\n\n` +
          `*Score:* ${score}/10\n` +
          `*Business:* ${lead.business_name}\n` +
          `*Phone:* ${lead.phone || "N/A"}\n` +
          `*Email:* ${lead.email || "N/A"}\n` +
          `*Website:* ${lead.website || "None"}\n` +
          `*City:* ${lead.city || "Unknown"}\n` +
          `*Source:* ${lead.source || "manual"}`;

        try {
          await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: CHAT_ID,
                text: msg,
                parse_mode: "Markdown",
              }),
            }
          );
        } catch (tgErr) {
          console.error("Telegram notification failed:", tgErr);
        }
      }
    }

    // ── Log activity ─────────────────────────────────────────────────────
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      user_id: lead.user_id,
      action: "scored",
      description: `AI scored ${score}/10${score >= 7 ? " — HOT LEAD" : ""}`,
    });

    return new Response(
      JSON.stringify({ success: true, leadId, score }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Qualify error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Scoring failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
