/**
 * vapi-outbound-call — Make outbound AI calls via Vapi
 *
 * Ported from SmokeShopGrowth's vapi_call.js logic into a
 * Supabase Edge Function so the CRM can trigger calls directly.
 *
 * Accepts: { leadId } or { phone, businessName, city }
 * Returns: { success, callId }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}

// ── Vapi call reasons ────────────────────────────────────────────────────────
function pickReason(lead: Record<string, unknown>): string {
  const website = (lead.website as string) || "";
  if (!website || website.trim() === "") return "no website";

  const lowSite = website.toLowerCase();
  const weak = [".wix.", ".wordpress.", ".squarespace.", ".weebly.", "square.site"];
  if (weak.some((w) => lowSite.includes(w))) return "website that could use an upgrade";

  return "website that could bring in more walk-ins";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const VAPI_API_KEY = Deno.env.get("VAPI_API_KEY");
    const VAPI_ASSISTANT_ID = Deno.env.get("VAPI_ASSISTANT_ID");
    const VAPI_PHONE_NUMBER_ID = Deno.env.get("VAPI_PHONE_NUMBER_ID");
    const AGENT_NAME = Deno.env.get("AGENT_NAME") || "Alex";

    if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) {
      throw new Error(
        "Missing Vapi env vars. Set VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID in Supabase secrets."
      );
    }

    const body = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Resolve lead data ────────────────────────────────────────────────
    let lead: Record<string, unknown>;

    if (body.leadId) {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", body.leadId)
        .single();

      if (error || !data) throw new Error("Lead not found");
      lead = data;
    } else if (body.phone && body.businessName) {
      lead = {
        phone: body.phone,
        business_name: body.businessName,
        city: body.city || "",
        website: body.website || "",
      };
    } else {
      throw new Error("Provide leadId or { phone, businessName }");
    }

    const phone = lead.phone as string;
    if (!phone) throw new Error("Lead has no phone number");

    const e164 = normalizePhone(phone);
    const businessName = lead.business_name as string;
    const city = (lead.city as string) || "";
    const reason = pickReason(lead);

    // Truncate long names for Vapi
    const shortName =
      businessName.length > 40
        ? businessName.substring(0, 37) + "..."
        : businessName;

    // ── Make the Vapi call ───────────────────────────────────────────────
    const vapiPayload = {
      assistantId: VAPI_ASSISTANT_ID,
      phoneNumberId: VAPI_PHONE_NUMBER_ID,
      customer: { number: e164, name: shortName },
      assistantOverrides: {
        variableValues: {
          business_name: shortName,
          city,
          problem: reason,
          reason,
          agent_name: AGENT_NAME,
        },
      },
      metadata: {
        lead_id: (lead.id as string) || "",
        business_name: businessName,
        phone: e164,
        city,
        problem: reason,
        source: "blue-rocket-dash",
      },
    };

    console.log(`Calling ${shortName} at ${e164}...`);

    const vapiRes = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vapiPayload),
    });

    if (!vapiRes.ok) {
      const errBody = await vapiRes.text();
      throw new Error(`Vapi API error ${vapiRes.status}: ${errBody}`);
    }

    const callData = await vapiRes.json();
    console.log(`Call initiated: ${callData.id}`);

    // ── Update lead status + log activity ────────────────────────────────
    if (lead.id) {
      await supabase
        .from("leads")
        .update({
          status: "contacted",
          notes: `${(lead.notes as string) || ""}\n[${new Date().toISOString()}] Vapi call initiated — ${callData.id}`.trim(),
        })
        .eq("id", lead.id);

      await supabase.from("lead_activities").insert({
        lead_id: lead.id as string,
        user_id: lead.user_id as string,
        action: "called",
        description: `Outbound Vapi call (${reason}) — call ID: ${callData.id}`,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        callId: callData.id,
        phone: e164,
        businessName,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Vapi call error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Call failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
