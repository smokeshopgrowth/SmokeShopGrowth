/**
 * vapi-webhook — Receives Vapi call-status webhooks
 *
 * Vapi sends POST requests when calls end with:
 *   - call status (completed, failed, no-answer, busy, etc.)
 *   - transcript of the conversation
 *   - metadata (lead_id, business_name, etc.)
 *
 * This function updates the lead record and logs the call result
 * so you can see outcomes in the CRM dashboard.
 *
 * Configure in Vapi Dashboard → Assistant → Server URL:
 *   https://<project>.supabase.co/functions/v1/vapi-webhook
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
    const payload = await req.json();
    console.log("Vapi webhook received:", JSON.stringify(payload).slice(0, 500));

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Parse Vapi webhook payload ───────────────────────────────────────
    // Vapi sends different message types
    const messageType = payload.message?.type || payload.type || "";

    // We care about "end-of-call-report" which has the full transcript + outcome
    if (
      messageType !== "end-of-call-report" &&
      messageType !== "status-update"
    ) {
      // Acknowledge but don't process other webhook types
      return new Response(JSON.stringify({ received: true, type: messageType }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract data from the payload
    const callData = payload.message || payload;
    const metadata = callData.call?.metadata || callData.metadata || {};
    const leadId = metadata.lead_id;
    const callId = callData.call?.id || callData.callId || "";

    // Call outcome
    const endedReason = callData.endedReason || callData.call?.endedReason || "unknown";
    const duration = callData.call?.duration || callData.duration || 0;
    const transcript = callData.transcript || callData.call?.transcript || "";
    const summary = callData.summary || callData.analysis?.summary || "";

    // Determine the call result category
    let callResult = "unknown";
    if (endedReason === "assistant-ended-call" || endedReason === "customer-ended-call") {
      callResult = duration > 60 ? "interested" : "short_call";
    } else if (endedReason === "voicemail") {
      callResult = "voicemail";
    } else if (endedReason === "customer-busy" || endedReason === "no-answer") {
      callResult = "no_answer";
    } else if (endedReason === "machine-detected") {
      callResult = "voicemail";
    } else {
      callResult = "failed";
    }

    console.log(
      `Call ${callId} for lead ${leadId}: ${callResult} (${endedReason}, ${duration}s)`
    );

    // ── Update lead if we have a lead_id ─────────────────────────────────
    if (leadId) {
      // Build the note
      const timestamp = new Date().toISOString();
      const callNote = [
        `\n--- Call Result [${timestamp}] ---`,
        `Outcome: ${callResult} (${endedReason})`,
        `Duration: ${Math.round(duration)}s`,
        summary ? `Summary: ${summary}` : null,
        transcript
          ? `Transcript: ${typeof transcript === "string" ? transcript.slice(0, 500) : JSON.stringify(transcript).slice(0, 500)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      // Fetch current lead
      const { data: lead } = await supabase
        .from("leads")
        .select("notes, user_id, status")
        .eq("id", leadId)
        .single();

      if (lead) {
        // Update lead status based on call result
        let newStatus = lead.status;
        if (callResult === "interested") {
          newStatus = "qualified";
        } else if (callResult === "voicemail" || callResult === "no_answer") {
          newStatus = "contacted"; // they were called but didn't answer
        }

        await supabase
          .from("leads")
          .update({
            status: newStatus,
            notes: `${lead.notes || ""}${callNote}`,
          })
          .eq("id", leadId);

        // Log activity
        const activityDesc =
          callResult === "interested"
            ? `📞 Call completed (${Math.round(duration)}s) — Lead seems interested!`
            : callResult === "voicemail"
            ? `📞 Went to voicemail`
            : callResult === "no_answer"
            ? `📞 No answer`
            : `📞 Call ended: ${endedReason} (${Math.round(duration)}s)`;

        await supabase.from("lead_activities").insert({
          lead_id: leadId,
          user_id: lead.user_id,
          action: "call_completed",
          description: activityDesc,
        });

        // ── Auto-generate website for interested leads ───────────────────
        if (callResult === "interested") {
          console.log(`Lead ${leadId} seems interested — triggering website generation`);

          // Check if we already generated a site for this lead
          const { data: existingSite } = await supabase
            .from("generated_websites")
            .select("id")
            .eq("lead_id", leadId)
            .maybeSingle();

          if (!existingSite) {
            // Trigger website generation (fire-and-forget)
            supabase.functions
              .invoke("generate-website", {
                body: {
                  leadId,
                  templateId: "bold", // smoke shops look best with the bold dark theme
                },
              })
              .catch((err: Error) =>
                console.error("Auto-generate website failed:", err)
              );
          }

          // Send Telegram notification
          const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
          const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
          if (BOT_TOKEN && CHAT_ID) {
            const msg =
              `🎯 *Interested Lead After Call!*\n\n` +
              `*Business:* ${metadata.business_name || "Unknown"}\n` +
              `*Phone:* ${metadata.phone || "N/A"}\n` +
              `*Call Duration:* ${Math.round(duration)}s\n` +
              `*Summary:* ${summary || "N/A"}\n\n` +
              `_Website demo being auto-generated..._`;

            fetch(
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
            ).catch(() => {});
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        callId,
        leadId,
        result: callResult,
        duration: Math.round(duration),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Vapi webhook error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Webhook processing failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
